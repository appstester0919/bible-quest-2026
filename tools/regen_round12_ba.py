#!/usr/bin/env python3
"""
Round-12 narrow regen: 鈸→拔 only. Regenerate 10 chapters in a single event
loop (CRITICAL fix — per-chapter asyncio.run() tears down aiohttp connection
state between chapters and edge_tts returns empty mp3s after the first few).

Targets:
  代上15 / 代上16 / 代上25 / 代下5 / 代下29 / 尼12 / 拉3 / 撒下6 / 林前13 / 詩150

Reuses generate_chapter from generate_tts_v2.py. TTS_CHAR_MAP (with 鈸→拔) is
already applied inside tts_text().
"""
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter, BIBLE_DATA, DELAY_BETWEEN_BATCHES

TARGETS = [
    ("代上", 15),
    ("代上", 16),
    ("代上", 25),
    ("代下", 5),
    ("代下", 29),
    ("尼", 12),
    ("拉", 3),
    ("撒下", 6),
    ("林前", 13),
    ("詩", 150),
]


async def run_all():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    bible_data = data["data"]

    print(f"[ROUND-12 narrow regen: 鈸→拔] (single event loop)")
    print(f"Targets: {TARGETS}")
    print(f"Source bible data: {BIBLE_DATA} (UNTOUCHED — TTS sub only)")
    print()

    results = []
    for i, (abbr, ch) in enumerate(TARGETS):
        if abbr not in bible_data or str(ch) not in bible_data[abbr]:
            print(f"SKIP {abbr} {ch} — not in bible data")
            continue
        verses = bible_data[abbr][str(ch)]
        voice = "F" if ch % 2 == 1 else "M"
        print(f"[{i+1}/{len(TARGETS)}] {abbr} {ch} ({voice})... ", end="", flush=True)
        r = await generate_chapter(abbr, ch, verses)  # <-- await, NOT asyncio.run
        if r["status"] == "ok":
            print(f"OK {r['size']}B ({r['duration']:.1f}s) attempts={r['attempts']}")
        else:
            print(f"FAIL {r.get('error', 'unknown')}")
        results.append(r)
        if i < len(TARGETS) - 1:
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\n=== Round-12 regen complete: {ok}/{len(results)} OK ===")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run_all()))