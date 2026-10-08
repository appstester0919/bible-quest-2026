"""Regression check for the truncation guard.

Builds a genuinely half-length mp3 and asserts --verify rejects it, then
asserts the untouched original passes. A guard that has never been shown to
fail is not evidence of anything.
"""
import glob
import shutil
import subprocess
import sys
from pathlib import Path

S = Path("/mnt/d/AI/BibleQuest2026")
TR = Path("/home/appstester0919/.hermes/cache/scratch/verify_regress")
sys.path.insert(0, str(S / "tools"))
import generate_ultimate_tts as G  # noqa: E402

shutil.rmtree(TR, ignore_errors=True)
(TR / "zh-Hant").mkdir(parents=True)

real = S / "public/ultimate-intention/audio/zh-Hant/21.mp3"
subprocess.run(["ffmpeg", "-y", "-i", str(real), "-t", "500",
                str(TR / "zh-Hant/21.mp3")], capture_output=True, check=True)

half = S / "public/ultimate-intention/zh-Hant/21.json"
print("truncated 21 (500s of 1192s):")
rc = G.run_verify([Path(half)], TR / "zh-Hant", "zh-Hant")
print("  -> exit", rc, "EXPECT 1", "PASS" if rc == 1 else "*** FAIL ***")

print("intact 21:")
rc2 = G.run_verify([Path(half)], S / "public/ultimate-intention/audio/zh-Hant",
                   "zh-Hant")
print("  -> exit", rc2, "EXPECT 0", "PASS" if rc2 == 0 else "*** FAIL ***")

# 60% cut: the old 50% floor let this through, the 85% floor must not.
subprocess.run(["ffmpeg", "-y", "-i", str(real), "-t", "700",
                str(TR / "zh-Hant/21.mp3")], capture_output=True, check=True)
print("60% cut (700s of 1192s):")
rc3 = G.run_verify([Path(half)], TR / "zh-Hant", "zh-Hant")
print("  -> exit", rc3, "EXPECT 1", "PASS" if rc3 == 1 else "*** FAIL ***")

# 91% is a real speaking rate, not truncation — must NOT be flagged.
# 4141 chars at the measured 0.288 s/char IS ~1192s; 1000s is 84% of the
# 4141/4.17=993s expectation, i.e. within tolerance.
print("91% of original (1085s) — expected to PASS, it is a plausible rate:")
subprocess.run(["ffmpeg", "-y", "-i", str(real), "-t", "1085",
                str(TR / "zh-Hant/21.mp3")], capture_output=True, check=True)
rc4 = G.run_verify([Path(half)], TR / "zh-Hant", "zh-Hant")
print("  -> exit", rc4, "EXPECT 0", "PASS" if rc4 == 0 else "*** FAIL ***")

sys.exit(0 if (rc == 1 and rc2 == 0 and rc3 == 1 and rc4 == 0) else 1)