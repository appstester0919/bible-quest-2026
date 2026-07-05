# BibleQuest2026 — Development Conventions

## Tech Stack
- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript (strict)
- **Styling**: Tailwind CSS v4 + CSS custom properties from DESIGN.md
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Auth**: Supabase Auth (email + Google OAuth via @supabase/ssr)
- **Bible Data**: public/bible-data.json (3.4MB, 1189 chapters)

## Architecture
- **Client components**: `/app/**/page.tsx` — use 'use client' only when needed
- **Server components**: Default. Prefer server actions for DB writes.
- **Auth helpers**: `src/lib/supabase/client.ts` (browser) + `src/lib/supabase/server.ts` (server)
- **Bible lookup**: `src/lib/bible/lookup.ts` (getChapter) + `src/lib/bible/scope.ts` (getTotalChapters)
- **DB queries**: `src/lib/supabase/queries/` — organize by resource
- **Components**: PascalCase in `/components/`

## Design Rule (MOST IMPORTANT)
**ALWAYS read DESIGN.md before writing any UI code.** All colors come from DESIGN.md tokens via CSS custom properties (--color-success, --color-streak, etc). NEVER use hardcoded hex values in components.

## Bible Data
- File: `public/bible-data.json` — loaded client-side
- Book order: OLD_TESTAMENT (929 chapters), NEW_TESTAMENT (260 chapters)
- Lookup: `getChapter(book_zh: string, chapter: number): string[]` → verse array
- Scope chapters: nt=260, ot=929, nt_ot=1189

## DB Conventions
- All tables have RLS enabled
- Use `service_role` key ONLY in server-side RLS-bypass contexts
- Timestamps: use `timestamptz` for user-facing, `date` for local-date streak counting
- User timezone: always use user's local date for streak, never server UTC date

## Code Quality
- NO raw `console.log` in production code — use `console.error` for errors
- NO `alert()` — use toast/modal patterns
- NO inline styles except in the root `page.tsx` placeholder
- All interactive elements: `cursor: pointer`, `min-height: 44px` for touch targets

## Supabase Auth Flow
1. User signs up/in → Supabase creates auth.users row
2. `handle_new_user()` trigger auto-creates: `profiles` + `user_stats` rows
3. Middleware checks `profiles.onboarding_done` → redirect to /onboarding if false
4. After onboarding → redirect to /dashboard
