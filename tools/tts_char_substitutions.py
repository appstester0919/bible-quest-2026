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
  - 搆 (gòu, "reach/attain") → SILENT in 搆到 context (4x, 賽/林後)
  - 誆 (kuāng, "deceive") → SILENT in 誆哄 context (4x, 士/撒下/王上)
  - 柺 (guǎi, "crutch/cane") → SILENT in 柺杖/架柺 context (5x, 創/撒下/亞/太/可)

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
  搆 → 夠 (gòu)   — "reach" → "enough"; user accepted semantic shift 2026-08-16
  誆 → 康 (kāng)  — "deceive" → "healthy/well"; semantic shift per user direction 2026-08-16
  柺 → 拐 (guǎi)  — traditional → simplified of same word; zero semantic loss 2026-08-16
  邑 → 泣 (qì)    — "city/town" → "cry"; semantic shift per user direction 2026-08-16
  珥 → 耳 (ěr)    — proper-noun placeholder → "ear"; semantic shift per user direction 2026-08-16

Confirmed via sample MP3 tests on the existing 4 mappings (2026-08-10).
New 2 mappings (輜, 驕) added 2026-08-12 per user direction.
New 6 mappings (軛, 縋, 讒, 貲, 賙, 單) added 2026-08-14 per user Cantonese ear
verification — original chars all SILENT in zh-HK voices (單 additionally misreads
as 善). User directed semantic-shift accept to avoid silent/misread output.
New 3 mappings (搆, 誆, 柺) added 2026-08-16 per user Cantonese ear verification —
all 3 chars SILENT in zh-HK voices. 搆→夠 and 誆→框 are semantic shifts; 柺→拐 is
traditional-to-simplified of the same word.
New 6 mappings (摶, 瓔, 轂, 鑷, 奩, 饈) added 2026-08-21 per user Cantonese ear
verification — all 6 chars REJECTED by edge TTS zh-HK voices (NoAudioReceived).
User-direct subs: 摶→團, 瓔→英, 轂→谷, 鑷→聶, 奩→廉, 饈→收. Speech-v4 friendly
homophones — 瓔/英 為最常見 pair; 饈→收 因 TTS 收る粵音近 xiū Mandarin.
New 1 mapping (罈) added 2026-08-21 per user Cantonese ear verify — 罈 REJECTED
by edge TTS zh-HK voices (NoAudioReceived). User-direct sub: 罈→譚 (tán/taam⁴).
Slight semantic shift (jar→surname) but minimal collision in BQ corpus.
New 1 mapping (縵) added 2026-08-24 per user Cantonese ear verify — 縵 REJECTED
by edge TTS zh-HK voices (NoAudioReceived / SILENT). User-direct sub: 縵→慢
(màn/maan⁶). 縵 = proper-name syllable in 乃縵 (Naaman) + 撒縵以色 (Shalmaneser);
homophone 慢 (slow) preserves Cantonese pronunciation perfectly with zero
collision in BQ corpus (乃慢 / 撒慢以色 read as natural proper name). Display
text in bible-data.json stays canonical 縵 — sub applied only at generation time.
Affects 20 verses across 4 chapters: 王下 5 / 王下 17 / 王下 18 / 路 4.
New 1 mapping (鉈) added 2026-08-27 per user Cantonese ear verify — 鉈 REJECTED
by edge TTS zh-HK voices (NoAudioReceived / SILENT). User-direct sub: 鉈→陀
(tò/tò⁴). 鉈 = plumb-line / 線鉈 / 準繩 measurement instrument in 4 verses:
賽 28:17 / 賽 34:11 / 王下 21:13 / 亞 4:10. Homophone 陀 (globe/steelyard base)
preserves Cantonese pronunciation perfectly. Display text in bible-data.json
stays canonical 鉈 — sub applied only at generation time.
New 1 mapping (諂) added 2026-08-28 per user Cantonese ear verify — 諂 REJECTED
by edge TTS zh-HK voices (NoAudioReceived, 0 B). User-direct sub: 諂→闡
(chǎn / cin2). 諂 = flattery, always in compound 諂媚 (flatter / cajole), appears
in 12 verses across 10 chapters / 8 books (詩5/詩78/箴6/箴7/箴26/箴28/箴29/
但11/帖前2/猶1). Homophone 闡 (expound / cin2) preserves Cantonese pronunciation
perfectly. Display text in bible-data.json stays canonical 諂 — sub applied only
at generation time.

