// app/(main)/links/page.tsx — Round 24 (2026-09-09)
//
// Server component reads published links from Supabase and passes
// them to the client view for filtering. RLS-only on `select`
// (policy "public read published") so anon-key request is enough.
//
// Page root MUST carry `bg-[var(--color-background)]` (Round-19
// pattern) so the dim overlay covers the full viewport width,
// matching /dashboard /calendar /settings. The max-w-3xl wrapper
// lives inside LinksView to cap the content column without
// clipping the parent overlay (Round-22 lesson).

import { createClient } from '@/lib/supabase/server'
import LinksView from './LinksView'

export const dynamic = 'force-dynamic'
// Vercel CDN caches the initial empty-state response even with force-dynamic
// (the first SSR happened when RLS GRANT was missing → 0 rows → cached empty).
// revalidate=0 + cache:' no-store on fetch ensures every request re-runs Supabase.
// Round-24 follow-up: without these, /links shows "暫時未有連結" until Vercel
// cache TTL expires (~1 min).
export const revalidate = 0

type Link = {
  id: string
  category: string
  title: string
  url: string
  description: string | null
  created_at: string
}

export default async function LinksPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bq_external_links')
    .select('id, category, title, url, description, created_at')
    .eq('is_published', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[links] supabase error', error)
  }

  const links: Link[] = data ?? []
  const categories = Array.from(new Set(links.map((l) => l.category)))

  return (
    <div className="page page-links min-h-screen bg-[var(--color-background)] pb-24">
      <LinksView links={links} categories={categories} />
    </div>
  )
}
