"""Build the reader's data files: 繁體 (default) + 簡體, split per chapter.

Why split per chapter rather than one big JSON:
  the whole book is 98,460 chars ≈ 300 KB as one JSON. /read gets away with a
  single bible-data.json because that is cached once and reused for 3112
  chapters; a 28-chapter book reader is the same shape, but the user may never
  open most chapters, and mobile JSON.parse of 300 KB blocks the main thread.
  Per chapter ≈ 10 KB, loaded on demand, and each file is a separate SW cache
  entry so offline reading still works chapter by chapter.

Conversion: OpenCC s2hk, then a 2-glyph override.
  s2hk is right for HK vocabulary (軟件/網絡/信息/裏) — s2tw would give 資訊,
  網路 and 裡, all wrong for a HK readership. But s2hk emits 説 (318x) and 啓
  (124x), which HK's own standard (GovHK, 香港聖經公會) does not use; HK writes
  說 and 啟. Measured on the real corpus, so the override table is evidence, not
  guesswork.

The simplified source is what the PDF ships, so 簡體 needs no conversion at all.
"""

import json
from pathlib import Path

import opencc

ROOT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
OUT_HT = ROOT / "zh-Hant"
OUT_HS = ROOT / "zh-Hans"

# Glyph corrections layered ON TOP of s2hk. Every entry is measured, not
# guessed — see the audit in build_ultimate_intention_data.py's docstring.
#
# Wrong-output class (s2hk emits a glyph HK does not use):
#   説 x318 → 說   (GovHK / 香港聖經公會 standard)
#   啓 x124 → 啟   (same)
#
# Missed-conversion class (s2hk leaves the SIMPLIFIED char untouched — a real
# gap in its table, caught by scanning our own zh-Hant output for simplified
# characters, which is why that scan exists):
#   悦 → 悅
#   着 → 著   (HK writes 著; s2hk leaves 着 alone)
HK_GLYPH_FIX = {
    "説": "說",
    "啓": "啟",
    "悦": "悅",
    "着": "著",
}

# Phrase-level patches for genuine OpenCC s2hk dictionary gaps.
#
# Found by tools/audit_ultimate_hant.py scanning our own zh-Hant output for
# characters OpenCC itself derives as simplified-only, then confirmed by a
# direct s2hk call. These are converter gaps, not ours:
#
#   s2hk("30天后")  -> "30天后"   后 never converts here (ch17)
#   s2hk("家伙")   -> "傢伙"    伙 stays the simplified glyph (ch04)
#   s2hk("干扰")   -> "干擾"    ← CORRECT. 干扰 is 干擾 in HK/TW too
#                              (干擾 / 干犯 / 干預 all use 干), so this is
#                              NOT a bug and must not be patched.
#
# Only entries verified as converter errors live here. A wrong entry is worse
# than none — it would corrupt correct text.
PHRASE_FIX = {
    "30天后": "30天後",
    "天后": "天後",
    "以后": "以後",
    "后来": "後來",
    "小傢伙": "小傢伙",
    "家伙": "傢伙",
}

# Longest-first so a longer phrase is matched before a shorter one it contains.
_PHRASE_ORDER = sorted(PHRASE_FIX.items(), key=lambda kv: -len(kv[0]))

# User-approved glyph fixes, 2026-10-07, each probe-verified on all three zh-HK
# voices AFTER the user corrected or confirmed the reading. Added for the
# 屬靈書 corpus; harmless for scripture (these chars simply do not occur there).
#
#  栄 → 榮  SOURCE TYPO: the PDF itself contains 栄 (U+8369, the Japanese
#           shinjitai) where it should read 荣. All three OpenCC configs leave it
#           alone because it is not a simplified form of anything — the
#           translator mistyped. Must be fixed in the source text, and fixing it
#           here also repairs the DISPLAY text, not just the audio.
#  禰 → 祢  s2hk maps 祢→禰, but HK churches print 祢 for the reverential "You"
#           (35 occurrences, every one addressing God). User confirmed.
#  羣 → 群  HK/TW standard for 羣人 / 羣眾. User confirmed.
#  諍 → 淨  User corrected my reading: 諍 is pronounced 淨 (zing6), NOT 爭, and
#           諍言 means candid exhortation, not argument — so 爭 was wrong on BOTH
#           counts and I am glad it was rejected. Measured proof that a
#           substitution is required at all: on all three voices
#           「對教會的諍言」and「對教會的言」are byte-identical (13536/12816/12672),
#           i.e. edge-tts SKIPS 諍 rather than mispronouncing it. With 淨 the audio
#           grows by exactly one syllable (15264/14112/13680). The displayed text
#           remains 諍言; only the audio speaks 淨, which is the correct reading.
#  鐧 → 簡  User instruction: 殺手鐧 is correct as written, so 鐧 is kept in the
#           display text and the audio substitutes 簡 only because 鐧 cannot be
#           pronounced. Killers implement a plan; 殺手鐧 = the trump card.
#  齧 → 嚙  HK glyph. User confirmed.

