#!/usr/bin/env python3
"""
Heuristic scan: detect chapters where existing mp3 duration is significantly
shorter than expected for the underlying text length.

Uses Edge TTS zh-HK measured speech rate (WanLungNeural ~4.83 chars/sec) as
the conservative lower bound. A chapter with mp3 < 90% of expected duration
is flagged as a candidate silent truncation (like book 10 was).

This scan is read-only: it does NOT call Edge TTS, only ffprobes existing
mp3 files. It will not modify anything. Use the output CSV to decide which
chapters to regen via tools/regen_split_chapters.py.

Output:
  - Prints a sorted table to stdout (worst offenders first)
  - Writes /home/appstester0919/silent_truncation_candidates.csv
"""
import subprocess, json, csv
from pathlib import Path

AUDIO_DIR = Path("/mnt/d/AI/BibleQuest2026/public/audio")
BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"

CHARS_PER_SEC = 4.83  # WanLungNeural (male, slower) measured rate
MIN_RATIO = 0.90      # <90% of expected → flagged


def probe_duration(path: Path) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def main():
    with open(BIBLE_DATA) as f:
        data = json.load(f)
    bible_data = data["data"]

    print(f"Scanning {len(bible_data)} books for silent truncation candidates...")

    # For each chapter, get text length from bible data, probe mp3 duration,
    # compute ratio. Skip chapters where bible data is missing (legacy files).
    candidates = []
    chapters_scanned = 0
    chapters_skipped = 0

    for book_abbr, chapters in sorted(bible_data.items()):
        for ch_str, verses in chapters.items():
            try:
                ch_num = int(ch_str)
            except ValueError:
                continue

            if isinstance(verses[0], list):
                text = "".join(v[1] for v in verses)
            else:
                text = "".join(verses)

            mp3_path = AUDIO_DIR / book_abbr / f"{book_abbr}{ch_num}.mp3"
            if not mp3_path.exists():
                continue

            actual = probe_duration(mp3_path)
            if actual == 0:
                continue

            expected = len(text) / CHARS_PER_SEC
            ratio = actual / expected if expected > 0 else 0

            chapters_scanned += 1
            if ratio < MIN_RATIO:
                candidates.append({
                    "book": book_abbr,
                    "chapter": ch_num,
                    "text_chars": len(text),
                    "expected_s": round(expected, 1),
                    "actual_s": round(actual, 1),
                    "ratio": round(ratio, 3),
                    "missing_s": round(expected - actual, 1),
                    "verse_count": len(verses),
                    "path": str(mp3_path),
                })

    # Sort by ratio asc (worst first)
    candidates.sort(key=lambda x: x["ratio"])

    print(f"\nScanned {chapters_scanned} chapters, skipped {chapters_skipped} (missing mp3 or data)")
    print(f"\nSilent truncation candidates (ratio < {MIN_RATIO}):\n")
    print(f"  {'Book':<6} {'Ch':>4} {'Verses':>6} {'Chars':>5} "
          f"{'Expect':>7} {'Actual':>7} {'Ratio':>6} {'Missing':>8}")
    print(f"  {'-'*6} {'-'*4} {'-'*6} {'-'*5} {'-'*7} {'-'*7} {'-'*6} {'-'*8}")
    for c in candidates:
        print(f"  {c['book']:<6} {c['chapter']:>4} {c['verse_count']:>6} {c['text_chars']:>5} "
              f"{c['expected_s']:>6.1f}s {c['actual_s']:>6.1f}s {c['ratio']:>5.1%} {c['missing_s']:>6.1f}s")

    csv_path = "/home/appstester0919/silent_truncation_candidates.csv"
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "book", "chapter", "verse_count", "text_chars",
            "expected_s", "actual_s", "ratio", "missing_s", "path",
        ])
        w.writeheader()
        for c in candidates:
            w.writerow(c)
    print(f"\n✓ CSV saved: {csv_path}")
    print(f"\nNext step: review the CSV. For each row, run regen_split_chapters.py "
          f"or directly regen with edge_tts + length verify.")


if __name__ == "__main__":
    main()