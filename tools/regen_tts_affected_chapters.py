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
from tts_char_substitutions import tts_text, TTS_CHAR_MAP, TTS_PUNCTUATION_FIXES

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
    """Save TTS audio (with homophone substitution applied) and verify duration.

    Triggers silent-truncation fail in TWO cases:
      1. duration < expected × MIN_DURATION_RATIO  (text too short for chars)
      2. duration >= 595s  (Edge TTS hard 600s cap, always truncated past this)

    Case 2 is independent of expected — 4 historical chapters (士 9, 撒上 17,
    民 7, 耶 51, 2026-08-16) had expected ≤ 600s so MIN_DURATION_RATIO passed
    at ratio=1.37 but the audio was actually truncated at 600s.
    """
    tts_input = tts_text(text)
    comm = edge_tts.Communicate(tts_input, voice)
    await comm.save(output_path)
    d = probe_duration(output_path)
    size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    expected = len(text) / CHARS_PER_SEC_CONSERVATIVE
    ok = d >= expected * MIN_DURATION_RATIO and d < 595.0
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

        # Try single-pass regen with retry
        last_err = None
        for attempt in range(MAX_RETRIES_PER_CHAPTER):
            ok, duration, size = await save_and_verify(text, voice, output_path)
            if ok:
                return {
                    "book": abbr, "chapter": chapter, "size": size,
                    "duration": duration, "voice": voice, "status": "ok",
                    "attempts": attempt + 1,
                }
            # Silent-truncation detector (v4 2026-08-16): if exactly 600s and
            # expected > 600, fall through to split-regen path. The standard
            # MIN_DURATION_RATIO check would PASS at ratio=143% but the mp3 is
            # actually truncated.
            expected = len(text) / CHARS_PER_SEC_CONSERVATIVE
            # (Hard-cap check moved into save_and_verify — if duration >= 595s,
            # ok=False is returned, so we never reach the success-return on
            # line 122 and fall through to split-regen here.)
            last_err = (
                f"silent truncation: expected ≥{expected:.1f}s, "
                f"got {duration:.1f}s ({duration*CHARS_PER_SEC_CONSERVATIVE/len(text)*100:.0f}%)"
            )
            if attempt < MAX_RETRIES_PER_CHAPTER - 1:
                await asyncio.sleep(2)

        # ─── Split-regen path (v4 2026-08-16) ───────────────────────────
        # Find verse-boundary midpoint. TTS input limit is 600s = ~2900 chars
        # at 4.83 cps. Aim for 50/50 split at verse nearest midpoint.
        total_chars = len(text)
        split_target = total_chars // 2
        cumulative = 0
        split_idx = len(verses) // 2  # start with verse midpoint
        for i, v in enumerate(verses):
            cumulative += len(v[1])
            if cumulative >= split_target:
                split_idx = i + 1
                break
        if split_idx == 0 or split_idx == len(verses):
            # edge case — single very long verse, split at char midpoint
            split_idx = len(verses) // 2

        upper_text = "".join(v[1] for v in verses[:split_idx])
        lower_text = "".join(v[1] for v in verses[split_idx:])

        upper_ok, upper_dur, _ = await save_and_verify(upper_text, voice, "/tmp/_split_upper.mp3")
        lower_ok, lower_dur, _ = await save_and_verify(lower_text, voice, "/tmp/_split_lower.mp3")

        if not (upper_ok and lower_ok):
            return {
                "book": abbr, "chapter": chapter,
                "error": f"split-regen also failed (upper={upper_dur:.1f}s, lower={lower_dur:.1f}s)",
                "status": "fail",
                "attempts": MAX_RETRIES_PER_CHAPTER,
            }

        # ffmpeg concat with -c copy (no re-encode)
        concat_list = "/tmp/_concat_list.txt"
        with open(concat_list, "w") as f:
            f.write(f"file '/tmp/_split_upper.mp3'\nfile '/tmp/_split_lower.mp3'\n")
        r = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", concat_list, "-c", "copy", output_path],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            return {
                "book": abbr, "chapter": chapter,
                "error": f"ffmpeg concat failed: {r.stderr[:200]}",
                "status": "fail",
                "attempts": MAX_RETRIES_PER_CHAPTER,
            }

        size = os.path.getsize(output_path)
        total_dur = upper_dur + lower_dur
        return {
            "book": abbr, "chapter": chapter, "size": size,
            "duration": total_dur, "voice": voice, "status": "ok-split",
            "attempts": MAX_RETRIES_PER_CHAPTER,
            "upper_dur": upper_dur, "lower_dur": lower_dur,
            "split_at_verse": split_idx,
        }
    except Exception as e:
        return {"book": abbr, "chapter": chapter, "error": str(e), "status": "fail"}


async def main():
    import sys
    # CLI: --new-only restricts to chapters with only the new chars
    #   round 3 (2026-08-14): 軛, 縋, 讒, 貲, 賙, 單
    #   round 4 (2026-08-16): 搆, 誆, 柺, 邑, 珥
    # default regen = all 17 chars (covers everything, including chapters
    # previously regen'd by rounds 1-3 — idempotent re-gen is safe).
    new_only = '--new-only' in sys.argv
    round4_only = '--round4-only' in sys.argv
    round5_only = '--round5-only' in sys.argv
    NEW_CHARS_ROUND3 = {'軛', '縋', '讒', '貲', '賙', '單'}
    NEW_CHARS_ROUND4 = {'搆', '誆', '柺', '邑', '珥'}
    NEW_CHARS_ROUND5 = {'摶', '瓔', '轂', '鑷', '奩', '饈'}
    if round5_only:
        # Round 5 scope (2026-08-21): chapters containing any round-5 char.
        # Round 1-4 chapters that don't have any round-5 chars are skipped
        # (already regen'd in earlier rounds).
        affected = find_new_only_chapters(NEW_CHARS_ROUND5)
        scope = f"round-5-only ({len(NEW_CHARS_ROUND5)} new chars: {NEW_CHARS_ROUND5})"
    elif round4_only:
        # Round 4 scope: chapters containing any round-4 char (regardless of
        # round 1-3 chars present). Round 1-3 chapters that don't have any
        # round-4 chars are skipped (already regen'd in earlier rounds).
        affected = find_new_only_chapters(NEW_CHARS_ROUND4)
        scope = f"round-4-only ({len(NEW_CHARS_ROUND4)} new chars: {NEW_CHARS_ROUND4})"
    elif new_only:
        # union of both rounds
        new_chars = NEW_CHARS_ROUND3 | NEW_CHARS_ROUND4
        affected = find_new_only_chapters(new_chars)
        scope = f"new-only (chapters containing {new_chars}, not in previous 159 batch)"
    else:
        affected = find_affected_chapters()
        scope = f"all 17 affected chars ({len(TTS_CHAR_MAP)} mappings)"
    print(f"[REGEN TTS — affected chapters]")
    print(f"  Scope: {scope}")
    mapping_str = ", ".join(f"{old}→{new}" for old, new in TTS_CHAR_MAP.items())
    print(f"  Mapping: {mapping_str}")
    print(f"  Affected chapters: {len(affected)}")
    print(f"  Output: {BASE_DIR}")
    print(f"  Source bible data: {BIBLE_DATA} (UNTOUCHED)")
    print(f"  Punctuation fixes: {len(TTS_PUNCTUATION_FIXES)} (applied at TTS time)")
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