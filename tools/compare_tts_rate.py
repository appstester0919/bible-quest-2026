"""Is the 屬靈書 audio actually faster than scripture, or is it misremembered?

Both pipelines call edge_tts.Communicate(text, voice) with NO rate= argument, so
edge-tts's default (+0%) applies to both. Any perceived speed difference must
therefore come from the TEXT, not from a parameter.

Candidate causes, each measurable:
  1. Voice — scripture uses WanLung (male) on some books, HiuGaai (female) on
     others; WanLung is ~5.5s per 4.83 chars baseline. If the book used a
     female voice and scripture used male for the material the user remembers,
     that alone would read as "faster".
  2. Punctuation — scripture is verse-per-line with heavy 逗號/句號, which
     inserts pauses. Prose paragraphs use 、and ；and long comma-spliced clauses;
     dense commas actually make it FASTER (less pause), so this could go either
     way.
  3. Character count per unit time — measure chars/sec directly on real files
     and compare against the 4.83 conservative floor already in the scripture
     pipeline. This is the decisive number.

Method: probe duration with ffprobe on already-generated files, divide the
chapter's character count by the duration, and compare. No new synthesis, so
this is cheap and does not disturb the running job.
"""

import asyncio
import json
import subprocess
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")

VOICES_BIBLE = {"female": "zh-HK-HiuGaaiNeural", "male": "zh-HK-WanLungNeural"}


def dur(path: Path) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=15,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def chapter_chars(lang: str, n: int) -> int:
    d = json.loads((ROOT / lang / f"{n:02d}.json").read_text(encoding="utf-8"))
    return sum(len(b.get("text", "")) for b in d["blocks"] if b["type"] == "p")


def main() -> None:
    print(f"{'lang':<9} {'ch':>3} {'chars':>7} {'sec':>7} {'chars/s':>9}")
    rates = []
    for lang in ("zh-Hant", "zh-Hans"):
        for mp3 in sorted((ROOT / "audio" / lang).glob("*.mp3")):
            n = int(mp3.stem)
            c, s = chapter_chars(lang, n), dur(mp3)
            if not s:
                continue
            cps = c / s
            rates.append((lang, n, cps))
            print(f"{lang:<9} {n:>3} {c:>7} {s:>7.1f} {cps:>9.2f}")

    if rates:
        lo = min(r[2] for r in rates)
        hi = max(r[2] for r in rates)
        avg = sum(r[2] for r in rates) / len(rates)
        print(f"\nchars/sec  min={lo:.2f}  avg={avg:.2f}  max={hi:.2f}")
        print(f"scripture pipeline conservative floor: 4.83")
        print(f"female voice nominal ~5.5, male ~4.83 (from generate_tts_v2.py)")


main()