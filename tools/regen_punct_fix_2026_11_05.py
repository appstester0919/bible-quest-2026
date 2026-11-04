#!/usr/bin/env python3
"""Regenerate audio for the two chapters whose SOURCE text was corrected
(2026-11-05 punctuation fix).

Corrected verses:
  耶 2:6   哪裡呢•   -> 哪裡呢？
  耶 2:19  為苦事•  -> 為苦事。
  創 24:62 庇耳•拉海•萊 -> 庇耳拉海萊

A corpus edit without a matching audio regen is a silent regression: the mp3
would keep reading the OLD text. Chunks: 耶2 (350s, even=male) and 創24
(490s, even=male).

Must run under the edge-tts 7.3.1 interpreter (the system python3 has 7.2.7,
which 403s) and with the IPv4 socket patch installed BEFORE edge_tts is used.
"""
import asyncio
import socket
import sys
from pathlib import Path

# --- IPv4 patch (must precede any edge_tts use) -----------------------------
_orig = socket.getaddrinfo


def _v4(host, port, *a, **k):
    res = _orig(host, port, *a, **k)
    return [r for r in res if r[0] == socket.AF_INET] or res


socket.getaddrinfo = _v4
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import edge_tts  # noqa: E402

import generate_tts_v2 as G  # noqa: E402
from tts_char_substitutions import tts_text  # noqa: E402

TARGETS = [("耶", 2), ("創", 24)]


async def main() -> int:
    print(f"edge-tts {edge_tts.__version__}")
    import json
    data = json.loads((ROOT / "public/bible-data.json").read_text(encoding="utf-8"))
    ok_all = True
    for abbr, ch in TARGETS:
        verses = data["data"][abbr][str(ch)]
        text = tts_text("".join(v[1] for v in verses))
        voice = G.VOICE_FEMALE if ch % 2 else G.VOICE_MALE
        out = ROOT / "public/audio" / abbr / f"{abbr}{ch}.mp3"
        want = len(text) * G.SECONDS_PER_CHAR["female" if voice == G.VOICE_FEMALE else "male"]
        ok, dur, size = await G._save_and_verify(text, voice, str(out))
        print(f"  {abbr}{ch} {'OK  ' if ok else 'SHORT'} {dur:7.1f}s "
              f"(expect ≈{want:.0f}s, {dur / want * 100:.0f}%) {size // 1024}KB", flush=True)
        ok_all = ok_all and ok
    print("=== done ===")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
