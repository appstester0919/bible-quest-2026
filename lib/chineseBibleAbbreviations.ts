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
  "提摩太後書": "提後",
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

// 輔助函數：解析讀經計劃並提取範圍
export function parseReadingPlan(readings: string[]): string {
  if (!readings || readings.length === 0) return ''
  
  const ranges: string[] = []
  
  for (const reading of readings) {
    // 解析格式如 "創世記 1-23" 或 "創世記 1:1-23:25"
    const match = reading.match(/^(.+?)\s+(\d+)(?::\d+)?(?:\s*[-~]\s*(\d+)(?::\d+)?)?/)
    if (match) {
      const bookName = match[1].trim()
      const startChapter = match[2]
      const endChapter = match[3] || startChapter
      
      const abbr = CHINESE_BIBLE_ABBREVIATIONS[bookName] || bookName.charAt(0)
      
      if (startChapter === endChapter) {
        ranges.push(`${abbr} ${startChapter}`)
      } else {
        ranges.push(`${abbr} ${startChapter}-${endChapter}`)
      }
    } else {
      // 如果無法解析，使用原始格式但縮寫書名
      const parts = reading.split(' ')
      if (parts.length >= 2) {
        const bookName = parts[0]
        const abbr = CHINESE_BIBLE_ABBREVIATIONS[bookName] || bookName.charAt(0)
        ranges.push(`${abbr} ${parts.slice(1).join(' ')}`)
      }
    }
  }
  
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