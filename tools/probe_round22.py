#!/usr/bin/env python3
# Round-22 probe: 詩 102:6 鵜 鶘 鴞 — bare-char single-char probe (skill §9/§50)
# NO carrier wrapping. Control char included.
import asyncio, os, subprocess
import edge_tts

VOICES = ["zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"]
CHARS = ["鵜", "鶘", "鴞", "字"]  # 字 = known-good control
COMPOUNDS = ["鵜鶘", "鴞鳥"]      # §50 — audible compound does NOT clear its chars

OUT = "/tmp/round22_probe"
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
    fp = os.path.join(OUT, f"{voice}_{'_'.join(f'U+{ord(c):04X}' for c in text)}.mp3")
    try:
        await edge_tts.Communicate(text, voice).save(fp)
        size = os.path.getsize(fp)
        if size == 0:
            return f"SILENT (size=0)"
        return f"OK size={size}B dur={dur(fp):.2f}s"
    except Exception as e:
        return f"SILENT/REJECT: {type(e).__name__}: {e}"


async def main():
    for v in VOICES:
        print(f"=== {v} ===")
        for c in CHARS:
            print(f"  bare {c}  -> {await probe(c, v)}")
        for c in COMPOUNDS:
            print(f"  comp {c}  -> {await probe(c, v)}")


asyncio.run(main())
