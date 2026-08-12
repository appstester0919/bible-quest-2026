#!/usr/bin/env python3
"""
Regenerate TTS audio for chapters containing archaic CUV chars that Edge TTS
zh-HK voices cannot pronounce correctly (櫺繙鬮捫 → 靈翻鳩悶 + 輜→資 + 驕→嬌).

This is a one-shot script that:
  1. Identifies chapters containing affected chars (using tts_char_substitutions)
  2. Regenerates ONLY those chapters (overwrites existing mp3)
  3. Logs progress

Why a separate script (not just generate_tts_v2.py):
  - generate_tts_v2.py skips chapters in .tts_gen_log.json (1189 already done)
  - We need to FORCE regen of specific chapters
  - This script does exactly that — does NOT touch the rest of the bible

bible-data.json is NEVER modified by this script. Only audio files are regenerated.

User mapping (initial 4 verified 2026-08-10, +2 added 2026-08-12):
  櫺 → 靈 (líng) — "window lattice" → "spirit/lattice"
  繙 → 翻 (fān)  — "translate" → "turn over"
  鬮 → 鳩 (jiū)  — "cast lots" → "dove/pigeon"
  捫 → 悶 (mèn)  — "touch" → "stuffy/depressed"
  輜 → 資 (zī)   — "baggage" → "resources"
  驕 → 嬌 (jiāo) — "arrogance" → "delicate"

98 chapters across 35 books affected (original 4-char regen, 2026-08-11).
62 additional chapters affected (new 2-char regen, 2026-08-12):
  - 30 F (odd chapter, zh-HK-HiuGaaiNeural)
  - 32 M (even chapter, zh-HK-WanLungNeural)
  - Includes 番 2 (捫+驕) and 撒上 17 (輜+驕) which need both mappings applied
"""
import asyncio
import edge_tts
import json
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime

# TTS-only homophone substitution (櫺繙鬮捫 → 靈翻鳩悶)
sys.path.insert(0, str(Path(__file__).parent))
from tts_char_substitutions import tts_text, TTS_CHAR_MAP

VOICE_FEMALE = "zh-HK-HiuGaaiNeural"
VOICE_MALE = "zh-HK-WanLungNeural"
BASE_DIR = "/mnt/d/AI/BibleQuest2026/public/audio"
BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"
CHARS_PER_SEC_CONSERVATIVE = 4.83
MIN_DURATION_RATIO = 0.90
MAX_RETRIES_PER_CHAPTER = 2


def probe_duration(path: str) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


async def save_and_verify(text: str, voice: str, output_path: str) -> tuple[bool, float, int]:
    """Save TTS audio (with homophone substitution applied) and verify duration."""
    tts_input = tts_text(text)
    comm = edge_tts.Communicate(tts_input, voice)
    await comm.save(output_path)
    d = probe_duration(output_path)
    size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    expected = len(text) / CHARS_PER_SEC_CONSERVATIVE
    ok = d >= expected * MIN_DURATION_RATIO
    return ok, d, size


def find_affected_chapters() -> list[tuple[str, int]]:
    """Scan bible-data.json for chapters containing any TTS-affected char.
    v3 (2026-08-12): now includes 輜 and 驕. Chapter count = 159 (was 98)."""
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)

    affected = []
    for abbr in data["data"]:
        for ch_num, verses in data["data"][abbr].items():
            chapter_text = "".join(v[1] for v in verses)
            if any(c in chapter_text for c in TTS_CHAR_MAP):
                affected.append((abbr, int(ch_num)))
    return affected


def find_new_only_chapters(new_chars: set[str]) -> list[tuple[str, int]]:
    """Scan bible-data.json for chapters containing ONLY new chars (not old 4).
    v3 (2026-08-12): only regen chapters with new 2 chars; leave previous 98 untouched.
    """
    old_chars = set(TTS_CHAR_MAP) - new_chars
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)

    affected = []
    for abbr in data["data"]:
        for ch_num, verses in data["data"][abbr].items():
            chapter_text = "".join(v[1] for v in verses)
            if any(c in chapter_text for c in new_chars):
                affected.append((abbr, int(ch_num)))
    return affected


async def regenerate_one(abbr: str, chapter: int, verses: list) -> dict:
    try:
        text = "".join(v[1] for v in verses)
        voice = VOICE_FEMALE if chapter % 2 == 1 else VOICE_MALE
        output_path = os.path.join(BASE_DIR, abbr, f"{abbr}{chapter}.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        last_err = None
        for attempt in range(MAX_RETRIES_PER_CHAPTER):
            ok, duration, size = await save_and_verify(text, voice, output_path)
            if ok:
                return {
                    "book": abbr, "chapter": chapter, "size": size,
                    "duration": duration, "voice": voice, "status": "ok",
                    "attempts": attempt + 1,
                }
            last_err = (
                f"silent truncation: expected ≥{len(text)/CHARS_PER_SEC_CONSERVATIVE:.1f}s, "
                f"got {duration:.1f}s ({duration*CHARS_PER_SEC_CONSERVATIVE/len(text)*100:.0f}%)"
            )
            if attempt < MAX_RETRIES_PER_CHAPTER - 1:
                await asyncio.sleep(2)

        return {
            "book": abbr, "chapter": chapter,
            "error": last_err, "status": "fail",
            "attempts": MAX_RETRIES_PER_CHAPTER,
        }
    except Exception as e:
        return {"book": abbr, "chapter": chapter, "error": str(e), "status": "fail"}


async def main():
    import sys
    # CLI: --new-only restricts to chapters with only the new 2 chars
    new_only = '--new-only' in sys.argv
    NEW_CHARS = {'輜', '驕'}
    if new_only:
        affected = find_new_only_chapters(NEW_CHARS)
        scope = f"new-only (chapters containing {NEW_CHARS}, not in previous 98 batch)"
    else:
        affected = find_affected_chapters()
        scope = "all 6 affected chars"
    print(f"[REGEN TTS — affected chapters]")
    print(f"  Scope: {scope}")
    print(f"  Mapping: 櫺→靈, 繙→翻, 鬮→鳩, 捫→悶, 輜→資, 驕→嬌")
    print(f"  Affected chapters: {len(affected)}")
    print(f"  Output: {BASE_DIR}")
    print(f"  Source bible data: {BIBLE_DATA} (UNTOUCHED)")
    print()

    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    bible_data = data["data"]

    ok_count = 0
    fail_count = 0
    started = datetime.now().isoformat()

    for i, (abbr, chapter) in enumerate(affected, 1):
        ch_str = str(chapter)
        verses = bible_data[abbr].get(ch_str, [])
        if not verses:
            print(f"[{i}/{len(affected)}] {abbr} {chapter} — SKIP (no verses)")
            continue

        voice = "F" if chapter % 2 == 1 else "M"
        print(f"[{i}/{len(affected)}] {abbr} {chapter} ({voice})... ", end="", flush=True)

        result = await regenerate_one(abbr, chapter, verses)

        if result["status"] == "ok":
            size_kb = result["size"] / 1024
            print(f"OK {size_kb:.0f}KB ({result['duration']:.1f}s)")
            ok_count += 1
        else:
            print(f"FAIL {result.get('error', '?')}")
            fail_count += 1

        # Small delay between chapters (avoid rate-limit)
        await asyncio.sleep(2)

    print()
    print(f"Done. {ok_count} ok, {fail_count} failed, started={started}")


if __name__ == "__main__":
    asyncio.run(main())