"""Probe 帚 / 㘣 with a control, forcing IPv4 at the socket layer.

The CUV text for 賽 14:23 in bible-data.json read 「我要用滅亡的掃㘣掃淨他」 —
㘣 (U+3623, CJK Ext A) is a data-entry error for 帚. This checks whether the
corrected 帚 is audible on the zh-HK voices, and whether the erroneous 㘣 is
silent, so the fix is grounded in measurement rather than assumption.

Why the socket patch: in this WSL environment speech.platform.bing.com resolves
to IPv6 first and the IPv6 path fails the WebSocket upgrade with
WSServerHandshakeError 403, while the HTTPS voices/list call on the same host
returns 200. The patch drops AAAA answers so the client uses IPv4. It must
capture the ORIGINAL getaddrinfo once, or the patched function recurses into
itself (RecursionError, seen on the first attempt).

A control character is synthesised first and the verdict is withheld if it
fails — see skill wsl-edge-tts-ipv6-403.
"""
import asyncio
import socket
import subprocess
import sys
from pathlib import Path

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, *args, **kwargs):
    res = _orig_getaddrinfo(host, port, *args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


socket.getaddrinfo = _ipv4_only

import edge_tts  # noqa: E402  (must follow the patch)

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_probe_zhou")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),
    ("帚", "zhou"),
    ("㘣", "jiao"),
    ("掃帚", "scan_zhou"),
    ("掃㘣", "scan_jiao"),
    ("我要用滅亡的掃帚掃淨它。", "verse_fix"),
]


def dur(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=30).stdout.strip() or 0)


async def probe(text: str, tag: str) -> dict:
    row = {}
    for t, v in VOICES.items():
        p = OUT / f"{tag}_{t}.mp3"
        try:
            await edge_tts.Communicate(text, v).save(str(p))
            row[t] = f"{dur(p):.2f}s/{p.stat().st_size}B"
        except Exception as e:                              # noqa: BLE001
            row[t] = f"{type(e).__name__}"
    print(f"  {text:22} F={row['F']:<24} M={row['M']}", flush=True)
    return row


async def main() -> int:
    print(f"edge-tts {edge_tts.__version__}")
    rows = {}
    for text, tag in CASES:
        rows[text] = await probe(text, tag)

    if "s/" not in rows["媽"]["F"]:
        print("\nCONTROL FAILED — service unreachable, verdict withheld.")
        return 1

    def v(text: str) -> str:
        f = rows[text]["F"]
        return "SILENT" if "s/" not in f else f

    print(f"\nVERDICTS (control OK {rows['媽']['F']}):")
    for t in ("帚", "㘣", "掃帚", "掃㘣", "我要用滅亡的掃帚掃淨它。"):
        print(f"  {t:22} {v(t)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
