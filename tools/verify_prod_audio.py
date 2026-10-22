"""Verify that the deployed mp3 bytes are the bytes on disk — not just the length.

A Vercel deployment can serve a stale file that happens to have the right
Content-Length (or the right URL, from a cache). Comparing `curl -I`
Content-Length against the local file is what got skipped for eight
consecutive releases and is exactly the check that would have caught a
service-worker cache miss shipping old silent-character audio.

This downloads every changed mp3 from the deployment and compares the MD5 of
the response body with the MD5 of the local file. It also checks the
service-worker script actually reports the new CACHE_NAME, because a stale
CACHE_NAME means every installed PWA keeps serving the previous bytes
regardless of how correct the deployment is.

    python3 tools/verify_prod_audio.py --base https://biblequest2026.vercel.app
    python3 tools/verify_prod_audio.py --base <preview-url> --ref HEAD
"""
import argparse
import hashlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path("/mnt/d/AI/BibleQuest2026")


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def md5_file(p: Path) -> str:
    h = hashlib.md5()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def changed_mp3s(ref: str) -> list[str]:
    r = subprocess.run(["git", "-C", str(ROOT), "-c", "core.quotePath=false",
                        "diff", "--name-only", f"{ref}", "HEAD", "--",
                        "public/audio", "public/ultimate-intention/audio"],
                       capture_output=True, text=True)
    return sorted(p for p in r.stdout.split("\n") if p.endswith(".mp3"))


def url_for(rel: str) -> str:
    return "/" + rel[len("public/"):]


def check(base: str, rel: str) -> tuple[str, bool, str]:
    local = ROOT / rel
    want = md5_file(local)
    r = subprocess.run(["curl", "-sS", "--max-time", "120", "-L",
                        f"{base}{url_for(rel)}"], capture_output=True)
    got = md5_bytes(r.stdout)
    ok = got == want
    if ok:
        return rel, True, f"MD5 {got[:12]} ✓ ({len(r.stdout):,} B)"
    if not r.stdout:
        return rel, False, f"下載空 ({r.stderr.decode()[:80]})"
    return rel, False, (f"MD5 {got[:12]} ≠ 本地 {want[:12]} "
                        f"(遠 {len(r.stdout):,} B / 本地 {local.stat().st_size:,} B)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--ref", default="HEAD~1")
    args = ap.parse_args()

    files = changed_mp3s(args.ref)
    print(f"base   {args.base}")
    print(f"ref    {args.ref}")
    print(f"files  {len(files)}\n")

    # service worker cache name
    sw = subprocess.run(["curl", "-sS", "--max-time", "60", "-L",
                         f"{args.base}/sw.js"], capture_output=True, text=True)
    import re
    m = re.search(r"const CACHE_NAME = 'bible-quest-v(\d+)'", sw.stdout)
    local_sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    ml = re.search(r"const CACHE_NAME = 'bible-quest-v(\d+)'", local_sw)
    if m and ml and m.group(1) != ml.group(1):
        print(f"✗ sw.js 遠端 v{m.group(1)} ≠ 本地 v{ml.group(1)}")
    elif m:
        print(f"✓ sw.js CACHE_NAME = v{m.group(1)} (遠端 = 本地)")
    else:
        print("✗ sw.js 搵唔到 CACHE_NAME")

    bad = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for rel, ok, msg in ex.map(lambda f: check(args.base, f), files):
            print(f"  {'✓' if ok else '✗'} {rel:56} {msg}")
            if not ok:
                bad.append(rel)
    print(f"\n通過 {len(files) - len(bad)} / {len(files)}")
    if bad:
        print("失敗：")
        for b in bad:
            print("  ", b)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
