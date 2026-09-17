#!/usr/bin/env python3
"""
Round-18 narrow regen: 轡→臂 + ；）→；　） (2026-09-17).

Scope: 6 chapters
  轡→臂 (Lane B TTS_CHAR_MAP, 3 chapters, 3 verses):
    伯 30 (v11 轡頭) — odd  → F (HiuGaaiNeural)
    詩 32 (v9  轡頭) — even → M (WanLungNeural)
    箴 26 (v3  轡頭) — even → M (WanLungNeural)
  ；）→；　） (Lane A pipeline-marker, 4 verses across 3 chapters, user-direct
     no-source-edit Round-18 exception to §14):
    伯 31 (v30 v32 ;）) — odd  → F
    羅 10 (v6            ;）) — even → M
    加 2  (v8            ;）) — even → M

Both fixes are PURE PIPELINE-LAYER — bible-data.json untouched. Display
text stays canonical 轡 / ；）. Audio bytes change because the round-trip
text fed to edge_tts is different (round-trip text has 臂 instead of 轡,
and ；　） instead of ；）).

Voice assignment by chapter parity (Bible Quest 2026 convention):
  odd  chapter → zh-HK-HiuGaaiNeural (F)
  even chapter → zh-HK-WanLungNeural (M)
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

# (book_abbr, chapter, fix_reason)
CHAPTERS = [
    ("伯", 30, "轡×1 v11"),    # odd  → F
    ("伯", 31, "；）×2 v30 v32"),  # odd  → F (same book, consecutive chapters; OK)
    ("詩", 32, "轡×1 v9"),     # even → M
    ("箴", 26, "轡×1 v3"),     # even → M
    ("羅", 10, "；）×1 v6"),   # even → M
    ("加", 2,  "；）×1 v8"),   # even → M
]


async def main() -> int:
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    results = []
    for book, ch, note in CHAPTERS:
        verses = data["data"][book]
        ch_str = str(ch)
        if ch_str not in verses:
            print(f"SKIP {book} {ch}: not in bible data")
            continue
        print(f"Regen {book} {ch} ({note})...", end=" ", flush=True)
        r = await generate_chapter(book, ch, verses[ch_str])
        results.append((book, ch, r))
        if r["status"] == "ok":
            print(f"OK {r['size']/1024:.0f}KB {r['duration']:.1f}s voice={r['voice']}")
        else:
            print(f"FAIL {r.get('error', '?')}")
    ok = sum(1 for _, _, r in results if r["status"] == "ok")
    print(f"\n{ok}/{len(results)} OK")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
