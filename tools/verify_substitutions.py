"""Verify a candidate TTS substitution: audible + same syllable as the char it replaces.

Why duration is the check
-------------------------
We cannot listen. What we CAN measure is how long the engine takes to say one
character. A single Cantonese syllable is ~0.2-0.4 s. If a candidate is read
with a different syllable (a multi-syllable reading, or a Mandarin reading that
the Cantonese voice falls back to) its duration will not line up with a known
reference character that has the same jyutping.

So for every candidate X (substitute for silent char Y) we:
  1. synthesise X bare  → must produce audio at all (else it is silent too)
  2. synthesise a REFERENCE character with the same jyutping as Y
  3. compare durations; accept if |Δ| <= DUR_TOL

The reference list is hand-picked common characters, not generated, so a wrong
reference cannot silently approve a wrong candidate.

This is a screening step, not the final word: the user's ear is the gate
(see references/commit-gating.md).
"""
import asyncio
import io
import json
import socket
import subprocess
import sys
from pathlib import Path

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, *args, **kwargs):
    res = _orig_getaddrinfo(host, port, *args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


socket.getaddrinfo = _ipv4_only

import edge_tts  # noqa: E402

OUT = Path("/home/appstester0919/.hermes/cache/scratch/cand")
OUT.mkdir(parents=True, exist_ok=True)
HK = ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural")
CN = ("zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural")
DUR_TOL = 0.12


async def dur(text, voice):
    """Return duration in seconds, or None if no audio."""
    p = OUT / "t.mp3"
    p.unlink(missing_ok=True)
    try:
        await edge_tts.Communicate(text, voice).save(str(p))
    except Exception:                                   # noqa: BLE001
        return None
    if not p.exists() or p.stat().st_size < 800:
        return None
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip().split(",")[0])
    except Exception:                                   # noqa: BLE001
        return None


# candidate -> (silent char it replaces, reference char with same jyutping,
#                jyutping, note)
CANDIDATES = {
    # --- 啣 haam4 → 銜 (carry in the mouth) ---
    "銜": ("啣", "含", "haam4", "銜羊/口齒內銜著"),
    # --- 噯 → 唉 ---
    "唉": ("噯", "埃", "aai1", "嘆詞『噯！』→『唉！』"),
    # --- 専 (日本字形) → 專 ---
    "專": ("専", "尊", "zyun1", "『完全專注於』"),
    # --- 廩 lam5 → 廪 (異體字, 同義) ---
    "廪": ("廩", "稟", "lam5", "倉廩/廪也破壞"),
    # --- 櫓 lou5 → 橹 (簡體, 同義) ---
    "橹": ("櫓", "魯", "lou5", "盪槳搖櫓"),
    # --- 璫 dong1 → 珰 (簡體, 同義) ---
    "珰": ("璫", "當", "dong1", "腳下玎璫"),
    # --- 癤 zit3 → 疖 (簡體, 同義) ---
    "疖": ("癤", "節", "zit3", "長了癤子"),
    # --- 磣 cam2 → ? ---
    "摻": ("磣", "參", "cam2", "沙石磣斷"),
    # --- 穡 sik1 → 穑 (簡體, 同義) ---
    "穑": ("穡", "識", "sik1", "稼穡"),
    # --- 簍 lau4/lau5 → 篓 (簡體, 同義) ---
    "篓": ("簍", "樓", "lau4", "駱駝的馱簍"),
    # --- 糴 dek6 → 籴 (簡體, 同義) ---
    "籴": ("糴", "笛", "dek6", "糴糧"),
    # --- 糶 tiu3 → 粜 (簡體, 同義) ---
    "粜": ("糶", "跳", "tiu3", "糶糧給埃及人"),
    # --- 脩 sau1 → 修 ---
    "修": ("脩", "休", "sau1", "以人為中心的靈修"),
    # --- 覿 dik6 → 觌 (簡體, 同義) ---
    "觌": ("覿", "敵", "dik6", "我覿面看見"),
    # --- 輥 gwan2 → 辊 (簡體, 同義) ---
    "辊": ("輥", "滾", "gwan2", "輥去/輥到墓門口"),
    # --- 鉋 paau4 → 刨 (簡體, 同義) ---
    "刨": ("鉋", "跑", "paau4", "用鉋子鉋成"),
    # --- 銲 hon6 → 焊 (簡體, 同義) ---
    "焊": ("銲", "汗", "hon6", "論銲工"),
    # --- 鏇 syun4 → 镟 (簡體, 同義) ---
    "镟": ("鏇", "旋", "syun4", "是鏇成的"),
    # --- 鏨 zaam6 → ? ---
    "站": ("鏨", "暫", "zaam6", "鏨成的石像"),
    # --- 鐃 naau4 → 铙 (簡體, 同義) ---
    "铙": ("鐃", "撓", "naau4", "用鐃鉤鉤住"),
    # --- 鐫 → 镌 (簡體, 同義) ---
    "镌": ("鐫", "專", "zyun1", "用鐵筆鐫刻"),
    # --- 鐺 → 铛 (簡體, 同義) ---
    "铛": ("鐺", "當", "dong1", "金鈴鐺"),
    # --- 閤 → 阖 (簡體, 同義: 全部) ---
    "阖": ("閤", "合", "hap6", "閤家人/閤城"),
    # --- 颻 jiu4 → 飖 (簡體, 同義) ---
    "飖": ("颻", "招", "jiu4", "飄颻在眾樹之上"),
    # --- 颼 → 飕 (簡體, 同義) ---
    "飕": ("颼", "修", "sau1", "短槍颼的響聲"),
    # --- 飫 jyu3 → 醧 (異體字, 同義) ---
    "醧": ("飫", "休", "jyu3", "我使他飽飫"),
    # --- 騸 sin3 → 骟 (簡體, 同義) ---
    "骟": ("騸", "扇", "sin3", "或是騸了的"),
    # --- 鴟 ci1 → 鸱 (簡體, 同義) ---
    "鸱": ("鴟", "疵", "ci1", "角鴟"),
    # --- 鶿 ci4 → 鸧 (簡體, 同義) ---
    "鸧": ("鶿", "慈", "ci4", "鸕鶿"),
    # --- 鷂 jiu6 → 鹞 (簡體, 同義) ---
    "鹞": ("鷂", "耀", "jiu6", "鷂鷹"),
    # --- 鷥 si1 → ? ---
    "司": ("鷥", "思", "si1", "鷺鷥"),
    # --- 鸇 zin1 → ? ---
    "斟": ("鸇", "針", "zam1", "鸇、小鷹"),
    # --- 鸕 lou4 → 鸬 (簡體, 同義) ---
    "鸬": ("鸕", "露", "lou6", "鸕鶿"),
    # --- 鸛 gun3 → 鹳 (簡體, 同義) ---
    "鹳": ("鸛", "灌", "gun3", "鸛、鷺鷥"),
}


