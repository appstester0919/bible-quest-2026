"""Sweep EVERY distinct CJK character in the Bible Quest corpus for Edge TTS silence.

Why this exists
---------------
Until 2026-10-22 every substitution was driven by a character someone happened to
report. The corpus has 3,972 distinct CJK characters; the mapping table had 57
entries. Nothing had ever checked whether the other ~3,900 could be pronounced at
all. This script answers that question systematically.

Scope
-----
  bible         public/bible-data.json                       → zh-HK voices
  ultimate-Hant public/ultimate-intention/zh-Hant/*.json      → zh-HK voices
  ultimate-Hans public/ultimate-intention/zh-Hans/*.json      → zh-CN voices
  (zh-Hans uses zh-CN because the reader expects Mandarin there — the generator
   picks the voice by script AND chapter parity.)

Method
------
  * bare-character probe per voice. A bare char that returns NoAudioReceived is
    dropped by the engine; a compound that contains it can lose the syllable
    silently, so bare is the right screen for "can this char be said at all".
    (The 鐐 case proves the reverse is not a risk: 鐵鐐 and 脚鐐 return full
     audio even though bare 鐐 is silent.)
  * CONTROL FIRST. The known-good char 媽 is synthesised before anything else;
    if the control fails, the whole sweep exits without printing a verdict.
    On 2026-10-12 a control-less probe reported every character as silent
    during an IPv6/WebSocket failure, and that wrong answer nearly became a
    character verdict.
  * results are appended to a JSON file after every character, so a killed run
    resumes instead of restarting.
  * concurrency 6 — enough to finish in reasonable time, gentle enough that the
    service does not start throttling.

Usage
-----
    VENV/bin/python3 tools/sweep_corpus_silent.py            # full sweep
    VENV/bin/python3 tools/sweep_corpus_silent.py --resume   # continue
"""
import asyncio
import io
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, *args, **kwargs):
    res = _orig_getaddrinfo(host, port, *args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


socket.getaddrinfo = _ipv4_only

import edge_tts  # noqa: E402  (must follow the patch)

S = Path("/mnt/d/AI/BibleQuest2026")
OUTDIR = Path("/home/appstester0919/.hermes/cache/scratch/sweep")
OUTDIR.mkdir(parents=True, exist_ok=True)
RESULT = OUTDIR / "silent_chars.json"

HK = ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural")
CN = ("zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural")
CONC = 6

VOICE_SETS = {
    "HK": list(HK),
    "CN": list(CN),
}


def load_corpus_chars():
    """Return {char: set(sets)} — which script(s) a char belongs to."""
    def cjk(t):
        return {c for c in t if "一" <= c <= "鿿" or "㐀" <= c <= "䶿"}

    out = {}
    d = json.load(io.open(S / "public/bible-data.json", encoding="utf-8"))
    bible = "".join(v[1] for chs in d["data"].values()
                    for vs in chs.values() for v in vs)
    for c in cjk(bible):
        out.setdefault(c, set()).add("HK")

    for lang, tag in (("zh-Hant", "HK"), ("zh-Hans", "CN")):
        t = ""
        for f in sorted((S / f"public/ultimate-intention/{lang}").glob("*.json")):
            t += io.open(f, encoding="utf-8").read()
        for c in cjk(t):
            out.setdefault(c, set()).add(tag)
    return out


async def synth_ok(text, voice, tmp):
    """True if the engine produced audio for this text."""
    try:
        await edge_tts.Communicate(text, voice).save(str(tmp))
        return tmp.exists() and tmp.stat().st_size > 1000
    except Exception:                                   # noqa: BLE001
        return False


async def main():
    resume = "--resume" in sys.argv
    limit = None
    for a in sys.argv:
        if a.startswith("--limit"):
            limit = int(a.split("=")[1]) if "=" in a else 20
    chars = load_corpus_chars()
    print(f"edge-tts {edge_tts.__version__} | {len(chars)} distinct CJK chars")

    result = {}
    if resume and RESULT.exists():
        result = json.load(io.open(RESULT, encoding="utf-8"))
        print(f"resuming: {len(result)} already probed")

    todo = [c for c in sorted(chars) if c not in result]
    if limit:
        todo = todo[:limit]
    print(f"to probe: {len(todo)}")

    # CONTROL FIRST — no verdict without it
    ctrl = Path(OUTDIR / "ctrl.mp3")
    if not await synth_ok("媽", HK[0], ctrl):
        print("\nCONTROL FAILED (媽, zh-HK female) — service unreachable.")
        print("No verdict. Retry when the service is back; see skill")
        print("wsl-edge-tts-ipv6-403.")
        return 1
    print(f"control OK (媽, {ctrl.stat().st_size} B) — verdict enabled\n")

    sem = asyncio.Semaphore(CONC)
    tmpdir = Path(OUTDIR / "tmp")
    tmpdir.mkdir(exist_ok=True)

    async def one(char):
        async with sem:
            sets = chars[char]
            silent = []
            for tag in sorted(sets):
                for v in VOICE_SETS[tag]:
                    tmp = tmpdir / f"p_{ord(char):05x}.mp3"
                    if not await synth_ok(char, v, tmp):
                        silent.append(v)
                    tmp.unlink(missing_ok=True)
            return char, silent

    t0 = time.time()
    done = 0
    batch = []
    for c in todo:
        batch.append(one(c))
        if len(batch) >= CONC * 2:
            for r in await asyncio.gather(*batch):
                result[r[0]] = r[1]
            batch = []
            done += CONC * 2
            json.dump(result, io.open(RESULT, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
            el = time.time() - t0
            print(f"  {len(result)}/{len(chars)}  {el:.0f}s  "
                  f"eta {el/max(done,1)*(len(todo)-done):.0f}s", flush=True)
    if batch:
        for r in await asyncio.gather(*batch):
            result[r[0]] = r[1]
    json.dump(result, io.open(RESULT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    silent = {c: v for c, v in result.items() if v}
    print(f"\nDONE in {time.time()-t0:.0f}s")
    print(f"probed {len(result)} | silent on >=1 voice: {len(silent)}")
    for c, v in sorted(silent.items()):
        inmap = ""
        sys.path.insert(0, str(S / "tools"))
        print(f"  {c}  U+{ord(c):04X}  {len(v)} voice(s)")
    json.dump(silent, io.open(OUTDIR / "silent_only.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
