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
  - 軛 (è, "yoke") → SILENT in 軛 / 重軛 / 鐵軛 context (52x, 20 books)
  - 縋 (zhuì, "descend by rope") → SILENT in 縋下 / 縋下去 context (10x, 7 books)
  - 讒 (chán, "slander") → SILENT in 讒言 / 讒謗 / 讒毀 context (18x, 11 books)
  - 貲 (zī, "donation/wealth") → SILENT in 捐貲 context (2x, 林後 only)
  - 賙 (zhōu, "relieve poor") → SILENT in 賙濟 context (19x, 10 books)
  - 單 (dān/shàn/chán, "single/proper name") → misread as 善 (shàn) by zh-HK
    voices. User chose blanket → 丹 (199x, 29 books) to avoid the misread entirely.

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
  軛 → 厄 (è)     — "yoke" → "hardship/strait"; homophone, user accepted 2026-08-14
  縋 → 墜 (zhuì)  — "descend by rope" → "fall/drop"; exact semantic match
  讒 → 慚 (cán)   — "slander" → "ashamed"; user accepts semantic shift, audible ok
  貲 → 資 (zī)    — reuse existing 資 mapping (Cantonese match)
  賙 → 周 (zhōu)  — "relieve poor" → "周濟" is a real word; user accepted 2026-08-14
  單 → 丹 (dān)   — blanket sub to avoid zh-HK TTS misreading as 善 (shàn);
    affects 199 verses across 29 books (most are 單獨/單單/單靠 semantic shift)

Confirmed via sample MP3 tests on the existing 4 mappings (2026-08-10).
New 2 mappings (輜, 驕) added 2026-08-12 per user direction.
New 6 mappings (軛, 縋, 讒, 貲, 賙, 單) added 2026-08-14 per user Cantonese ear
verification — original chars all SILENT in zh-HK voices (單 additionally misreads
as 善). User directed semantic-shift accept to avoid silent/misread output.

AFFECTED VERSES: ~520 verses across 40+ books (212 from original 4 + 6 輜 + 75 驕
  + 52 軛 + 10 縋 + 18 讒 + 2 貲 + 19 賙 + 199 單).
  Books affected: 創/利/民/申/書士撒上撒下王上王下代上代下拉尼伯詩箴歌賽耶結但珥摩俄彌鴻番太可路約徒林前林後來/plus new: 哀/傳/出/亞/何/加/多/提前/提後/斯/士/耶/珥/摩

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
    '軛': '厄',  # è — added 2026-08-14 per user Cantonese ear verify
    '縋': '墜',  # zhuì — added 2026-08-14 per user Cantonese ear verify
    '讒': '慚',  # cán — added 2026-08-14 per user Cantonese ear verify
    '貲': '資',  # zī — added 2026-08-14 per user Cantonese ear verify
    '賙': '周',  # zhōu — added 2026-08-14 per user Cantonese ear verify
    '單': '丹',  # dān — added 2026-08-14 per user Cantonese ear verify (blanket)
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