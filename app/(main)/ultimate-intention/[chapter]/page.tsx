// app/(main)/ultimate-intention/[chapter]/page.tsx
//
// Server shell that loads the chapter JSON and hands it to the client reader.
// The data is a static file under public/, so this is effectively a static read
// — but `dynamic = 'force-dynamic'` keeps the reading route out of the ISR cache
// so a regenerated chapter file is visible on the next deploy without a
// revalidation step.

import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import fs from 'node:fs/promises'
import path from 'node:path'

import ChapterReader from '@/components/ultimate-intention/ChapterReader'

export const dynamic = 'force-dynamic'

const ROOT = path.join(process.cwd(), 'public', 'ultimate-intention')
const TOTAL = 28

type Localized = { 'zh-Hant': string; 'zh-Hans': string }

type ChapterFile = {
  num: number
  label: string
  title: Localized
  lang: string
  blocks: { type: 'p'; text: string }[] | { type: 'img'; src: string }[]
}

type Index = {
  title: Localized
  chapters: { num: number }[]
}

const pad = (n: number) => String(n).padStart(2, '0')

export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapter: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { chapter } = await params
  const { lang: langQ } = await searchParams
  const num = Number(chapter)
  if (!Number.isInteger(num) || num < 1 || num > TOTAL) notFound()

  // 繁體 is the default. ?lang= wins so a shared deep link can force the other
  // script; otherwise fall back to the ui-script cookie.
  //
  // The cookie used to be ignored here, which made ScriptToggle look dead:
  // it sets ui-script and calls router.refresh(), but this page only ever read
  // the query string, so the reader re-rendered in 繁體 every time and the
  // user reported 「繁簡轉換button現在沒有發揮作用」.
  const cookieLang = (await cookies()).get('ui-script')?.value
  const lang: 'zh-Hant' | 'zh-Hans' =
    langQ === 'zh-Hans' || langQ === 'zh-Hant'
      ? langQ
      : cookieLang === 'zh-Hans'
        ? 'zh-Hans'
        : 'zh-Hant'

  let data: ChapterFile
  let book: Index
  try {
    ;[data, book] = await Promise.all([
      fs
        .readFile(path.join(ROOT, lang, `${pad(num)}.json`), 'utf-8')
        .then((s) => JSON.parse(s) as ChapterFile),
      fs
        .readFile(path.join(ROOT, 'index.json'), 'utf-8')
        .then((s) => JSON.parse(s) as Index),
    ])
  } catch {
    notFound()
  }

  // hasAudio is derived from the filesystem, not a flag: until
  // tools/generate_ultimate_tts.py has produced a chapter's mp3 the reader
  // simply omits the bar rather than offering a play button that 404s.
  const hasAudio = await fs
    .stat(path.join(ROOT, 'audio', lang, `${pad(num)}.mp3`))
    .then(() => true)
    .catch(() => false)

  const q = `?lang=${lang}`

  return (
    <ChapterReader
      chapter={data as never}
      total={TOTAL}
      bookTitle={book.title}
      lang={lang}
      hasAudio={hasAudio}
      prevHref={num > 1 ? `/ultimate-intention/${num - 1}${q}` : null}
      nextHref={num < TOTAL ? `/ultimate-intention/${num + 1}${q}` : null}
      indexHref="/ultimate-intention"
    />
  )
}