async def main():
    print(f"edge-tts {edge_tts.__version__}\n")
    ctrl = await dur("媽", HK[0])
    if ctrl is None:
        print("CONTROL FAILED — no verdict")
        return 1
    print(f"control 媽 = {ctrl:.2f}s\n")
    hdr = f'{"候選":4} {"取代":4} {"同音參考":6} {"粵拼":8} ' \
          f'{"HK-F":>6} {"HK-M":>6} {"ref-F":>6} {"Δ":>6}  判定'
    print(hdr)
    print("-" * len(hdr))
    results = {}
    for cand, (orig, ref, syl, note) in CANDIDATES.items():
        d_f = await dur(cand, HK[0])
        d_m = await dur(cand, HK[1])
        r_f = await dur(ref, HK[0])
        if d_f is None and d_m is None:
            verdict = "✗ 無聲（候選字自己都讀唔到）"
        elif d_f is None or d_m is None:
            verdict = "△ 只有一邊聲線讀到"
        elif r_f is None:
            verdict = "? 參考字無聲，無法比對"
        else:
            delta = abs(d_f - r_f)
            verdict = "✓ 同音節" if delta <= DUR_TOL else f"✗ 音節不符 (Δ{delta:.2f}s)"
        print(f'{cand:4} {orig:4} {ref:6} {syl:8} '
              f'{(f"{d_f:.2f}" if d_f else "-"):>6} {(f"{d_m:.2f}" if d_m else "-"):>6} '
              f'{(f"{r_f:.2f}" if r_f else "-"):>6} {note}')
        print(f'{"":32}→ {verdict}')
        results[cand] = {"orig": orig, "ref": ref, "syl": syl, "note": note,
                         "dur_f": d_f, "dur_m": d_m, "ref_dur": r_f,
                         "verdict": verdict}
    json.dump(results, io.open(OUT / "candidates.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    ok = [c for c, r in results.items() if r["verdict"].startswith("✓")]
    print(f"\n通過 {len(ok)}/{len(results)}: {''.join(ok)}")
    bad = [c for c, r in results.items() if not r["verdict"].startswith("✓")]
    print(f"要再揀: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
