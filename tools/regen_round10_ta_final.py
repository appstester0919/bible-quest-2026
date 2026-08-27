#!/usr/bin/env python3
"""Regen just 亞4 (Zechariah 4) — the one Round-10 regen did not finish."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter, BIBLE_DATA


async def main():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    verses = data["data"]["亞"]["4"]
    r = await generate_chapter("亞", 4, verses)
    print(f"亞 4: status={r['status']} size={r.get('size', 0)} duration={r.get('duration', 0):.1f}s")
    return 0 if r["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))