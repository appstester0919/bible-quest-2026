"""Probe 躥 綹 硃 — user reports all three as silent on Edge TTS.

Corpus (scanned from bible-data.json):
    躥  2 occurrences / 2 chapters — 歌 2:8 「他躥山越嶺而來」,
        珥 2:9 「躥上牆」. Sense: to leap/scale.
    綹  7 occurrences / 5 chapters — 民 6:5, 士 16:13/14/19, 歌 7:5, 結 8:3 (+1),
        all in 髮綹 / 一綹頭髮 — a lock/braid of hair, or a strand. Sense is
        consistent across all 7, so a blanket mapping is safe.
    硃  1 occurrence / 1 chapter — 賽 1:18 「你們的罪雖像硃紅」. 硃 = vermilion.
        NB: this is also a proper-name character (朱熹's 硃熹) but in 賽 1:18 it
        is plainly the colour, so the substituted character must read as the
        colour and not as a surname.

Method: control first, compound second. A control-less probe on 2026-10-12
reported every character as silent during an IPv6/WebSocket outage, so a
verdict is only printed if the known-good control produced audio. The compound
measurement is what settles "dropped mid-word" (圇, 饜, 謄 all behaved this
way); the bare measurement only settles "silent as a character".

Candidates are chosen on reading, verified by measurement:
    躥 cyun3 / dyun1 — no exact homophone, so the substitute must be a character
         the zh-HK voices actually pronounce, accepting a reading change that the
         user must then approve by ear.
    綹 cou2 — 綹 is also the silk-radical character; candidate 縷 cou2 lau5 is
         the semantic neighbour 「strand」 and a real character.
    硃 zyu1 — 硃紅 is the compound; candidate 朱 zyu1 is the bare form of the
         same word and is the character most readers expect.
Nothing is written into the substitution map by this script; it only reports.
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import edge_tts

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_probe_3")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),                     # known-good: no verdicts if this fails
    ("躥", "cyun_orig"), ("蹲", "cyun_sub"), ("春", "cyun_alt"),
    ("他躥山越嶺而來", "cyun_phrase_orig"), ("他蹲山越嶺而來", "cyun_phrase_sub"),
    ("綹", "cou_orig"), ("縷", "cou_sub"), ("樓", "cou_alt"),
    ("他的髮綹長長了", "cou_phrase_orig"), ("他的髮縷長長了", "cou_phrase_sub"),
    ("一綹頭髮", "cou_strand_orig"), ("一縷頭髮", "cou_strand_sub"),
    ("硃", "zyu_orig"), ("朱", "zyu_sub"),
    ("雖像硃紅", "zyu_phrase_orig"), ("雖像朱紅", "zyu_phrase_sub"),
]


def dur(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=30).stdout.strip() or 0)


async def probe(text: str, tag: str) -> dict:
    row = {}
    for t, v in VOICES.items():
        p = OUT / f"{tag}_{t}.mp3"
        try:
            await edge_tts.Communicate(text, v).save(str(p))
            row[t] = f"{dur(p):.2f}s/{p.stat().st_size}B"
        except Exception as e:                              # noqa: BLE001
            row[t] = type(e).__name__
    print(f"  {text:16} F={row['F']:<24} M={row['M']}", flush=True)
    return row


async def main() -> int:
    rows = {}
    for text, tag in CASES:
        rows[text] = await probe(text, tag)

    if "s/" not in rows["媽"]["F"]:
        print("\nCONTROL FAILED — service unreachable, verdict withheld. "
              "See skill wsl-edge-tts-ipv6-403.")
        return 1

    def v(text: str) -> str:
        f = rows[text]["F"]
        return "SILENT" if "s/" not in f else f

    print(f"\nVERDICTS (control OK {rows['媽']['F']}):")
    for orig, sub in (("躥", "蹲"), ("綹", "縷"), ("硃", "朱")):
        print(f"  {orig} bare {v(orig):<24} | {sub} bare {v(sub)}")
    print(f"  他躥山越嶺而來 {v('他躥山越嶺而來'):<20} | 他蹲山越嶺而來 {v('他蹲山越嶺而來')}")
    print(f"  他的髮綹長長了 {v('他的髮綹長長了'):<20} | 他的髮縷長長了 {v('他的髮縷長長了')}")
    print(f"  一綹頭髮 {v('一綹頭髮'):<24} | 一縷頭髮 {v('一縷頭髮')}")
    print(f"  雖像硃紅 {v('雖像硃紅'):<24} | 雖像朱紅 {v('雖像朱紅')}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))