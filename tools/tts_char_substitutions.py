"""
TTS-only character substitution map for BibleQuest2026.

WHY THIS EXISTS:
The Chinese Union Version (和合本) uses some archaic characters that Edge TTS
zh-HK voices (HiuGaaiNeural, WanLungNeural) cannot pronounce correctly:
  - 櫺 (líng, "window lattice") → SILENT / garbled by TTS
  - 繙 (fān, "translate/turn over") → SILENT / garbled
  - 鬮 (jiū, "lot/cast lots") → SILENT / garbled
  - 捫 (mén, "touch/feel") → SILENT / garbled
  - 輜 (zī, "baggage/supplies") → SILENT in 輜重 / 輜重車 context
  - 驕 (jiāo, "arrogance") → misread (gài instead of jiāo) in 驕傲 context

We do NOT modify public/bible-data.json — that would double file size and slow
down Bible reading load time. Instead, this module provides a substitution that
is applied ONLY at TTS generation time.

USER-FACING DISPLAY: keeps original CUV characters (correct for reading).
TTS PRONUNCIATION: uses substituted homophones (correct for audio).

USER-PROVIDED MAPPING:
  櫺 → 靈 (líng)  — "window lattice" → "spirit/lattice"; sounds natural in window context
  繙 → 翻 (fān)   — "translate" → "turn over"; standard Chinese word
  鬮 → 鳩 (jiū)   — "cast lots" → "dove/pigeon"; sounds match Cantonese + Mandarin
  捫 → 悶 (mèn)   — "touch" → "stuffy/depressed"; sounds match Cantonese + Mandarin
  輜 → 資 (zī)    — "baggage" → "resources"; homophone, user accepted 2026-08-12
  驕 → 嬌 (jiāo)  — "arrogance" → "delicate"; homophone, user suggested 2026-08-12

Confirmed via sample MP3 tests on the existing 4 mappings (2026-08-10).
New 2 mappings (輜, 驕) added 2026-08-12 per user direction.

AFFECTED VERSES: ~220 verses across 30+ books (212 from original 4 + 6 輜 + 75 驕).
  Books affected: 創/利/民/申/書士撒上撒下王上王下代上代下拉尼伯詩箴歌賽耶結但珥摩俄彌鴻番太可路約徒林前來

REGENERATION SCOPE: any chapter containing affected chars needs regen.
Use `regen_tts_affected_chapters.py` after wiring this module in.
"""

# Substitution map (display_char → tts_char)
#
# REVERTED 2026-08-11: 捫 sub is REQUIRED because Edge TTS REJECTS 捫 entirely.
# Empirical evidence: `edge_tts.Communicate('捫', 'zh-HK-WanLungNeural')` raises
# `NoAudioReceived: No audio was received`. The HK voices cannot process 捫 as
# input at all (not just SILENT). 124/125 occurrences are 亞捫人 (Ammonites
# proper noun) and 1/125 is 捫心自問 (verb). Substituting to 悶 produces
# "亞悶人" which is semantically wrong but at least audible. The user accepted
# this tradeoff (2026-08-11 verification: "終於順利聽到缺失的字音"). See
# references/tts-char-substitution-2026-08-10.md for full audit + reverting
# story.
TTS_CHAR_MAP: dict[str, str] = {
    '櫺': '靈',  # líng
    '繙': '翻',  # fān
    '鬮': '鳩',  # jiū
    '捫': '悶',  # mèn
    '輜': '資',  # zī — added 2026-08-12 per user direction
    '驕': '嬌',  # jiāo — added 2026-08-12 per user direction
}

# Frozen snapshot for safety (prevents accidental mutation)
_FROZEN_MAP = frozenset(TTS_CHAR_MAP.items())


def tts_text(display_text: str) -> str:
    """
    Convert user-facing display text to TTS-pronounceable text.

    Applied ONLY at audio generation time. The returned string is fed to
    edge_tts.Communicate; the original `display_text` is what users see on
    /read page and what bible-data.json holds.

    This is a simple 1:1 character substitution (no nesting logic, no
    context-aware selection). Same approach as the 7/20 CJK vertical→horizontal
    quote fix (commit 981dd61).
    """
    if not display_text:
        return display_text
    result = display_text
    for old, new in _FROZEN_MAP:
        result = result.replace(old, new)
    return result


def contains_affected_chars(text: str) -> bool:
    """Check if a verse text contains any TTS-affected character.
    Used by TTS scripts to decide whether to skip regen for clean chapters."""
    return any(c in text for c in TTS_CHAR_MAP)


def list_affected_chars() -> list[str]:
    """Return the list of characters that need substitution."""
    return list(TTS_CHAR_MAP.keys())


# Module self-test (run as `python3 tools/tts_char_substitutions.py`)
if __name__ == '__main__':
    test_cases = [
        ('從窗櫺中呼叫說：他的戰車為何耽延不來呢？', '從窗靈中呼叫說：他的戰車為何耽延不來呢？'),
        ('彌賽亞繙出來就是基督。', '彌賽亞翻出來就是基督。'),
        ('為那兩隻羊拈鬮，一鬮歸與耶和華。', '為那兩隻羊拈鳩，一鳩歸與耶和華。'),
        ('我心裡也仔細省察捫心自問。', '我心裡也仔細省察悶心自問。'),
    ]
    print('=== tts_text() tests ===')
    all_pass = True
    for input_text, expected in test_cases:
        result = tts_text(input_text)
        ok = result == expected
        all_pass = all_pass and ok
        print(f'  {"✅" if ok else "❌"} {input_text!r}')
        if not ok:
            print(f'     got:      {result!r}')
            print(f'     expected: {expected!r}')

    print(f'\n=== Module info ===')
    print(f'  Affected chars: {list_affected_chars()}')
    print(f'  Total: {len(TTS_CHAR_MAP)} chars, 212 affected verses across 30+ books')

    if all_pass:
        print('\n✅ All tests pass')
    else:
        print('\n❌ Some tests failed')
        raise SystemExit(1)