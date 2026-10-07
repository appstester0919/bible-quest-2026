'use client'

// components/ultimate-intention/ScriptToggle.tsx
//
// 繁體/简体 switch. Sets the ui-script cookie and navigates, so the server
// component re-renders in the new script. Using a cookie (not ?lang=) means the
// choice survives a reload and applies to every chapter without threading the
// query through internal links.
//
// The reading page reads ?lang= because a deep link must be able to force a
// script (someone sharing 「简体版第26篇」). The index reads the cookie because
// the user picks there and expects it to stick.

import { useRouter } from 'next/navigation'

export default function ScriptToggle({
  lang,
}: {
  lang: 'zh-Hant' | 'zh-Hans'
}) {
  const router = useRouter()
  const next = lang === 'zh-Hant' ? 'zh-Hans' : 'zh-Hant'

  const apply = (script: 'zh-Hant' | 'zh-Hans') => {
    // 1 year — the user only changes this if their preference changes.
    document.cookie = `ui-script=${script}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }

  return (
    <div
      className="flex shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)]"
      role="group"
      aria-label="文字版本"
    >
      {(['zh-Hant', 'zh-Hans'] as const).map((s) => {
        const active = s === lang
        return (
          <button
            key={s}
            type="button"
            onClick={() => apply(s)}
            aria-pressed={active}
            className={[
              'px-3 py-2 text-sm font-bold transition-colors',
              active
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface)]',
            ].join(' ')}
          >
            {s === 'zh-Hant' ? '繁' : '简'}
          </button>
        )
      })}
    </div>
  )
}
