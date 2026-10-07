"""Debug the audit's false positives with exact indices.

The audit reported 「里 x9 …不久前以後…」 and 「伙 x1 …這小傢伙…」 — but
「傢伙」 HAS been converted, and 「以後」 has 後. Either the audit's index
arithmetic is wrong, or those characters appear elsewhere in the same block.

Print the exact code points at the reported offsets.
"""

import json

simp = set(open(
    "/mnt/d/AI/BibleQuest2026/tools/simplified_only_set.txt", encoding="utf-8").read())

for fn, targets in [("09.json", "里干征伙准斗"), ("04.json", "伙"),
                    ("16.json", "干准"), ("17.json", "后"),
                    ("19.json", "征"), ("21.json", "斗")]:
    p = f"/mnt/d/AI/BibleQuest2026/public/ultimate-intention/zh-Hant/{fn}"
    d = json.load(open(p, encoding="utf-8"))
    print(f"\n=== {fn} ===")
    for i, b in enumerate(d["blocks"]):
        if b["type"] != "p":
            continue
        t = b["text"]
        found = [(k, t.index(k)) for k in set(t) if k in simp]
        if not found:
            continue
        for ch, j in sorted(found, key=lambda x: x[1]):
            print(f"  b{i} [{ch}] @ {j}/{len(t)}  …{t[max(0, j-14):j+14]}…")
            print(f"        codepoints {t[max(0,j-3):j+4]} = "
                  f"{[hex(ord(c)) for c in t[max(0,j-3):j+4]]}")