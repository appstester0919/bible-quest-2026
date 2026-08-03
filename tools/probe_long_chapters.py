#!/usr/bin/env python3
"""
Probe all BibleQuest mp3 files and identify chapters that approach
the Edge TTS 10-minute (600s) hard cap.

When a chapter's duration is >= 580s, the source text was almost certainly
truncated by Edge TTS when the original mp3 was generated — the mp3 we
have today is incomplete. These chapters need split-regen.

Output:
  1. Prints a sorted table to stdout
  2. Writes CSV to /home/appstester0919/long_chapters.csv
  3. Writes split-recipe JSON to /home/appstester0919/split_recipes.json
     (split point = midpoint verse, upper/lower voice determined by chapter parity)

Voice logic (must match generate_tts_v2.py):
  - Odd chapter  → zh-HK-HiuGaaiNeural (female, abbr: F)
  - Even chapter → zh-HK-WanLungNeural  (male,   abbr: M)
  - Both halves of a split use the same voice (no voice flip mid-chapter)
"""
import subprocess, json, csv, os
from pathlib import Path

AUDIO_DIR = Path("/mnt/d/AI/BibleQuest2026/public/audio")
BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

VOICE_FEMALE = "zh-HK-HiuGaaiNeural"
VOICE_MALE = "zh-HK-WanLungNeural"
THRESHOLD_S = 580  # 20s buffer below 600s cap; anything here is suspect


def chapter_voice(chapter: int) -> str:
    """Return voice id for a given chapter number. Matches generate_tts_v2.py."""
    return VOICE_FEMALE if chapter % 2 == 1 else VOICE_MALE


def probe_duration(path: Path) -> float | None:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return None


def find_split_point(verses: list) -> int:
    """Find the verse index where the upper half begins to exceed 580s of narration.

    Estimates 1 verse ≈ len(text) * 0.014s (zh-HK Edge TTS avg from past runs).
    Walks verse by verse, accumulating estimated duration until threshold.
    Returns the split index — upper = verses[0:split], lower = verses[split:].

    Conservative: assumes slowest voice (male) at 13 chars/sec.
    """
    CHARS_PER_SEC = 13
    accum = 0
    for i, v in enumerate(verses):
        text = v[1] if isinstance(v, list) else v
        accum += len(text) / CHARS_PER_SEC
        if accum >= THRESHOLD_S:
            return i
    return len(verses) // 2  # fallback


def main():
    with open(BIBLE_DATA) as f:
        data = json.load(f)
    bible_books = data["books"]
    bible_data = data["data"]
    book_by_abbr = {b["a"]: b["n"] for b in bible_books}

    all_mp3s = sorted(AUDIO_DIR.rglob("*.mp3"))
    print(f"Probing {len(all_mp3s)} mp3 files in {AUDIO_DIR}...", flush=True)

    probed = []
    for p in all_mp3s:
        rel = p.relative_to(AUDIO_DIR)
        if len(rel.parts) != 2:
            continue
        book_abbr = rel.parts[0]
        ch_str = rel.parts[1].replace(".mp3", "").replace(book_abbr, "")
        try:
            ch_num = int(ch_str)
        except ValueError:
            continue
        d = probe_duration(p)
        if d is None:
            continue
        probed.append((book_abbr, ch_num, d, p))

    probed.sort(key=lambda x: -x[2])

    # ── Filter: chapters at or above threshold ─────────────────────────────────
    at_risk = [x for x in probed if x[2] >= THRESHOLD_S]
    print(f"\nChapters with duration >= {THRESHOLD_S}s ({len(at_risk)}):\n")
    print(f"  {'Book':<10} {'Ch':>4} {'Duration':>10} {'Size':>8} {'Name':<14}")
    print(f"  {'-'*10} {'-'*4} {'-'*10} {'-'*8} {'-'*14}")
    for book, ch, d, p in at_risk:
        name = book_by_abbr.get(book, book)
        size_kb = p.stat().st_size / 1024
        print(f"  {book:<10} {ch:>4} {d:>8.1f}s {size_kb:>6.0f}KB  {name:<14}")

    # ── Duration distribution ────────────────────────────────────────────────
    print(f"\n\nDuration distribution (all {len(probed)} chapters):")
    buckets = [
        (0, 60, "<1m"),
        (60, 120, "1-2m"),
        (120, 300, "2-5m"),
        (300, 480, "5-8m"),
        (480, 580, "8m-9.7m"),
        (580, 600, "9.7-10m (RISK)"),
        (600, 100000, "≥10m (cut)"),
    ]
    for lo, hi, label in buckets:
        cnt = sum(1 for x in probed if lo <= x[2] < hi)
        print(f"  {label:<25} [{lo:>4}s, {hi:>5}s): {cnt:>4}")

    # ── Save CSV + split recipes ─────────────────────────────────────────────
    csv_path = "/home/appstester0919/long_chapters.csv"
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["book_abbr", "book_name", "chapter", "duration_s", "size_kb", "voice", "path"])
        for book, ch, d, p in at_risk:
            name = book_by_abbr.get(book, book)
            voice = chapter_voice(ch)
            size_kb = p.stat().st_size / 1024
            w.writerow([book, name, ch, f"{d:.1f}", f"{size_kb:.0f}", voice, str(p)])
    print(f"\n✓ CSV saved: {csv_path}")

    recipes = []
    for book, ch, d, p in at_risk:
        if book not in bible_data or str(ch) not in bible_data[book]:
            print(f"  ⚠ No bible data for {book} {ch} — skip recipe")
            continue
        verses = bible_data[book][str(ch)]
        split_idx = find_split_point(verses)
        upper_count = split_idx
        lower_count = len(verses) - split_idx
        recipes.append({
            "book_abbr": book,
            "book_name": book_by_abbr.get(book, book),
            "chapter": ch,
            "voice": chapter_voice(ch),
            "voice_label": "F" if ch % 2 == 1 else "M",
            "duration_s": round(d, 1),
            "verse_count": len(verses),
            "split_verse_index": split_idx,
            "upper_verses": f"1-{upper_count}",
            "lower_verses": f"{upper_count+1}-{len(verses)}",
            "output_path": str(p),
            "temp_upper": f"/tmp/{book}{ch}_upper.mp3",
            "temp_lower": f"/tmp/{book}{ch}_lower.mp3",
        })
    recipes_path = "/home/appstester0919/split_recipes.json"
    with open(recipes_path, "w", encoding="utf-8") as f:
        json.dump(recipes, f, ensure_ascii=False, indent=2)
    print(f"✓ Recipes saved: {recipes_path} ({len(recipes)} chapters)")
    print("\nNext step: review `split_recipes.json`, then run `regen_split_chapters.py` to actually regen.")


if __name__ == "__main__":
    main()
