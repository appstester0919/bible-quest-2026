"""Regenerate exactly the chapters that contain a newly-added TTS substitution.

Round-24 added 圇→崙. The existing regen_tts_affected_chapters.py rebuilds all
532 chapters containing ANY of the 50 mapped characters, which is the right
tool after a bulk change and wildly wasteful after a one-character addition —
it also has no --dry-run, so invoking it "to see the scope" silently started
regenerating. This takes an explicit chapter list and does nothing else.

    python3 tools/regen_chapters.py 箴 1 耶 19
    python3 tools/regen_chapters.py --list 圇        # what does this char touch?
    python3 tools/regen_chapters.py --dry-run 箴 1

Reuses generate_tts_v2._save_and_verify, so the truncation guard that caught
但以理書 11 applies here too. Does NOT touch .tts_gen_log.json.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import generate_tts_v2 as G  # noqa: E402
from tts_char_substitutions import TTS_CHAR_MAP, tts_text  # noqa: E402


def chapters_with(chars: set[str]) -> list[tuple[str, int]]:
    data = json.loads((ROOT / "public/bible-data.json").read_text(encoding="utf-8"))
    out = []
    for abbr, chs in data["data"].items():
        for ch, verses in chs.items():
            text = "".join(v[1] if isinstance(v, (list, tuple)) else str(v)
                           for v in verses)
            if any(c in text for c in chars):
                out.append((abbr, int(ch)))
    return sorted(out, key=lambda t: (t[0], t[1]))


def verses_of(abbr: str, ch: int) -> list:
    data = json.loads((ROOT / "public/bible-data.json").read_text(encoding="utf-8"))
    chs = data["data"][abbr]
    return chs.get(str(ch)) or chs.get(ch) or []


async def do(abbr: str, ch: int, dry: bool) -> bool:
    verses = verses_of(abbr, ch)
    text = tts_text("".join(v[1] if isinstance(v, (list, tuple)) else str(v)
                            for v in verses))
    voice = G.VOICE_FEMALE if ch % 2 else G.VOICE_MALE
    out = ROOT / "public/audio" / abbr / f"{abbr}{ch}.mp3"
    per = G.SECONDS_PER_CHAR["female" if voice == G.VOICE_FEMALE else "male"]
    want = len(text) * per
    if dry:
        print(f"  {abbr}{ch} {len(text)}字 expect ≈{want:.0f}s "
              f"(need ≥{want * G.MIN_DURATION_RATIO:.0f}s) [dry]")
        return True

    ok, dur, size = await G._save_and_verify(text, voice, str(out))
    print(f"  {abbr}{ch} {'OK  ' if ok else 'SHORT'} {dur:7.1f}s "
          f"({dur / want * 100:3.0f}%) {size // 1024}KB", flush=True)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", help="list chapters touched by this character")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("book", nargs="?")
    ap.add_argument("chapter", nargs="?", type=int)
    args = ap.parse_args()

    if args.list:
        if args.list not in TTS_CHAR_MAP:
            print(f"{args.list!r} is not a mapped character. "
                  f"{len(TTS_CHAR_MAP)} mapped: {' '.join(TTS_CHAR_MAP)}")
            return 2
        for abbr, ch in chapters_with({args.list}):
            print(f"  {abbr}{ch}")
        return 0

    if not args.book or args.chapter is None:
        ap.print_help()
        return 2

    results = asyncio.run(do(args.book, args.chapter, args.dry_run))
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())