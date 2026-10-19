"""Probe 謄 and candidate substitutes, with a control and in real context.

Context from bible-data.json: 箴 25:1 「…是猶大王希西家的人所謄錄的。」 —
one occurrence, in the compound 謄錄 「to copy/transcribe」. Single sense, so a
blanket map is safe.

Structure follows tools/probe_yan.py: a known-good control is synthesised FIRST
and every verdict is suppressed if it fails. On 2026-10-12 a control-less probe
reported NoAudioReceived for every character including ones already fixed, and
the cause turned out to be an IPv6/WebSocket failure rather than anything about
the text (see skill wsl-edge-tts-ipv6-403).

Bare-character probes are reported but are NOT the verdict. 圇 produced audio
bare and was still dropped inside 囫圇, so the compound measurement is what
decides. Candidates are the homophones the substitute map already uses for this
kind of repair: 藤 (téng, same final, different initial) is wrong — prefer exact
homophone 腾/騰 or 滕, all téng. 謄 is yèng in isolation but the compound 謄錄 is
yàng? — no: 謄 yèng, 謄錄 yèng lù. Candidates are therefore chars pronounced
yèng: 騰 (also yèng in some readings) is risky; verify each by measurement
rather than by assumption.
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import edge_tts

OUT = Path("/home/appstester0919/.hermes/cache/scratch/tts_probe_yan")
OUT.mkdir(parents=True, exist_ok=True)
VOICES = {"F": "zh-HK-HiuGaaiNeural", "M": "zh-HK-WanLungNeural"}

CASES = [
    ("媽", "ctrl"),                       # known-good: no verdicts if this fails
    ("謄", "char_orig"),
    ("騰", "char_teng"),
    ("藤", "char_vine"),
    ("所謄錄的", "phrase_orig"),
    ("所騰錄的", "phrase_teng"),
    ("是猶大王希西家的人所謄錄的", "verse_orig"),
    ("是猶大王希西家的人所騰錄的", "verse_fix"),
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
    print(f"  {text:20} F={row['F']:<26} M={row['M']}", flush=True)
    return row


async def main() -> int:
    print("probe (control first):")
    rows = {}
    for text, tag in CASES:
        rows[text] = await probe(text, tag)

    if "s/" not in rows["媽"]["F"]:
        print("\nCONTROL FAILED — service unreachable. Verdict withheld; "
              "see skill wsl-edge-tts-ipv6-403.")
        return 1

    def verdict(text: str) -> str:
        f = rows[text]["F"]
        return f"silent ({f})" if "s/" not in f else f"audible {f}"

    print(f"\nVERDICTS (control OK, {rows['媽']['F']}):")
    print(f"  謄 bare      : {verdict('謄')}")
    print(f"  騰 bare      : {verdict('騰')}")
    print(f"  藤 bare      : {verdict('藤')}")
    print(f"  所謄錄的     : {verdict('所謄錄的')}")
    print(f"  所騰錄的     : {verdict('所騰錄的')}")
    print(f"  verse orig   : {verdict('是猶大王希西家的人所謄錄的')}")
    print(f"  verse fix    : {verdict('是猶大王希西家的人所騰錄的')}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))