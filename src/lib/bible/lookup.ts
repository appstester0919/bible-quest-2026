/**
 * Bible chapter lookup — matches UNV-bible-reader-2025 data format:
 * {
 *   "books": [{"a":"創","n":"創世記","c":50}, ...],
 *   "data": { "創": { "1": [[1,"起初神創造天地"], ...], ... }, ... }
 * }
 */

export interface BookMeta {
  abbr: string       // e.g. "創"
  name: string       // e.g. "創世記"
  chapters: number
}

// Raw data types from JSON
type RawChapter = Array<[number, string]>
type RawData = Record<string, Record<string, RawChapter>>

// Flat structure used internally after loading
export interface BibleData {
  books: BookMeta[]
  /** keyed by book abbr, e.g. data["創"]["1"][0][1] = verse text */
  data: RawData
}

let bibleDataCache: BibleData | null = null

/** Load + cache bible data from /bible-data.json */
export async function loadBibleData(): Promise<BibleData> {
  if (bibleDataCache) return bibleDataCache
  const res = await fetch('/bible-data.json')
  if (!res.ok) throw new Error('Failed to load bible-data.json')
  const json = await res.json() as { books: BookMeta[]; data: RawData }
  bibleDataCache = { books: json.books, data: json.data }
  return bibleDataCache
}

/** Get a single chapter's verses as strings, optionally with verse numbers */
export async function getChapter(
  bookAbbr: string,
  chapter: number,
  opts: { withNumbers?: boolean } = {}
): Promise<Array<[number, string]>> {
  const { data } = await loadBibleData()
  const ch = data[bookAbbr]?.[String(chapter)]
  if (!ch) throw new Error(`Not found: ${bookAbbr} ${chapter}`)
  if (opts.withNumbers) return ch
  return ch
}

/** Get just verse texts (no numbers) for a chapter */
export async function getChapterVerses(bookAbbr: string, chapter: number): Promise<string[]> {
  const ch = await getChapter(bookAbbr, chapter)
  return ch.map(([, text]) => text)
}

/** Get audio URL for a chapter (matches UNV-bible-reader-2025 naming: audio/創/創1.mp3) */
export function getAudioUrl(bookAbbr: string, chapter: number): string {
  return `/audio/${bookAbbr}/${bookAbbr}${chapter}.mp3`
}

/** Search verses across all books */
export async function searchVerses(
  query: string,
  opts: { bookAbbr?: string; limit?: number } = {}
): Promise<Array<{ book: BookMeta; chapter: number; verse: number; text: string }>> {
  const { books, data } = await loadBibleData()
  const results: Array<{ book: BookMeta; chapter: number; verse: number; text: string }> = []
  const q = query.toLowerCase()
  const limit = opts.limit ?? 50

  for (const book of books) {
    if (opts.bookAbbr && book.abbr !== opts.bookAbbr) continue
    const chapters = data[book.abbr]
    if (!chapters) continue

    for (const [chStr, verses] of Object.entries(chapters)) {
      for (const [vnum, text] of verses) {
        if (text.toLowerCase().includes(q)) {
          results.push({ book, chapter: Number(chStr), verse: vnum, text })
          if (results.length >= limit) return results
        }
      }
    }
  }
  return results
}

/** Get book metadata by abbr */
export async function getBook(abbr: string): Promise<BookMeta> {
  const { books } = await loadBibleData()
  const book = books.find(b => b.abbr === abbr)
  if (!book) throw new Error(`Book not found: ${abbr}`)
  return book
}

/** List all books */
export async function listBooks(): Promise<BookMeta[]> {
  const { books } = await loadBibleData()
  return books
}
