"""FINAL proposal for the 6 remaining silent characters — for user sign-off.

Probe evidence (bare-char probe, which is the only probe that works — Round-23:
鐐 alone was silent while 鐵鐐 returned full audio):

  栄  raw=0  UNMAPPED  → SOURCE TYPO, not a TTS problem. The PDF itself
                          contains 栄 (U+8369, the Japanese shinjitai) where it
                          should say 荣. All three OpenCC configs leave it alone
                          because it is not a simplified form of anything — the
                          translator mistyped. Fix = correct the SOURCE.
  禰  raw=0  UNMAPPED  → reverential "You" for God (主禰). ~40 occurrences.
  羣  raw=0  UNMAPPED  → variant of 群. ~10 occurrences.
  諍  raw=0  UNMAPPED  → 諍言 = contention/slander. 2 occurrences.
  鐧  raw=0  UNMAPPED  → 鐧 = simple/plain. 1 occurrence (殺手鐧 = final trump card).
  齧  raw=0  UNMAPPED  → 齧蝕 = gnaw/corrode. 2 occurrences.

Note the important structural point: 禰 comes from the converter (祢→禰), and
HK Christian usage more commonly writes 祢. So 禰 may be a converter choice
rather than only a TTS problem — worth deciding before substituting.

Every candidate below is probe-verified on zh-HK-HiuGaaiNeural. I am NOT choosing:
Round-23 I guessed 璜/煌 for 鐐 on the wrong reading and the user had to correct me.
"""

import asyncio
import json
import sys

sys.path.insert(0, "/mnt/d/AI/BibleQuest2026/tools")

import edge_tts  # noqa: E402

VOICES = ["zh-HK-HiuGaaiNeural", "zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural"]

ROOT = "/mnt/d/AI/BibleQuest2026/public/ultimate-intention"

# dead char -> [(candidate, note)]
PROPOSAL = {
    "栄": [("榮", "correct traditional; SOURCE TYPO in the PDF, not a converter issue")],
    "禰": [
        ("祢", "HK Christian standard for the reverential 'You'"),
        ("你", "plain 'you' — loses the reverence these passages are built on"),
    ],
    "羣": [("群", "HK/TW standard for 羣人 / 羣眾")],
    "諍": [
        ("爭", "same sound; 爭論/爭議 are everyday words"),
        ("諧", "probe OK but WRONG MEANING — listed only to show it was checked"),
    ],
    "鐧": [("簡", "standard for 簡單; 殺手鐧 = the trump card")],
    "齧": [("嚙", "HK glyph; 嚙蝕 reads naturally")],
}


async def probe(s: str) -> int:
    n = 0
    try:
        c = edge_tts.Communicate(s, VOICES[0])
        async for piece in c.stream():
            if piece.get("type") == "audio":
                n += len(piece.get("data") or b"")
    except Exception:
        return 0
    return n


async def main() -> None:
    print("=== occurrence counts in zh-Hant corpus ===")
    for dead in PROPOSAL:
        cnt = 0
        where = []
        for n in range(1, 29):
            d = json.loads(open(f"{ROOT}/zh-Hant/{n:02d}.json", encoding="utf-8").read())
            for b in d["blocks"]:
                if b["type"] == "p" and dead in b["text"]:
                    cnt += b["text"].count(dead)
                    if len(where) < 2:
                        i = b["text"].index(dead)
                        where.append(f"第{n}篇 …{b['text'][max(0,i-10):i+10]}…")
        print(f"  {dead} x{cnt:<3} {where}")

    print("\n=== candidate probe (zh-HK-HiuGaaiNeural) ===")
    for dead, cands in PROPOSAL.items():
        for cand, note in cands:
            raw = await probe(dead)
            sub = await probe(cand)
            mark = "OK " if sub else "SIL"
            print(f"  {mark} {dead}({raw:>6}) -> {cand}({sub:>6})  {note}")


asyncio.run(main())