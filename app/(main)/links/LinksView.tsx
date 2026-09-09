// app/(main)/links/LinksView.tsx — Round 24 (2026-09-09)
//
// Client-side filtering UI for the /links page. Pure state +
// derive, no server calls. Uses the .chip / .chip-active / .card /
// .card-link / .h-section / .h-subsection classes (Round-24
// additions to globals.css) plus inline tailwind utilities for
// layout.

'use client'

import { useMemo, useState } from 'react'

type Link = {
  id: string
  category: string
  title: string
  url: string
  description: string | null
  created_at: string
}

export default function LinksView({
  links,
  categories,
}: {
  links: Link[]
  categories: string[]
}) {
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return links.filter((l) => {
      if (activeCat && l.category !== activeCat) return false
      if (query) {
        const q = query.toLowerCase()
        if (
          !l.title.toLowerCase().includes(q) &&
          !(l.description?.toLowerCase().includes(q) ?? false)
        )
          return false
      }
      return true
    })
  }, [links, query, activeCat])

  const grouped = useMemo(() => {
    const m = new Map<string, Link[]>()
    for (const l of filtered) {
      if (!m.has(l.category)) m.set(l.category, [])
      m.get(l.category)!.push(l)
    }
    return m
  }, [filtered])

  // Render categories in the same order they were collected from the
  // server response (already sorted alphabetically by category).
  const orderedCategories = useMemo(() => {
    return Array.from(grouped.keys())
  }, [grouped])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="h-section">外網連結</h1>
        <p className="text-sm text-muted mt-1">
          由社群共同維護嘅聖經相關資源連結
        </p>
      </header>

      {/* search */}
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋標題或解說..."
          aria-label="搜尋連結"
          className="w-full px-4 py-2.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      {/* category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            className={`chip ${activeCat === null ? 'chip-active' : ''}`}
            aria-pressed={activeCat === null}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCat(c)}
              className={`chip ${activeCat === c ? 'chip-active' : ''}`}
              aria-pressed={activeCat === c}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* grouped links */}
      {orderedCategories.length > 0 ? (
        <div className="mt-6 space-y-6">
          {orderedCategories.map((cat) => {
            const items = grouped.get(cat) ?? []
            return (
              <section key={cat} aria-labelledby={`cat-${cat}`}>
                <h2 id={`cat-${cat}`} className="h-subsection mb-2">
                  {cat}
                </h2>
                <ul className="space-y-3">
                  {items.map((link) => (
                    <li key={link.id} className="card !p-0 overflow-hidden">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="card-link p-4 flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-[var(--color-primary)] break-words">
                            {link.title}
                          </h3>
                          {link.description && (
                            <p className="text-sm text-muted mt-1 break-words">
                              {link.description}
                            </p>
                          )}
                          <p className="text-xs text-muted mt-1 truncate">
                            {link.url}
                          </p>
                        </div>
                        <ExternalLinkGlyph />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <p className="text-center text-muted mt-8">
          {links.length === 0
            ? '暫時未有連結'
            : '冇符合嘅連結'}
        </p>
      )}
    </div>
  )
}

/**
 * Inline SVG external-link glyph — matches the stroke-based icon style
 * in components/BottomNavigation.tsx (no lucide-react dependency).
 */
function ExternalLinkGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-muted shrink-0 mt-1"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}
