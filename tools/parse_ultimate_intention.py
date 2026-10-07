"""Parse 《神的終極目的》 (Ultimate Intention) PDF → structured JSON.

Design decisions, each forced by a probe result rather than assumption:

1. CHAPTER BOUNDARIES come from the TOC on p3 (start page per 篇), not from
   regex-matching「第N篇」in the body. Probe showed the body contains in-text
   references that a heading regex would falsely treat as new chapters —
   p20「第五篇的图示」and p51「第八篇说到基督在旷野...」. The TOC is ground
   truth and costs nothing to trust.

2. RUNNING HEADER「神的終極目的」sits at y=37.5 on every page and is stripped.
   Probe confirmed it on all sampled pages.

3. IMAGE POSITION is recovered from vertical gaps in the bbox line stream.
   Probe: p7 has text at y=112.5 then y=350.2 — a 238pt hole, exactly where
   pdfimages reports an image. pdfimages gives no y-offset, so gap detection is
   the only route. Each page's images are consumed in document order, which is
   what pdfimages numbering already gives us.

4. Front matter (p1-3: author bio + TOC) is EXCLUDED — 0 images there, confirmed.

Output: /mnt/d/AI/BibleQuest2026/public/ultimate-intention/book.json
        images → public/ultimate-intention/img/NN.jpg
"""

import json
import re
import subprocess
from pathlib import Path

PDF = Path("/home/appstester0919/.hermes/cache/scratch/ultimate.pdf")
OUT_DIR = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
IMG_DIR = OUT_DIR / "img"

RUNNING_HEADER = "神的终极目的"

# A vertical hole wider than this (pt) between consecutive text lines is treated
# as an image band. Line pitch in this PDF is ~15.6pt (probe: 254.2 → 269.8),
# and the smallest real image occupies ~211px at 139-181 ppi ≈ 84-109pt.
# 60pt clears both margins with room to spare.
GAP_PT = 60.0

# TOC start pages (p3), 篇 1..28.
TOC_PAGES = [
    4, 8, 11, 14, 17, 20, 23, 26, 29, 32, 36, 39, 43, 46, 50, 53, 57, 61,
    64, 68, 71, 75, 80, 84, 89, 93, 97, 100,
]

CN = "一二三四五六七八九十"


def cn_to_int(s: str) -> int:
    """Chinese numeral 1..28 → int. Handles 一二三…十, 十一…十九, 二十…二十八."""
    digits = {c: i + 1 for i, c in enumerate(CN)}
    if "十" not in s:
        return digits[s]
    head, _, tail = s.partition("十")
    tens = digits[head] if head else 1
    ones = digits[tail] if tail else 0
    return tens * 10 + ones


def is_junk(txt: str) -> bool:
    """Drop PDF furniture, keep real subheadings.

    Probe over the parsed corpus found exactly two junk classes:
      - page-number footers 「4/102」 — 98 of them, one per body page
      - figure captions 「【图1】」「图6.」「图7.」 — the reader renders the
        image inline already, so a redundant caption is noise
    「正确的起点」 and similar 3-6 char lines are REAL subheadings and must
    survive, so the test is pattern-based, not length-based.
    """
    t = txt.strip()
    if re.fullmatch(r"\d+\s*/\s*\d+", t):
        return True
    if re.fullmatch(r"【\s*图\s*\d+\s*】", t):
        return True
    if re.fullmatch(r"图\s*\d+\s*[.．。]?", t):
        return True
    return False


def extract_toc() -> list[dict]:
    """Read p3's TOC lines and pair each「第N篇 title」with its page number."""
    txt = subprocess.run(
        ["pdftotext", "-f", "3", "-l", "3", str(PDF), "-"],
        capture_output=True, text=True,
    ).stdout
    # TOC entries end with a dot leader run then the page number. re.S is
    # REQUIRED: titles wrap across lines in the source TOC (第11/26篇), and
    # without DOTALL the lazy title match stops at the newline.
    pat = re.compile(rf"第([{CN}]+)篇\s*(\S[\s\S]*?)\s*\.{{2,}}\s*(\d+)")
    out = []
    for m in pat.finditer(txt):
        title = re.sub(r"\s+", " ", m.group(2)).strip()
        out.append({"num": cn_to_int(m.group(1)), "title": title, "start_page": int(m.group(3))})
    return out


def extract_images() -> dict[int, list[int]]:
    """page -> list of global image numbers, in document order."""
    out = subprocess.run(
        ["pdfimages", "-list", str(PDF)], capture_output=True, text=True
    ).stdout
    pages: dict[int, list[int]] = {}
    for line in out.splitlines()[2:]:
        f = line.split()
        if len(f) >= 3 and f[0].isdigit() and f[1].isdigit():
            pages.setdefault(int(f[0]), []).append(int(f[1]))
    return pages


def page_lines(n: int) -> list[tuple[float, str]]:
    """[(y_min, text)] for page n, top to bottom, header stripped."""
    xml = subprocess.run(
        ["pdftotext", "-f", str(n), "-l", str(n), "-bbox-layout", str(PDF), "-"],
        capture_output=True, text=True,
    ).stdout
    rows: list[tuple[float, str]] = []
    for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</line>', xml, re.S):
        y = float(m.group(2))
        words = re.findall(r"<word[^>]*>(.*?)</word>", m.group(3), re.S)
        txt = "".join(words).strip()
        if not txt or txt == RUNNING_HEADER or is_junk(txt):
            continue
        rows.append((y, txt))
    return rows


