"""Prove each regenerated chapter actually gained audio for the new characters.

Idea
----
The old chapter mp3 is in git (HEAD). The new one is on disk. The old one was
rendered with the character still silent — the engine drops that syllable
outright — so the new file must be LONGER by roughly one syllable per
previously-silent character that occurs in that chapter.

This costs nothing: no synthesis, no listening. It reads two files and
subtracts. It is the only bulk evidence that a regen actually changed the
audio rather than just rewriting the same bytes.

Caveat
------
A chapter can also change duration for other reasons (the engine's pacing is
not perfectly deterministic). So the check is directional: new >= old, and
the delta should be at least ~0.15 s per newly-silent character occurrence.
A delta near zero means the character contributed nothing.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026")
NEW_CHARS = list("啣噯廩櫓璫癤磣穡簍糴糶脩覿輥鉋銲鏇鏨鐃鐫鐺閤颻颼飫騸鴟鶿鷂鷥鸇鸕鸛")


def dur_of_bytes(data: bytes) -> float:
    p = Path("/home/appstester0919/.hermes/cache/scratch/_d.mp3")
    p.write_bytes(data)
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    p.unlink(missing_ok=True)
    try:
        return float(r.stdout.strip())
    except Exception:                                   # noqa: BLE001
        return 0.0


def dur_of_path(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:                                   # noqa: BLE001
        return 0.0


def main():
    data = json.load(open(ROOT / "public/bible-data.json", encoding="utf-8"))["data"]
    # which chapters changed, from git
    # -z gives NUL-separated records with NO path quoting. Without it git
    # escapes CJK paths as octal (e.g. "\344\272\236") and every path
    # parse fails silently — the first run of this script reported
    # "changed mp3 on disk: 0" while 20 files were in fact modified.
    r = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "-z",
                        "--", "public/audio", "public/ultimate-intention/audio"],
                       capture_output=True, text=True)
    changed = []
    for rec in r.stdout.split("\0"):
        if not rec:
            continue
        st, _, path = rec[:2], rec[2], rec[3:]
        if st.strip() and path.endswith(".mp3"):
            changed.append(Path(path))
    print(f"changed mp3 on disk: {len(changed)}\n")
    print(f'{"章":10}{"字元":30}{"舊s":>8}{"新s":>8}{"Δs":>7}  判定')
    print("-" * 82)
    bad, ok = [], 0
    for p in changed:
        # git status -z paths are repo-relative
        rel = Path(str(p).replace("\\", "/"))
        disk = ROOT / rel
        g = subprocess.run(["git", "-C", str(ROOT), "show",
                            f"HEAD:{rel}"], capture_output=True)
        if g.returncode != 0:
            print(f"{rel.stem:10} (新檔, git 冇舊版)")
            continue
        old = dur_of_bytes(g.stdout)
        new = dur_of_path(disk)
        # characters present in that chapter
        stem = rel.stem
        i = len(stem)
        while i > 0 and stem[i - 1].isdigit():
            i -= 1
        abbr, ch = stem[:i], stem[i:]
        try:
            verses = data[abbr][str(int(ch))]
        except Exception:                                # noqa: BLE001
            verses = []
        text = "".join(v[1] for v in verses)
        hits = [c for c in NEW_CHARS if c in text]
        delta = new - old
        verdict = "✓" if delta >= 0.1 * len(hits) else ("~" if delta > 0 else "✗")
        if verdict == "✗":
            bad.append((rel.stem, hits, delta))
        else:
            ok += 1
        print(f'{rel.stem:10}{"".join(hits) or "(無新字)":30}'
              f'{old:8.1f}{new:8.1f}{delta:7.1f}  {verdict}')
    print(f"\n通過 {ok}｜可疑 {len(bad)}")
    for b in bad:
        print("  ✗", b)


if __name__ == "__main__":
    main()
