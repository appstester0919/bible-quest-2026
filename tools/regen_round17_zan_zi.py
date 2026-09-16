#!/usr/bin/env python3
"""
Round-17 narrow regen: 儹→讚 + 鷙→致 (TTS_CHAR_MAP 34th + 35th mappings, 2026-09-16).
Scope: 8 chapters (3 儹 + 6 鷙 occurrences).

Voice assignment by chapter parity (Bible Quest 2026 convention):
  odd  chapter → zh-HK-HiuGaaiNeural (F)
  even chapter → zh-HK-WanLungNeural (M)

儹 chapters (2):
  太 6  (even → M)   雅 5  (odd → F)
鷙 chapters (6):
  創 15 (odd → F)    伯 28 (even → M)
  賽 18 (even → M)   賽 46 (even → M)
  耶 12 (even → M)   結 39 (odd → F)

Pure Lane-B (no Lane-A source edits this round) — bible-data.json untouched.
Display text stays canonical 儹 / 鷙 — sub applied only at generation time.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

CHAPTERS = [
    ("太", 6),        # 儹×2 (v19 v20) — even → M
    ("雅", 5),        # 儹×1 (v3)      — odd → F
    ("創", 15),       # 鷙×1 (v11)     — odd → F
    ("伯", 28),       # 鷙×1 (v7)      — even → M
    ("賽", 18),       # 鷙×2 (v6 v6)   — even → M
    ("賽", 46),       # 鷙×1 (v11)     — even → M
    ("耶", 12),       # 鷙×2 (v9 v9)   — even → M
    ("結", 39),       # 鷙×1 (v4)      — odd → F
]


async def main() -> int:
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    results = []
    for book, ch in CHAPTERS:
        verses = data["data"][book]
        ch_str = str(ch)
        if ch_str not in verses:
            print(f"SKIP {book} {ch}: not in bible data")
            continue
        print(f"Regen {book} {ch}...", end=" ", flush=True)
        r = await generate_chapter(book, ch, verses[ch_str])
        results.append((book, ch, r))
        if r["status"] == "ok":
            print(f"OK {r['size']/1024:.0f}KB {r['duration']:.1f}s voice={r['voice']}")
        else:
            print(f"FAIL {r.get('error', '?')}")
    ok = sum(1 for _, _, r in results if r["status"] == "ok")
    print(f"\n{ok}/{len(results)} OK")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
