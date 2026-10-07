"""Round-23 narrow regen: 鐐→獠 (fetter liáo, Cantonese liu4).

Only the 4 chapters containing 鐐. Wholesale regen would touch 487 chapters.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import generate_chapter, BIBLE_DATA  # noqa: E402

TARGETS = [
    ("詩", 105),
    ("詩", 149),
    ("可", 5),
    ("路", 8),
]


async def main() -> None:
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        bible_data = json.load(f)["data"]

    for abbr, ch in TARGETS:
        verses = bible_data[abbr][str(ch)]
        r = await generate_chapter(abbr, ch, verses)
        status = r.get("status")
        flag = "OK  " if status == "ok" else "FAIL"
        print(
            f"[{flag}] {abbr} {ch}: {r.get('size', 0)}B "
            f"({r.get('duration', 0):.1f}s) {'' if status == 'ok' else r}"
        )


if __name__ == "__main__":
    asyncio.run(main())