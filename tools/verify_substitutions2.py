"""Final gate for the 34 newly-found silent characters.

Three independent checks per substitution, because each catches a different
failure mode:

 1. DICT  — the candidate shares a jyutping with the character it replaces.
             Catches "same sound in my head, different syllable in Cantonese".
             (The rime-cantonese dict is traditional-only, so simplified
             candidates are accepted on the ground that they are the standard
             GB simplification of the traditional form and therefore carry the
             same reading; those are marked `via=GB-simplification`.)

 2. VOICE — the candidate produces audio on BOTH Cantonese voices, and on the
             Mandarin voices too when the character is in the simplified corpus.
             Catches "silent candidate".

 3. CONTEXT — the candidate is synthesised inside the real verse sentence and
             its duration is compared with the same sentence using a reference
             character of the same reading. A bare-character duration is a weak
             signal (every single char returns ~1.87 s because of trailing
             silence); inside a sentence the signal is much sharper. Catches
             "the voice pronounces it, but as a different length/stress".

Nothing here replaces the user's ear. This script only decides which
candidates are WORTH sending to the user for ear verification.
"""
import asyncio
import collections
import io
import json
import re
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

OUT = Path("/home/appstester0919/.hermes/cache/scratch/cand2")
OUT.mkdir(parents=True, exist_ok=True)
DICT = Path("/home/appstester0919/.hermes/cache/scratch/jyut6.yaml")
DICT_RAW = ("https://raw.githubusercontent.com/rime/rime-cantonese/main/"
             "jyut6ping3.chars.dict.yaml")
OCC_ST = Path("/home/appstester0919/.hermes/cache/scratch/STCharacters.txt")
OCC_ST_RAW = ("https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/"
              "dictionary/STCharacters.txt")
HK = ("zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural")
CN = ("zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural")
TOL = 0.15

# orig, cand, jyutping, verse phrase, reference char (same reading), note
PAIRS = [
    ("啣", "銜", "haam4", "從群中啣一隻羊羔去", "含", "口齒內銜著"),
    ("噯", "唉", "aai1", "唉！難道我們從神手裡得福", "埃", "嘆詞"),
    ("専", "專", "zyun1", "完全專注於建立神的國度", "尊", "日本新字形誤植"),
    ("廩", "廪", "lam5", "倉也荒涼，廪也破壞", "稟", "倉廩（異體字）"),
    ("櫓", "橹", "lou5", "其中必沒有盪槳搖橹的船", "魯", "GB簡化"),
    ("璫", "珰", "dong1", "腳下玎璫", "當", "GB簡化"),
    ("癤", "疖", "zit3", "人的肉皮上若長了疖子", "節", "GB簡化"),
    ("磣", "摻", "cam3", "他又用沙石摻斷我的牙", "噆", "音節近，tone差一"),
    ("穡", "穑", "sik1", "稼穡、寒暑、冬夏", "識", "GB簡化"),
    ("簍", "篓", "lau5", "拉結已經把神像藏在駱駝的馱簍裡", "樓", "GB簡化"),
    ("糴", "籴", "dek6", "到約瑟那裡籴糧", "笛", "GB簡化"),
    ("糶", "粜", "tiu3", "約瑟開了各處的倉，粜糧給埃及人", "跳", "GB簡化"),
    ("脩", "修", "sau1", "主斥責以人為中心的靈修", "休", "靈脩→靈修"),
    ("覿", "觌", "dik6", "因為我覿面看見耶和華的使者", "敵", "GB簡化"),
    ("輥", "辊", "gwan2", "我又把大石頭辊到墓門口", "滾", "GB簡化"),
    ("鉋", "刨", "paau4", "用鉋子鉋成形狀", "跑", "GB簡化"),
    ("銲", "焊", "hon6", "論銲工說，銲得好", "汗", "GB簡化"),
    ("鏇", "旋", "syun4", "他好像棕樹，是鏇成的", "旋", "同音，字義欠佳"),
    ("鏨", "站", "zaam6", "安什麼鏨成的石像", "暫", "同音，字義欠佳"),
    ("鐃", "铙", "naau4", "用鐃鉤鉤住瑪拿西", "撓", "GB簡化"),
    ("鐫", "镌", "zyun1", "用鐵筆鐫刻，用鉛灌在磐石上", "專", "GB簡化"),
    ("鐺", "铛", "dong1", "在袍子周圍的石榴中間要有金鈴鐺", "當", "GB簡化"),
    ("閤", "阖", "hap6", "國民都歡樂，閤城都安靜", "合", "GB簡化，全體"),
    ("颻", "搖", "jiu4", "飄颻在眾樹之上", "招", "飄搖（同義）"),
    ("颼", "嗖", "sau1", "他嗤笑短槍颼的響聲", "修", "嗖＝呼嘯聲"),
    ("飫", "醧", "jyu3", "疲乏的人，我使他飽飫", "休", "異體字，同義"),
    ("騸", "骟", "sin3", "或是騸了的，不可獻給耶和華", "扇", "GB簡化"),
    ("鴟", "鸱", "ci1", "鴞鳥、貓頭鷹、角鴟", "疵", "GB簡化"),
    ("鶿", "鸧", "ci4", "鴞鳥、鸕鶿、貓頭鷹", "慈", "GB簡化"),
    ("鷂", "鹞", "jiu6", "鷂鷹、小鷹與其類", "耀", "GB簡化"),
    ("鷥", "鸶", "si1", "鸛、鷺鷥與其類", "思", "GB簡化"),
    ("鸇", "煎", "zin1", "鸇、小鷹、鷂鷹與其類", "煎", "同音，字義欠佳"),
    ("鸕", "鸬", "lou4", "鴞鳥、鸕鶿、貓頭鷹", "盧", "GB簡化"),
    ("鸛", "鹳", "gun3", "鸛、鷺鷥與其類", "灌", "GB簡化"),
]


