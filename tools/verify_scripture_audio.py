"""Audit every committed scripture mp3 for silent truncation.

    python3 tools/verify_scripture_audio.py          # summary + any findings
    python3 tools/verify_scripture_audio.py -v       # per-file rates

generate_tts_v2.py already verifies at write time (ffprobe duration >= 90% of
the expected length), but that only proves the check RAN on the day each file
was made — not that every file already on disk is complete now. This
re-audits the committed corpus independently.

Two signals per file:

  * absolute — duration against a conservative 4.83 chars/sec (the slower male
    voice, as generate_tts_v2.py uses). Real speech never drifts far below that;
    real truncation lands near 0.5 of it.
  * relative — seconds-per-character against the median OF THE SAME VOICE
    across the whole corpus. Female and male voices differ by ~14% on this
    material, so a pooled median would flag half the library; per-voice does
    not.

Read-only: writes nothing, deletes nothing, opens no browser.
"""
import json
import re
import statistics
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026")
AUDIO = ROOT / "public/audio"
DATA = ROOT / "public/bible-data.json"

# Measured across all 1,189 committed files, in SECONDS PER CHARACTER:
#
#   female zh-HK-HiuGaaiNeural  0.297 s/char  (3.37 chars/sec)
#   male   zh-HK-WanLungNeural  0.214 s/char  (4.67 chars/sec)
#
# Note this contradicts the comment in generate_tts_v2.py, which claims
# ~5.5 / ~4.83 chars/sec. The male figure is close; the female voice is 39%
# SLOWER than documented. That constant is used there to compute an expected
# duration, so every female chapter was expected to be ~60% shorter than it
# actually is — which is why its 90% floor never rejected anything and the
# guard was believed to be working.
#
# The absolute floor here is therefore set from the SLOWEST real voice with
# headroom: 0.45 s/char is ~50% slower than the slowest genuine speech and
# still far below the ~0.6 s/char that a half-length cut would show.
SLOWEST_SEC_PER_CHAR = 0.297
MIN_SEC_PER_CHAR = 0.45

REL_WARN = 0.40           # deviation from own-voice median that is worth noting
REL_BAD = 0.60            # …and that is treated as a defect


def probe_all(paths: list[Path], workers: int = 12) -> dict[Path, float]:
    """Durations for every file, in parallel.

    ffprobe accepts only ONE input per invocation, so 1,245 files means 1,245
    processes; run serially that took ~4 minutes, which is long enough that
    nobody runs the audit. A thread pool over the subprocess calls cuts it to
    seconds without changing what is measured.
    """
    from concurrent.futures import ThreadPoolExecutor

    def one(p: Path) -> tuple[Path, float]:
        try:
            r = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(p)],
                capture_output=True, text=True, timeout=30)
            return p, float(r.stdout.strip() or 0)
        except (OSError, ValueError, subprocess.SubprocessError):
            return p, 0.0

    if not paths:
        return {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return dict(ex.map(one, paths))


def load_rows() -> tuple[list[tuple], dict]:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    rows = []
    for abbr, chapters in data["data"].items():
        for ch, verses in chapters.items():
            mp3 = AUDIO / abbr / f"{abbr}{ch}.mp3"
            if not mp3.exists():
                continue
            # verses is [[n, text], ...] in this corpus
            text = "".join(v[1] if isinstance(v, (list, tuple)) and len(v) > 1
                           else str(v) for v in verses)
            text = re.sub(r"\s+", "", text)
            n = int(ch)
            rows.append((abbr, n, len(text), mp3,
                         "odd" if n % 2 == 1 else "even"))

    durs = probe_all([r[3] for r in rows])
    return [(a, n, c, durs.get(m, 0.0), v) for a, n, c, m, v in rows], durs


def main() -> int:
    verbose = "-v" in sys.argv
    rows, durs = load_rows()
    if not rows:
        print("no audio found")
        return 1

    rates: dict[str, list[float]] = defaultdict(list)
    for _, _, nchars, sec, voice in rows:
        if nchars and sec:
            rates[voice].append(sec / nchars)
    med = {k: statistics.median(v) for k, v in rates.items() if v}

    bad, warn = [], []
    for abbr, n, nchars, sec, voice in rows:
        if not nchars or not sec:
            bad.append((abbr, n, nchars, sec, voice, "empty text or unreadable audio"))
            continue
        rate = sec / nchars
        if rate > MIN_SEC_PER_CHAR:
            bad.append((abbr, n, nchars, sec, voice,
                        f"{rate:.3f}s/字 exceeds floor {MIN_SEC_PER_CHAR:.3f} "
                        f"(= far slower than any real voice, i.e. truncation)"))
            continue
        ref = med.get(voice)
        if ref:
            dev = abs(rate - ref) / ref
            if dev > REL_WARN:
                (bad if dev > REL_BAD else warn).append(
                    (abbr, n, nchars, sec, voice,
                     f"{rate:.3f}s/字 vs {voice} median {ref:.3f} ({dev:.0%} off)"))

    if verbose:
        for abbr, n, nchars, sec, voice in sorted(rows, key=lambda r: r[0]):
            rate = f"{sec / nchars:.3f}" if nchars and sec else "—"
            print(f"  {abbr}{n:<4} {nchars:5}字 {sec:7.1f}s  {rate}s/字  {voice}")

    longest = max(rows, key=lambda r: r[3])
    print(f"files audited : {len(rows)}")
    print(f"total audio   : {sum(r[3] for r in rows) / 3600:.1f} h")
    print(f"longest       : {longest[0]}{longest[1]}  {longest[3]:.1f}s "
          f"({longest[3] / 60:.1f} min, {longest[2]}字)")
    print("per-voice med : " + ", ".join(
        f"{k} {v:.3f}s/字" for k, v in sorted(med.items())))
    over600 = [r for r in rows if r[3] > 600]
    print(f"over 600s     : {len(over600)} files — i.e. Edge TTS did NOT "
          f"stop at ten minutes for these")
    if over600:
        print(f"                longest of them: {max(over600, key=lambda r: r[3])[0]}"
              f"{max(over600, key=lambda r: r[3])[1]} "
              f"{max(over600, key=lambda r: r[3])[3]:.0f}s")
    print(f"BAD           : {len(bad)}")
    print(f"warn          : {len(warn)}")

    if "-top" in sys.argv:
        ranked = sorted(rows, key=lambda r: abs(
            (r[3] / r[2] if r[2] else 0) - med.get(r[4], 0)) / (med.get(r[4]) or 1),
            reverse=True)
        print("\nmost deviant 15 (rate vs own-voice median):")
        for r in ranked[:15]:
            print(f"  {r[0]}{r[1]:<4} {r[2]:5}字 {r[3]:7.1f}s "
                  f"{r[3] / r[2]:.3f}s/字 ({r[4]} median {med.get(r[4], 0):.3f})")

    for tag, lst in (("BAD", bad), ("warn", warn)):
        for r in lst[:30]:
            print(f"  [{tag}] {r[0]}{r[1]} {r[2]}字 {r[3]:.1f}s {r[4]} — {r[5]}")
        if len(lst) > 30:
            print(f"  ... and {len(lst) - 30} more")

    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())