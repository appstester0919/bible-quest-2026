#!/usr/bin/env python3
"""Round-19 (2026-09-18) narrow regen for 伯 39:19 char fixes.

Source-edit (Lane A) only: 浛→挲 + 𢔰(U+28970)→鬃 in bible-data.json §32 bytes-level.
Audio regen required (audible changes — 浛/挲 different pronunciation, 𢔰/鬃 different).
Scope: 1 chapter (伯 39), odd → F voice (zh-HK-HiuGaaiNeural).
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter
import json


async def main() -> None:
    bible = json.load(open("public/bible-data.json"))
    book = "伯"
    ch = 39
    verses = bible["data"][book][str(ch)]
    print(f"Round-19: regen {book}{ch} ({len(verses)} verses, F voice)...")
    res = await generate_chapter(book, ch, verses)
    print(f"  -> {res}")
    print(f"  size: {Path(res['path']).stat().st_size} bytes")


if __name__ == "__main__":
    asyncio.run(main())
