"""Bump the service-worker cache name together with the audio change.

Why this is a script and not a sed
----------------------------------
`public/sw.js` carries a long comment on the CACHE_NAME line that records
what changed, the corpus scope, the chapter count and the total bytes. That
comment is the only record of why the cache version moved, and it was wrong
or missing on 8 consecutive audio-changing commits (2026-10-07 → 2026-10-22),
which is how a stale cache served the old silent-character mp3s for two
weeks. Hand-editing the number and then hand-counting the bytes is how it
goes wrong, so the bytes are computed from git.

Usage
-----
    python3 tools/bump_sw_cache.py --what "<what changed and why>"
    python3 tools/bump_sw_cache.py --what "..." --dry-run
"""
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026")
SW = ROOT / "public/sw.js"
AUDIO_DIRS = ["public/audio", "public/ultimate-intention/audio"]


def changed_mp3s() -> list[str]:
    r = subprocess.run(
        ["git", "-C", str(ROOT), "status", "--porcelain", "-z", "--"] + AUDIO_DIRS,
        capture_output=True, text=True)
    out = []
    for rec in r.stdout.split("\0"):
        if not rec:
            continue
        st, path = rec[:2], rec[3:]
        if st.strip() and path.endswith(".mp3"):
            out.append(path)
    return sorted(out)


def bytes_of(paths: list[str]) -> int:
    total = 0
    for p in paths:
        f = ROOT / p
        if f.exists():
            total += f.stat().st_size
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--what", required=True,
                    help="what changed and why a stale cache matters")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = SW.read_text(encoding="utf-8")
    m = re.search(r"const CACHE_NAME = 'bible-quest-v(\d+)'", src)
    if not m:
        raise SystemExit("CACHE_NAME pattern not found in public/sw.js")
    old_v = int(m.group(1))
    new_v = old_v + 1

    files = changed_mp3s()
    nbytes = bytes_of(files)
    bible = [f for f in files if f.startswith("public/audio/")]
    ult = [f for f in files if "ultimate-intention" in f]
    comment = (f"// bump v{old_v} -> v{new_v} ({args.what}) "
               f"Corpus scope: {len(bible)} Bible chapters + {len(ult)} 屬靈書 files "
               f"({len(files)} files, {nbytes:,} B total). "
               f"Audio bytes changed, so a stale cache would serve the previous "
               f"mp3s to every installed PWA.")
    new_line = f"const CACHE_NAME = 'bible-quest-v{new_v}' {comment}"

    print(f"bible-quest-v{old_v} -> bible-quest-v{new_v}")
    print(f"  files: {len(files)} ({len(bible)} Bible + {len(ult)} 屬靈書)")
    print(f"  bytes: {nbytes:,}")
    print(f"  comment: {comment}")
    if args.dry_run:
        print("\n(dry run — nothing written)")
        return

    # The CACHE_NAME line carries the full bump history as appended
    # "// bump vN -> vN+1 (...)" segments. Replacing the line would destroy
    # it, so: swap the version string in place, then append the new segment
    # to the end of that same line.
    line_no = next(i for i, l in enumerate(src.split("\n"))
                   if l.startswith("const CACHE_NAME ="))
    lines = src.split("\n")
    old_line = lines[line_no]
    head = old_line.split("// bump ")[0].rstrip()
    # Bug found 2026-10-22: head is the part of the line before the first
    # "// bump ", and it still contained the OLD version number. The comment
    # said "bump v45 -> v46" while CACHE_NAME itself stayed v45, so the cache
    # never moved and every installed PWA kept the old audio. The version
    # substitution has to be applied to head, not only to the comment.
    head = head.replace(f"bible-quest-v{old_v}", f"bible-quest-v{new_v}")
    hist = "// bump " + "// bump ".join(old_line.split("// bump ")[1:])
    new_line = f"{head} {comment} {hist}"
    lines[line_no] = new_line
    SW.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nwritten to {SW} (history preserved: {hist.count('// bump ')} prior segments)")


if __name__ == "__main__":
    main()
