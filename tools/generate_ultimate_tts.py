"""Generate 朗讀 audio for 《神的終極目的》— one mp3 per chapter, per script.

Mirrors tools/generate_tts_v2.py (the scripture pipeline) deliberately:
  * same edge-tts zh-HK voices, odd chapter female / even chapter male, so the
    book sounds like the Bible reader the user already knows
  * same silent-truncation protection (retry + duration verification) — the
    Round-23 鐐 incident is exactly the failure that guard exists for
  * tts_text() substitution, so the 42 TTS_CHAR_MAP fixes apply here too

Differences from the scripture generator, both deliberate:
  * OUTPUT PATH is per-chapter under public/ultimate-intention/audio/<lang>/,
    because the reader checks for the file's existence to decide whether to
    render the audio bar. generate_chapter() writes a fixed BASE_DIR path, so
    it cannot be reused directly (passing a single verse would also overwrite
    the committed chapter mp3 — see tools/make_liu_clips.py).
  * LANGUAGE is a parameter: 繁體 and 簡體 each get their own file.

Runtime: ~5.9 h of audio per language at ~1x realtime, so a full run is ~12 h
for both. Run one language at a time and it is resumable — existing files with
a plausible size are skipped unless --force.

Verification (no synthesis, exits 1 if anything looks truncated):
    python3 tools/generate_ultimate_tts.py --lang zh-Hant --verify

Usage:
    python3 tools/generate_ultimate_tts.py --lang zh-Hant
    python3 tools/generate_ultimate_tts.py --lang zh-Hans
    python3 tools/generate_ultimate_tts.py --lang zh-Hant --only 3,7,26
    python3 tools/generate_ultimate_tts.py --lang zh-Hant --only 3 --clip
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import edge_tts  # noqa: E402

from tts_char_substitutions import tts_text  # noqa: E402

ROOT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
OUT_ROOT = ROOT / "audio"

# Voice per script. 「轉到簡體，朗讀卻沒有轉成普通話？」 — both scripts were
# synthesised with the SAME zh-HK voice, so the spoken audio never changed with
# the text: 繁體 read in Cantonese and 简体 read in Cantonese, which is exactly
# what was reported. The two languages now use their own locale:
#
#   繁體 (this book is a Hong Kong / 白受恩 translation) -> zh-HK
#   简体 -> zh-CN, the mainland standard the reader expects
#
# Female on odd chapters, male on even — unchanged, so the voices still
# alternate the way the scripture reader's do.
VOICES = {
    "zh-Hant": ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"),
    "zh-Hans": ("zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural"),
}
VOICE_FEMALE, VOICE_MALE = VOICES["zh-Hant"]  # back-compat for ad-hoc imports

# A chapter whose audio is under this many seconds is treated as a silent
# truncation and retried. The smallest real chapter in this book is 第二十八篇
# at ~2,500 chars ≈ 6.5 min, so 30s is a very loose floor.
MIN_SECONDS = 30.0

# Measured speaking rate across all 56 generated files. Speaking rate is NOT a
# property of the language alone — it depends on the voice:
#
#   zh-Hant / zh-HK-HiuGaaiNeural  (odd chapters, female)  4.17 chars/sec… but
#   zh-Hant / zh-HK-WanLungNeural  (even chapters, male)   5.00 chars/sec
#   zh-Hans / zh-CN-XiaoxiaoNeural (odd, female)           5.05 chars/sec
#   zh-Hans / zh-CN-YunjianNeural   (even, male)            5.05 chars/sec
#
# A single constant per language was wrong by up to 20% for zh-Hant, which made
# every even (male) chapter look over-long and every odd one look suspiciously
# slow — 10 false alarms on a corpus that is in fact complete. Keyed by
# (lang, chapter parity) because that is what actually selects the voice.
CHARS_PER_SEC = {
    ("zh-Hant", "odd"): 4.17,   # measured 0.2808 s/char, except ch1 (0.230)
    ("zh-Hant", "even"): 5.00,  # measured 0.2000 s/char, except ch28 (0.156)
    ("zh-Hans", "odd"): 5.05,
    ("zh-Hans", "even"): 5.05,
}
CHARS_PER_SEC_DEFAULT = 4.2

# How much of the expected duration a file must reach to count as complete.
#
# This was 0.5, and 0.5 is the one number that makes the check nearly useless:
# 「a chapter whose audio is under this many seconds」 was in the docstring, but
# a 1,000-second chapter truncated to 500 seconds PASSED. edge-tts returns
# HTTP 200 with a short stream at its ~2,500-char boundary instead of raising,
# so this guard is the only thing standing between a silently half-read chapter
# and production.
#
# 0.85 leaves room for the real variation in speaking rate (measured spread on
# the existing corpus: 0.24 s/char ± ~7% for zh-HK, ± ~2% for zh-CN) while
# still rejecting a genuine half-length cut. A file that fails this is retried,
# not shipped.
MIN_COMPLETE_RATIO = 0.85

_BYTES_PER_SEC = 8000  # edge mp3 ≈ 8KB/sec; used only when ffprobe is absent

# Chapters whose speaking rate is legitimately outside the corpus median, with
# the reason — never a bare number, so a future reader can tell "known and
# understood" from "nobody checked".
#
#   zh-Hant 28 = 譯者序. Classical-Chinese foreword with dense 「」 quotations and
#   no modern punctuation cadence; 0.156 s/char against a 0.203 male-voice
#   median. Verified by ear — the file ends on 「阿們！(猶24-25)」, which is the
#   last line of the chapter text, so it is complete, just slow.
KNOWN_SLOW: dict[tuple[str, int], str] = {
    ("zh-Hant", 28): "譯者序 — 文言，語速自然慢；已聽證尾部為全章最後一句",
}


def audio_seconds(path: Path, size: int) -> float | None:
    """Real duration in seconds, or None when ffprobe is unavailable.

    Duration is the honest signal; byte size is a proxy that drifts with
    bitrate and speaking rate, which is why it must never be the only check.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        val = float(out.stdout.strip())
        return val if val > 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def expected_seconds(n_chars: int, lang: str, num: int) -> float:
    """Expected duration, keyed by the voice that chapter actually uses."""
    key = (lang, "odd" if num % 2 == 1 else "even")
    rate = CHARS_PER_SEC.get(key, CHARS_PER_SEC_DEFAULT)
    return max(MIN_SECONDS, n_chars / rate)


