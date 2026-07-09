/**
 * Bible data lookup utilities.
 * bible-data.json format:
 *   { books: [{ a: abbr, n: name, c: chapters }, ...], data: { abbr: { chapterNum: [[verseNum, text], ...] } } }
 */

let _bibleCache: { books: BookMeta[]; data: Record<string, Record<string, [number, string][]>> } | null = null

export interface BookMeta {
  abbr: string   // 2-char abbr e.g. "創", "太"
  name: string   // full name e.g. "創世記", "馬太福音"
  chapters: number
  /** 0-based index in canonical order (創 = 0) */
  index: number
}

async function loadBible(): Promise<{ books: BookMeta[]; data: Record<string, Record<string, [number, string][]>> }> {
  if (_bibleCache) return _bibleCache
  const res = await fetch('/bible-data.json')
  const json = await res.json()
  _bibleCache = {
    books: json.books.map((b: { a: string; n: string; c: number }, i: number) => ({
      abbr: b.a,
      name: b.n,
      chapters: b.c,
      index: i,
    })),
    data: json.data as Record<string, Record<string, [number, string][]>>,
  }
  return _bibleCache
}

/**
 * Synchronous lookup — callers must pass pre-loaded books from the component's own state.
 * For dashboard use, prefer useBibleData() hook or pass books from the same fetch.
 */

/**
 * Get a single chapter's verses.
 * @param bookAbbr  2-char abbreviation e.g. "創", "太"
 * @param chapter   1-based chapter number
 * @returns Array of [verseNum, text] tuples
 */
export async function getChapter(bookAbbr: string, chapter: number): Promise<[number, string][]> {
  const bible = await loadBible()
  const chapterData = bible.data[bookAbbr]?.[String(chapter)]
  return chapterData ?? []
}

/**
 * Get all books metadata (synced, for use in components that already loaded bible data).
 */
export function getBooksMeta(bibleJson: { books: { a: string; n: string; c: number }[] }): BookMeta[] {
  return bibleJson.books.map((b, i) => ({
    abbr: b.a,
    name: b.n,
    chapters: b.c,
    index: i,
  }))
}

/**
 * Audio URL for a chapter.
 * Audio files live at /audio/{abbr}/{abbr}{chapter}.mp3
 * e.g. /audio/創/創1.mp3, /audio/太/太1.mp3
 */
export function getAudioUrl(bookAbbr: string, chapter: number): string {
  return `/audio/${bookAbbr}/${bookAbbr}${chapter}.mp3`
}

/**
 * Get the total chapter count for a scope.
 */
export function getTotalChapters(scope: 'nt' | 'ot' | 'nt_ot'): number {
  const counts: Record<string, number> = { nt: 260, ot: 929, nt_ot: 1189 }
  return counts[scope] ?? 1189
}
