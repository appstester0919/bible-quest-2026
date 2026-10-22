"""Probe 攢 → 賺, control first, in real corpus context.

攢 has two Cantonese readings (shyyp.net, 羊羊粵語審音字典): cyun4 and zaan2,
the second from 廣韻「作旱切」. The first reading (cyun4) would map cleanly to
存, but 賽 23:18 already contains 存 immediately after 攢 — 「必不積攢存留」 —
so substituting 存 produces 「積存存留」, two identical syllables in a row. KH LAI
rejected that as unnatural and chose the second reading, 賺, which avoids the
collision.

One honest caveat recorded here rather than glossed over: 賺 is zaan6, while 攢's
dictionary reading is zaan2 — the tone differs by one. The choice is driven by
the engine's actual output and by avoiding the repeated syllable, not by exact
tone matching, so the ear test is what settles it.

Corpus: 1 occurrence, 1 chapter (賽 23). Control-first per skill
wsl-edge-tts-ipv6-403 — no verdict is printed if the control fails.
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

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_probe_zan2")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),
    ("攢", "zan_orig"),
    ("賺", "sub_zaan"),
    ("積賺存留", "phrase_fix"),
    ("必不積賺存留", "verse_fix"),
    ("必不積攢存留", "verse_orig"),
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
            row[t] = type(e).__name__
    print(f"  {text:16} F={row['F']:<24} M={row['M']}", flush=True)
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
    for t in ("攢", "賺", "積賺存留", "必不積賺存留", "必不積攢存留"):
        print(f"  {t:16} {v(t)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
