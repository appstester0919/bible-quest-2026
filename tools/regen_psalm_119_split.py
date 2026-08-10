#!/usr/bin/env python3
"""
Regenerate 詩 119 as a single mp3 by splitting at verse 88/89 boundary
(Edge TTS has ~10-minute per-request hard limit; full chapter 176 verses exceeds it).

Strategy:
  1. Split verses into upper (1-88) and lower (89-176)
  2. Gen each half via Edge TTS → /tmp/詩119_upper.mp3 + /tmp/詩119_lower.mp3
  3. ffmpeg concat with -c copy (same codec, bit rate) → 詩119.mp3

Reuses same voice as main script: zh-HK-HiuGaaiNeural (詩 = Psalms, 119 is odd chapter).
"""

import asyncio
import edge_tts
import subprocess
import json
import os
import sys
from pathlib import Path

# TTS-only homophone substitution for archaic CUV chars (櫺繙鬮捫 → 靈翻鳩悶)
# bible-data.json stays untouched — this only affects the text passed to edge_tts
sys.path.insert(0, str(Path(__file__).parent))
from tts_char_substitutions import tts_text

VOICE = "zh-HK-HiuGaaiNeural"
BIBLE_DATA = "/mnt/d/AI/BibleQuest2026/public/bible-data.json"
OUTPUT_DIR = "/mnt/d/AI/BibleQuest2026/public/audio/詩"
TEMP_DIR = "/tmp"

UPPER_OUT = os.path.join(TEMP_DIR, "詩119_upper.mp3")
LOWER_OUT = os.path.join(TEMP_DIR, "詩119_lower.mp3")
FINAL_OUT = os.path.join(OUTPUT_DIR, "詩119.mp3")
SPLIT_VERSE = 88  # upper = v1..v88, lower = v89..v176


def load_halves():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    verses = data["data"]["詩"]["119"]
    assert len(verses) == 176, f"Expected 176 verses, got {len(verses)}"
    upper = verses[:SPLIT_VERSE]   # indices 0..87 → verses 1..88
    lower = verses[SPLIT_VERSE:]   # indices 88..175 → verses 89..176
    upper_text = "".join(v[1] for v in upper)
    lower_text = "".join(v[1] for v in lower)
    print(f"  upper: verses 1-{SPLIT_VERSE}  ({len(upper)} entries, {len(upper_text)} chars)")
    print(f"  lower: verses {SPLIT_VERSE+1}-176  ({len(lower)} entries, {len(lower_text)} chars)")
    return upper_text, lower_text


async def gen(text: str, path: str, label: str):
    print(f"  [{label}] Sending to Edge TTS ({VOICE})...")
    # Apply TTS-only homophone substitution (櫺繙鬮捫 → 靈翻鳩悶)
    tts_input = tts_text(text)
    comm = edge_tts.Communicate(tts_input, VOICE)
    await comm.save(path)
    size_kb = os.path.getsize(path) / 1024
    print(f"  [{label}] OK → {path}  ({size_kb:.0f} KB)")


def concat_mp3():
    """Concat two mp3s without re-encoding using ffmpeg concat demuxer."""
    list_file = os.path.join(TEMP_DIR, "詩119_concat_list.txt")
    with open(list_file, "w") as f:
        f.write(f"file '{UPPER_OUT}'\n")
        f.write(f"file '{LOWER_OUT}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", FINAL_OUT,
    ]
    print(f"  ffmpeg: {' '.join(cmd)}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FFMPEG STDERR:", r.stderr[-2000:])
        raise RuntimeError(f"ffmpeg failed: rc={r.returncode}")
    size_kb = os.path.getsize(FINAL_OUT) / 1024
    print(f"  concat OK → {FINAL_OUT}  ({size_kb:.0f} KB)")


def probe_duration(path: str) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def main():
    print("=" * 60)
    print("詩 119 Split-Regen (Edge TTS 10-min cap workaround)")
    print("=" * 60)

    # Clean up any stale temp files
    for p in [UPPER_OUT, LOWER_OUT]:
        if os.path.exists(p):
            os.remove(p)
            print(f"  removed stale temp: {p}")

    upper_text, lower_text = load_halves()

    print("\n[1/3] Generating two halves...")
    asyncio.run(gen(upper_text, UPPER_OUT, "UPPER"))
    asyncio.run(gen(lower_text, LOWER_OUT, "LOWER"))

    print("\n[2/3] Probing halves...")
    d_upper = probe_duration(UPPER_OUT)
    d_lower = probe_duration(LOWER_OUT)
    print(f"  upper duration: {d_upper:.2f}s")
    print(f"  lower duration: {d_lower:.2f}s")
    assert d_upper < 600, f"Upper half still > 10min ({d_upper}s); split point wrong"
    assert d_lower < 600, f"Lower half still > 10min ({d_lower}s); split point wrong"

    print("\n[3/3] Concatenating...")
    concat_mp3()

    d_final = probe_duration(FINAL_OUT)
    size_kb = os.path.getsize(FINAL_OUT) / 1024
    print(f"\n✓ FINAL: {FINAL_OUT}")
    print(f"  duration: {d_final:.2f}s ({d_final/60:.2f} min)")
    print(f"  size: {size_kb:.0f} KB")
    print(f"  expected ~{d_upper + d_lower:.2f}s (sum of halves, concat may add tiny gap)")

    if d_final < 600:
        print(f"\n⚠ Still under 10 min — 詩119 may not have been fully covered. Check verses.")
    else:
        print(f"\n✓ Over 10 min — 176 verses fully covered.")


if __name__ == "__main__":
    main()