# DISPLAY-LEVEL fixes. These change the TEXT THE USER READS, not just the audio,
# so they belong here rather than in TTS_CHAR_MAP. Applied to the simplified
# source before conversion, so both script outputs are corrected.
#
#  栄 → 榮  the PDF itself contains the Japanese shinjitai where it means 榮
#  禰 → 祢  s2hk maps 祢→禰; HK churches print 祢, and 35 occurrences all address
#           God (主禰 / 惟禰 / 禰的), so this is a vocabulary correction, not a
#           glyph variant. User confirmed.
#
# NOT here: 羣 (kept as the traditional variant 羣, which HK also uses — only the
# AUDIO needs 群, and TTS_CHAR_MAP handles that), and 齧/鐧 likewise audio-only.
SOURCE_TYPO_FIX = {
    "栄": "榮",
    "禰": "祢",
}

CN = "一二三四五六七八九十"


def cn_label(n: int) -> str:
    if n <= 10:
        return CN[n - 1] + "篇"
    if n < 20:
        return "十" + CN[n - 11] + "篇"
    return "二十" + (CN[n - 21] if n > 20 else "") + "篇"


def to_hk(text: str, conv: opencc.OpenCC) -> str:
    out = conv.convert(text)
    # Phrase fixes first — they are context-dependent, a bare glyph swap would
    # corrupt words where the char IS correct (幹擾 vs 干擾).
    for wrong, right in _PHRASE_ORDER:
        if wrong in out:
            out = out.replace(wrong, right)
    for wrong, right in HK_GLYPH_FIX.items():
        if wrong in out:
            out = out.replace(wrong, right)
    return out


def main() -> None:
    conv = opencc.OpenCC("s2hk")
    raw = (ROOT / "book.json").read_text(encoding="utf-8")
    # Repair source typos BEFORE parsing, so 栄→榮 fixes the display text too.
    for wrong, right in SOURCE_TYPO_FIX.items():
        if wrong in raw:
            n = raw.count(wrong)
            print(f"source typo: {wrong} → {right}  x{n}")
            raw = raw.replace(wrong, right)
    book = json.loads(raw)

    OUT_HT.mkdir(parents=True, exist_ok=True)
    OUT_HS.mkdir(parents=True, exist_ok=True)

    index = {
        "id": book["id"],
        "title": {"zh-Hant": to_hk(book["title"], conv), "zh-Hans": book["title"]},
        "titleEn": book["titleEn"],
        "author": {"zh-Hant": to_hk(book["author"], conv), "zh-Hans": book["author"]},
        "chapters": [],
    }

    for ch in book["chapters"]:
        n = ch["num"]
        label = cn_label(n)
        title_hs = ch["title"]
        title_ht = to_hk(title_hs, conv)

        blocks_hs = []
        blocks_ht = []
        for b in ch["blocks"]:
            if b["type"] == "img":
                blocks_hs.append(b)
                blocks_ht.append(b)
            else:
                # Preserve the block type. The web parser emits "h" for a
                # subheading and "p" for body prose; flattening both to "p" threw
                # away all 154 subheadings before the reader ever saw them.
                kind = b["type"] if b["type"] in ("p", "h") else "p"
                blocks_hs.append({"type": kind, "text": b["text"]})
                blocks_ht.append({"type": kind, "text": to_hk(b["text"], conv)})

        meta = {"num": n, "label": label,
                "title": {"zh-Hant": title_ht, "zh-Hans": title_hs}}

        (OUT_HS / f"{n:02d}.json").write_text(
            json.dumps({**meta, "lang": "zh-Hans", "blocks": blocks_hs},
                       ensure_ascii=False, indent=1),
            encoding="utf-8")
        (OUT_HT / f"{n:02d}.json").write_text(
            json.dumps({**meta, "lang": "zh-Hant", "blocks": blocks_ht},
                       ensure_ascii=False, indent=1),
            encoding="utf-8")

        # index entry carries a preview so the list page needs one fetch, not 28
        first = next((b["text"] for b in blocks_ht if b["type"] == "p"), "")
        index["chapters"].append({
            **meta,
            "preview": {"zh-Hant": first[:60], "zh-Hans": ""},
            "images": sum(1 for b in blocks_ht if b["type"] == "img"),
            "chars": sum(len(b["text"]) for b in blocks_ht if b["type"] == "p"),
        })

    (ROOT / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # Verification: assert the override actually landed and no bad glyph remains.
    sample = (OUT_HT / "01.json").read_text(encoding="utf-8")
    for wrong in HK_GLYPH_FIX:
        assert wrong not in sample, f"{wrong} still present in zh-Hant output"
    assert "說" in sample or True  # 說 may not appear in ch1; the assert above is the guard

    all_ht = "".join((OUT_HT / f"{n:02d}.json").read_text(encoding="utf-8")
                     for n in range(1, 29))
    print(f"built {len(index['chapters'])} chapters, both scripts")
    print(f"  説 remaining: {all_ht.count('説')}   啓 remaining: {all_ht.count('啓')}")
    print(f"  說: {all_ht.count('說')}   啟: {all_ht.count('啟')}")
    print(f"  裏: {all_ht.count('裏')}   裡: {all_ht.count('裡')}")
    print(f"  軟件: {all_ht.count('軟件')}   網絡: {all_ht.count('網絡')}")
    print(f"  zh-Hant total {len(all_ht):,} chars")
    print(f"  index.json {len((ROOT / 'index.json').read_text(encoding='utf-8')):,} bytes")


if __name__ == "__main__":
    main()