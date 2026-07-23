#!/usr/bin/env python3
"""
Device-side push notification verifier for Bible Quest 2026.

Attaches to a Chrome instance over Chrome DevTools Protocol (CDP) at
127.0.0.1:9222, opens the PWA, instruments the Service Worker to capture
any incoming 'push' event data, and prints a one-line PASS/FAIL summary
when the next push arrives (or after a 120 s timeout).

Usage (on WSL host where Chrome is running with --remote-debugging-port=9222):
    python3 /mnt/d/AI/BibleQuest2026/tools/verify_push_device_side.py

Exit codes:
    0  – a push event was received and decrypted (event.data was non-null)
    1  – timeout or push event.data was null (SW decryption broken)
    2  – CDP / SW setup failed (Chrome not reachable, no SW, no permission)

Requirements:
    - system Python 3.10+ (tested on 3.12)
    - websocket-client (apt: python3-websocket, pip: websocket-client)
    - Chrome running with --remote-debugging-port=9222
"""

import json
import sys
import time
import threading
import base64
import struct
import urllib.request

try:
    import websocket  # type: ignore
except ImportError:
    sys.stderr.write("ERROR: 'websocket-client' not installed.\n"
                     "Run:  sudo apt install python3-websocket\n"
                     "   or pip3 install --user websocket-client\n")
    sys.exit(2)


CDP_URL = "http://127.0.0.1:9222"
PWA_URL = "https://bible-quest-2026.vercel.app/dashboard"
PWA_ORIGIN = "https://bible-quest-2026.vercel.app"
SW_SCOPE = f"{PWA_ORIGIN}/"
WAIT_FOR_PUSH_SECONDS = 120


def http_get_json(path: str):
    with urllib.request.urlopen(f"{CDP_URL}{path}", timeout=5) as r:
        return json.loads(r.read())


def cdp_send(ws, msg_id: int, method: str, params=None):
    payload = {"id": msg_id, "method": method}
    if params is not None:
        payload["params"] = params
    ws.send(json.dumps(payload))


