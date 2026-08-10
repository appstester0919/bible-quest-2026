#!/usr/bin/env python3
"""
聖經 TTS 批量生成腳本 (BibleQuest2026 校對版 v2)
- Edge TTS (zh-HK)
- 男女聲梅花間竹：單數章=女 (HiuGaaiNeural)，雙數章=男 (WanLungNeural)
- 輸入: 校對後 bible-data.json (66 卷含約參)
- 輸出: /mnt/d/AI/BibleQuest2026/public/audio/{abbr}/{abbr}{ch}.mp3
- 斷點續傳: .tts_gen_log.json
- 並發: 1 個 worker (避免 rate-limit)，3 秒延遲
"""
import asyncio
import edge_tts
import os
import json
import time
import sys
from datetime import datetime
from pathlib import Path
# TTS-only homophone substitution for archaic CUV chars (櫺繙鬮捫 → 靈翻鳩悶)
# bible-data.json stays untouched — this only affects the text passed to edge_tts
sys.path.insert(0, str(Path(__file__).parent))
from tts_char_substitutions import tts_text, contains_affected_chars

VOICE_FEMALE = "zh-HK-HiuGaaiNeural"
VOICE_MALE = "zh-HK-WanLungNeural"
BASE_DIR = "/mnt/d/AI/BibleQuest2026/public/audio"
LOG_FILE = "/mnt/d/AI/BibleQuest2026/.tts_gen_log.json"
BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"
DELAY_BETWEEN_BATCHES = 3

# Edge TTS zh-HK speech rate measured from production runs:
#   female HiuGaaiNeural ~5.5 chars/sec, male WanLungNeural ~4.83 chars/sec
# We use 4.83 (slower male voice) as the conservative lower bound — anything
# faster than this would silently truncate. Generated mp3 < 90% of expected
# duration → retry once, then mark fail (previously the script logged 'ok'
# on a partial file; bug book 10 hit 2026-07-20, fix landed 2026-08-03).
CHARS_PER_SEC_CONSERVATIVE = 4.83
MIN_DURATION_RATIO = 0.90  # accept if >=90% of expected duration
MAX_RETRIES_PER_CHAPTER = 2  # 1 retry on silent truncation (1st pass + 1 retry)


def _probe_duration(path: str) -> float:
    """Probe mp3 duration via ffprobe; returns 0.0 on failure."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


async def _save_and_verify(text: str, voice: str, output_path: str) -> tuple[bool, float, int]:
    """Save Edge TTS audio, then verify duration matches expected. Returns (ok, duration, size)."""
    # Apply TTS-only homophone substitution so archaic CUV chars are pronounced correctly
    # (櫺繙鬮捫 → 靈翻鳩悶). bible-data.json is unchanged; only the text passed to TTS is modified.
    tts_input = tts_text(text)
    comm = edge_tts.Communicate(tts_input, voice)
    await comm.save(output_path)
    d = _probe_duration(output_path)
    size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    expected = len(text) / CHARS_PER_SEC_CONSERVATIVE
    ok = d >= expected * MIN_DURATION_RATIO
    return ok, d, size


async def generate_chapter(book_abbr: str, chapter: int, verses: list) -> dict:
    try:
        if isinstance(verses[0], list):
            text = "".join(v[1] for v in verses)
        else:
            text = "".join(verses)

        voice = VOICE_FEMALE if chapter % 2 == 1 else VOICE_MALE
        output_path = os.path.join(BASE_DIR, book_abbr, f"{book_abbr}{chapter}.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Always overwrite (bible data has been calibrated, audio needs regen)
        # Retry loop: silent truncation protection (book 10 had ~13% missing
        # without raise in edge_tts==7.2.7; verify duration before accepting).
        last_err = None
        for attempt in range(MAX_RETRIES_PER_CHAPTER):
            ok, duration, size = await _save_and_verify(text, voice, output_path)
            if ok:
                return {
                    "book": book_abbr, "chapter": chapter, "size": size,
                    "duration": duration, "voice": voice, "status": "ok",
                    "attempts": attempt + 1,
                }
            last_err = (
                f"silent truncation: expected ≥{len(text)/CHARS_PER_SEC_CONSERVATIVE:.1f}s, "
                f"got {duration:.1f}s ({duration*CHARS_PER_SEC_CONSERVATIVE/len(text)*100:.0f}%)"
            )
            if attempt < MAX_RETRIES_PER_CHAPTER - 1:
                # Brief backoff before retry (avoid rate-limit)
                await asyncio.sleep(2)

        # All retries exhausted
        return {
            "book": book_abbr, "chapter": chapter,
            "error": last_err, "status": "fail",
            "attempts": MAX_RETRIES_PER_CHAPTER,
        }
    except Exception as e:
        return {"book": book_abbr, "chapter": chapter, "error": str(e), "status": "fail"}

def load_progress():
    completed = set()
    failed = []
    started_at = datetime.now().isoformat()
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data.get("completed", []):
                parts = item.split(":")
                completed.add((parts[0], int(parts[1])))
            failed = data.get("failed", [])
            started_at = data.get("started_at", started_at)
    return completed, failed, started_at

def save_progress(completed, failed, started_at):
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "completed": [f"{b}:{c}" for b, c in sorted(completed)],
            "failed": failed,
            "started_at": started_at,
            "version": "v2-calibrated"
        }, f, ensure_ascii=False, indent=2)

def main():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)

    completed, failed, started_at = load_progress()
    bible_data = data["data"]
    books = data["books"]

    # Total remaining
    total_remaining = 0
    for book in books:
        abbr = book["a"]
        if abbr not in bible_data:
            continue
        for ch_str in bible_data[abbr]:
            if (abbr, int(ch_str)) not in completed:
                total_remaining += 1

    total_done = len(completed)
    print(f"[BIBLEQUEST 2026 TTS v2 — calibrated]")
    print(f"Started at: {started_at}")
    print(f"Books: {len(books)}")
    print(f"Already done: {total_done}")
    print(f"Remaining: {total_remaining}")
    print(f"Delay: {DELAY_BETWEEN_BATCHES}s/chapter")
    print()

    if total_remaining == 0:
        print("All chapters done!")
        return

    for book in books:
        abbr = book["a"]
        name = book["n"]
        if abbr not in bible_data:
            print(f"SKIP {name} ({abbr}) — not in bible data")
            continue

        for ch_str, verses in bible_data[abbr].items():
            chapter = int(ch_str)
            key = (abbr, chapter)

            if key in completed:
                continue

            voice = "F" if chapter % 2 == 1 else "M"
            print(f"[{total_done+1}/{total_done+total_remaining}] {name} {ch_str} ({voice})... ", end="", flush=True)

            result = asyncio.run(generate_chapter(abbr, chapter, verses))

            if result["status"] == "ok":
                size_kb = result["size"] / 1024
                print(f"OK {size_kb:.0f}KB")
                completed.add(key)
                total_done += 1
                time.sleep(DELAY_BETWEEN_BATCHES)
            elif result["status"] == "skip":
                print(f"SKIP (exists)")
                completed.add(key)
                total_done += 1
            else:
                print(f"FAIL {result.get('error', '?')}")
                failed.append({"book": abbr, "chapter": chapter, "error": result.get("error", "?")})
                time.sleep(1)

            save_progress(completed, failed, started_at)

    print(f"\nDone! {len(completed)} chapters done.")

if __name__ == "__main__":
    main()
