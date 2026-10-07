"""Derive the true simplified-only character set from OpenCC.

Hand-typing the set produced 10 false positives on the first attempt
(台 斗 干 后 扎 污 户 漠 掠 温), because several of those are valid in BOTH
scripts — 舞台, 干擾, 30天后, 扎實, 污穢, 門户, 冷漠, 擄掠, 温柔 are all correct
traditional. So the audit must not trust a typed list.

Rule: a character is simplified-only iff OpenCC maps it to a DIFFERENT
character. That is a mechanical definition, computed here and written out for
audit_ultimate_hant.py to consume.
"""

import opencc

conv = opencc.OpenCC("s2hk")

# Every CJK char that appears in either our simplified source or its output.
corpus = open(
    "/mnt/d/AI/BibleQuest2026/public/ultimate-intention/book.json", encoding="utf-8"
).read()

simp_only = []
for ch in sorted(set(c for c in corpus if "一" <= c <= "鿿")):
    if conv.convert(ch) != ch:
        simp_only.append(ch)

out = "".join(simp_only)
print(f"derived {len(simp_only)} simplified-only chars from the actual corpus")
print(out)

with open(
    "/mnt/d/AI/BibleQuest2026/tools/simplified_only_set.txt", "w", encoding="utf-8"
) as f:
    f.write(out)

# Sanity-check the ten that fooled the hand-typed version.
for ch, expected in [
    ("台", False), ("扎", False), ("污", False), ("户", False),
    ("漠", False), ("掠", False), ("温", False), ("斗", True),
    ("干", True), ("后", True),
]:
    actual = ch in set(simp_only)
    flag = "ok " if actual == expected else "!! "
    print(f"  {flag}{ch} simplified-only={actual} (expected {expected})")