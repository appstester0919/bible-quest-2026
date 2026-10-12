"""Does Edge TTS zh-HK pronounce 馱 / 囫 / 圇 correctly?

These three are absent from tools/tts_char_substitutions.py, whose existing map
covers 17 similar CUV characters that the zh-HK voices garble or drop silently.
Rather than guess from a dictionary, synthesise each character in the exact
contexts where the corpus uses it and report what the audio actually contains:
  * duration and whether audio was produced at all (silent-drop detection)
  * RMS energy, to distinguish a spoken syllable from a near-empty buffer
  * a recording clip per character for the user to judge by ear

Writes only under /tmp. Regenerating committed audio needs the corpus audit
plus the substitution map, not this probe.
"""
import asyncio
import json
import math
import struct
import sys
import wave
from pathlib import Path

import edge_tts

ROOT = Path("/mnt/d/AI/BibleQuest2026")
OUT = Path("/tmp/tts_char_probe")
VOICES = ["zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural"]

CASES = [
    ("馱", "他們就把糧食馱在驢上"),          # 創42:26
    ("馱", "用駱駝馱著香料"),              # 創37:25
    ("囫", "被我們囫圇吞了"),              # 箴1:12
    ("圇", "以致不能再囫圇"),              # 耶19:11
    ("對照", "他們就把糧食放在驢上"),        # control: known-good
]


def rms_and_peak(path: Path) -> tuple[float, int, float]:
    """(duration_s, peak, rms) read via ffmpeg to raw PCM."""
    import subprocess
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le",
         "-ac", "1", "-ar", "16000", "-"],
        capture_output=True, timeout=60).stdout
    n = len(raw) // 2
    if not n:
        return 0.0, 0, 0.0
    samples = struct.unpack(f"<{n}h", raw)
    peak = max(abs(s) for s in samples)
    rms = math.sqrt(sum(s * s for s in samples) / n)
    return n / 16000.0, peak, rms


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'字':4} {'voice':10} {'secs':>7} {'peak':>6} {'rms':>7}  verdict")
    for char, ctx in CASES:
        for voice in VOICES:
            p = OUT / f"{char}_{voice.split('-')[-1]}.mp3"
            try:
                await edge_tts.Communicate(ctx, voice).save(str(p))
            except Exception as e:                       # noqa: BLE001
                print(f"{char:4} {voice[-6:]:10} {'—':>7} {'—':>6} {'—':>7}  ERROR {e}")
                continue
            secs, peak, rms = rms_and_peak(p)
            # A dropped character leaves either no audio or a buffer whose
            # energy collapses relative to a control utterance.
            if secs < 0.4:
                verdict = "SILENT / dropped"
            elif rms < 900:
                verdict = "very quiet — check pronunciation"
            else:
                verdict = "audio present"
            print(f"{char:4} {voice[-6:]:10} {secs:7.2f} {peak:6d} {rms:7.0f}  {verdict}")
    print(f"\nclips in {OUT}")


if __name__ == "__main__":
    asyncio.run(main())