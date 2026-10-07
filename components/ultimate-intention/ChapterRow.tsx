'use client'

// components/ultimate-intention/ChapterRow.tsx
//
// One row in the book index. Split out of the server page so the done/undone
// state can read localStorage without turning the whole 28-item list into a
// client component — the page header, the summary card and the source footer
// stay server-rendered.

import Link from 'next/link'
import { useChapterDone } from './ReadingProgress'

const DONE_BG = 'bg-[#E8F2E4] border-[#B8D4B4]'
const DONE_INK = 'text-[#2F5D3A]'

export default function ChapterRow({
  num,
  title,
  lang,
}: {
  num: number
  title: string
  lang: 'zh-Hant' | 'zh-Hans'
}) {
  const { done, ready } = useChapterDone(num)
  const isDone = ready && done

  return (
    <li>
      <Link
        href={`/ultimate-intention/${num}?lang=${lang}`}
        className={[
          'lesson-card-link lesson-card-link--compact block transition-colors',
          isDone ? DONE_BG : '',
        ].join(' ')}
      >
        <div className="flex items-center gap-3 py-1">
          {/* Not aria-hidden: it is the only thing telling a screen reader
              which chapter this row opens. 「Ch 3」 is read as 「chapter 3」,
              which is the intent. */}
          <span
            className={[
              'shrink-0 w-12 font-extrabold',
              isDone ? DONE_INK : 'text-[var(--color-primary)]',
            ].join(' ')}
          >
            Ch {num}
          </span>
          <span
            className={[
              'flex-1 min-w-0 font-bold break-words',
              isDone ? DONE_INK : 'text-[var(--color-ink)]',
            ].join(' ')}
          >
            {title}
          </span>
          {/* The emoji is the redundant cue the user asked for: colour alone
              fails anyone who cannot distinguish the green from the default. */}
          <span
            className="shrink-0 text-base leading-none"
            title={isDone ? '已完成' : '未完成'}
            aria-label={isDone ? '已完成' : '未完成'}
          >
            {isDone ? '✅' : '⬜'}
          </span>
        </div>
      </Link>
    </li>
  )
}
