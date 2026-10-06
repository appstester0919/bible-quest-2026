#!/usr/bin/env python3
# Round-22 final sub verify — user picks verbatim (skill §27):
#   鵜→提 (tai4), 鶘→弧 (wu4), 鴞→囂 (hiu1)
# 弧 was NOT in the probed candidate set → mandatory §20/§35 verify before map write.
import asyncio, os, subprocess
import edge_tts

VOICES = ["zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"]
PAIRS = [("鵜", "提"), ("鶘", "弧"), ("鴞", "囂")]
CONTROL = "字"
OUT = "/tmp/round22_final"
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
    bad = 0
    for v in VOICES:
        print(f"=== {v} ===")
        print(f"  control {CONTROL} -> {await probe(CONTROL, v)}")
        for orig, sub in PAIRS:
            r = await probe(sub, v)
            print(f"  {orig}->{sub} -> {r}")
            if "SILENT" in r:
                bad += 1
    print(f"\n{'❌ ABORT — a sub is silent' if bad else '✅ all subs audible on both voices'}")


asyncio.run(main())
