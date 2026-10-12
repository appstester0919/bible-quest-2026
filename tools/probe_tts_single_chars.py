"""One isolated character per clip, for judging pronunciation by ear.

The combined probe in probe_tts_chars.py proved the characters produce audio but
could not show whether they are READ correctly — 馱 could come out as to/duo,
and only a listener can tell. Mixing four characters into one clip worked for
silence-detection but not for judgement, so this emits each character on its
own, slowed, with generous head/tail silence.

Per character, per voice:
  {char}_iso   the character alone — the purest test
  {char}_twice the character twice, spaced — makes a wrong reading obvious
Plus 對照 chars 媽 (mā) and 騎 (qí), known-good Cantonese, so the user can
confirm the clip's own quality before judging the three suspects.

Everything is a separate mp3; nothing is concatenated.
"""
import asyncio
import subprocess
from pathlib import Path

import edge_tts

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_single")
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

SUBJECTS = ["馱", "囫", "圇", "媽", "騎"]

RATE = "-25%"          # slow enough to catch a substituted syllable
PITCH = "+0Hz"


async def clip(voice: str, text: str, path: Path) -> tuple[float, int]:
    await edge_tts.Communicate(
        text, voice, rate=RATE, pitch=PITCH).save(str(path))
    d = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=30).stdout.strip()
    return float(d or 0), path.stat().st_size


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'file':22} {'secs':>6} {'bytes':>8}")
    for tag, voice in VOICES.items():
        for ch in SUBJECTS:
            for kind, text in (("iso", ch), ("twice", f"{ch}。{ch}。")):
                name = f"{ch}_{kind}_{tag}.mp3"
                secs, size = await clip(voice, text, OUT / name)
                flag = "  <-- NO AUDIO" if secs < 0.25 else ""
                print(f"{name:22} {secs:6.2f} {size:8d}{flag}")
    print(f"\n{OUT}")


if __name__ == "__main__":
    asyncio.run(main())