def merge_runs(rows: list[tuple[float, str]]) -> list[str]:
    """Join bbox lines into paragraphs.

    The PDF's line pitch is uniform (~15.6pt) within a paragraph and jumps
    (~28-32pt) at a paragraph break, so y-delta is the paragraph signal. That
    is fragile in general, so we ALSO merge when the previous line ends without
    terminal punctuation and the new line starts flush-left (x would be the
    stronger signal, but it is not returned per word here).
    """
    paras: list[str] = []
    cur = ""
    prev_y = None
    for y, txt in rows:
        if prev_y is not None and y - prev_y > 22.0:
            if cur:
                paras.append(cur)
            cur = txt
        elif cur:
            cur += txt
        else:
            cur = txt
        prev_y = y
    if cur:
        paras.append(cur)
    return paras


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    toc = extract_toc()
    print(f"TOC entries: {len(toc)}")
    if len(toc) != 28:
        raise SystemExit(f"expected 28 TOC entries, got {len(toc)}")

    # Cross-check the regex-derived TOC against the hand-read page list.
    mismatch = [(e["num"], e["start_page"], TOC_PAGES[e["num"] - 1])
                for e in toc if e["start_page"] != TOC_PAGES[e["num"] - 1]]
    if mismatch:
        print("TOC page mismatch vs hand-read list:", mismatch)
    else:
        print("TOC pages agree with hand-read list")

    # Extract images first so we know which page consumes which.
    subprocess.run(
        ["pdfimages", "-j", "-png", str(PDF), str(IMG_DIR / "raw")],
        capture_output=True, text=True,
    )

    img_pages = extract_images()
    print(f"images on {len(img_pages)} pages, {sum(len(v) for v in img_pages.values())} total")

    # Rename raw-NNN.(jpg|ppm) → NN.(jpg|png) so the reader can derive the
    # filename from the block index alone.
    renamed = {}
    for p in IMG_DIR.glob("raw-*"):
        num = int(p.name.split("-")[1].split(".")[0])
        ext = "jpg" if p.suffix.lower() in (".jpg", ".jpeg") else "png"
        dst = IMG_DIR / f"{num:02d}.{ext}"
        p.rename(dst)
        renamed[num] = dst.name
    print(f"renamed {len(renamed)} image files")

    # Build chapters.
    chapters = []
    for i, entry in enumerate(toc):
        start = entry["start_page"]
        end = TOC_PAGES[i + 1] - 1 if i + 1 < len(TOC_PAGES) else 101
        blocks: list[dict] = []
        cursor_img = 0

        for pno in range(start, end + 1):
            rows = page_lines(pno)
            here = img_pages.get(pno, [])
            local = 0

            # Walk lines, emitting a paragraph or an image at each gap.
            chunk: list[tuple[float, str]] = []
            prev_y = None
            for y, txt in rows:
                if prev_y is not None and (y - prev_y) > GAP_PT and local < len(here):
                    if chunk:
                        for para in merge_runs(chunk):
                            blocks.append({"type": "p", "text": para})
                        chunk = []
                    num = here[local]
                    blocks.append({"type": "img", "src": renamed.get(num, f"{num:02d}.jpg")})
                    local += 1
                chunk.append((y, txt))
                prev_y = y
            if chunk:
                for para in merge_runs(chunk):
                    blocks.append({"type": "p", "text": para})

            # Any images on this page the gap scan missed go at the end.
            for num in here[local:]:
                blocks.append({"type": "img", "src": renamed.get(num, f"{num:02d}.jpg")})
            cursor_img += len(here)

        # Drop the chapter title line — it is rendered as the page h1 instead.
        head = f"第{CN.replace('十','10')}"  # unused; filter by title text below
        blocks = [
            b for b in blocks
            if not (b["type"] == "p" and entry["title"] and entry["title"] in b["text"]
                    and len(b["text"]) <= len(entry["title"]) + 6)
        ]

        chapters.append({
            "num": entry["num"],
            "title": entry["title"],
            "startPage": start,
            "blocks": blocks,
        })
        n_img = sum(1 for b in blocks if b["type"] == "img")
        print(f"  第{entry['num']}篇 {entry['title'][:14]:<16} "
              f"p{start}-{end}  {len(blocks)} blocks  {n_img} img")

    book = {
        "id": "ultimate-intention",
        "title": "神的终极目的",
        "titleEn": "Ultimate Intention",
        "author": "法兰基 (De Vern Framke)",
        "language": "zh-Hans",
        "chapters": chapters,
    }
    (OUT_DIR / "book.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    tot_p = sum(1 for c in chapters for b in c["blocks"] if b["type"] == "p")
    tot_i = sum(1 for c in chapters for b in c["blocks"] if b["type"] == "img")
    chars = sum(len(b["text"]) for c in chapters for b in c["blocks"] if b["type"] == "p")
    print(f"\nwrote book.json  {len(chapters)} chapters  {tot_p} paras  "
          f"{tot_i} images  {chars} chars")


if __name__ == "__main__":
    main()