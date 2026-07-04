# BibleQuest2026 — Setup Runbook

## Prerequisites

- Node.js 20+ (check: `node --version`)
- npm 10+ (check: `npm --version`)
- Git
- Supabase account (free tier)

---

## Step 1: Clone / Pull Latest Code

```bash
cd D:\AI\BibleQuest2026
git pull
```

---

## Step 2: Create Supabase Project

1. Go to https://supabase.com/dashboard
2. Click **New Project** → name it `bible-quest-2026`
3. Choose a region closest to Hong Kong (e.g., Southeast Asia — Singapore)
4. Save the **Project URL** and **anon public** key from:
   > Settings → API

---

## Step 3: Run Database Schema

1. In Supabase Dashboard → **SQL Editor**
2. Open `docs/schema.sql`
3. Paste and **Run** the entire file
4. Verify: run this query → `SELECT count(*) FROM profiles;` (should return `0`)

> ⚠️ **Important**: All data lives in this schema. Do not drop tables.

---

## Step 4: Configure Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> 🔒 Never commit `.env.local`. It is in `.gitignore`.

---

## Step 5: Install Dependencies

```bash
npm install
npx husky install
```

---

## Step 6: Start Dev Server

```bash
npm run dev
```

Open http://localhost:3000

- If Supabase env vars are not set → shows landing page
- If Supabase env vars are set → redirects to `/login`

---

## Step 7: Push to GitHub (first time only)

```bash
git remote -v   # verify origin points to https://github.com/appstester0919/bible-quest-2026
git push -u origin main
```

---

## Troubleshooting

### `npm run dev` hangs / shows blank page

Check Supabase env vars are set in `.env.local`:
```bash
grep SUPABASE .env.local
```

Test Supabase connection directly in browser console:
```js
const { createClient } = require('@supabase/supabase-js')
console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
```

### Husky hook not running

```bash
npx husky install
git status   # should show .husky/ as staged
```

### ESLint errors on commit

```bash
npm run lint:fix    # auto-fix
npm run format      # prettier format
git add .
git commit
```

---

## Project Structure

```
BibleQuest2026/
├── app/
│   ├── (auth)/           # Auth pages (login, signup)
│   ├── (main)/           # Protected pages (dashboard, etc.)
│   ├── api/              # API routes
│   ├── globals.css       # CSS variables (Duolingo theme)
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Landing / root redirect
├── docs/
│   ├── schema.sql        # Supabase schema (run in SQL Editor)
│   ├── mvp-spec.md       # Product spec
│   ├── user-flows.md     # User journey flows
│   ├── milestones.md     # Stage 1–4 task breakdown
│   └── runbook.md        # This file
├── src/
│   └── lib/supabase/     # Supabase client helpers
├── middleware.ts         # Auth redirect logic
├── DESIGN.md             # Design token system
├── package.json
└── .env.local.example
```

---

## Loop L1 — Pre-commit Hook

Every `git commit` automatically runs:

1. `next lint --fix` (auto-fix ESLint errors)
2. `prettier --write` (format code)

To bypass (never do this for production code):
```bash
git commit --no-verify -m "wip"
```