def completeness(n_chars: int, size: int, seconds: float | None,
                 lang: str = "zh-Hant", num: int = 1) -> tuple[bool, str]:
    """(ok, detail) — is this audio plausibly the whole chapter?"""
    want = expected_seconds(n_chars, lang, num)
    got = seconds if seconds is not None else size / _BYTES_PER_SEC
    src = "ffprobe" if seconds is not None else "bytes"
    ratio = got / want
    ok = ratio >= MIN_COMPLETE_RATIO
    note = KNOWN_SLOW.get((lang, num))
    detail = (f"{got:.0f}s vs expected {want:.0f}s "
              f"({ratio:.0%}, floor {MIN_COMPLETE_RATIO:.0%}, via {src})")
    if not ok and note:
        # Documented, not merely tolerated: still reported as ok, because the
        # alternative is a permanently red corpus that people learn to ignore.
        detail += f" — 已記錄: {note}"
        return True, detail
    return ok, detail


async def synth(text: str, voice: str, out: Path, retries: int = 3,
                lang: str = "zh-Hant", num: int = 1) -> dict:
    """Synthesize one chapter, retrying on the silent-truncation failure.

    edge-tts 7.2.7 can return HTTP 200 with a short/empty stream instead of
    raising. Checking duration is the only defence — that is why the scripture
    generator verifies it too.
    """
    last = None
    for attempt in range(1, retries + 1):
        try:
            tmp = out.with_suffix(".part")
            await edge_tts.Communicate(text, voice).save(str(tmp))
            size = tmp.stat().st_size
            ok, detail = completeness(len(text), size, audio_seconds(tmp, size),
                                     lang, num)
            if not ok:
                tmp.unlink(missing_ok=True)
                last = f"truncated: {detail} (attempt {attempt})"
                time.sleep(2 * attempt)
                continue
            tmp.replace(out)
            return {"status": "ok", "size": size, "attempt": attempt,
                    "check": detail}
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
            out.with_suffix(".part").unlink(missing_ok=True)
            time.sleep(2 * attempt)
    return {"status": "fail", "error": last}