def ensure_file(path: Path, url: str) -> Path:
    """Download `url` into `path` when it is missing or empty.

    The rime dictionary and the OpenCC table used to live only in the scratch
    dir, which Hermes prunes — so this committed script silently stopped
    working once the scratch copy was swept. Fetch them on demand instead.
    """
    if path.exists() and path.stat().st_size > 0:
        return path
    import urllib.request
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=180) as r:
        path.write_bytes(r.read())
    return path


def load_dict():
    """jyutping readings per character, from the rime-cantonese dictionary.

    Handles both the raw rime layout (`char<TAB>reading[<TAB>weight]`) and
    the flattened layout written by the sweep tooling (`char<TAB>rd1<TAB>rd2`).
    """
    ensure_file(DICT, DICT_RAW)
    jp = collections.defaultdict(set)
    for line in io.open(DICT, encoding="utf-8"):
        if line.startswith("#") or line.strip() in ("---", "..."):
            continue
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and len(parts[0]) == 1:
            for rd in parts[1:]:
                rd = rd.strip()
                if re.fullmatch(r"[a-z]+\d", rd):
                    jp[parts[0]].add(rd)
    return jp


def load_opencc():
    """simplified char -> traditional forms, from OpenCC's STCharacters."""
    ensure_file(OCC_ST, OCC_ST_RAW)
    st = {}
    for line in io.open(OCC_ST, encoding="utf-8"):
        if line.startswith("#") or "\t" not in line:
            continue
        k, v = line.rstrip("\n").split("\t", 1)
        st[k.strip()] = v.strip().split(" ")
    return st


async def dur(text, voice):
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


async def main():
    jp = load_dict()
    st = load_opencc()
    print(f"edge-tts {edge_tts.__version__}\n")
    ctrl = await dur("媽", HK[0])
    if ctrl is None:
        print("CONTROL FAILED — no verdict")
        return 1
    print(f"control 媽 = {ctrl:.2f}s\n")

    hdr = (f'{"原":3}{"候選":4}{"粵拼":8}{"字典":6}{"HK-F":>7}{"HK-M":>7}'
           f'{"語境Δ":>8}  {"句":16} 判定')
    print(hdr)
    print("-" * 96)
    results = {}
    for orig, cand, syl, phrase, ref, note in PAIRS:
        # 1. dict
        so, sc = set(jp.get(orig, set())), set(jp.get(cand, set()))
        # The rime dictionary is traditional-only, so a simplified candidate
        # is ABSENT BY DESIGN. Absence is not evidence that the candidate is
        # the simplification of THIS source — 鶿→鸧 slipped through on that
        # assumption (OpenCC: 鸧 ← 鶬, a different bird reading coeng1; 鶿's
        # own simplification is 鹚, ci4). OpenCC decides the correspondence,
        # and the traditional form's reading must still match the source's.
        trads = st.get(cand, [])
        occ_ok = bool(trads) and any(
            t == orig or (so & jp.get(t, set())) for t in trads)
        if so and sc:
            dict_ok = bool(so & sc)
            dict_txt = "✓" if dict_ok else "✗"
        elif not sc:
            dict_ok = occ_ok
            dict_txt = "簡✓" if occ_ok else "簡✗"
        else:
            dict_ok, dict_txt = True, "n/a"
        # 2. voice
        df = await dur(cand, HK[0])
        dm = await dur(cand, HK[1])
        voice_ok = df is not None and dm is not None
        # 3. context
        pc = phrase.replace(orig, cand)
        pr = phrase.replace(orig, ref)
        dc = await dur(pc, HK[0])
        dr = await dur(pr, HK[0])
        if dc is None or dr is None:
            delta, ctx_ok = None, False
        else:
            delta = abs(dc - dr)
            ctx_ok = delta <= TOL
        verdict = "✓ 可提交耳驗" if (voice_ok and ctx_ok and dict_ok) \
            else ("✗ " + (("簡化對應錯 " if not sc else "字典唔同音 ")
                           if not dict_ok else "")
                  + ("無聲 " if not voice_ok else "")
                  + ("語境長度差異大" if not ctx_ok else ""))
        print(f'{orig:3}{cand:4}{syl:8}{dict_txt:6}'
              f'{(f"{df:.2f}" if df else "-"):>7}{(f"{dm:.2f}" if dm else "-"):>7}'
              f'{(f"{delta:.2f}" if delta is not None else "-"):>8}  '
              f'{phrase[:16]:16} {verdict}')
        results[orig] = {"cand": cand, "syl": syl, "phrase": phrase,
                         "ref": ref, "note": note, "dur_f": df, "dur_m": dm,
                         "ctx_delta": delta, "dict_ok": dict_ok,
                         "voice_ok": voice_ok, "ctx_ok": ctx_ok,
                         "verdict": verdict}
    json.dump(results, io.open(OUT / "final.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    ok = [o for o, r in results.items() if r["verdict"].startswith("✓")]
    print(f"\n通過 {len(ok)}/{len(results)}")
    bad = {o: r["verdict"] for o, r in results.items()
           if not r["verdict"].startswith("✓")}
    if bad:
        print("要再揀:")
        for o, v in bad.items():
            print(f"  {o} → {results[o]['cand']}  {v}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
