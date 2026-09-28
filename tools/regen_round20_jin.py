#!/usr/bin/env python3
"""Round-20 (2026-09-18) narrow regen for 矜→京 (TTS_CHAR_MAP, Lane B only).

Display text in public/bible-data.json stays canonical 矜 (untouched).
Sub applied at generation time only: TTS_CHAR_MAP['矜'] = '京' (ging1, HK habit).
Edge TTS zh-HK reads 矜 with the wrong Cantonese (not silent — MISREAD per §34).

Scope: 8 chapters — 撒下1, 代下25, 詩90, 賽13, 耶23, 耶50, 番3, 彼後2.
Odd chapter → F voice (zh-HK-HiuGaaiNeural), even → M voice (zh-HK-WanLungNeural).
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter

CHAPTERS = [
    ("撒下", 1),
    ("代下", 25),
    ("詩", 90),
    ("賽", 13),
    ("耶", 23),
    ("耶", 50),
    ("番", 3),
    ("彼後", 2),
]


async def main() -> None:
    bible = json.load(open("public/bible-data.json"))
    for book, ch in CHAPTERS:
        verses = bible["data"][book][str(ch)]
        chars = sum(len(t) for _, t in verses)
        print(f"Round-20: regen {book}{ch} ({len(verses)} verses, {chars} chars)...")
        res = await generate_chapter(book, ch, verses)
        print(f"  -> {res}")


if __name__ == "__main__":
    asyncio.run(main())
