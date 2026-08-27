#!/usr/bin/env python3
"""
Round-10 narrow regen: 鉈→陀 only. Regenerate just 4 chapters:
  賽28 / 賽34 / 王下21 / 亞4
Reuses generate_chapter from generate_tts_v2.py which already applies
TTS_CHAR_MAP (including our new 鉈→陀) via tts_text().

Why this script exists:
- regen_tts_affected_chapters.py with default scope = 487 chapters (~3 hours).
- regen_tts_affected_chapters.py has no --chapters CLI flag.
- generate_tts_v2.py skips chapters in .tts_gen_log.json (so it won't regen
  even if we delete the log entries, since it walks ALL remaining books).

This script targets exactly the 4 affected chapters in seconds.
"""
import asyncio
import json
import sys
from pathlib import Path

# Reuse same path as regen_tts_affected_chapters.py
sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter, BIBLE_DATA

TARGETS = [
    ("賽", 28),
    ("賽", 34),
    ("王下", 21),
    ("亞", 4),
]


async def main():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    bible_data = data["data"]

    print(f"[ROUND-10 narrow regen: 鉈→陀]")
    print(f"Targets: {TARGETS}")
    print(f"Source bible data: {BIBLE_DATA} (UNTOUCHED — TTS sub only)")
    print()

    results = []
    for abbr, ch in TARGETS:
        if abbr not in bible_data or str(ch) not in bible_data[abbr]:
            print(f"SKIP {abbr} {ch} — not in bible data")
            continue
        verses = bible_data[abbr][str(ch)]
        voice = "F" if ch % 2 == 1 else "M"
        print(f"[{abbr} {ch}] ({voice})... ", end="", flush=True)
        r = await generate_chapter(abbr, ch, verses)
        if r["status"] == "ok":
            print(f"OK {r['size']}B ({r['duration']:.1f}s) attempts={r['attempts']}")
        else:
            print(f"FAIL {r.get('error', 'unknown')}")
        results.append(r)

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\n=== Round-10 regen complete: {ok}/{len(results)} OK ===")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))