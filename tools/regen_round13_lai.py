#!/usr/bin/env python3
"""
Round-13 narrow regen: 賚→萊 (TTS_CHAR_MAP 27th mapping, 2026-09-01).
Scope: 1 chapter only (代上 27) — verified by corpus hit enumeration
(代上 27:29, 施提賚/亞第賚 — proper names).

Pattern follows Round-10/12 narrow-regen script.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter  # noqa: E402
import json  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"
BOOK = "代上"
CHAPTERS = [27]


async def main() -> int:
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    verses = data["data"][BOOK]
    results = []
    for ch in CHAPTERS:
        ch_str = str(ch)
        if ch_str not in verses:
            print(f"SKIP {BOOK} {ch}: not in bible data")
            continue
        print(f"Regen {BOOK} {ch}...", end=" ", flush=True)
        r = await generate_chapter(BOOK, ch, verses[ch_str])
        results.append(r)
        if r["status"] == "ok":
            print(f"OK {r['size']/1024:.0f}KB {r['duration']:.1f}s voice={r['voice']}")
        else:
            print(f"FAIL {r.get('error', '?')}")
    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\n{ok}/{len(results)} OK")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
