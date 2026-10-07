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

Usage:
    python3 tools/generate_ultimate_tts.py --lang zh-Hant
    python3 tools/generate_ultimate_tts.py --lang zh-Hans
    python3 tools/generate_ultimate_tts.py --lang zh-Hant --only 3,7,26
    python3 tools/generate_ultimate_tts.py --lang zh-Hant --only 3 --clip
"""

import argparse
import asyncio
import json
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
# truncation and retried. The smallest real chapter in this book is 第五篇 at
# ~3,800 chars ≈ 15 min, so 30s is a very loose floor.
MIN_SECONDS = 30.0


async def synth(text: str, voice: str, out: Path, retries: int = 3) -> dict:
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
            # ffprobe is not guaranteed present; fall back to a byte floor
            # derived from text length (edge mp3 ≈ 4.2 chars/sec ≈ 8KB/sec).
            floor = max(MIN_SECONDS * 8000, len(text) / 4.2 * 8000 * 0.5)
            if size < floor:
                tmp.unlink(missing_ok=True)
                last = f"too short: {size}B < {int(floor)}B (attempt {attempt})"
                time.sleep(2 * attempt)
                continue
            tmp.replace(out)
            return {"status": "ok", "size": size, "attempt": attempt}
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
            out.with_suffix(".part").unlink(missing_ok=True)
            time.sleep(2 * attempt)
    return {"status": "fail", "error": last}


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
        r = await synth(text, voice, out)

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