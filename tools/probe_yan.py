"""Probe 饜 and its proposed substitute 厭 in their real corpus context.

饜 appears twice in bible-data.json, both in the single compound 貪得無饜
(箴 21:26, 結 22:12), which is the same sense as 貪得無厭. User direction:
「饜 在 edge tts 無聲，用『厭』音修」.

Both characters are checked bare and inside the compound, because for 圇 the two
tests disagreed — 圇 returns NoAudioReceived bare AND is dropped mid-word, and
only the compound measurement proves a substitution actually restores the
syllable. Control 媽 (known-good) is included so a service failure cannot be
mistaken for a character verdict; that exact confusion is why the earlier
饜 probe was discarded.
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import edge_tts

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_single")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),          # control: must produce audio, else the service is down
    ("饜", "char_orig"),
    ("厭", "char_sub"),
    ("貪得無饜的", "phrase_orig"),
    ("貪得無厭的", "phrase_fix"),
]


def dur(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=30).stdout.strip() or 0)


async def probe(text: str, tag: str) -> dict:
    row = {}
    for t, v in VOICES.items():
        p = OUT / f"yan_{tag}_{t}.mp3"
        try:
            await edge_tts.Communicate(text, v).save(str(p))
            row[t] = f"{dur(p):.2f}s/{p.stat().st_size}B"
        except Exception as e:                              # noqa: BLE001
            row[t] = f"{type(e).__name__}"
    print(f"{text:20} F={row['F']:<28} M={row['M']}", flush=True)
    return row


async def main() -> int:
    rows = {}
    for text, tag in CASES:
        rows[text] = await probe(text, tag)

    ctrl = rows["媽"]["F"]
    if "s/" not in ctrl:
        print("\nCONTROL FAILED — service unreachable, verdicts would be "
              "meaningless. Stop.")
        return 1
    print(f"\ncontrol OK ({ctrl}) → verdicts below are trustworthy")
    print(f"  饜 bare      : {rows['饜']['F']}")
    print(f"  厭 bare      : {rows['厭']['F']}")
    print(f"  貪得無饜的   : {rows['貪得無饜的']['F']}")
    print(f"  貪得無厭的   : {rows['貪得無厭的']['F']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
