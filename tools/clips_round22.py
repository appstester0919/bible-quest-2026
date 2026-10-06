#!/usr/bin/env python3
"""
Round-22 ear-verify clips (Stage 5a, LOCAL regenerated mp3s — §44).

Golden rules applied:
  §43  verse number = the entry's OWN `vn` field, NEVER array index + 1.
  §43  target located by CANONICAL char content (bible-data.json text), not by
       a hand-guessed verse number — and NOT in the TTS text, because tts_text()
       has already substituted 鵜鶘 -> 提弧 by that point.
  §10  cps probed from the ACTUAL local mp3 duration, never a hard-coded
       constant (Round-21 measured 4.19-4.67 WanLung; 3.36 HiuGaai).
  §43  every clip prints book+chapter:verse, its opening text, and the span, so
       the printed text can be eyeballed for the target char BEFORE sending.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tts_char_substitutions import tts_text

BASE = Path("/mnt/d/AI/BibleQuest2026")
AUDIO = BASE / "public" / "audio"
OUT = Path("/tmp/round22_clips")
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = [
    ("詩", 102, "鵜鶘", "你報告嘅章"),
    ("利", 11, "鴞", "F voice"),
    ("利", 11, "鵜鶘", "F voice"),
    ("申", 14, "鴞", ""),
    ("申", 14, "鵜鶘", ""),
    ("賽", 34, "鵜鶘", ""),
    ("番", 2, "鵜鶘", ""),
]
PAD = 1.2   # seconds of context either side of the verse


def probe_duration(fp):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(fp)],
        capture_output=True, text=True)
    return float(r.stdout.strip())


bible = json.load(open(BASE / "public" / "bible-data.json", encoding="utf-8"))["data"]

clips = []
for book, ch, needle, note in TARGETS:
    verses = bible[book][str(ch)]
    mp3 = AUDIO / book / f"{book}{ch}.mp3"
    if not mp3.exists():
        print(f"❌ {book}{ch}: mp3 missing")
        continue
    total = probe_duration(mp3)

    # char spans over the CONCATENATED TTS text (what generate_tts_v2 feeds
    # edge_tts), keyed by the entry's own vn field (§43)
    spans, pos = {}, 0
    rows = []
    for vn, text in verses:
        t = tts_text(text)
        spans[vn] = (pos, pos + len(t))
        rows.append((vn, text, t))     # canonical + tts
        pos += len(t)
    total_chars = pos
    cps = total_chars / total          # §10 empirical, per-file

    hit = [(vn, canon, t) for vn, canon, t in rows if needle in canon]
    if not hit:
        print(f"❌ {book}{ch}: '{needle}' not in canonical text — grep the corpus")
        continue

    for vn, canon, t in hit:
        s, e = spans[vn]
        start = max(0.0, s / cps - PAD)
        end = min(total, e / cps + PAD)
        label = canon[:14].replace("/", "／")
        out = OUT / f"{book}{ch}_{vn}_{needle}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}",
             "-to", f"{end:.2f}", "-i", str(mp3), "-c", "copy", str(out)],
            check=True)
        cd = probe_duration(out)
        clips.append((f"{book}{ch}:{vn}", label, tts_text(needle), start, end,
                      cd, out.stat().st_size, note, out, canon, needle))

print("=== Round-22 ear-verify clips (LOCAL mp3s, pre-commit — §44) ===")
print(f"{'ref':<11} {'canonical opening':<20} {'TTS reads':<7} {'span':<16} {'clip':<7} {'size':<9}")
for ref, label, sub, s, e, cd, csz, note, out, canon, needle in clips:
    print(f"{ref:<11} {label:<20} {sub:<7} {s:6.1f}-{e:6.1f}s {cd:5.1f}s {csz:>7}B  {note}")

print("\n=== sanity (§43): canonical text of each clip MUST contain its own needle ===")
bad = 0
for ref, label, sub, s, e, cd, csz, note, out, canon, needle in clips:
    ok = needle in canon          # THIS clip's own needle, carried from TARGETS
    if not ok:
        bad += 1
    print(f"  {'✅' if ok else '❌'} {ref}  「{canon[:24]}」  needle={needle}")

print(f"\n{'✅ all clips verified on the right verse' if bad == 0 else f'❌ {bad} BAD'}")
print(f"{len(clips)} clips in {OUT}")
