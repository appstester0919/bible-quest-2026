"""Does a single-pass Edge TTS call still truncate at ~600s?

詩119 is the decisive case: 3,729 characters in 176 verses, and the committed
mp3 is 1,119 seconds — which exists only because regen_psalm_119_split.py had
to split it into 1-88 / 89-176 and concatenate. If one pass now yields the same
~1,119 seconds, the split machinery is obsolete. If it yields ~600, the cap is
real and the recipe still matters.

Writes to /tmp only. Touches no committed audio.
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path("/mnt/d/AI/BibleQuest2026")
sys.path.insert(0, str(ROOT / "tools"))
from tts_char_substitutions import tts_text  # noqa: E402

VOICE = "zh-HK-HiuGaaiNeural"   # odd chapter → female, same as generate_tts_v2
OUT = Path("/tmp/psalm119_single_pass.mp3")


def probe(p) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=30)
    return float(r.stdout.strip() or 0)


async def main() -> None:
    data = json.loads((ROOT / "public/bible-data.json").read_text(encoding="utf-8"))
    verses = data["data"]["詩"]["119"]
    text = tts_text("".join(v[1] for v in verses))
    print(f"chars: {len(text)}  verses: {len(verses)}", flush=True)
    print(f"expected at measured female rate 0.297 s/char: "
          f"{len(text) * 0.297:.0f}s", flush=True)

    await edge_tts.Communicate(text, VOICE).save(str(OUT))
    got = probe(OUT)
    want = len(text) * 0.297
    print(f"\ngot: {got:.1f}s   expected: {want:.0f}s   "
          f"{got / want * 100:.0f}%", flush=True)
    print("VERDICT: " + ("single pass is fine — split recipe is obsolete"
                         if got > want * 0.85
                         else "CAP IS REAL — a single pass truncates"), flush=True)


if __name__ == "__main__":
    asyncio.run(main())