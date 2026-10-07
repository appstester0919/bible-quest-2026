"""Rebuild the book data from the source web pages instead of the PDF.

Why this replaced the PDF parser: 「文章中許多分段的地方，你卻沒有分段」 and
「第二篇…是段落title『正確的起點』，然後是該段內容，但現在的顯示卻沒有正確
切割」 were both symptoms of having to RECOVER structure that the PDF had lost.
pdftotext flattens paragraphs, so the indent/leading geometry had to be
re-derived by guesswork, and three separate attempts (y-delta > 22pt, x-indent,
line-gap + short-line) each got a different subset right.

The web edition carries the structure explicitly:

    <p class="wp-block-paragraph"><strong>正確的起點</strong></p>
    <p class="wp-block-paragraph">如果起點不對，就會導引我們…</p>

Every subheading is wrapped in <strong>; body prose is not. That is an exact
signal, not a heuristic — 200+ subheadings across 28 chapters, and every one of
them is already a standalone <p>.

Scope: only the div.entry-content of each chapter page. The page also carries
the site chrome — sidebar, 378 <li> navigation items, jp-carousel comment forms —
which must not leak into the book.

Figure captions 「【图4】」「图6.」are <p> elements that name the adjacent
image; the PDF parser dropped them as junk and this one does the same, since the
reader renders the image inline.
"""

import html
import json
import re
import subprocess
import sys
import time
from pathlib import Path

INDEX_URL = (
    "https://gaienfuren.com/2024/03/05/"
    "%E7%A5%9E%E7%9A%84%E7%BB%88%E6%9E%81%E7%9B%AE%E7%9A%84ultimate-intention/"
)
OUT_DIR = Path("/mnt/d/AI/BibleQuest2026/public/ultimate-intention")
CACHE = Path("/tmp/ut_html")

# Figure captions and page furniture, matched by shape rather than by length so
# a real subheading that happens to be short is never swallowed.
JUNK = [
    re.compile(r"【\s*图\s*\d+\s*】"),
    re.compile(r"图\s*\d+\s*[.．。]?"),
]


def fetch(url: str, dest: Path) -> str:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest.read_text(encoding="utf-8", errors="replace")
    for attempt in range(3):
        subprocess.run(
            ["curl", "-sL", "--max-time", "60", url, "-o", str(dest)],
            capture_output=True,
        )
        if dest.exists() and dest.stat().st_size > 1000:
            return dest.read_text(encoding="utf-8", errors="replace")
        time.sleep(2)
    raise SystemExit(f"failed to fetch {url}")


def content_div(page: str) -> str:
    """Return the balanced <div class="entry-content">…</div> slice."""
    i = page.find('<div class="entry-content')
    if i < 0:
        return ""
    depth = 0
    j = i
    while True:
        m = re.compile(r"<(/?)div\b[^>]*>").search(page, j)
        if not m:
            return page[i:]
        if m.group(1) == "/":
            depth -= 1
            if depth == 0:
                return page[i:m.end()]
            j = m.end()
        else:
            tag = re.match(r"<div\b[^>]*?(/?)>", page[m.start():]).group(0)
            if not tag.endswith("/>"):
                depth += 1
            j = m.end()


