#!/usr/bin/env python3
"""
Round-14 narrow regen: 鍤→插 + 誚→俏 (TTS_CHAR_MAP 30th + 31st mappings, 2026-09-02).
Scope: 26 chapters (4 鍤 + 22 誚).
Pattern follows Round-10/12/13 narrow-regen scripts.

Voice assignment by chapter parity (Bible Quest 2026 convention):
  odd  chapter → zh-HK-HiuGaaiNeural (F)
  even chapter → zh-HK-WanLungNeural (M)

鍤 chapters (4):
  出27 (odd,F)  出38 (even,M)  民4 (even,M)  代下4 (even,M)
誚 chapters (22):
  申28(F) 士8(M) 王上9(M) 代下7(M) 代下30(M) 代下36(M) 伯16(M) 伯34(M) 詩123(M)
  箴3(M) 箴27(M) 賽28(M) 結22(M) 結36(M) 哈1(M) 太27(F) 可15(M) 路23(M)
  徒2(M) 徒17(M) 彼後3(M) 猶1(M)
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

CHAPTERS = [
    ("出", 27), ("出", 38), ("民", 4), ("代下", 4),       # 鍤
    ("申", 28), ("士", 8), ("王上", 9), ("代下", 7),
    ("代下", 30), ("代下", 36), ("伯", 16), ("伯", 34),
    ("詩", 123), ("箴", 3), ("箴", 27), ("賽", 28),
    ("結", 22), ("結", 36), ("哈", 1), ("太", 27),
    ("可", 15), ("路", 23), ("徒", 2), ("徒", 17),
    ("彼後", 3), ("猶", 1),
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
