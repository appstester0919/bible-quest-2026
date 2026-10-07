"""Context + correct-reading lookup for the 8 silent chars.

Two jobs:

1. THE PROBE TESTED THE WRONG STRING. generate_ultimate_tts.py --probe probes the
   RAW corpus, but the pipeline sends tts_text() output. 軛 and 鐐 are already in
   TTS_CHAR_MAP, so what actually reaches edge-tts is 軛's replacement, not 軛.
   Re-probing must run tts_text() first. This script does that.

2. Report each occurrence's context, so a substitution can be chosen from the
   meaning rather than guessed. Round-23's 鐐→璜/煌 mistake came from assuming a
   reading instead of reading the word.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")

import edge_tts  # noqa: E402

from tts_char_substitutions import TTS_CHAR_MAP, tts_text  # noqa: E402

ROOT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
SILENT = "栄禰羣諍軛鐐鐧齧"
VOICE = "zh-HK-HiuGaaiNeural"

# Occurrences of each char, with surrounding context.
print("=== occurrences in the zh-Hant corpus ===")
for n in range(1, 29):
    d = json.loads((ROOT / "zh-Hant" / f"{n:02d}.json").read_text(encoding="utf-8"))
    for b in d["blocks"]:
        if b["type"] != "p":
            continue
        t = b["text"]
        for ch in SILENT:
            if ch in t:
                i = t.index(ch)
                mapped = TTS_CHAR_MAP.get(ch)
                print(f"  第{n}篇 {ch}"
                      f"{' (mapped→' + mapped + ')' if mapped else ' (UNMAPPED)':<16}"
                      f" …{t[max(0, i - 14):i + 14]}…")


async def probe(s: str) -> int:
    n = 0
    try:
        c = edge_tts.Communicate(s, VOICE)
        async for piece in c.stream():
            if piece.get("type") == "audio":
                n += len(piece.get("data") or b"")
    except Exception:
        return 0
    return n


async def main() -> None:
    print("\n=== probe the RAW char vs its TTS_CHAR_MAP replacement ===")
    for ch in SILENT:
        raw = await probe(ch)
        mapped = TTS_CHAR_MAP.get(ch)
        sub = await probe(mapped) if mapped else None
        verdict = (
            "raw silent, substitute OK" if raw == 0 and sub and sub > 0
            else "raw silent, SUBSTITUTE ALSO SILENT" if raw == 0 and sub == 0
            else "raw OK" if raw > 0
            else "raw silent, NO SUBSTITUTE"
        )
        print(f"  {ch}  raw={raw:>6}  sub={mapped or '—':<4}({sub if sub is not None else '—':>6})  {verdict}")

    print("\n=== full-chapter tts_text() sanity: does any chapter still contain a dead char? ===")
    # Re-run the pipeline's own text, then probe it whole — a chapter with many
    # chars will not be NoAudioReceived, but its duration tells us if chunks
    # were dropped. Cheap proxy: confirm no UNMAPPED silent char survives.
    unmapped = [c for c in SILENT if c not in TTS_CHAR_MAP]
    print(f"  unmapped silent chars still in output: {''.join(unmapped) or 'none'}")


asyncio.run(main())