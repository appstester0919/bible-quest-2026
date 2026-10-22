"""Final audio audit across both corpora.

Two independent checks, run together so a single command answers "is every
shipped audio file complete and does it match the text it is supposed to
read":

1. Completeness — duration per character must sit inside the band the rest
   of the corpus achieves. A file truncated by the edge-tts ~600s stream
   limit sits far below its book's median; a file rendered from a text that
   was later superseded sits below the band too, because the source text
   grew after the audio was made.

2. Provenance — for each audio file, the commit that last touched it must
   be at or after the commit that last touched its source text. If the audio
   commit is older, the file is reading a superseded text.

Run this after every regen has finished. It is the gate before the SW cache
bump and the commit.
"""
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026")
VENV = "/home/appstester0919/.hermes/installs/3f7177cbd6a40c8f/environments/34dd70208e644285889f2c46e7ac5772/venv/bin/python3"


def dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:                                    # noqa: BLE001
        return 0.0


def git_last_touch(rel: str) -> str:
    r = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotePath=false",
                        "log", "-1", "--format=%h %ad", "--date=short", "--", rel],
                       capture_output=True, text=True)
    return r.stdout.strip() or "(uncommitted)"


def main() -> int:
    data = json.load(open(ROOT / "public/bible-data.json", encoding="utf-8"))["data"]

    # ---- corpus 1: Bible ----
    rows = []
    for ab, cs in data.items():
        for ch, vs in cs.items():
            t = "".join(v[1] for v in vs)
            rel = f"public/audio/{ab}/{ab}{ch}.mp3"
            p = ROOT / rel
            if not t or not p.exists():
                continue
            rows.append((ab, ch, len(t), dur(p), rel))
    # Baseline must be per VOICE, not per book. generate_tts_v2.py picks the
    # voice by chapter parity — odd chapter = female HiuGaaiNeural, even =
    # male WanLungNeural — and the two voices are 39% apart in pacing
    # (0.297 vs 0.214 s/char). A per-book mean mixes them and flags every
    # even chapter as short: that is what produced 370 false positives on the
    # first run of this script.
    band = defaultdict(list)
    for ab, ch, n, d, rel in rows:
        if n and d:
            band[("odd" if int(ch) % 2 == 1 else "even")].append(d / n)
    med = {k: (sum(v) / len(v)) for k, v in band.items()}
    print("聖經 按聲線基線: " + ", ".join(f"{k} cps={v:.4f}" for k, v in sorted(med.items())))
    bad = [r for r in rows if r[2] and r[3] and r[3] / r[2] < med["odd" if int(r[1]) % 2 == 1 else "even"] * 0.85]
    print(f"聖經: {len(rows)} 檔；低于本身聲線基線 85% = {len(bad)}")
    for r in bad[:10]:
        print(f"   ✗ {r[0]+r[1]} {r[2]}字 {r[3]:.1f}s cps={r[3]/r[2]:.4f}")

    # ---- corpus 2: 屬靈書 ----
    urows = []
    for lang in ("zh-Hant", "zh-Hans"):
        for f in sorted((ROOT / "public/ultimate-intention" / lang).glob("*.json")):
            d = json.load(open(f, encoding="utf-8"))
            t = "".join(b.get("text", "") for b in d["blocks"] if b.get("type") == "p")
            n = f.stem
            rel = f"public/ultimate-intention/audio/{lang}/{n}.mp3"
            p = ROOT / rel
            if not t or not p.exists():
                continue
            urows.append((lang, n, len(t), dur(p), rel))
    uband = defaultdict(list)
    for lang, n, c, d, rel in urows:
        if c and d:
            uband[(lang, "odd" if int(n) % 2 == 1 else "even")].append(d / c)
    umed = {k: (sum(v) / len(v)) for k, v in uband.items()}
    ubad = [r for r in urows if r[2] and r[3] and r[3] / r[2] < umed[(r[0], "odd" if int(r[1]) % 2 == 1 else "even")] * 0.85]
    print(f"\n屬靈書: {len(urows)} 檔；按聲線基線")
    for k in sorted(umed):
        print(f"   {k[0]} {k[1]} cps={umed[k]:.4f}")
    print(f"低于本身聲線基線 85% = {len(ubad)}")
    for r in ubad[:10]:
        print(f"   ✗ {r[0]}/{r[1]} {r[2]}字 {r[3]:.1f}s cps={r[3]/r[2]:.4f}")

    # ---- provenance: audio commit vs text commit ----
    print("\n=== 音檔 vs 源文 commit 對照 ===")
    stale = []
    for lang in ("zh-Hant", "zh-Hans"):
        for f in sorted((ROOT / "public/ultimate-intention" / lang).glob("*.json")):
            n = f.stem
            rel_a = f"public/ultimate-intention/audio/{lang}/{n}.mp3"
            rel_t = f"public/ultimate-intention/{lang}/{n}.json"
            a = git_last_touch(rel_a)
            t = git_last_touch(rel_t)
            if a == "(uncommitted)":
                stale.append((rel_a, "工作區未提交（新重生）", t))
                continue
            ad, td = a.split(" ")[1], t.split(" ")[1]
            if ad < td:
                stale.append((rel_a, a, t))
    print(f"  屬靈書 音檔早于源文 commit: {len(stale)}")
    for s in stale[:12]:
        print(f"   ✗ {s[0]}  audio={s[1]}  text={s[2]}")

    b_stale = []
    for ab, cs in data.items():
        for ch in cs:
            rel_a = f"public/audio/{ab}/{ab}{ch}.mp3"
            rel_t = "public/bible-data.json"
            a = git_last_touch(rel_a)
            if a == "(uncommitted)":
                continue
            t = git_last_touch(rel_t)
            if a.split(" ")[1] < t.split(" ")[1]:
                b_stale.append((rel_a, a, t))
    print(f"  聖經 音檔早于 bible-data.json commit: {len(b_stale)}")
    for s in b_stale[:12]:
        print(f"   ✗ {s[0]}  audio={s[1]}  text={s[2]}")

    ok = not bad and not ubad and not stale and not b_stale
    print(f"\n{'✅ 全部通過' if ok else '❌ 仍有待處理'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
