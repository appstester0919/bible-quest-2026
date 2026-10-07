// app/(main)/ultimate-intention/page.tsx — 屬靈書《神的終極目的》篇章列表
//
// Server component, mirroring app/(main)/links/page.tsx: no 'use client', no
// hydration mismatch risk (the Round-25 lesson there was never to introduce a
// client island in a list page).
//
// DATA SOURCE — public/ultimate-intention/index.json, produced by
//   tools/parse_ultimate_intention.py   (PDF → book.json)
//   tools/build_ultimate_intention_data.py  (book.json → index.json + per-chapter)
// and audited by tools/audit_ultimate_hant.py, which fails the build if any
// simplified character leaks into the zh-Hant strings. So 繁體 is the default
// here and it is not an aspiration — it is enforced.
//
// SCRIPT SWITCH is a cookie (?lang= is used instead), because the reading page
// must keep the same language across a reload without a query string on every
// internal link.

import Link from 'next/link'
import { cookies } from 'next/headers'
import fs from 'node:fs/promises'
import path from 'node:path'

import ChapterRow from '@/components/ultimate-intention/ChapterRow'
import ScriptToggle from '@/components/ultimate-intention/ScriptToggle'

export const dynamic = 'force-dynamic'

type Localized = { 'zh-Hant': string; 'zh-Hans': string }

type IndexChapter = {
  num: number
  label: string
  title: Localized
  preview: Localized
  images: number
  chars: number
}

type Index = {
  id: string
  title: Localized
  titleEn: string
  author: Localized
  chapters: IndexChapter[]
}

const SOURCE_SITE = 'https://gaienfuren.com'

const DATA = path.join(
  process.cwd(),
  'public',
  'ultimate-intention',
  'index.json',
)
const COOKIE = 'ui-script'

export default async function BookIndexPage() {
  const jar = await cookies()
  const lang: 'zh-Hant' | 'zh-Hans' =
    jar.get(COOKIE)?.value === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant'
  const t = (o: Localized) => o[lang]

  let book: Index
  try {
    book = JSON.parse(await fs.readFile(DATA, 'utf-8')) as Index
  } catch {
    return (
      <div className="page min-h-screen bg-[var(--color-background)] p-6">
        <div className="empty-state-card">
          <p className="text-lg mb-1" aria-hidden="true">
            📖
          </p>
          <p>內容暫時未能載入</p>
          <p className="text-sm mt-1 opacity-80">請稍後再試</p>
        </div>
      </div>
    )
  }

  const totalImages = book.chapters.reduce((n, c) => n + c.images, 0)

  return (
    <div className="page min-h-screen bg-[var(--color-background)] pb-24">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <header className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="h-section">{t(book.title)}</h1>
              <p className="text-sm text-muted mt-1">
                {book.titleEn} · {t(book.author)}
              </p>
            </div>
            <ScriptToggle lang={lang} />
          </div>
        </header>

        <div className="card-gem mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl" aria-hidden="true">
              📘
            </span>
            <p className="font-extrabold text-base">
              {book.chapters.length} 篇
            </p>
          </div>
          <p className="text-sm opacity-90">
            {lang === 'zh-Hant' ? '繁體版（香港用字）' : '简体版'}
            {' · '}
            {totalImages} 幅插圖 · 支援朗讀
          </p>
        </div>

        {/* Compact single-line rows. Design.md §Components: cards are 20px
            corners with 24px padding — correct for a lesson card you tap to
            start, but 28 of them made the index three screens long. The roman
            numeral and 一篇 said the same thing twice, so the number is now
            「Ch N」 in latin and the Chinese ordinal is dropped entirely. */}
        <ul className="space-y-2">
          {book.chapters.map((c) => (
            <ChapterRow
              key={c.num}
              num={c.num}
              title={t(c.title)}
              lang={lang}
            />
          ))}
        </ul>

        {/* 「目錄也用細字標明內容出處網站並連結，以示尊重」
            The text is transcribed from a public edition of De Vern Framke's
            Ultimate Intention; naming it costs one line and is the honest thing
            to do with someone else's book. */}
        <footer className="mt-8 pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-ink-soft)] leading-relaxed">
            內容出處：{' '}
            <a
              href={SOURCE_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-[var(--color-primary)]"
            >
              {SOURCE_SITE.replace(/^https?:\/\//, '')}
            </a>
            <br />
            {t(book.author)} · {book.titleEn}（{' '}
            {lang === 'zh-Hant' ? '繁體版' : '简体版'}）
          </p>
        </footer>
      </div>
    </div>
  )
}
