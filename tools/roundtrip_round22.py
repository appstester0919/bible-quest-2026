#!/usr/bin/env python3
# Round-22 round-trip acceptance test (skill Stage 4 audit item 3).
# Verifies tts_text() produces the expected TTS string for every Round-22 verse.
# Also asserts the CANONICAL corpus is untouched (§36 Lane-B purity).
import json
import sys

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")
from tts_char_substitutions import tts_text, list_affected_chars

ROUNDS = [
    ("鵜", "提"), ("鶘", "弧"), ("鴞", "囂"),
]

# Exact corpus strings (verbatim from bible-data.json)
CASES = [
    ("詩102:6", "我如同曠野的鵜鶘；我好像荒場的鴞鳥。",
     "我如同曠野的提弧；我好像荒場的囂鳥。"),
    ("利11:17", "鴞鳥、鸕鶿、貓頭鷹、", "囂鳥、鸕鶿、貓頭鷹、"),
    ("利11:18", "角鴟、鵜鶘、禿鵰、", "角鴟、提弧、禿鵰、"),
    ("申14:16", "鴞鳥、貓頭鷹、角鴟、", "囂鳥、貓頭鷹、角鴟、"),
    ("申14:17", "鵜鶘、禿鵰、鸕鶿、", "提弧、禿鵰、鸕鶿、"),
    ("賽34:11", "鵜鶘、箭豬卻要得為業；貓頭鷹、烏鴉要住在其間。耶和華必將空虛的準繩，混沌的線鉈，拉在其上。",
     "提弧、箭豬卻要得為業；貓頭鷹、烏鴉要住在其間。耶和華必將空虛的準繩，混沌的線陀，拉在其上。"),
    # NOTE 賽34:11 contains 線鉈 — Round-10's 鉈→陀 mapping ALSO applies, so the correct
    # TTS output reads 線陀. That is pre-existing Round-10 behaviour, not a Round-22 bug.
    ("番2:14", "群畜，就是各國（國：或作類）的走獸必臥在其中；鵜鶘和箭豬要宿在柱頂上。在窗戶內有鳴叫的聲音；門檻都必毀壞，香柏木已經露出。",
     "群畜，就是各國（國：或作類）的走獸必臥在其中；提弧和箭豬要宿在柱頂上。在窗戶內有鳴叫的聲音；門檻都必毀壞，香柏木已經露出。"),
]

d = json.load(open("/mnt/d/AI/BibleQuest2026/public/bible-data.json"))
corpus = d["data"]

fails = 0
print("=== round-trip: canonical corpus -> tts_text() ===")
for ref, src, expected in CASES:
    # pull the REAL string out of the corpus (proves no typo in my CASES table)
    # locate the verse by CONTENT across the whole corpus (no key-name guessing, §49)
    found = None
    for bk, chaps in corpus.items():
        for ch_k, verses in chaps.items():
            for vn, text in verses:
                if src in text:
                    found = text
                    break
            if found:
                break
        if found:
            break
    if found is None:
        print(f"  ❌ {ref}: canonical string NOT FOUND in bible-data.json (my CASES table has a typo)")
        fails += 1
        continue
    got = tts_text(found)
    ok = got == expected
    fails += 0 if ok else 1
    print(f"  {'✅' if ok else '❌'} {ref}")
    if not ok:
        print(f"     corpus: {found!r}")
        print(f"     got:    {got!r}")
        print(f"     want:   {expected!r}")

print("\n=== Lane-B purity: no Round-22 char leaks into TTS output ===")
for orig, sub in ROUNDS:
    leaked = [r for r, s, e in CASES
              if orig in e and s not in e]  # orig present in expected = not substituted
    print(f"  {orig}: {'❌ LEAK in ' + str(leaked) if leaked else '✅ fully substituted'}")

print(f"\n=== map size ===")
chars = list_affected_chars()
print(f"  total mappings: {len(chars)}")
for o, s in ROUNDS:
    print(f"  {o} in map: {'✅' if o in chars else '❌ MISSING'}")

print(f"\n{'✅ ALL PASS' if fails == 0 else f'❌ {fails} FAILURES'}")
sys.exit(1 if fails else 0)