AFFECTED VERSES: ~534+12 = ~546 verses across 40+ books (212 original 4 + 6 輜 +
  75 驕 + 52 軛 + 10 縋 + 18 讒 + 2 貲 + 19 賙 + 199 單 + 4 搆 + 4 誆 + 5 柺 + 12
  諂 [詩5 詩78 箴6 箴7 箴26 箴28 箴29 但11 帖前2 猶1]).
  Books affected: 創/利/民/申/書士撒上撒下王上王下代上代下拉尼伯詩箴歌賽耶結但珥摩俄彌鴻番太可路約徒林前林後來/plus new: 哀/傳/出/亞/何/加/多/提前/提後/斯/士/耶/珥/摩/plus 2026-08-16: 撒下1/賽10/林後10/士14/士16/王上13

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
    '搆': '夠',  # gòu — added 2026-08-16 per user Cantonese ear verify
    '誆': '康',  # kāng — added 2026-08-16 per user Cantonese ear verify
    '柺': '拐',  # guǎi — added 2026-08-16 per user Cantonese ear verify
    '邑': '泣',  # qì — added 2026-08-16 per user Cantonese ear verify
    '珥': '耳',  # ěr — added 2026-08-16 per user Cantonese ear verify
    '摶': '團',  # tuán — added 2026-08-21 per user Cantonese ear verify
    '瓔': '英',  # yīng — added 2026-08-21 per user Cantonese ear verify
    '轂': '谷',  # gǔ — added 2026-08-21 per user Cantonese ear verify
    '鑷': '聶',  # niè — added 2026-08-21 per user Cantonese ear verify
    '奩': '廉',  # lián — added 2026-08-21 per user Cantonese ear verify
    '饈': '收',  # shōu (xiū→TTS reads as shōu acceptable per user Cantonese ear) — added 2026-08-21
    '罈': '譚',  # tán — added 2026-08-21 per user Cantonese ear verify (罈 REJECTED by edge TTS zh-HK, NoAudioReceived)
    '縵': '慢',  # màn — added 2026-08-24 per user Cantonese ear verify (縵 REJECTED by edge TTS zh-HK, NoAudioReceived/SILENT). Naaman/Shalmaneser proper name.
    '鉈': '陀',  # tò — added 2026-08-27 per user Cantonese ear verify (鉈 REJECTED by edge TTS zh-HK, NoAudioReceived/SILENT). 線鉈 / 準繩 plumb-line context. Display text stays canonical 鉈 — sub applied only at generation time.
    '諂': '闡',  # chǎn / cin2 — added 2026-08-28 per user Cantonese ear verify (諂 REJECTED by edge TTS zh-HK, NoAudioReceived, 0 B). Affects 12 verses across 10 chapters (詩/箴/但/帖前/猶) — all in compound 諂媚. Display text stays canonical 諂 — sub applied only at generation time.
    '鈸': '拔',  # bá / bat6 — added 2026-08-30 per user Cantonese ear verify (鈸 REJECTED by edge TTS zh-HK, NoAudioReceived, 0 B). Affects 15 verses across 10 chapters (代上/代下/尼/拉/撒下/林前/詩) — all 鈸 proper-noun musical instrument. Display text stays canonical 鈸 — sub applied only at generation time.
}

# Frozen snapshot for safety (prevents accidental mutation)
_FROZEN_MAP = frozenset(TTS_CHAR_MAP.items())


# Verse-specific punctuation fixes (apply BEFORE char substitution)
# These are typos in bible-data.json that affect TTS prosody. The display text
# stays unchanged — only TTS rendering is corrected by injecting a comma where
# the human reader would naturally pause.
#
# Format: (substring_marker, TTS_insertion_after_marker, optional_verse_ref)
# We use substring_marker so we don't need verse context — a substring that is
# uniquely identifying for the typo, and only matches in the typo'd verse.
#
# Verse-specific punctuation fixes (source-edit-only — per user direction
# 2026-08-21, future punctuation typos should be fixed DIRECTLY in
# public/bible-data.json. The display text is ground truth for readers,
# search, citation hashes. This list is back-compat for already-shipped
# verses where audio was gen'd against unfixed source; it should NOT
# grow with new entries. As of 2026-08-21 both historical entries
# (撒下 1:23, 弗 3:13) have been source-edited and their markers removed.
#
# 2026-08-16: 撒下 1:23 raw = '掃羅和約拿單活時相悅相愛，死時也不分離他們比鷹更快，比獅子還強。'
# Should be: '掃羅和約拿單活時相悅相愛，死時也不分離。他們比鷹更快，比獅子還強。'
# (missing 。 after '也不分離'). Edge TTS reads '也不分離他們' as a single flowing
# phrase without pause — distorts the parallel structure '相悅相愛/也不分離'.
# Status (2026-08-21): SOURCE-EDITED. Marker removed.
#
# 2026-08-21: 弗 3:13 '...患難喪膽這原是你們的榮耀。' — flagged by user as
# missing the 中間 '，'. Source-edit applied directly to bible-data.json
# (per user's preference for permanent source-level fixes). Marker removed.
TTS_PUNCTUATION_FIXES: list[tuple[str, str, str]] = []


def tts_text(display_text: str) -> str:
    """
    Convert user-facing display text to TTS-pronounceable text.

    Applied ONLY at audio generation time. The returned string is fed to
    edge_tts.Communicate; the original `display_text` is what users see on
    /read page and what bible-data.json holds.

    Pipeline:
      1. Apply verse-specific punctuation fixes (e.g. 撒下 1:23)
      2. Apply char substitution map (TTS_CHAR_MAP)

    Step 1 must run before step 2 because punctuation fixes may insert
    punctuation that's later passed to edge_tts unchanged (punctuation is
    not in TTS_CHAR_MAP so order doesn't matter for that, but conceptually
    fixes precede substitution).
    """
    if not display_text:
        return display_text
    result = display_text
    for marker, replacement, _ref in TTS_PUNCTUATION_FIXES:
        result = result.replace(marker, replacement)
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
        ('他們用舌頭諂媚人。', '他們用舌頭闡媚人。'),  # Round-11 2026-08-28
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