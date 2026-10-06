#!/usr/bin/env python3
"""
Round-22 narrow regen: 鵜→提 + 鶘→弧 + 鴞→囂 (all three in one Round).

Corpus scan (walker + grep cross-check, identical counts):
  鵜 × 5  鶘 × 5  鴞 × 3   →  5 distinct chapters after dedup:
  利11:17-18 / 申14:16-17 / 詩102:6 / 賽34:11 / 番2:14

Narrow scope (§19/§26) instead of regen_tts_affected_chapters.py default scope
(487 chapters / ~3 hours). Reuses generate_chapter from generate_tts_v2.py,
which already applies TTS_CHAR_MAP (now 41 mappings) via tts_text().

Voice assignment is FIXED by chapter parity (§ skill Stage 4):
  odd chapter  → F voice (zh-HK-HiuGaaiNeural)
  even chapter → M voice (zh-HK-WanLungNeural)

Prints the generate_chapter() result DICT (§44 — it has no 'path' key).
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter, BIBLE_DATA

TARGETS = [
    ("利", 11),   # F — 鴞鳥 + 鵜鶘
    ("申", 14),   # M — 鴞鳥 + 鵜鶘
    ("詩", 102),  # M — 鵜鶘 + 鴞鳥 (user-reported)
    ("賽", 34),   # M — 鵜鶘 (+ pre-existing 線鉈→線陀 from Round-10)
    ("番", 2),    # M — 鵜鶘
]


async def main():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    bible_data = data["data"]

    print("[ROUND-22 narrow regen: 鵜→提 + 鶘→弧 + 鴞→囂]")
    print(f"Targets: {TARGETS}")
    print(f"Source bible data: {BIBLE_DATA} (UNTOUCHED — Lane-B TTS sub only)")
    print()

    results = []
    for abbr, ch in TARGETS:
        if abbr not in bible_data or str(ch) not in bible_data[abbr]:
            print(f"SKIP {abbr} {ch} — not in bible data")
            continue
        verses = bible_data[abbr][str(ch)]
        voice = "F" if ch % 2 == 1 else "M"
        print(f"[{abbr} {ch}] ({voice} voice, {len(verses)} verses)... ", end="", flush=True)
        r = await generate_chapter(abbr, ch, verses)
        if r["status"] == "ok":
            print(f"OK {r['size']}B {r['duration']:.1f}s voice={r['voice']} attempts={r['attempts']}")
        else:
            print(f"FAIL -> {r}")
        results.append(r)

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\n=== Round-22 regen complete: {ok}/{len(results)} OK ===")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
