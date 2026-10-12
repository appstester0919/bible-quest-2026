"""Regenerate every chapter touched by one or more TTS substitutions.

    python3 tools/regen_by_char.py 馱 圇
    python3 tools/regen_by_char.py --dry-run 馱

regen_chapters.py takes an explicit chapter list, which is right when you
already know the chapters. After adding a character to tts_char_substitutions
the chapters are whatever the corpus scan turns up — 馱 alone is 27 chapters
across 18 books — and listing them by hand is exactly the step that gets
skipped. This does the scan and the regen.

Chapters longer than 600s are refused, not silently truncated: only 詩 119 is
in that range today and it must go through regen_split_chapters.py so both
halves keep one voice. If one is ever needed here, the refusal names it.
"""
import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import generate_tts_v2 as G  # noqa: E402
from regen_chapters import chapters_with, verses_of  # noqa: E402
from tts_char_substitutions import TTS_CHAR_MAP, tts_text  # noqa: E402

SPLIT_REQUIRED_SEC = 600


def duration(p: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=30)
    return float(r.stdout.strip() or 0)


async def regen(abbr: str, ch: int, dry: bool) -> bool:
    verses = verses_of(abbr, ch)
    text = tts_text("".join(v[1] if isinstance(v, (list, tuple)) else str(v)
                            for v in verses))
    voice = G.VOICE_FEMALE if ch % 2 else G.VOICE_MALE
    out = ROOT / "public/audio" / abbr / f"{abbr}{ch}.mp3"
    per = G.SECONDS_PER_CHAR["female" if voice == G.VOICE_FEMALE else "male"]
    want = len(text) * per
    if dry:
        print(f"  {abbr}{ch:<4} {len(text):5}字 ≈{want:.0f}s")
        return True
    ok, dur, size = await G._save_and_verify(text, voice, str(out))
    print(f"  {abbr}{ch:<4} {'OK   ' if ok else 'SHORT'} {dur:7.1f}s "
          f"({dur / want * 100:3.0f}%) {size // 1024}KB", flush=True)
    return ok


async def run(targets: list[tuple[str, int]], dry: bool) -> int:
    skipped, bad, n = [], [], 0
    for abbr, ch in targets:
        existing = ROOT / "public/audio" / abbr / f"{abbr}{ch}.mp3"
        if existing.exists() and duration(existing) > SPLIT_REQUIRED_SEC:
            skipped.append(f"{abbr}{ch}")
            print(f"  {abbr}{ch:<4} SKIP — {duration(existing):.0f}s exceeds "
                  f"{SPLIT_REQUIRED_SEC}s; use regen_split_chapters.py so both "
                  f"halves share one voice", flush=True)
            continue
        n += 1
        if not await regen(abbr, ch, dry):
            bad.append(f"{abbr}{ch}")
    print(f"\n{n} chapters {'listed' if dry else 'regenerated'}, "
          f"{len(bad)} short, {len(skipped)} skipped as split-required")
    if bad:
        print(f"  SHORT: {' '.join(bad)}")
    if skipped:
        print(f"  SPLIT: {' '.join(skipped)}")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chars", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    unknown = [c for c in args.chars if c not in TTS_CHAR_MAP]
    if unknown:
        print(f"not in TTS_CHAR_MAP ({len(TTS_CHAR_MAP)} mapped): "
              f"{' '.join(unknown)}")
        return 2

    targets = chapters_with(set(args.chars))
    print(f"{' '.join(args.chars)} → {len(targets)} chapters")
    return asyncio.run(run(targets, args.dry_run))


if __name__ == "__main__":
    sys.exit(main())