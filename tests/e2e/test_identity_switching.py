#!/usr/bin/env python3
"""
test_identity_switching.py — End-to-end regression test for Bible Quest 2026
identity-driven background switching.

Verifies the full user flow:
  1. Login as test user
  2. Visit /settings, confirm body data-identity renders correctly
  3. Click each identity radio (Uni/High/Prim) and verify:
     - body data-identity updates
     - background-image URL matches the identity's background
     - DB persists the change (verified via direct REST query)
  4. Restore Uni (clean state for next run)

Run: /usr/bin/python3 tests/e2e/test_identity_switching.py
Requires: aidc running (Chrome on CDP 127.0.0.1:9222), Playwright Python SDK installed
"""
import json
import sys
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9222"
PWA = "https://bible-quest-2026.vercel.app"
SUPABASE = "https://xybrbennsttjttxuxqoq.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5YnJiZW5uc3R0anR0eHV4cW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTM5OTcsImV4cCI6MjA5ODgyOTk5N30.Q3IER7XqhseimIRn60ynuBeJTY8Iu_KCjZgWnC6zF34"
TEST_EMAIL = "apkhlai@cityu.edu.hk"
TEST_PASSWORD = "MasterTesting0919"

IDENTITY_BG_MAP = {
    "Uni": "/identity-bg/Uni.jpg",
    "High": "/identity-bg/High.jpg",
    "Prim": "/identity-bg/Prim.jpg",
}


def fail(msg):
    print(f"❌ FAIL: {msg}")
    sys.exit(1)


def ok(msg):
    print(f"✅ {msg}")


def get_db_identity() -> str:
    """Read current identity from DB via direct REST query."""
    # Login
    login_body = json.dumps({"email": TEST_EMAIL, "password": TEST_PASSWORD}).encode()
    req = urllib.request.Request(
        f"{SUPABASE}/auth/v1/token?grant_type=password",
        data=login_body, method="POST",
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        auth = json.loads(r.read())
    jwt = auth["access_token"]
    user_id = auth["user"]["id"]

    # Query profile
    q_url = f"{SUPABASE}/rest/v1/profiles?select=identity&id=eq.{user_id}"
    req2 = urllib.request.Request(q_url, headers={"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"})
    with urllib.request.urlopen(req2, timeout=10) as r:
        profiles = json.loads(r.read())
    if not profiles:
        fail(f"no profile found for user_id={user_id}")
    return profiles[0]["identity"]


def main():
    print("=" * 60)
    print("Bible Quest identity switching — E2E regression test")
    print("=" * 60)

    # Pre-check: DB starts in known state
    db_start = get_db_identity()
    print(f"\nDB identity at start: {db_start!r}")
    if db_start not in IDENTITY_BG_MAP:
        fail(f"DB identity {db_start!r} not in {list(IDENTITY_BG_MAP)}")

    # Pre-check: aidc reachable
    try:
        with urllib.request.urlopen(f"{CDP}/json/version", timeout=3) as r:
            ws_url = json.loads(r.read())["webSocketDebuggerUrl"]
        ok(f"CDP reachable, browser WS: {ws_url}")
    except Exception as e:
        fail(f"CDP unreachable at {CDP}: {e}. Run 'aidc' on WSL host first.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(ws_url)
            page = browser.contexts[0].pages[0]

            # 1. Login
            print("\n[1] Login")
            page.goto(f"{PWA}/login", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(3000)
            page.fill("#email", TEST_EMAIL)
            page.fill("#password", TEST_PASSWORD)
            page.click("button[type=submit]")
            page.wait_for_timeout(5000)
            if "/dashboard" not in page.url and "/onboarding" not in page.url:
                fail(f"login did not redirect to dashboard: {page.url}")
            ok(f"login OK, at {page.url}")

            # 2. Settings page
            print("\n[2] Settings page")
            page.goto(f"{PWA}/settings", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(5000)
            initial_id = page.evaluate("() => document.body.dataset.identity")
            ok(f"server-rendered body identity: {initial_id!r}")

            # 3. Cycle through all 3 identities
            for label_text, code in [("高中生", "High"), ("小五六", "Prim"), ("大專生", "Uni")]:
                print(f"\n[3.{code}] Click {label_text}")
                page.locator("label").filter(has_text=label_text).first.click()
                page.wait_for_timeout(10000)
                actual_id = page.evaluate("() => document.body.dataset.identity")
                actual_bg = page.evaluate("() => getComputedStyle(document.body).backgroundImage")
                if actual_id != code:
                    fail(f"expected identity={code!r}, got {actual_id!r}")
                expected_bg_fragment = IDENTITY_BG_MAP[code]
                if expected_bg_fragment not in actual_bg:
                    fail(f"expected bg containing {expected_bg_fragment!r}, got {actual_bg!r}")
                ok(f"  body identity={actual_id!r}, bg contains {expected_bg_fragment}")
                # Cross-check DB
                db_now = get_db_identity()
                if db_now != code:
                    fail(f"DB identity={db_now!r}, expected {code!r}")
                ok(f"  DB identity={db_now!r} (persisted)")

            browser.close()
    except Exception as e:
        fail(f"unexpected error during test: {e}")

    # Final restore check (Uni was the last click)
    db_end = get_db_identity()
    if db_end != "Uni":
        fail(f"final DB state should be 'Uni', got {db_end!r}")
    ok(f"\nFinal DB identity: {db_end!r} (test left system in clean state)")
    print("\n✅ ALL CHECKS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
