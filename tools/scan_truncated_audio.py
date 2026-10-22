"""Scan every Bible mp3 for the signature of a truncated render.

Signature
---------
edge-tts stops cleanly at exactly 600.0 s when a chapter's audio exceeds the
websocket stream limit, so a file whose duration is ~600.0 s is not "a long
chapter" — it is a chapter that was cut off. Four such chapters were
re-discovered on 2026-10-22 (利13, 士9, 撒上17, 路9) and had to be rendered
in two halves and concatenated.

This scans the whole 1,189-file corpus so no other chapter is still serving
a cut-off reading.
"""
import glob
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = "/mnt/d/AI/BibleQuest2026/public/audio"


def dur(path: str) -> tuple[str, float]:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return path, float(r.stdout.strip())
    except ValueError:
        return path, 0.0


def main() -> int:
    files = sorted(glob.glob(f"{ROOT}/*/*.mp3"))
    with ThreadPoolExecutor(max_workers=16) as ex:
        rows = list(ex.map(dur, files))
    cut = [(p, d) for p, d in rows if 594 <= d <= 606]
    zero = [p for p, d in rows if d <= 0]
    big = sorted(((p, d) for p, d in rows if d >= 590), key=lambda x: -x[1])
    print(f"scanned {len(files)} files")
    print(f"\n⚠ 594-606s (cut at the 600s stream limit): {len(cut)}")
    for p, d in cut:
        print(f"   {os.path.basename(p):14} {d:8.1f}s")
    print(f"\n⚠ 0-second / unreadable: {len(zero)}")
    for p in zero:
        print("   ", p)
    print(f"\nall >=590s ({len(big)}):")
    for p, d in big:
        print(f"   {os.path.basename(p):14} {d:8.1f}s")
    ds = sorted(d for _, d in rows)
    print(f"\nmedian {ds[len(ds) // 2]:.1f}s   max {ds[-1]:.1f}s")
    return 1 if (cut or zero) else 0


if __name__ == "__main__":
    sys.exit(main())
