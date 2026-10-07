"""Round-23 clip builder: standalone verse TTS for the 4 鐐 verses.

Chapter-level mp3s are already regenerated and committed. For ear-verify we need
short clips the user can play in Telegram.

NOTE: generate_chapter() writes to a fixed BASE_DIR/<book>/<abbr><chap>.mp3, so
calling it with a single verse would OVERWRITE the committed chapter audio with a
one-verse file. Must not do that. Instead reproduce the same pipeline inline:
tts_text() for the substitution, then edge_tts.save() to our own path.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")

import edge_tts  # noqa: E402
from tts_char_substitutions import tts_text  # noqa: E402

BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"
OUT = Path("/home/appstester0919/.hermes/cache/scratch/liu_clips")
OUT.mkdir(parents=True, exist_ok=True)

# Match generate_tts_v2.py: odd chapter -> female, even -> male.
VOICE_FEMALE = "zh-HK-HiuGaaiNeural"
VOICE_MALE = "zh-HK-WanLungNeural"

# (abbr, chapter, verse_number, label)
TARGETS = [
    ("詩", 105, 18, "p105v18"),
    ("詩", 149, 8, "p149v08"),
    ("可", 5, 4, "co5v04"),
    ("路", 8, 29, "lu8v29"),
]


async def main() -> None:
    bible_data = json.load(open(BIBLE_DATA, encoding="utf-8"))["data"]
    for abbr, ch, vn, label in TARGETS:
        verses = bible_data[abbr][str(ch)]
        one = [v for v in verses if v[0] == vn]
        if not one:
            print(f"[FAIL] {abbr} {ch}:{vn} not found")
            continue
        text = tts_text(one[0][1])
        assert "鐐" not in text, f"substitution missed in {label}"
        assert "獠" in text, f"獠 missing in {label}"

        voice = VOICE_FEMALE if ch % 2 == 1 else VOICE_MALE
        out = OUT / f"{label}.mp3"
        await edge_tts.Communicate(text, voice).save(str(out))

        size = out.stat().st_size
        flag = "OK  " if size > 10000 else "FAIL"
        print(f"[{flag}] {label} {abbr} {ch}:{vn} {voice} {size}B")
        print(f"       {text}")


if __name__ == "__main__":
    asyncio.run(main())