// 聖經書卷中文單字縮寫映射
export const CHINESE_BIBLE_ABBREVIATIONS: { [key: string]: string } = {
  // 舊約
  "創世記": "創",
  "出埃及記": "出",
  "利未記": "利",
  "民數記": "民",
  "申命記": "申",
  "約書亞記": "書",
  "士師記": "士",
  "路得記": "得",
  "撒母耳記上": "撒上",
  "撒母耳記下": "撒下",
  "列王紀上": "王上",
  "列王紀下": "王下",
  "歷代志上": "代上",
  "歷代志下": "代下",
  "以斯拉記": "拉",
  "尼希米記": "尼",
  "以斯帖記": "斯",
  "約伯記": "伯",
  "詩篇": "詩",
  "箴言": "箴",
  "傳道書": "傳",
  "雅歌": "歌",
  "以賽亞書": "賽",
  "耶利米書": "耶",
  "耶利米哀歌": "哀",
  "以西結書": "結",
  "但以理書": "但",
  "何西阿書": "何",
  "約珥書": "珥",
  "阿摩司書": "摩",
  "俄巴底亞書": "俄",
  "約拿書": "拿",
  "彌迦書": "彌",
  "那鴻書": "鴻",
  "哈巴谷書": "哈",
  "西番雅書": "番",
  "哈該書": "該",
  "撒迦利亞書": "亞",
  "瑪拉基書": "瑪",

  // 新約
  "馬太福音": "太",
  "馬可福音": "可",
  "路加福音": "路",
  "約翰福音": "約",
  "使徒行傳": "徒",
  "羅馬書": "羅",
  "哥林多前書": "林前",
  "哥林多後書": "林後",
  "加拉太書": "加",
  "以弗所書": "弗",
  "腓立比書": "腓",
  "歌羅西書": "西",
  "帖撒羅尼迦前書": "帖前",
  "帖撒羅尼迦後書": "帖後",
  "提摩太前書": "提前",
  "提摩太后書": "提後",
  "提多書": "多",
  "腓利門書": "門",
  "希伯來書": "來",
  "雅各書": "雅",
  "彼得前書": "彼前",
  "彼得後書": "彼後",
  "約翰一書": "約一",
  "約翰二書": "約二",
  "約翰三書": "約三",
  "猶大書": "猶",
  "啟示錄": "啟"
}

// 縮寫 → 全名（用於完整顯示）
export const BOOK_FULL_NAMES: { [key: string]: string } = Object.fromEntries(
  Object.entries(CHINESE_BIBLE_ABBREVIATIONS).map(([full, abbr]) => [abbr, full])
)

// 輔助函數：解析讀經計劃並提取範圍
// 1. 按卷分組，連續章合併為 "太 1-7" 格式
// 2. 不同卷之間用 " / " 分隔
export function parseReadingPlan(readings: string[]): string {
  if (!readings || readings.length === 0) return ''

  // Parse each reading into {book, chapter, raw}
  const parsed = readings.map(r => {
    const match = r.match(/^(.+?)\s+(\d+)(?::\d+)?(?:\s*[-~]\s*(\d+)(?::\d+)?)?$/)
    if (match) {
      const bookName = match[1].trim()
      const startChap = parseInt(match[2], 10)
      const endChap = match[3] ? parseInt(match[3], 10) : startChap
      const abbr = CHINESE_BIBLE_ABBREVIATIONS[bookName] || bookName.charAt(0)
      return { book: bookName, abbr, startChap, endChap, raw: r }
    }
    // Fallback
    const parts = r.split(' ')
    const abbr = CHINESE_BIBLE_ABBREVIATIONS[parts[0]] || parts[0].charAt(0)
    return { book: parts[0], abbr, startChap: 1, endChap: 1, raw: r }
  })

  // Group by book, merge consecutive chapters
  const groups: { book: string, abbr: string, chapters: number[] }[] = []
  for (const item of parsed) {
    const last = groups[groups.length - 1]
    if (last && last.book === item.book) {
      // Same book — extend
      for (let c = last.chapters[last.chapters.length - 1] + 1; c <= item.endChap; c++) {
        last.chapters.push(c)
      }
    } else {
      // New book group
      const chapters: number[] = []
      for (let c = item.startChap; c <= item.endChap; c++) chapters.push(c)
      groups.push({ book: item.book, abbr: item.abbr, chapters })
    }
  }

  // Format each group as "太 1-7"
  const ranges = groups.map(g => {
    if (g.chapters.length === 1) return `${g.abbr} ${g.chapters[0]}`
    return `${g.abbr} ${g.chapters[0]}-${g.chapters[g.chapters.length - 1]}`
  })

  return ranges.join(' / ')
}

// 完整名稱格式（用於"今日功課"等需要全名的地方）
export function formatReadingPlanFull(readings: string[]): string {
  if (!readings || readings.length === 0) return ''

  const parsed = readings.map(r => {
    const match = r.match(/^(.+?)\s+(\d+)(?::\d+)?(?:\s*[-~]\s*(\d+)(?::\d+)?)?$/)
    if (match) {
      const bookName = match[1].trim()
      const startChap = parseInt(match[2], 10)
      const endChap = match[3] ? parseInt(match[3], 10) : startChap
      return { bookName, startChap, endChap }
    }
    return { bookName: r, startChap: 1, endChap: 1 }
  })

  // Group by book
  const groups: { book: string, chapters: number[] }[] = []
  for (const item of parsed) {
    const last = groups[groups.length - 1]
    if (last && last.book === item.bookName) {
      for (let c = last.chapters[last.chapters.length - 1] + 1; c <= item.endChap; c++) last.chapters.push(c)
    } else {
      const chapters: number[] = []
      for (let c = item.startChap; c <= item.endChap; c++) chapters.push(c)
      groups.push({ book: item.bookName, chapters })
    }
  }

  const ranges = groups.map(g => {
    if (g.chapters.length === 1) return `${g.book} ${g.chapters[0]}`
    return `${g.book} ${g.chapters[0]}-${g.chapters[g.chapters.length - 1]}`
  })

  return ranges.join(' / ')
}

// 輔助函數：獲取香港時區的今天日期字符串
export function getHongKongToday(): string {
  // 使用 Intl.DateTimeFormat 獲取香港時區的日期
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  
  const parts = formatter.formatToParts(new Date())
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  
  return `${year}-${month}-${day}`
}

// 輔助函數：檢查日期是否為香港時區的今天
export function isHongKongToday(date: Date): boolean {
  const dateString = date.toISOString().split('T')[0]
  const hongKongToday = getHongKongToday()
  return dateString === hongKongToday
}