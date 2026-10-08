"""Regenerate exactly the chapters an audit found truncated.

    python3 tools/regen_suspect_chapters.py            # audit, then regen findings
    python3 tools/regen_suspect_chapters.py --dry-run  # list only

Deliberately does not go through generate_tts_v2.py's main(), because that
reads and writes .tts_gen_log.json — the resume ledger for a full 1,189-chapter
run. Regenerating three files must not mark 1,189 chapters complete or otherwise
disturb that state.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import generate_tts_v2 as G  # noqa: E402

import verify_scripture_audio as V  # noqa: E402


async def regen(abbr: str, ch: int, verses) -> None:
    text = "".join(v[1] if isinstance(v, (list, tuple)) else str(v) for v in verses)
    voice = G.VOICE_FEMALE if ch % 2 == 1 else G.VOICE_MALE
    out = str(ROOT / "public/audio" / abbr / f"{abbr}{ch}.mp3")
    per_char = G.SECONDS_PER_CHAR["female" if voice == G.VOICE_FEMALE else "male"]
    want = len(text) * per_char
    print(f"→ {abbr}{ch}  {len(text)}字  女/男={voice[-1]}  "
          f"expect ≈{want:.0f}s (need ≥{want * G.MIN_DURATION_RATIO:.0f}s)",
          flush=True)

    r = await G._save_and_verify(text, voice, out)
    ok, dur, size = r
    verdict = "OK" if ok else "STILL SHORT"
    print(f"  {verdict}: {dur:.1f}s, {size / 1024:.0f}KB "
          f"({dur / want * 100:.0f}% of expected)", flush=True)
    if not ok:
        # generate_chapter owns the retry loop; reuse it so the retry policy
        # stays in one place rather than being re-implemented here.
        res = await G.generate_chapter(abbr, ch, verses)
        print(f"  after retries: {res.get('status')} "
              f"{res.get('duration', 0):.1f}s", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = json.loads((ROOT / "public/bible-data.json").read_text(encoding="utf-8"))
    rows, _ = V.load_rows()

    import statistics
    from collections import defaultdict
    rates = defaultdict(list)
    for _, n, nchars, sec, voice in rows:
        if nchars and sec:
            rates[voice].append(sec / nchars)
    med = {k: statistics.median(v) for k, v in rates.items()}

    suspects = []
    for abbr, n, nchars, sec, voice in rows:
        if not nchars or not sec:
            continue
        rate = sec / nchars
        ref = med.get(voice)
        # Same rule as verify_scripture_audio.py's REL_BAD, so the two tools
        # cannot disagree about what "suspicious" means.
        if ref and abs(rate - ref) / ref > V.REL_BAD:
            suspects.append((abbr, n, nchars, sec, voice, rate, ref))

    if not suspects:
        print("no suspicious chapters — nothing to regenerate")
        return 0

    for abbr, n, nchars, sec, voice, rate, ref in suspects:
        print(f"[suspicious] {abbr}{n} {nchars}字 {sec:.1f}s "
              f"{rate:.3f}s/字 vs {voice} median {ref:.3f}")

    if args.dry_run:
        return 0

    for abbr, n, *_ in suspects:
        verses = data["data"][abbr].get(str(n)) or data["data"][abbr].get(n)
        asyncio.run(regen(abbr, n, verses))
    return 0


if __name__ == "__main__":
    sys.exit(main())