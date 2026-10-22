"""Probe one character across the Cantonese and Mandarin voices.

Used to decide whether a TTS_CHAR_MAP substitution is needed for a given
script. The map is shared between the Cantonese (zh-HK) and Mandarin
(zh-CN) renders, but a substitution only helps if the SOURCE character is
actually rejected by the engine, and it only hurts if the TARGET character
is read differently in that script.

The 2026-10-22 case: 邑→泣 is a correct Cantonese homophone (both kap1)
but in Mandarin 邑 = yì and 泣 = qì, so the simplified 《屬靈書》 would
read 「城泣」 (crying city) instead of 「城邑」.
"""
import asyncio
import socket
import sys

_orig = socket.getaddrinfo


def _v4(host, port, *a, **k):
    r = _orig(host, port, *a, **k)
    v = [i for i in r if i[0] == socket.AF_INET]
    return v or r


socket.getaddrinfo = _v4

import edge_tts  # noqa: E402

VOICES = [
    "zh-HK-HiuMaanNeural",
    "zh-HK-WanLungNeural",
    "zh-HK-HiuGaaiNeural",
    "zh-CN-XiaoxiaoNeural",
]


async def probe(text: str, voice: str):
    try:
        audio = b""
        async for ch in edge_tts.Communicate(text, voice).stream():
            if ch["type"] == "audio":
                audio += ch["data"]
        return len(audio)
    except Exception as e:
        return f"ERR {type(e).__name__}: {str(e)[:70]}"


async def main():
    texts = sys.argv[1:] or ["邑", "泣", "城邑", "城泣"]
    ctrl = await probe("媽", VOICES[0])
    print(f"對照 媽 @ {VOICES[0]} = {ctrl} B\n")
    for t in texts:
        row = []
        for v in VOICES:
            n = await probe(t, v)
            short = v.replace("zh-HK-", "").replace("zh-CN-", "").replace("Neural", "")
            row.append(f"{short}={n if isinstance(n, int) else 'ERR'}")
        print(f"  「{t}」  " + "  ".join(row))


if __name__ == "__main__":
    asyncio.run(main())
