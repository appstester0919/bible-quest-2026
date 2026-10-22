"""Control experiment: how much does edge-tts vary between two runs of the SAME text?

The 屬靈書 regen produced per-chapter duration deltas of -22.3 s to +27.8 s
against the previous render, and the substituted characters are all
one-syllable-for-one-syllable (禰→祢, 羣→群, 單→丹 …). If the deltas were
caused by the substitution they would all point the same way; they don't, so
the likely cause is that edge-tts does not render the same text to the same
length twice.

This measures that directly: render one chapter twice and compare. It is the
only way to tell "the change moved the audio" from "the renderer is noisy".
"""
import asyncio
import json
import socket
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, *args, **kwargs):
    res = _orig_getaddrinfo(host, port, *args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


socket.getaddrinfo = _ipv4_only

import edge_tts  # noqa: E402
from tts_char_substitutions import tts_text  # noqa: E402

ULT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_variance")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural")


def chapter_text(ch: dict) -> str:
    return tts_text("".join(b["text"] for b in ch["blocks"] if b["type"] == "p"))


def dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


async def main():
    nums = [int(x) for x in (sys.argv[1].split(",") if len(sys.argv) > 1
                             else ["6", "11"])]
    for num in nums:
        raw = json.loads((ULT / "zh-Hant" / f"{num:02d}.json").read_text(
            encoding="utf-8"))
        text = chapter_text(raw)
        voice = VOICES[0 if num % 2 else 1]
        ds = []
        for i in (1, 2):
            p = OUT / f"ch{num:02d}_run{i}.mp3"
            await edge_tts.Communicate(text, voice).save(str(p))
            d = dur(p)
            ds.append(d)
            print(f"  ch{num:02d} run{i}: {d:.1f}s  ({p.stat().st_size:,}B)")
        delta = abs(ds[1] - ds[0])
        print(f"ch{num:02d}: run-to-run Δ = {delta:.1f}s "
              f"({delta / ds[0]:.2%} of the chapter)\n")


if __name__ == "__main__":
    asyncio.run(main())
