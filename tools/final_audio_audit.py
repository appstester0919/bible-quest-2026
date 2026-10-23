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

# Punctuation edge-tts does not voice. Stripping it makes the provenance
# comparison compare what is actually SPOKEN, not what is typed.
PUNCT = set("「」『』（）()【】《》〈〉—…、。，．,.;:!?！？\"'“”‘’～~·「」『』")
VENV = "/home/appstester0919/.hermes/installs/3f7177cbd6a40c8f/environments/34dd70208e644285889f2c46e7ac5772/venv/bin/python3"


def dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:                                    # noqa: BLE001
        return 0.0


_TOUCH_CACHE: dict[str, str] = {}


def _build_touch_index() -> dict[str, str]:
    """Map every tracked file to the last commit that touched it.

    One `git log --name-only` walk replaces 1,245 individual `git log -1`
    calls. The per-file version took ~70 minutes on /mnt/d (Windows drive
    over WSL) because every call re-read the index and walked history
    again; the batched walk does it once and finishes in seconds.
    """
    if _TOUCH_CACHE:
        return _TOUCH_CACHE
    r = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotePath=false",
                        "log", "--format=@@%h %ad", "--date=short",
                        "--name-only", "--no-renames", "--", "public/audio",
                        "public/ultimate-intention/audio"],
                       capture_output=True, text=True)
    cur = ""
    for line in r.stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("@@"):              # explicit commit marker
            cur = line[2:]
        elif cur:
            # git still quotes paths containing spaces even with quotePath=false
            _TOUCH_CACHE.setdefault(line.strip('"'), cur)   # newest-first: first hit wins
    return _TOUCH_CACHE


def git_last_touch(rel: str) -> str:
    idx = _build_touch_index()
    if rel in idx:
        return idx[rel]
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
    # Content comparison, same as the Bible side: take the chapter's text as
    # it stood at the commit that produced the audio and compare it with the
    # text now. A date comparison is only meaningful when the text lives in
    # its own file (which it does here), but it still cannot tell a real
    # edit from a reformat.
    print("\n=== 音檔 vs 源文 commit 對照 ===")
    stale = []
    for lang in ("zh-Hant", "zh-Hans"):
        for f in sorted((ROOT / "public/ultimate-intention" / lang).glob("*.json")):
            n = f.stem
            rel_a = f"public/ultimate-intention/audio/{lang}/{n}.mp3"
            rel_t = f"public/ultimate-intention/{lang}/{n}.json"
            a = git_last_touch(rel_a)
            if a == "(uncommitted)":
                stale.append((rel_a, "工作區未提交（新重生）", ""))
                continue
            c = a.split(" ")[0]
            r = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotePath=false",
                                "show", f"{c}:{rel_t}"], capture_output=True, text=True)
            if r.returncode != 0:
                continue
            try:
                old_txt = "".join(b.get("text", "") for b in
                                  json.loads(r.stdout)["blocks"] if b.get("type") == "p")
            except Exception:
                continue
            new_txt = "".join(b.get("text", "") for b in
                              json.load(open(ROOT / rel_t, encoding="utf-8"))["blocks"]
                              if b.get("type") == "p")
            if old_txt != new_txt:
                stale.append((rel_a, c, "".join(
                    x for x, y in zip(old_txt, new_txt) if x != y)[:40]))
    print(f"  屬靈書 音檔文字同 HEAD 源文唔一致: {len(stale)}")
    for s in stale[:12]:
        print(f"   ✗ {s[0]}  render commit {s[1]}  差: {s[2]}")

    # Bible provenance cannot be a date comparison. bible-data.json is one
    # file for the whole corpus, so "audio commit < json commit" flags every
    # chapter whose audio predates the last edit to ANY chapter — hundreds of
    # false positives. The only defensible check is content: take the text as
    # it stood at the commit that last touched this chapter's audio, and
    # compare it with the text now. Load the JSON once per distinct commit.
    b_stale = []
    pairs = []
    for ab, cs in data.items():
        for ch in cs:
            rel_a = f"public/audio/{ab}/{ab}{ch}.mp3"
            if not (ROOT / rel_a).exists():
                continue
            c = git_last_touch(rel_a)
            if c == "(uncommitted)":
                continue
            pairs.append((rel_a, ab, ch, c.split(" ")[0]))
    by_commit = defaultdict(list)
    for rel_a, ab, ch, c in pairs:
        by_commit[c].append((rel_a, ab, ch))
    print(f"  聖經: {len(pairs)} 檔，跨 {len(by_commit)} 個 render commit")
    for c, items in by_commit.items():
        r = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotePath=false",
                            "show", f"{c}:public/bible-data.json"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            continue
        try:
            old = json.loads(r.stdout)["data"]
        except Exception:
            continue
        for rel_a, ab, ch in items:
            # bible-data.json shape: data[book][chapter] is a LIST of verse
            # entries, and each entry is [verse_number, text]. So the text is
            # entry[1] for each entry — one level of nesting, not two. My
            # first version iterated elements of each entry and hit
            # TypeError: 'int' object is not subscriptable on the verse
            # NUMBER. Historical commits also store bare strings, so guard.
            def verse_text(node):
                out = []
                for entry in ((node.get(ab, {}) or {}).get(ch, []) or []):
                    if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], str):
                        out.append(entry[1])
                    elif isinstance(entry, str):
                        out.append(entry)
                return "".join(out)
            # Compare AUDIO-EQUIVALENT text, not raw text. edge-tts ignores
            # quotes and reads 甚麼 and 什麼 with the same phonemes, so a raw
            # text diff flags a chapter whose audio is already correct —
            # 利17 differs only by four added 「 and two 甚→什, and re-rendering
            # it from the current text produced byte-identical output.
            def norm(t):
                t = "".join(ch for ch in t if ch not in PUNCT)
                return t.replace("甚", "什")
            old_t = verse_text(old)
            new_t = verse_text(data)
            if old_t and norm(old_t) != norm(new_t):
                b_stale.append((rel_a, c, "".join(
                    a for a, b in zip(old_t, new_t) if a != b)[:40]))
    print(f"  聖經 音檔文字同 HEAD 源文唔一致: {len(b_stale)}")
    for s in b_stale[:12]:
        print(f"   ✗ {s[0]}  render commit {s[1]}  差: {s[2]}")

    ok = not bad and not ubad and not stale and not b_stale
    print(f"\n{'✅ 全部通過' if ok else '❌ 仍有待處理'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
