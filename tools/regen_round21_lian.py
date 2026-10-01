#!/usr/bin/env python3
"""Round-21 (2026-10-01) narrow regen for 輦→連 (TTS_CHAR_MAP, Lane B only).

Display text in public/bible-data.json stays canonical 輦 (untouched).
Sub applied at generation time only: TTS_CHAR_MAP['輦'] = '連' (lin4).

輦 is SILENT in edge TTS zh-HK — single-char probe returned NoAudioReceived
on BOTH zh-HK voices while the control 字 returned 12528B / 2.09s, so the
skip is the character itself, not the voice (§9 / Stage 1.5 bare-char probe).

Scope: 3 chapters, all three occurrences in the corpus and all in the
compound 車輦 (chariot):
  詩 68:17  神的車輦累萬盈千   (even → M voice)
  詩 104:3 用雲彩為車輦        (even → M voice)
  賽 66:15 他的車輦像旋風      (even → M voice)

Odd chapter → F voice (zh-HK-HiuGaaiNeural), even → M voice
(zh-HK-WanLungNeural); assigned by parity, never by content.

§19/§26: narrow regen, not wholesale. §44: generate_chapter is async and
returns a STATUS DICT — print the dict, don't destructure a 'path' key.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter

CHAPTERS = [("詩", 68), ("詩", 104), ("賽", 66)]


async def main() -> None:
    bible = json.load(open("public/bible-data.json"))
    ok = fail = 0
    for book, ch in CHAPTERS:
        verses = bible["data"][book][str(ch)]
        chars = sum(len(t) for _, t in verses)
        print(f"Round-21: regen {book}{ch} ({len(verses)} verses, {chars} chars)...",
              flush=True)
        res = await generate_chapter(book, ch, verses)
        print(f"  -> {res}", flush=True)
        if res.get("status") == "ok":
            ok += 1
        else:
            fail += 1
    print(f"\n=== {ok} ok, {fail} fail ===")


if __name__ == "__main__":
    asyncio.run(main())