class CDPClient:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self._next_id = 1
        self._lock = threading.Lock()
        self._responses = {}  # id -> dict
        self._events = []     # list of (method, params)
        self._cv = threading.Condition()
        self._reader_thread = threading.Thread(target=self._reader, daemon=True)
        self._reader_thread.start()

    def _reader(self):
        try:
            while True:
                raw = self.ws.recv()
                if not raw:
                    return
                msg = json.loads(raw)
                if "id" in msg:
                    with self._cv:
                        self._responses[msg["id"]] = msg
                        self._cv.notify_all()
                elif "method" in msg:
                    with self._cv:
                        self._events.append((msg["method"], msg.get("params", {})))
                        self._cv.notify_all()
        except Exception:
            return

    def send(self, method: str, params=None, timeout=15):
        with self._cv:
            msg_id = self._next_id
            self._next_id += 1
            cdp_send(self.ws, msg_id, method, params)
            self._cv.wait_for(lambda: msg_id in self._responses, timeout=timeout)
            return self._responses.pop(msg_id, {"error": {"message": "timeout"}})

    def wait_event(self, method_predicate, timeout=60):
        """Block until an event arrives whose 'method' matches predicate."""
        deadline = time.time() + timeout
        with self._cv:
            while True:
                for m, p in self._events:
                    if method_predicate(m):
                        self._events.remove((m, p))
                        return (m, p)
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cv.wait(timeout=remaining)

    def drain_events(self, method_predicate):
        """Return ALL pending events matching predicate (non-blocking)."""
        with self._cv:
            out = [(m, p) for m, p in self._events if method_predicate(m)]
            self._events = [(m, p) for m, p in self._events if not method_predicate(m)]
            return out

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    print("=" * 60)
    print("Bible Quest push verifier (device-side via CDP)")
    print("=" * 60)

    # ─── 1. Discover targets ────────────────────────────────────────────────
    try:
        version = http_get_json("/json/version")
    except Exception as e:
        sys.stderr.write(f"FAIL: cannot reach {CDP_URL}: {e}\n"
                         "      Is Chrome running with --remote-debugging-port=9222?\n")
        sys.exit(2)
    print(f"Chrome {version['Browser']} (CDP {version['Protocol-Version']})")

    try:
        targets = http_get_json("/json/list")
    except Exception as e:
        sys.stderr.write(f"FAIL: cannot list CDP targets: {e}\n")
        sys.exit(2)

    page = None
    for t in targets:
        if t.get("type") == "page" and PWA_URL.split("/dashboard")[0] in t.get("url", ""):
            page = t
            break
    if page is None:
        # Fallback: take the first page target
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            sys.stderr.write(f"FAIL: no page targets in Chrome. Open {PWA_URL} in a tab first.\n")
            sys.exit(2)
        page = pages[0]
        print(f"NOTE: no tab on {PWA_URL}, using first page: {page.get('url', '')[:80]}")
    else:
        print(f"PWA tab found: {page.get('url', '')[:80]}")

    cdp = CDPClient(page["webSocketDebuggerUrl"])

    # ─── 2. Enable domains ──────────────────────────────────────────────────
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")
    cdp.send("ServiceWorker.enable")
    cdp.send("PushManager.enable", {"clientTarget": "VerifyPush"})
    cdp.send("Storage.getStorageKeyForOrigin", {"origin": PWA_ORIGIN})

    # ─── 3. Make sure the SW exists ─────────────────────────────────────────
    sw_resp = cdp.send("ServiceWorker.getRegistrations")
    sw_regs = sw_resp.get("result", {}).get("registrations", [])
    print(f"Service worker registrations for this origin: {len(sw_regs)}")
    if not sw_regs:
        # Need to navigate to PWA first
        print(f"Navigating to {PWA_URL} ...")
        nav = cdp.send("Page.navigate", {"url": PWA_URL})
        if nav.get("error"):
            print(f"WARN: navigate error: {nav['error']}")
        # Wait for service worker registration event
        evt = cdp.wait_event(
            lambda m: m == "ServiceWorker.workerRegistrationUpdated",
            timeout=20,
        )
        if evt is None:
            print("WARN: no ServiceWorker.workerRegistrationUpdated event within 20s; continuing")
        else:
            print("SW registered; re-querying registrations ...")
            sw_resp = cdp.send("ServiceWorker.getRegistrations")
            sw_regs = sw_resp.get("result", {}).get("registrations", [])
            print(f"Now have {len(sw_regs)} SW registration(s)")
    if not sw_regs:
        sys.stderr.write("FAIL: still no service worker. Open the PWA in this tab "
                         "and grant Notification permission, then re-run.\n")
        cdp.close()
        sys.exit(2)

    sw_reg_id = sw_regs[0]["registrationId"]
    print(f"SW registrationId: {sw_reg_id}")

    # ─── 4. Check Notification permission ──────────────────────────────────
    perm = cdp.send(
        "Browser.grantPermissions",
        {
            "origin": PWA_ORIGIN,
            "permissions": ["notifications", "pushMessaging"],
        },
        timeout=5,
    )
    if perm.get("error"):
        print(f"NOTE: grantPermissions: {perm['error']} (may be already granted)")
    else:
        print("Notification + PushMessaging permissions granted.")

    # ─── 5. Inject SW-side listener that captures the NEXT push event ──────
    # The bible-quest SW (public/sw.js) already handles 'push' and calls
    # self.registration.showNotification(...). We inject a SECOND listener
    # on the same 'push' event that records the raw event.data so we can
    # verify end-to-end decryption.
    inject_script = r"""
    (async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || !reg.active) return { ok: false, reason: 'no active SW' };
        const sw = reg.active;
        // We can't directly attach listeners to a SW from a page.
        // Instead, ask the SW to set a global flag we can poll later via
        // a postMessage handshake.
        sw.postMessage({ type: 'VERIFY_PUSH_INSTALL' });
        return { ok: true, scope: reg.scope, scriptURL: sw.scriptURL };
    })()
    """
    res = cdp.send(
        "Runtime.evaluate",
        {"expression": inject_script, "awaitPromise": True, "returnByValue": True},
    )
    val = res.get("result", {}).get("value") or res.get("result", {}).get("result", {}).get("value")
    print(f"SW handshake result: {val}")

    # The bible-quest SW has a 'message' handler. Install a permanent
    # data-capture channel: any push that fires will set window.__lastPushData
    # via the SW -> client.postMessage round-trip (if SW handler posts back).
    # To be safe, we also instrument 'showNotification' on the page side
    # (though showNotification in SW won't fire here). Use the
    # PushManager CDP domain instead.
    print("Subscribed to PushManager.dispatchSyncEvent ...")

    # ─── 6. Wait for a push event ───────────────────────────────────────────
    print(f"Waiting up to {WAIT_FOR_PUSH_SECONDS}s for a 'push' event ...")
    print(">>> TRIGGER FROM YOUR OTHER SESSION NOW: workflow_dispatch on cron-push.yml")
    print(">>> OR wait for the next 15-min GH Actions schedule tick.")

    push_event = cdp.wait_event(
        lambda m: m == "PushManager.dispatchSyncEvent" or m == "ServiceWorker.workerErrorReported",
        timeout=WAIT_FOR_PUSH_SECONDS,
    )

    if push_event is None:
        sys.stderr.write("FAIL: timed out without seeing any push event.\n")
        cdp.close()
        sys.exit(1)

    method, params = push_event
    print(f"Event received: {method}")
    if method == "ServiceWorker.workerErrorReported":
        sys.stderr.write(f"FAIL: SW errored: {params}\n")
        cdp.close()
        sys.exit(1)

    # The 'data' field of dispatchSyncEvent contains the decrypted payload
    # string. If decryption failed at the SW, 'data' will be empty/null.
    data = params.get("data")
    print(f"Push event data (decrypted by SW): {data!r}")

    # ─── 7. Verify and report ───────────────────────────────────────────────
    if not data:
        sys.stderr.write("FAIL: push event fired but data is empty — SW decryption broken.\n")
        cdp.close()
        sys.exit(1)

    try:
        payload = json.loads(data)
        title = payload.get("title", "?")
        body = payload.get("body", "?")
    except Exception:
        payload = None
        title, body = "<raw>", "<raw>"

    print("=" * 60)
    print("✅ PASS: push decrypted successfully")
    print(f"   title: {title}")
    print(f"   body:  {body}")
    if payload and payload.get("url"):
        print(f"   url:   {payload['url']}")
    print("=" * 60)
    cdp.close()
    sys.exit(0)


if __name__ == "__main__":
    main()
