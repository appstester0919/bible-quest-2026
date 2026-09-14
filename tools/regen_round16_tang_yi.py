#!/usr/bin/env python3
"""
Round-16 narrow regen: 帑→幣 + 驛→譯 (TTS_CHAR_MAP 32nd + 33rd mappings, 2026-09-14).
Scope: 3 chapters (1 帑 + 6 驛 occurrences).

Voice assignment by chapter parity (Bible Quest 2026 convention):
  odd  chapter → zh-HK-HiuGaaiNeural (F)
  even chapter → zh-HK-WanLungNeural (M)

帑 chapters (1):
  斯 3 (odd, F)
驛 chapters (3):
  代下 30 (even, M)   斯 3 (F)   斯 8 (F)

NOTE: 來 13:3 punctuation fix (Lane A source-edit, byte-level replace §32) does NOT
require audio regen per §33 — punctuation (句號 / 頓號 / 逗號) is non-audible to
edge TTS zh-HK voices (silent prosody pause). Display text fix lands on next deploy
without re-rendering audio.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

CHAPTERS = [
    ("斯", 3),       # 帑×1 (v9) + 驛×2 (v13 v15) — odd → F
    ("斯", 8),       # 驛×2 (v10 v14)                — even? no: 8 even → M
    ("代下", 30),    # 驛×2 (v6 v10)                — even → M
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