"""Probe 攢 and its substitute 存, control first, in real corpus context.

Corpus: 1 occurrence, 賽 23:18 「他的貨財和利息要歸耶和華為聖，必不積攢存留」 —
the only 攢 in all 31,103 verses, so 1 chapter.

攢 is cyun4 in Cantonese (shyyp.net), and 存 is also cyun4 — an exact match, and
「積存」 is ordinary modern usage for accumulate/store, so the substituted audio
is correct in meaning as well as sound. That is the ideal case: no reading change
and no meaning change, only a glyph the engine can actually pronounce.

Note the verse already contains 存 immediately after 攢 (「積攢存留」), so the
substituted line reads 「積存存留」 — the same character twice in a row. That is
fine for audio but worth flagging to the user, since a listener may notice the
repetition even though the display text stays canonical 攢.

Control-first, per skill wsl-edge-tts-ipv6-403: no verdict is printed if the
known-good control fails, because on 2026-10-12 a control-less probe reported
every character as silent during an IPv6/WebSocket failure.
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

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_probe_zan")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),
    ("攢", "zan_orig"),
    ("存", "cun_sub"),
    ("積攢存留", "phrase_orig"),
    ("積存存留", "phrase_fix"),
    ("必不積攢存留", "verse_orig"),
    ("必不積存存留", "verse_fix"),
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
    for t in ("攢", "存", "積攢存留", "積存存留", "必不積攢存留", "必不積存存留"):
        print(f"  {t:16} {v(t)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
