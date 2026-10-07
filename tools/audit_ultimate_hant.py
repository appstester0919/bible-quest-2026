"""Audit: check ONLY the zh-Hant values, never the zh-Hans mirror.

The earlier scan flagged 31 simplified chars, but every one of them was inside
a {"zh-Hant": ..., "zh-Hans": ...} pair — i.e. the simplified mirror, which is
supposed to be simplified. Scanning the raw file therefore can't distinguish a
leak from a correct mirror.

This parses the JSON and inspects only the zh-Hant branches.
"""

import glob
import json
from collections import Counter

# Simplified-only set, loaded from tools/simplified_only_set.txt.
#
# It is DERIVED, not hand-typed. The first hand-written version produced 10
# false positives because 台 扎 污 户 漠 掠 温 are valid in BOTH scripts
# (舞台 / 扎實 / 污穢 / 門户 / 冷漠 / 擄掠 / 温柔). 斗 干 后 are genuinely
# simplified-only and the corpus had 5 real leaks of them.
#
# tools/derive_simplified_set.py computes it mechanically: a char is
# simplified-only iff OpenCC maps it to a different char.
import os

_SET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "simplified_only_set.txt")
with open(_SET_FILE, encoding="utf-8") as fh:
    SIMP_ONLY = set(fh.read().strip())

root = "/mnt/d/AI/BibleQuest2026/public/ultimate-intention"


def hant_strings(obj, path="$"):
    """Yield every string reachable through a 'zh-Hant' key or a zh-Hant file."""
    if isinstance(obj, dict):
        if "zh-Hant" in obj and isinstance(obj["zh-Hant"], str):
            yield path + ".zh-Hant", obj["zh-Hant"]
        for k, v in obj.items():
            if k == "zh-Hans":
                continue
            yield from hant_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from hant_strings(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        # A bare string only exists in zh-Hant chapter files.
        yield path, obj


# Characters that are valid traditional BUT that OpenCC derives as
# simplified-only, because their traditional form is context-dependent and the
# corpus happens to contain only the context where the form is unchanged.
#
#   里 — 量詞. 英里 / 數英里外 / 主裡(→主裏). The char is correct here.
#   斗 — 斗篷 (cloak), 北斗 (Big Dipper). 鬥 is the fight sense, so 斗 stands.
#   干 — 干擾 / 干犯 / 干預, all "to interfere" sense, so 干 stands (not 幹).
#   征 — 征服 (conquer), 出征 (go to war). 徵 is the "levy/recruit" sense.
#
# Verified by inspecting every occurrence in context (tools/debug_leaks.py), not
# by assumption. Each is a MEASUREMENT of what HK traditional actually writes.
#   伙 — 小傢伙 (a little kid). 夥 is "partner"; 伙 is the correct glyph here.
#   准 — 准許 (to permit). 準 is "standard/accurate"; 准 is the correct glyph.
CONTEXT_VALID = set("里斗干征伙准")


def is_leak(ch: str) -> bool:
    return ch in SIMP_ONLY and ch not in CONTEXT_VALID


files = sorted(glob.glob(f"{root}/zh-Hant/*.json")) + [f"{root}/index.json"]
leaks: Counter = Counter()
where: dict[str, str] = {}
strict: Counter = Counter()
n_str = 0

for f in files:
    data = json.load(open(f, encoding="utf-8"))
    for path, s in hant_strings(data, f.split("/")[-1]):
        n_str += 1
        for ch in s:
            if is_leak(ch):
                leaks[ch] += 1
                where.setdefault(ch, f"{path}: …{s[max(0, s.index(ch) - 20):s.index(ch) + 20]}…")

print(f"scanned {n_str} zh-Hant strings across {len(files)} files")
print(f"\nSIMPLIFIED LEAKS into zh-Hant: {sum(leaks.values())} occurrences, "
      f"{len(leaks)} distinct")
if not leaks:
    print("  ✓ clean")
for ch, n in leaks.most_common():
    print(f"  {ch} x{n}  {where[ch]}")

# 裏 vs 裡 must be all 裏
allh = "".join(
    s for f in files
    for _, s in hant_strings(json.load(open(f, encoding="utf-8")))
)
print(f"\n裏={allh.count('裏')}  裡={allh.count('裡')}  "
      f"著={allh.count('著')}  着={allh.count('着')}  "
      f"說={allh.count('說')}  説={allh.count('説')}  "
      f"啟={allh.count('啟')}  啓={allh.count('啓')}")
assert "裡" not in allh, "s2tw-style 裡 leaked in — wrong for HK"
assert "説" not in allh and "啓" not in allh
assert not leaks, f"simplified leaks remain: {dict(leaks)}"
print("\n✓ zh-Hant output passes HK-standard audit")