def clean(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return html.unescape(fragment).replace("\xa0", " ").strip()


def parse_chapter(page: str) -> list[dict]:
    """Turn one chapter page into an ordered list of blocks."""
    body = content_div(page)
    blocks: list[dict] = []

    # Walk the content in DOCUMENT ORDER over <p> and <img> only: the paragraph
    # text and the figures have to interleave, and scanning for them separately
    # loses the sequence.
    token = re.compile(
        r'<p class="wp-block-paragraph"[^>]*>(.*?)</p>'
        r'|<img[^>]*?src="([^"]+)"[^>]*>',
        re.S,
    )
    for m in token.finditer(body):
        para_html, img_src = m.group(1), m.group(2)
        if img_src:
            # The site serves the original figure at ?w=1024. Keep the remote
            # URL so the fetch step can pull the real artwork; the PDF's
            # pdfimages output is a re-encode of the same plates at lower
            # fidelity, so prefer the web original.
            blocks.append({
                "type": "img",
                "remote": img_src,
                "src": "",
            })
            continue
        if "<strong" not in para_html:
            text = clean(para_html)
            if text:
                blocks.append({"type": "p", "text": text})
            continue
        # <strong> may wrap the whole paragraph (a subheading) or just lead in.
        stripped = clean(re.sub(r"</?strong>", "", para_html))
        strongs = [clean(s) for s in re.findall(r"<strong>(.*?)</strong>", para_html, re.S)]
        strongs = [s for s in strongs if s]
        if not strongs:
            text = clean(para_html)
            if text:
                blocks.append({"type": "p", "text": text})
            continue
        heading = "".join(strongs).strip()
        if any(j.fullmatch(heading) for j in JUNK):
            continue
        # A heading the editor bolded inside a sentence keeps its tail.
        rest = re.sub(r"\s*<strong>.*?</strong>\s*", "", para_html, flags=re.S)
        rest = clean(rest)
        if rest and rest != stripped:
            blocks.append({"type": "p", "text": rest})
        blocks.append({"type": "h", "text": heading})
    return blocks


def main() -> None:
    index = fetch(INDEX_URL, CACHE / "index.html")
    links = re.findall(
        r'href="(https://gaienfuren\.com/[^"]+)"[^>]*>\s*<strong>(第[一二三四五六七八九十]+篇[^<]*)</strong>',
        index,
    )
    if len(links) != 28:
        raise SystemExit(f"expected 28 chapters, found {len(links)}")

    chapters = []
    for num, (url, raw_title) in enumerate(links, start=1):
        page = fetch(url, CACHE / f"{num:02d}.html")
        # The index link text is not always a complete title (第十一篇 links as
        # bare 「第十一篇」), so prefer the page's own og:title.
        og = re.search(r'og:title"\s+content="([^"]+)"', page)
        title = html.unescape(og.group(1) if og else raw_title).strip()
        blocks = parse_chapter(page)
        # Drop the chapter's own title line(s): rendered as the page heading.
        # The page opens with 「第二篇」 and 「神的永远计划」 as two separate
        # <p><strong> blocks, and sometimes the subtitle is not bold at all, so
        # match the ordinal and the title independently.
        title_body = re.sub(r"^第[一二三四五六七八九十]+篇\s*", "", title).strip()
        ordinal = re.match(r"^第[一二三四五六七八九十]+篇", title)
        ordinal = ordinal.group(0) if ordinal else ""
        drop = {title.strip(), title_body.strip(), ordinal.strip()}
        drop.discard("")
        blocks = [
            b for b in blocks
            if not (b.get("type") in ("h", "p") and b["text"].strip() in drop)
        ]
        n_h = sum(1 for b in blocks if b["type"] == "h")
        n_img = sum(1 for b in blocks if b["type"] == "img")
        chars = sum(len(b.get("text", "")) for b in blocks)
        # Download each figure and name it deterministically.
        fig = 0
        for b in blocks:
            if b["type"] != "img":
                continue
            remote = b.pop("remote").split("?")[0]
            ext = Path(remote).suffix.lower() or ".png"
            name = f"web-{num:02d}-{fig}{ext}"
            dest = OUT_DIR / "img" / name
            if not dest.exists():
                subprocess.run(
                    ["curl", "-sL", "--max-time", "90", remote, "-o", str(dest)],
                    capture_output=True,
                )
            b["src"] = f"img/{name}"
            fig += 1

        chapters.append({
            "num": num,
            "title": title_body,
            "sourceUrl": url,
            "blocks": blocks,
        })
        print(f"  第{num:>2}篇 {title_body[:14]:<16} "
              f"{len(blocks):>3} blocks  {n_h:>2} h  {n_img} img  {chars:>5} chars")

    book = {
        "id": "ultimate-intention",
        "title": "神的终极目的",
        "titleEn": "Ultimate Intention",
        "author": "法兰基 (De Vern Framke)",
        "lang": "zh-Hans",
        "sourceUrl": INDEX_URL,
        "chapters": chapters,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "book.json").write_text(
        json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    total_p = sum(1 for c in chapters for b in c["blocks"] if b["type"] == "p")
    total_h = sum(1 for c in chapters for b in c["blocks"] if b["type"] == "h")
    print(f"\nwrote book.json  {len(chapters)} chapters  "
          f"{total_p} paras + {total_h} subheads  "
          f"{sum(len(b.get('text','')) for c in chapters for b in c['blocks'])} chars")


if __name__ == "__main__":
    sys.exit(main())