def run_verify(chapters: list[Path], outdir: Path, lang: str) -> int:
    """Audit existing mp3s against their chapter text. No synthesis.

    Three independent signals per file, because any one alone can lie:

      * duration vs expected, keyed by the voice that chapter actually uses
      * characters-per-second against the median OF THE WHOLE LANGUAGE — which
        is why the median is computed from every mp3 in outdir, not just the
        chapters under test. Comparing a file against itself always passes,
        which is exactly the bug this rewrite removed.
      * the KNOWN_SLOW allowlist, so a documented exception is visible rather
        than silently tolerated

    Returns an exit code, so it is usable in CI or a pre-deploy hook.
    """
    # Baseline rates from the FULL corpus, so --only 21 still judges 21 against
    # every other chapter rather than against itself.
    ref_rates: dict[str, list[float]] = {}
    for mp3 in sorted(outdir.glob("*.mp3")):
        n = int(mp3.stem)
        src = ROOT / lang / f"{n}.json"
        if not src.exists():
            continue
        body = chapter_text(json.loads(src.read_text(encoding="utf-8")))
        sec = audio_seconds(mp3, mp3.stat().st_size)
        if body and sec:
            ref_rates.setdefault("odd" if n % 2 == 1 else "even",
                                 []).append(sec / len(body))
    medians = {k: sorted(v)[len(v) // 2] for k, v in ref_rates.items() if v}

    rows: list[tuple[int, int, float | None, int]] = []
    missing = 0
    for p in chapters:
        num = int(p.stem)
        ch = json.loads(p.read_text(encoding="utf-8"))
        text = chapter_text(ch)
        mp3 = outdir / f"{num:02d}.mp3"
        if not mp3.exists():
            print(f"[MISS] {num:02d} {ch['label']} — no audio file")
            missing += 1
            continue
        size = mp3.stat().st_size
        rows.append((num, len(text), audio_seconds(mp3, size), size))

    if not rows:
        print("nothing to verify")
        return 1 if missing else 0

    bad = 0
    for num, nchars, sec, size in rows:
        ok, detail = completeness(nchars, size, sec, lang, num)
        rate = (sec / nchars) if (nchars and sec) else None
        voice = "odd" if num % 2 == 1 else "even"
        ref = medians.get(voice)
        # Corpus-relative check within the same voice. Skipped when there is
        # only one sample of that voice — a median of one is the file itself,
        # and the test would be vacuous rather than reassuring.
        rel_ok = True
        if rate is not None and ref and len(ref_rates.get(voice, [])) > 2:
            rel_ok = abs(rate - ref) / ref <= 0.35
        if ok and rel_ok:
            tail = f" {sec:7.1f}s {rate:.3f}s/字 ({voice} median {ref:.3f})" if rate else ""
            print(f"[ok  ] {num:02d} {nchars:5}字{tail}")
        else:
            bad += 1
            why = [] if ok else [detail]
            if not rel_ok:
                why.append(f"rate {rate:.3f}s/字 vs {voice} median {ref:.3f} "
                           f"over the whole language")
            print(f"[BAD ] {num:02d} {nchars:5}字 — {'; '.join(why)}")

    print(f"\n{lang}: {len(rows)} files, {bad} suspicious, {missing} missing, "
          f"per-voice medians {{{', '.join(f'{k}:{v:.3f}' for k, v in medians.items())}}}"
          f" s/字, floor {MIN_COMPLETE_RATIO:.0%}")
    return 1 if (bad or missing) else 0


def chapter_text(ch: dict) -> str:
    """Paragraphs joined; image blocks contribute nothing to speech."""
    parts = [b["text"] for b in ch["blocks"] if b["type"] == "p"]
    return "".join(parts)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True, choices=["zh-Hant", "zh-Hans"])
    ap.add_argument("--only", help="comma-separated chapter numbers")
    ap.add_argument("--force", action="store_true", help="regenerate existing files")
    ap.add_argument("--clip", action="store_true",
                    help="write to scratch instead of public/ (for ear-check)")
    ap.add_argument("--probe", action="store_true",
                    help="per-character silent-char scan, writes nothing")
    ap.add_argument("--verify", action="store_true",
                    help="audit existing audio against its chapter text "
                         "(no synthesis); exits 1 if any file looks truncated")
    args = ap.parse_args()

    chapters = sorted((ROOT / args.lang).glob("*.json"))
    if args.only:
        want = {int(x) for x in args.only.split(",")}
        chapters = [p for p in chapters if int(p.stem) in want]

    outdir = (Path("/home/appstester0919/.hermes/cache/scratch/ultimate_clips")
              / args.lang) if args.clip else (OUT_ROOT / args.lang)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.probe:
        await run_probe(chapters, args.lang)
        return

    if args.verify:
        sys.exit(run_verify(chapters, outdir, args.lang))

    t0 = time.time()
    done = skipped = failed = 0
    total_bytes = 0

    for p in chapters:
        num = int(p.stem)
        ch = json.loads(p.read_text(encoding="utf-8"))
        out = outdir / f"{num:02d}.mp3"

        if out.exists() and not args.force:
            skipped += 1
            print(f"[skip] {num:02d} {ch['label']} {out.stat().st_size:,}B", flush=True)
            continue

        text = chapter_text(ch)
        female, male = VOICES[args.lang]
        voice = female if num % 2 == 1 else male
        r = await synth(text, voice, out, lang=args.lang, num=num)

        if r["status"] == "ok":
            done += 1
            total_bytes += r["size"]
            elapsed = time.time() - t0
            print(f"[ok  ] {num:02d} {ch['label']} {r['size']:,}B "
                  f"attempt {r['attempt']} | {elapsed / 60:.1f}min elapsed", flush=True)
        else:
            failed += 1
            print(f"[FAIL] {num:02d} {ch['label']} {r['error']}", flush=True)

    print(f"\n{args.lang}: {done} generated, {skipped} skipped, {failed} failed, "
          f"{total_bytes:,} bytes, {(time.time() - t0) / 60:.1f} min")
    if failed:
        sys.exit(1)


async def run_probe(chapters: list[Path], lang: str) -> None:
    """Find characters that are SILENT on the zh-HK voices.

    Round-23 (鐐) taught two things that this probe encodes:
      * a BARE-char probe is required — 鐐 alone returned NoAudioReceived while
        the compounds 鐵鐐 and 脚鐐 returned full audio, because the engine
        absorbs the unknown syllable and reads the neighbours. A compound probe
        would have falsely cleared the char.
      * a wrong candidate substitution is worse than none, so this only
        REPORTS. TTS_CHAR_MAP stays a human decision.

    Rate: ~1.3 requests/sec sustained, so a full-corpus scan is ~2 min. Batches
    are capped and the run is resumable in the sense that it re-derives from the
    corpus each time rather than accumulating state.
    """
    corpus = "".join(chapter_text(json.loads(p.read_text(encoding="utf-8")))
                     for p in chapters)
    chars = sorted(set(c for c in corpus if "\u4e00" <= c <= "\u9fff"))

    # Probe the text the pipeline ACTUALLY SENDS, not the raw corpus. An earlier
    # version probed the raw text and so re-reported 軛/鐐 as failing after they
    # were already mapped — the substitution is what reaches edge-tts, and a
    # probe that ignores tts_text() answers the wrong question.
    from tts_char_substitutions import TTS_CHAR_MAP
    probe_chars = sorted({TTS_CHAR_MAP.get(c, c) for c in chars})

    print(f"scanning {len(probe_chars)} distinct characters on zh-HK voices "
          f"({len(chars)} source, after {len(TTS_CHAR_MAP)} mappings)")
    chars = probe_chars
    silent = []

    # Group into chunks so one request covers several chars; edge-tts streams
    # per input, and a chunked probe still isolates failures because the error
    # is per-character on the service side. To stay unambiguous we probe ONE
    # char per request but pipeline 8 concurrently.
    sem = asyncio.Semaphore(8)

    async def one(ch: str) -> tuple[str, int, str | None]:
        async with sem:
            for attempt in range(3):
                try:
                    n = 0
                    comm = edge_tts.Communicate(ch, VOICE_FEMALE)
                    async for piece in comm.stream():
                        if piece.get("type") == "audio":
                            n += len(piece.get("data") or b"")
                    return ch, n, None
                except Exception as exc:  # noqa: BLE001
                    err = type(exc).__name__
                    if attempt == 2:
                        return ch, 0, err
                    await asyncio.sleep(1.5 * (attempt + 1))
            return ch, 0, "unknown"

    results = await asyncio.gather(*(one(c) for c in chars))
    for ch, n, err in results:
        if n == 0 or err:
            silent.append((ch, n, err))

    print(f"\nSILENT / failing characters: {len(silent)}")
    for ch, n, err in silent:
        print(f"  {ch}  bytes={n}  {err}")


    if silent:
        out = Path("/home/appstester0919/.hermes/cache/scratch")
        (out / f"ultimate_tts_silent_{lang}.txt").write_text(
            "\n".join(f"{c}\t{n}\t{e}" for c, n, e in silent), encoding="utf-8")
        print(f"\nwrote {out / f'ultimate_tts_silent_{lang}.txt'}")
        print("NOTE: this only REPORTS. Pick substitutions by hand — a wrong one is "
              "worse than a missing one.")


if __name__ == "__main__":
    asyncio.run(main())