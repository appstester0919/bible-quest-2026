/**
 * Bible chapter lookup
 * Requires: public/bible-data.json (loaded dynamically)
 * 
 * Bible data structure assumed:
 * {
 *   "Matthew": ["1:1", "1:2", ...],  // each verse as "chapter:verse"
 *   "馬太福音": ["1:1", "1:2", ...],  // Chinese names too
 *   ...
 * }
 */

export interface BibleBook {
  name_zh: string
  name_en: string
  chapters: number
  order: number // 1-66 (Genesis = 1, Revelation = 66)
}

// Old Testament books (Genesis to Malachi)
export const OLD_TESTAMENT_BOOKS: BibleBook[] = [
  { name_zh: '創世記', name_en: 'Genesis', chapters: 50, order: 1 },
  { name_zh: '出埃及記', name_en: 'Exodus', chapters: 40, order: 2 },
  { name_zh: '利未記', name_en: 'Leviticus', chapters: 27, order: 3 },
  { name_zh: '民數記', name_en: 'Numbers', chapters: 36, order: 4 },
  { name_zh: '申命記', name_en: 'Deuteronomy', chapters: 34, order: 5 },
  { name_zh: '約書亞記', name_en: 'Joshua', chapters: 24, order: 6 },
  { name_zh: '士師記', name_en: 'Judges', chapters: 21, order: 7 },
  { name_zh: '路得記', name_en: 'Ruth', chapters: 4, order: 8 },
  { name_zh: '撒母耳記上', name_en: '1 Samuel', chapters: 31, order: 9 },
  { name_zh: '撒母耳記下', name_en: '2 Samuel', chapters: 24, order: 10 },
  { name_zh: '列王紀上', name_en: '1 Kings', chapters: 22, order: 11 },
  { name_zh: '列王紀下', name_en: '2 Kings', chapters: 25, order: 12 },
  { name_zh: '歷代志上', name_en: '1 Chronicles', chapters: 29, order: 13 },
  { name_zh: '歷代志下', name_en: '2 Chronicles', chapters: 36, order: 14 },
  { name_zh: '以斯拉記', name_en: 'Ezra', chapters: 10, order: 15 },
  { name_zh: '尼希米記', name_en: 'Nehemiah', chapters: 13, order: 16 },
  { name_zh: '以斯帖記', name_en: 'Esther', chapters: 10, order: 17 },
  { name_zh: '約伯記', name_en: 'Job', chapters: 42, order: 18 },
  { name_zh: '詩篇', name_en: 'Psalms', chapters: 150, order: 19 },
  { name_zh: '箴言', name_en: 'Proverbs', chapters: 31, order: 20 },
  { name_zh: '傳道書', name_en: 'Ecclesiastes', chapters: 12, order: 21 },
  { name_zh: '雅歌', name_en: 'Song of Solomon', chapters: 8, order: 22 },
  { name_zh: '以賽亞書', name_en: 'Isaiah', chapters: 66, order: 23 },
  { name_zh: '耶利米書', name_en: 'Jeremiah', chapters: 52, order: 24 },
  { name_zh: '耶利米哀歌', name_en: 'Lamentations', chapters: 5, order: 25 },
  { name_zh: '以西結書', name_en: 'Ezekiel', chapters: 48, order: 26 },
  { name_zh: '但以理書', name_en: 'Daniel', chapters: 12, order: 27 },
  { name_zh: '何西阿書', name_en: 'Hosea', chapters: 14, order: 28 },
  { name_zh: '約珥書', name_en: 'Joel', chapters: 3, order: 29 },
  { name_zh: '阿摩司書', name_en: 'Amos', chapters: 9, order: 30 },
  { name_zh: '俄巴底亞書', name_en: 'Obadiah', chapters: 1, order: 31 },
  { name_zh: '約拿書', name_en: 'Jonah', chapters: 4, order: 32 },
  { name_zh: '彌迦書', name_en: 'Micah', chapters: 7, order: 33 },
  { name_zh: '那鴻書', name_en: 'Nahum', chapters: 3, order: 34 },
  { name_zh: '哈巴谷書', name_en: 'Habakkuk', chapters: 3, order: 35 },
  { name_zh: '西番雅書', name_en: 'Zephaniah', chapters: 3, order: 36 },
  { name_zh: '哈該書', name_en: 'Haggai', chapters: 2, order: 37 },
  { name_zh: '撒加利書', name_en: 'Zechariah', chapters: 14, order: 38 },
  { name_zh: '瑪拉基書', name_en: 'Malachi', chapters: 4, order: 39 },
]

