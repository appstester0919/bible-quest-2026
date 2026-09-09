// app/(main)/links/page.tsx — Round 28 (2026-09-09) design rework
//
// Server component only — no `'use client'`. Filter via URL query (?category=)
// so each filter is full SSR; no client JS needed. Round-25 lesson kept:
// never introduce a client island here (caused hydration mismatch in
// Round-24's earlier draft).
//
// DESIGN SYSTEM — per DESIGN.md tokens:
//   - `h-section`        → Nunito 800 page h1
//   - `card-gem`         → gem-blue (#1CB0F6) info banner with totals
//   - `chip` + `chip-active` (green #58CC02 — Round-28 fix from purple)
//   - `category-header-streak` → streak-orange (#FF9600) category header
//   - `lesson-card-link` → white surface, 20px corner, 24px padding, hover lift
//   - `empty-state-card` → danger-light dashed border for "暫時未有連結"
//
// No lucide-react, no arbitrary hex colors. External-link glyph is inline
// SVG (matches BottomNavigation pattern of inline SVG icons, not emoji).

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type LinkRow = {
  id: string
  category: string
  title: string
  url: string
  description: string | null
  sort_order: number
  created_at: string
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bq_external_links')
    .select('id, category, title, url, description, sort_order, created_at')
    .eq('is_published', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[links] supabase error', error)
  }

  const allLinks: LinkRow[] = data ?? []
  const allCategories = Array.from(new Set(allLinks.map((l) => l.category))).sort()

  const params = await searchParams
  const activeCat = params.category ?? null
  const visibleLinks = activeCat
    ? allLinks.filter((l) => l.category === activeCat)
    : allLinks

  // Group by category for section headers (only show categories with visible rows)
  const grouped = new Map<string, LinkRow[]>()
  for (const l of visibleLinks) {
    if (!grouped.has(l.category)) grouped.set(l.category, [])
    grouped.get(l.category)!.push(l)
  }

  return (
    <div className="page page-links min-h-screen bg-[var(--color-background)] pb-24">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <header className="mb-4">
          <h1 className="h-section">🔗 外網連結</h1>
          <p className="text-sm text-muted mt-1">
            探索更多聖經資源，由社群一齊維護
          </p>
        </header>

        {/* Info banner — gem-blue card-gem with totals */}
        {allLinks.length > 0 && (
          <div className="card-gem mb-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl" aria-hidden="true">📘</span>
              <p className="font-extrabold text-base">
                {allLinks.length} 個連結 · {allCategories.length} 個分類
              </p>
            </div>
            <p className="text-sm opacity-90">
              由社群共同維護嘅外網資源
            </p>
          </div>
        )}

        {/* Category chips — server-rendered <a> tags, filter via URL */}
        {allCategories.length > 0 && (
          <nav
            className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-1 px-1"
            aria-label="連結分類"
          >
            <Link
              href="/links"
              className={`chip ${activeCat === null ? 'chip-active' : ''}`}
              aria-current={activeCat === null ? 'page' : undefined}
            >
              全部 ({allLinks.length})
            </Link>
            {allCategories.map((c) => {
              const count = allLinks.filter((l) => l.category === c).length
              return (
                <Link
                  key={c}
                  href={`/links?category=${encodeURIComponent(c)}`}
                  className={`chip ${activeCat === c ? 'chip-active' : ''}`}
                  aria-current={activeCat === c ? 'page' : undefined}
                >
                  {c} ({count})
                </Link>
              )
            })}
          </nav>
        )}

        {/* Grouped link cards */}
        {grouped.size > 0 ? (
          <div className="mt-6">
            {Array.from(grouped.entries()).map(([cat, items]) => (
              <section key={cat} aria-labelledby={`cat-${cat}`} className="mb-6">
                <h2 id={`cat-${cat}`} className="category-header-streak">
                  <span aria-hidden="true">🔥</span>
                  <span>{cat}</span>
                  <span className="opacity-80 font-bold text-sm ml-auto">
                    {items.length} 個
                  </span>
                </h2>
                <ul className="space-y-3 mt-3">
                  {items.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lesson-card-link"
                      >
                        <div className="flex items-start gap-3 relative">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-extrabold text-[var(--color-primary)] break-words text-base">
                              {link.title}
                            </h3>
                            {link.description && (
                              <p className="text-sm text-[var(--color-ink-soft)] mt-1 break-words">
                                {link.description}
                              </p>
                            )}
                            <p className="text-xs text-[var(--color-muted)] mt-1 truncate">
                              {link.url}
                            </p>
                          </div>
                          <ExternalLinkGlyph />
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state-card">
            <p className="text-lg mb-1" aria-hidden="true">📭</p>
            <p>
              {allLinks.length === 0
                ? '暫時未有連結'
                : '呢個分類暫時未有連結'}
            </p>
            <p className="text-sm mt-1 opacity-80">
              等緊社群加入第一個外網資源
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Inline SVG external-link glyph — matches BottomNavigation icon style
// (stroke-only, currentColor, 18px). No lucide-react import per project pattern.
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