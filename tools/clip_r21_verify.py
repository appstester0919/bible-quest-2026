#!/usr/bin/env python3
"""Stage 5a ear-verify clips for 輦→連 (Round-21).

§43: key spans by the entry's own `vn` field, never by enumerate() index, and
locate target verses by TARGET_CHAR in entry[1]. Print {book}{ch}:{vn} 「text」
with every clip so a mis-landed clip is obvious before the user wastes a
listen.

§10/Stage 5a: cps = total_chars / probe_duration(deployed LOCAL mp3), probed
per chapter — never a single hard-coded number.
"""
import json, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tts_char_substitutions import tts_text

BASE = Path(__file__).resolve().parent.parent
AUDIO = BASE / "public" / "audio"
OUT = Path("/home/appstester0919/.hermes/cache/scratch/clips_r21")
OUT.mkdir(parents=True, exist_ok=True)
TARGET = "輦"
CHAPTERS = [("詩", 68, 17), ("詩", 104, 3), ("賽", 66, 15)]

bible = json.load(open(BASE / "public" / "bible-data.json"))


def dur_of(p: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(p)],
        capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


for book, ch, want_vn in CHAPTERS:
    verses = bible["data"][book][str(ch)]
    # spans keyed by the entry's own vn
    spans, pos = {}, 0
    for vn, text in verses:
        spans[vn] = (pos, pos + len(text))
        pos += len(text)
    total = pos

    mp3 = AUDIO / book / f"{book}{ch}.mp3"
    if not mp3.exists():
        print(f"!! missing {mp3}")
        continue
    d = dur_of(mp3)
    cps = total / d if d else 0.0

    # locate by char content, not by a guessed verse number
    found = [e[0] for e in verses if TARGET in e[1]]
    print(f"\n{book} {ch}: 目標節 = {found}  (want v{want_vn})")
    print(f"  chars={total} dur={d:.2f}s cps={cps:.3f}")

    vn = want_vn if want_vn in spans else (found[0] if found else None)
    if vn is None:
        print("  !! no target verse")
        continue
    s, e = spans[vn]
    # widen a little so the word is audible in context
    s2, e2 = max(0, s - 12), min(total, e + 12)
    t0, t1 = s2 / cps, e2 / cps
    dst = OUT / f"{book}{ch}_v{vn}.mp3"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.2f}",
                    "-to", f"{t1:.2f}", "-i", str(mp3), "-c:a", "libmp3lame",
                    str(dst)], check=True)
    text = dict((v[0], v[1]) for v in verses)[vn]
    print(f"  {book}{ch}:{vn} 「{text[:24]}」 {t0:.1f}-{t1:.1f}s")
    print(f"  -> {dst}  ({dst.stat().st_size}B)")
    print(f"  MEDIA:{dst}")