// New Testament books (Matthew to Revelation)
export const NEW_TESTAMENT_BOOKS: BibleBook[] = [
  { name_zh: '馬太福音', name_en: 'Matthew', chapters: 28, order: 40 },
  { name_zh: '馬可福音', name_en: 'Mark', chapters: 16, order: 41 },
  { name_zh: '路加福音', name_en: 'Luke', chapters: 24, order: 42 },
  { name_zh: '約翰福音', name_en: 'John', chapters: 21, order: 43 },
  { name_zh: '使徒行傳', name_en: 'Acts', chapters: 28, order: 44 },
  { name_zh: '羅馬書', name_en: 'Romans', chapters: 16, order: 45 },
  { name_zh: '哥林多前書', name_en: '1 Corinthians', chapters: 16, order: 46 },
  { name_zh: '哥林多後書', name_en: '2 Corinthians', chapters: 13, order: 47 },
  { name_zh: '加拉太書', name_en: 'Galatians', chapters: 6, order: 48 },
  { name_zh: '以弗所書', name_en: 'Ephesians', chapters: 6, order: 49 },
  { name_zh: '腓立比書', name_en: 'Philippians', chapters: 4, order: 50 },
  { name_zh: '歌羅西書', name_en: 'Colossians', chapters: 4, order: 51 },
  { name_zh: '帖撒羅尼迦前書', name_en: '1 Thessalonians', chapters: 5, order: 52 },
  { name_zh: '帖撒羅尼迦後書', name_en: '2 Thessalonians', chapters: 3, order: 53 },
  { name_zh: '提摩太前書', name_en: '1 Timothy', chapters: 6, order: 54 },
  { name_zh: '提摩太後書', name_en: '2 Timothy', chapters: 4, order: 55 },
  { name_zh: '提多書', name_en: 'Titus', chapters: 3, order: 56 },
  { name_zh: '腓利門書', name_en: 'Philemon', chapters: 1, order: 57 },
  { name_zh: '希伯來書', name_en: 'Hebrews', chapters: 13, order: 58 },
  { name_zh: '雅各書', name_en: 'James', chapters: 5, order: 59 },
  { name_zh: '彼得前書', name_en: '1 Peter', chapters: 5, order: 60 },
  { name_zh: '彼得後書', name_en: '2 Peter', chapters: 3, order: 61 },
  { name_zh: '約翰一書', name_en: '1 John', chapters: 5, order: 62 },
  { name_zh: '約翰二書', name_en: '2 John', chapters: 1, order: 63 },
  { name_zh: '約翰三書', name_en: '3 John', chapters: 1, order: 64 },
  { name_zh: '猶大書', name_en: 'Jude', chapters: 1, order: 65 },
  { name_zh: '啟示錄', name_en: 'Revelation', chapters: 22, order: 66 },
]

export const ALL_BOOKS = [...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS]

// Cache for bible data
let bibleDataCache: Record<string, string[]> | null = null

/**
 * Load bible data from public/bible-data.json
 */
export async function loadBibleData(): Promise<Record<string, string[]>> {
  if (bibleDataCache) return bibleDataCache
  const res = await fetch('/bible-data.json')
  if (!res.ok) throw new Error('Failed to load bible-data.json')
  const data: Record<string, string[]> = await res.json()
  bibleDataCache = data
  return data
}

/**
 * Get chapter verses as array of strings
 */
export async function getChapter(bookName: string, chapter: number): Promise<string[]> {
  const data = await loadBibleData()
  const key = Object.keys(data).find(k => 
    k.toLowerCase() === bookName.toLowerCase() ||
    ALL_BOOKS.some(b => b.name_zh === bookName && k === b.name_en)
  )
  if (!key) throw new Error(`Book not found: ${bookName}`)
  const verses = data[key]
  if (!verses) throw new Error(`Chapter not found: ${bookName} ${chapter}`)
  return verses
}

/**
 * Get user's reading order for today (which book + chapter)
 */
export function getReadingForDay(
  scope: 'nt' | 'ot' | 'nt_ot',
  dayNumber: number,
  readingOrder: 'nt_ot' | 'ot_nt' | 'parallel' = 'nt_ot'
): { book: BibleBook; startChapter: number; endChapter: number } {
  const books = scope === 'nt' ? NEW_TESTAMENT_BOOKS 
    : scope === 'ot' ? OLD_TESTAMENT_BOOKS 
    : readingOrder === 'ot_nt' ? [...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS]
    : [...NEW_TESTAMENT_BOOKS, ...OLD_TESTAMENT_BOOKS]
  
  // Calculate which book/chapter for this day
  // This is simplified - real implementation needs to track cumulative chapters per day
  let cumulativeChapters = 0
  let chaptersPerDay = scope === 'nt' ? 7 : scope === 'ot' ? 25 : 4 // placeholder
  
  for (const book of books) {
    if (cumulativeChapters + book.chapters >= (dayNumber - 1) * chaptersPerDay) {
      const dayStart = (dayNumber - 1) * chaptersPerDay
      const bookStart = dayStart - cumulativeChapters
      return {
        book,
        startChapter: Math.max(1, bookStart + 1),
        endChapter: Math.min(book.chapters, bookStart + chaptersPerDay),
      }
    }
    cumulativeChapters += book.chapters
  }
  
  // Fallback: last book
  const lastBook = books[books.length - 1]
  return { book: lastBook, startChapter: lastBook.chapters, endChapter: lastBook.chapters }
}
