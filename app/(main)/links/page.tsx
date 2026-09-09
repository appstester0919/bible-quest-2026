// app/(main)/links/page.tsx — Round 24 (2026-09-09) + Round-25 simplification
//
// ENTIRELY server-component, no client island. Filter is done via URL query
// string (`?category=<name>`) so each filter is a full SSR. No hydration
// mismatch possible. Trade-off: search box removed (would require client JS).
// Round-25 decision: simplicity > search; user can scroll + use browser Cmd+F.
//
// Server fetch always hits Supabase (force-dynamic + revalidate=0), and the
// page renders the actual server-fetched data because there's no client-side
// filter to wipe it during hydration. (Round-24 follow-up: client-component
// LinksView was receiving empty `links` prop at hydration time, causing
// "暫時未有連結" empty state to override server-rendered DOM.)
//
// Page root MUST carry `bg-[var(--color-background)]` (Round-19 pattern)
// so the dim overlay covers the full viewport width, matching /dashboard
// /calendar /settings. Content max-width is handled inside the .max-w-3xl
// wrapper below — overlay spans edge-to-edge, content is capped + centered.

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

  // Group by category for section headings
  const grouped = new Map<string, LinkRow[]>()
  for (const l of visibleLinks) {
    if (!grouped.has(l.category)) grouped.set(l.category, [])
    grouped.get(l.category)!.push(l)
  }

  return (
    <div className="page page-links min-h-screen bg-[var(--color-background)] pb-24">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <header className="mb-4">
          <h1 className="h-section">外網連結</h1>
          <p className="text-sm text-muted mt-1">
            由社群共同維護嘅聖經相關資源連結
          </p>
        </header>

        {/* category chips — server-rendered <a> tags, filter via URL */}
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

        {/* grouped link cards */}
        {grouped.size > 0 ? (
          <div className="mt-6 space-y-6">
            {Array.from(grouped.entries()).map(([cat, items]) => (
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
            ))}
          </div>
        ) : (
          <p className="text-center text-muted mt-8">
            {allLinks.length === 0
              ? '暫時未有連結'
              : '呢個分類暫時未有連結'}
          </p>
        )}
      </div>
    </div>
  )
}

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