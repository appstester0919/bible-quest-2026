"""Force IPv4 for Edge TTS inside WSL.

In this environment DNS for speech.platform.bing.com resolves to IPv6 first
(2620:1ec:33::10) and WSL2's IPv6 path does not carry the WebSocket upgrade, so
every synthesis ends in WSServerHandshakeError 403 while the service itself is
perfectly healthy — voices/list returns 200 over the same name. Upgrading
edge-tts (7.2.7 → 7.3.1) does not help, because the failure is below the
library.

Pin the A record in /etc/hosts for the process. If it works, probe; if the
host cannot be written, still try, because the resolver cache may already hold
the IPv4 answer from an earlier getent.
"""
import socket
import subprocess
import sys
from pathlib import Path

HOSTS = Path("/etc/hosts")
NAMES = ["speech.platform.bing.com", "speech.platform.bing.com."]


def ipv4_of(name: str) -> str | None:
    for family in (socket.AF_INET,):
        try:
            info = socket.getaddrinfo(name, 443, family, socket.SOCK_STREAM)
            return info[0][4][0]
        except socket.gaierror:
            continue
    return None


def pin() -> str:
    ip = ipv4_of("speech.platform.bing.com")
    if not ip:
        return "could not resolve an IPv4 address"
    lines = HOSTS.read_text().splitlines()
    keep = [ln for ln in lines
            if not any(n in ln for n in NAMES) and "edge-tts ipv4" not in ln]
    keep.append(f"{ip} speech.platform.bing.com  # edge-tts ipv4 pin")
    try:
        HOSTS.write_text("\n".join(keep) + "\n")
    except PermissionError as e:
        return f"could not write {HOSTS}: {e}"
    return f"pinned {ip}"


if __name__ == "__main__":
    print(pin())
    sys.stdout.flush()
    # Verify through the library rather than through socket, since the library
    # is what actually failed.
    import asyncio

    import edge_tts

    async def go():
        try:
            await asyncio.wait_for(
                edge_tts.Communicate("媽", "zh-HK-HiuGaaiNeural").save("/tmp/hb2.mp3"),
                timeout=25)
            return "OK"
        except Exception as e:                                  # noqa: BLE001
            return f"{type(e).__name__}: {str(e)[:70]}"

    print(asyncio.run(go()))
