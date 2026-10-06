#!/usr/bin/env python3
# Round-22 sub-candidate probe (§35: probe every SUB before offering to user)
# Cantonese evidence:
#   鵜鶘 = tai4 wu4 (wiktionary 粵拼) ; 康熙 鵜 「杜奚切…音啼」
#   鶘 從胡 → 候補 胡 / 吾 (wu4)
#   鴞 = hiu1 (learnlab.hk) ; 粵音資料集叢 同韻字 囂/嘵/枵/梟/蹺 (hiu1)
# Control: 字
import asyncio, os, subprocess
import edge_tts

VOICES = ["zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"]
SUBS = {
    "鵜": ["啼", "梯", "提"],
    "鶘": ["胡", "吾", "湖"],
    "鴞": ["嘵", "囂", "消"],
}
CONTROL = ["字"]
OUT = "/tmp/round22_subprobe"
os.makedirs(OUT, exist_ok=True)


def dur(fp):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", fp],
        capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


async def probe(text, voice):
    fp = os.path.join(OUT, f"{voice}_{ord(text[0]):04X}.mp3")
    try:
        await edge_tts.Communicate(text, voice).save(fp)
        size = os.path.getsize(fp)
        return "SILENT" if size == 0 else f"OK size={size}B dur={dur(fp):.2f}s"
    except Exception as e:
        return f"SILENT ({type(e).__name__})"


async def main():
    for v in VOICES:
        print(f"=== {v} ===")
        for c in CONTROL:
            print(f"  control {c} -> {await probe(c, v)}")
        for orig, cands in SUBS.items():
            for c in cands:
                print(f"  {orig}->{c} -> {await probe(c, v)}")


asyncio.run(main())
