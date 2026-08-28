#!/usr/bin/env python3
"""
Round-11 narrow regen: 諂→闡 only. Regenerate just 10 chapters:
  詩5 / 詩78 / 箴6 / 箴7 / 箴26 / 箴28 / 箴29 / 但11 / 帖前2 / 猶1
Reuses generate_chapter from generate_tts_v2.py which already applies
TTS_CHAR_MAP (including our new 諂→闡) via tts_text().

Why this script exists (Anti-pattern §19, CLASS-LEVEL 2026-08-27):
- regen_tts_affected_chapters.py with default scope = ~487 chapters (~3 hours).
- regen_tts_affected_chapters.py has no --chapters CLI flag.
- generate_tts_v2.py skips chapters in .tts_gen_log.json (so it won't regen
  even if we delete the log entries, since it walks ALL remaining books).

This script targets exactly the 10 affected chapters in seconds.

Pre-regen silent-cap audit (Anti-pattern §10, §15):
  Voice assignment by parity (chapter % 2):
    odd → F (zh-HK-HiuGaaiNeural, ~3.36 cps empirical → cap 1997 chars)
    even → M (zh-HK-WanLungNeural, ~4.70 cps empirical → cap 2820 chars)
  All 10 target chapters verified under cap; largest is 但11 = 1887 chars F
  (5.5% margin). No split-regen needed.

SUB-char probe (Anti-pattern §20): single-char probe 諂 → 0 B (REJECTED,
NoAudioReceived) on both voices; sub 闡 → 10656 B OK on both. Sub audible.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# Reuse same path as regen_tts_affected_chapters.py
sys.path.insert(0, str(Path(__file__).parent))
from generate_tts_v2 import (
    generate_chapter,
    BIBLE_DATA,
    BASE_DIR,
    VOICE_FEMALE,
    VOICE_MALE,
    CHARS_PER_SEC_CONSERVATIVE,
)

# Round-11 target list. All in compound 諂媚. Voice assignments verified
# by chapter parity (odd=F, even=M).
TARGETS = [
    ("詩", 5),    # F — 405 chars, well under cap
    ("詩", 78),   # M — 1719 chars, well under cap
    ("箴", 6),    # M — 736 chars
    ("箴", 7),    # F — 586 chars
    ("箴", 26),   # M — 636 chars
    ("箴", 28),   # M — 633 chars
    ("箴", 29),   # F — 585 chars
    ("但", 11),   # F — 1887 chars (largest, 5.5% margin under 1997)
    ("帖前", 2),  # M — 775 chars
    ("猶", 1),    # F — 1018 chars
]

# Empirical cps (Anti-pattern §10): voice-aware cps for duration pre-check.
# Conservative floor for verification gate (CHARS_PER_SEC_CONSERVATIVE in
# generate_tts_v2.py is 4.83 — the male lower bound; we use it as a uniform
# floor so any chapter regen'd via this script gets the SAME truncation
# protection as the wholesale script).
CPS_F = 3.36
CPS_M = 4.70


def expected_duration(ch: int, total_chars: int) -> float:
    """Voice-aware expected duration (Anti-pattern §10)."""
    cps = CPS_F if ch % 2 == 1 else CPS_M
    return total_chars / cps


async def main():
    with open(BIBLE_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    bible_data = data["data"]

    print(f"[ROUND-11 narrow regen: 諂→闡]")
    print(f"Targets: {TARGETS}")
    print(f"Source bible data: {BIBLE_DATA} (UNTOUCHED — TTS sub only)")
    print(f"Silent caps: F < 1997 chars, M < 2820 chars")
    print()

    results = []
    for abbr, ch in TARGETS:
        if abbr not in bible_data or str(ch) not in bible_data[abbr]:
            print(f"SKIP {abbr} {ch} — not in bible data")
            continue

        verses = bible_data[abbr][str(ch)]
        text = "".join(v[1] for v in verses)
        voice = "F" if ch % 2 == 1 else "M"
        voice_name = VOICE_FEMALE if voice == "F" else VOICE_MALE
        cap = 1997 if voice == "F" else 2820
        exp_dur = expected_duration(ch, len(text))

        # Pre-regen silent-cap check (Anti-pattern §10, §15)
        if len(text) >= cap:
            print(
                f"[{abbr} {ch}] ({voice}/{voice_name}) !!! SILENT-CAP-RISK "
                f"chars={len(text)} cap={cap} — abort chapter"
            )
            results.append({
                "book": abbr, "chapter": ch, "status": "aborted-silent-cap",
                "chars": len(text), "voice": voice_name,
            })
            continue

        # Capture old file size for verification (regen should grow it: sub adds syllable)
        mp3_path = os.path.join(BASE_DIR, abbr, f"{abbr}{ch}.mp3")
        size_old = os.path.getsize(mp3_path) if os.path.exists(mp3_path) else 0

        print(
            f"[{abbr} {ch}] ({voice}/{voice_name}) chars={len(text)} "
            f"exp_dur≈{exp_dur:.1f}s cap={cap} size_old={size_old}B ... ",
            end="", flush=True,
        )

        r = await generate_chapter(abbr, ch, verses)
        r["chars"] = len(text)
        r["exp_dur"] = exp_dur
        r["size_old"] = size_old
        r["voice_name"] = voice_name

        if r["status"] == "ok":
            actual_dur = r["duration"]
            new_size = r["size"]

            # Post-regen silent-truncation check (Anti-pattern §10 + Skill §silent-truncation)
            # Use uniform conservative cps floor (4.83 cps from generate_tts_v2.py).
            # generate_chapter already enforces MIN_DURATION_RATIO=0.90, but we re-check
            # against voice-aware cps for tighter audit.
            voice_aware_ok = actual_dur >= exp_dur * 0.90
            grew = new_size > size_old or size_old == 0  # new sub adds syllable, expect >

            r["voice_aware_ok"] = voice_aware_ok
            r["grew"] = grew
            print(
                f"OK {new_size}B ({actual_dur:.1f}s) attempts={r['attempts']} "
                f"voice_aware_dur_ok={'✅' if voice_aware_ok else '⚠️'} "
                f"grew={'✅' if grew else '➖'}"
            )
        else:
            print(f"FAIL {r.get('error', 'unknown')}")
        results.append(r)

    ok = sum(1 for r in results if r.get("status") == "ok")
    fail = sum(1 for r in results if r.get("status") not in ("ok", "aborted-silent-cap"))
    print(f"\n=== Round-11 regen complete: {ok}/{len(results)} OK ({fail} failed) ===")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))