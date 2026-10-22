"""Ear-verification clips for the 2026-10-22 corpus sweep (34 new substitutions).

Method
------
The shipped chapter mp3 is ONE edge-tts utterance for the whole chapter
(generate_tts_v2._save_and_verify sends the joined verse text), so there are no
verse boundaries inside the file to cut on. make_liu_clips.py established the
accepted alternative: synthesise the single verse with the exact same pipeline
— tts_text() for the substitution, the same voice the chapter parity selects —
and save it to our own path. That is the same text+voice the chapter was
rendered with, so what the user hears is what ships.

Deliverables
------------
  reel.mp3    all 34 segments concatenated with 0.6 s gaps, in the fixed order
              printed below. One listen; flag anything wrong by position.
  risky/      the individual clips whose *word* becomes semantically odd, for
              one-at-a-time scrutiny.

Nothing here is a substitute for the user's ear. It only decides which clips
are worth sending.
"""
import asyncio
import json
import shutil
import socket
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, *args, **kwargs):
    res = _orig_getaddrinfo(host, port, *args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


socket.getaddrinfo = _ipv4_only

import edge_tts  # noqa: E402
from tts_char_substitutions import tts_text  # noqa: E402

ROOT = Path("/mnt/d/AI/BibleQuest2026")
BIBLE = ROOT / "public/bible-data.json"
ULT = ROOT / "public/ultimate-intention"
OUT = Path("/home/appstester0919/.hermes/cache/scratch/sweep_clips")
OUT.mkdir(parents=True, exist_ok=True)
RISKY_DIR = OUT / "risky"
RISKY_DIR.mkdir(exist_ok=True)

VOICES = {
    "zh-Hant": ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"),
    "zh-Hans": ("zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural"),
}

# (orig, repl, source, risk)
#   source = ("bible", abbr, chapter, verse)  or  ("ult", lang, chapter, needle)
TARGETS = [
    ("啣", "銜", ("bible", "撒上", 17, 34), ""),
    ("噯", "唉", ("bible", "伯", 2, 10), "嘆詞，要聽自然唔自然"),
    ("廩", "廪", ("bible", "珥", 1, 17), ""),
    ("櫓", "橹", ("bible", "可", 6, 48), ""),
    ("璫", "珰", ("bible", "賽", 3, 16), ""),
    ("癤", "疖", ("bible", "利", 13, 2), ""),
    ("磣", "磨", ("bible", "哀", 3, 16), "★唯一唔跟同音，RCUV 官方譯法"),
    ("穡", "穑", ("bible", "創", 8, 22), ""),
    ("簍", "篓", ("bible", "創", 31, 34), ""),
    ("糴", "籴", ("bible", "創", 42, 2), ""),
    ("糶", "粜", ("bible", "創", 41, 56), ""),
    ("脩", "修", ("ult", "zh-Hant", 1, "靈脩"), ""),
    ("覿", "觌", ("bible", "士", 6, 22), ""),
    ("輥", "辊", ("bible", "太", 27, 60), ""),
    ("鉋", "刨", ("bible", "賽", 44, 13), ""),
    ("銲", "焊", ("bible", "賽", 41, 7), ""),
    ("鏇", "旋", ("bible", "耶", 10, 5), "★字義欠佳，同音優先"),
    ("鏨", "站", ("bible", "利", 26, 1), "★字義欠佳，同音優先"),
    ("鐃", "铙", ("bible", "代下", 33, 11), ""),
    ("鐫", "镌", ("bible", "伯", 19, 24), ""),
    ("鐺", "铛", ("bible", "出", 28, 33), ""),
    ("閤", "阖", ("bible", "創", 20, 16), ""),
    ("颻", "搖", ("bible", "士", 9, 9), ""),
    ("颼", "嗖", ("bible", "伯", 41, 29), "★嗖 = 呼嘯聲，聽吓啱唔啱"),
    ("飫", "醧", ("bible", "耶", 31, 25), "★醧 生僻，聽吓讀唔讀得出"),
    ("騸", "骟", ("bible", "利", 22, 24), ""),
    ("鴟", "鸱", ("bible", "利", 11, 18), ""),
    ("鶿", "鸧", ("bible", "利", 11, 17), ""),
    ("鷂", "鹞", ("bible", "利", 11, 14), ""),
    ("鷥", "鸶", ("bible", "利", 11, 19), ""),
    ("鸇", "煎", ("bible", "申", 14, 13), "★字義欠佳，同音優先"),
    ("鸕", "鸬", ("bible", "利", 11, 17), ""),
    ("鸛", "鹳", ("bible", "利", 11, 19), ""),
    ("専", "專", ("ult", "zh-Hant", 28, "完全専注"), ""),
]


def bible_text(data, abbr, ch, vn):
    for v in data[abbr][str(ch)]:
        if v[0] == vn:
            return v[1]
    raise KeyError(f"{abbr}{ch}:{vn}")


def ult_text(lang, ch, needle):
    raw = json.load(io_open(ULT / lang / f"{ch:02d}.json"))
    for b in raw["blocks"]:
        if b.get("type") == "p" and needle in b.get("text", ""):
            return b["text"]
    raise KeyError(f"{lang}/{ch:02d} {needle}")


def io_open(p):
    return open(p, encoding="utf-8")


def dur_of(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True).stdout.strip()
    return float(r or 0)


async def main():
    data = json.load(io_open(BIBLE))["data"]
    segs, order = [], []
    print(f'{"#":>3} {"字":2}→{"字":2} {"出處":14} {"經文":40} {"秒":>5}')
    for i, (orig, repl, src, risk) in enumerate(TARGETS, 1):
        if src[0] == "bible":
            _, abbr, ch, vn = src
            raw = bible_text(data, abbr, ch, vn)
            voice = VOICES["zh-Hant"][0 if ch % 2 else 1]
            where = f"{abbr}{ch}:{vn}"
        else:
            _, lang, ch, needle = src
            raw = ult_text(lang, ch, needle)
            voice = VOICES[lang][0 if ch % 2 else 1]
            where = f"{lang}/{ch:02d}"
        text = tts_text(raw)
        assert orig not in text, f"{orig} 未被替換: {text[:50]}"
        assert repl in text, f"{repl} 唔喺輸出: {text[:50]}"
        p = OUT / f"{i:02d}_{orig}_{where.replace('/', '_').replace(':', '')}.mp3"
        await edge_tts.Communicate(text, voice).save(str(p))
        d = dur_of(p)
        segs.append(p)
        order.append((i, orig, repl, where, d, risk))
        print(f'{i:3} {orig}→{repl} {where:14} {raw[:38]:40} {d:5.1f}s'
              f'{" ★" if risk else ""}')

    # reel: 0.6 s gap between segments
    lst = OUT / "reel_list.txt"
    with open(lst, "w") as f:
        for p in segs:
            f.write(f"file '{p}'\n")
    gap = OUT / "gap.mp3"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                    "anullsrc=r=44100:cl=mono", "-t", "0.6", str(gap)],
                   capture_output=True)
    concat = OUT / "reel_concat.txt"
    with open(concat, "w") as f:
        for p in segs:
            f.write(f"file '{p}'\n")
            f.write(f"file '{gap}'\n")
    reel = OUT / "reel.mp3"
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i",
                    str(concat), "-c", "copy", str(reel)], capture_output=True)
    print(f"\nreel.mp3 {dur_of(reel):.1f}s {reel.stat().st_size//1024}KB")
    for i, orig, repl, where, d, risk in order:
        if risk:
            src = [p for p in segs if p.name.startswith(f"{i:02d}_")][0]
            shutil.copy(src, RISKY_DIR / src.name)
    print(f"risky clips: {len(list(RISKY_DIR.glob('*.mp3')))}")
    json.dump([{"n": i, "orig": o, "repl": r, "where": w, "sec": d,
                "risk": k} for i, o, r, w, d, k in order],
              open(OUT / "order.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    asyncio.run(main())
