"""Re-parse the PDF preserving PARAGRAPH structure.

Root cause of 「文章中許多分段的地方，你卻沒有分段」:

parse_ultimate_intention.py ran `pdftotext` WITHOUT -layout. In raw mode the
PDF's paragraph-first-line indent is discarded entirely, so the extractor saw
one continuous wall of wrapped lines and the parser could only emit one <p> per
page-region. Chapters came out with single blocks of 1000+ characters where the
book has paragraphs of ~150.

The indent IS the signal. With -layout, the first line of every paragraph is
indented (2-3 spaces, occasionally 1) while continuation lines start at column
0. Measured on page 4:

    indent= 2  当前最要紧是…          <- paragraph start
    indent= 0  什么。然而每个人虽然…     <- continuation
    indent= 0  但每个人在本质上…
    indent= 3  一个小孩若是从来都不问…   <- paragraph start
    indent= 0  放在他里面的部份…

So: a line whose indent >= 1 begins a new paragraph; indent 0 continues the
current one. Headings are centred (large indent, no further lines) and are
detected separately by the existing heuristics.

The user's other point — 「中文也習慣在每一段的開頭，移後兩個空格」 — is a
rendering concern, not a data concern: the indent must not be stored in the
text. It becomes CSS text-indent on the reader, so screen readers and any
future copy/paste see clean text.
"""

import json
import re
import subprocess
from pathlib import Path

PDF = Path("/home/appstester0919/.hermes/cache/scratch/ultimate.pdf")
OUT = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")

# 目录 page numbers -> chapter number, as established by the TOC pass.
CHAPTER_START_PAGES = json.loads(
    Path(__file__).with_name("ultimate_toc.json").read_text(encoding="utf-8")
) if Path(__file__).with_name("ultimate_toc.json").exists() else None


def extract_layout_pages() -> list[str]:
    """pdftotext -layout, one big string, page breaks preserved as \f."""
    r = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(PDF), "-"],
        capture_output=True, text=True, timeout=300,
    )
    return r.stdout.split("\f")


def classify(line: str) -> tuple[str, str | None]:
    """Return (kind, content). kind ∈ {blank, head, body, junk}."""
    if not line.strip():
        return "blank", None
    indent = len(line) - len(line.lstrip(" "))
    text = line.strip()
    # Running header: the book title alone, or a page number alone.
    if re.fullmatch(r"神的?[终終]极?[目目]的?[的目]?[的目]?目的?", text):
        return "junk", None
    if re.fullmatch(r"\d{1,3}", text):
        return "junk", None
    # Centred heading: indent >= 10 and short.
    if indent >= 10 and len(text) <= 30:
        return "head", text
    return "body", text


def main() -> None:
    pages = extract_layout_pages()
    print(f"{len(pages)} pages extracted with -layout")

    for pno, page in enumerate(pages, start=1):
        lines = page.split("\n")
        paras: list[str] = []
        cur: list[str] = []
        for line in lines:
            kind, text = classify(line)
            indent = len(line) - len(line.lstrip(" "))

            if kind == "blank":
                continue
            if kind == "junk":
                if cur:
                    paras.append("".join(cur))
                    cur = []
                continue
            if kind == "head":
                if cur:
                    paras.append("".join(cur))
                    cur = []
                continue

            # body
            if indent >= 1 and cur:
                # indented after text already collected ⇒ new paragraph
                paras.append("".join(cur))
                cur = [text]
            elif indent >= 1:
                cur = [text]
            else:
                cur.append(text)
        if cur:
            paras.append("".join(cur))

        if pno <= 8:
            print(f"  p{pno}: {len(paras)} paragraphs")
            for x in paras[:4]:
                print(f"      {len(x):>4}  {x[:48]}")


if __name__ == "__main__":
    main()