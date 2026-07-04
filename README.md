# Bible Quest 2026

> Duolingo-inspired Bible reading PWA for young Chinese-speaking Christians.
> 中文和合本 + Streak/XP/Partner + 朋輩推動。Capacitor 包 native。

## 📚 Documentation

| Doc | What it covers |
|---|---|
| [DESIGN.md](./DESIGN.md) | Visual identity (Duolingo vibe), design tokens, components |
| [docs/mvp-spec.md](./docs/mvp-spec.md) | Full MVP spec: features, schema, roadmap, open questions |
| [docs/schema.sql](./docs/schema.sql) | Supabase PostgreSQL DDL — tables, views, RLS, triggers, seeds |
| [docs/user-flows.md](./docs/user-flows.md) | Mermaid flows: onboarding, daily lesson, streak break, partner |

## 🚧 Status

**Stage 0 — Planning** (current)

- [x] Research: loop engineering + Google DESIGN.md
- [x] MVP spec v0.1
- [x] Design tokens v0 (Duolingo vibe)
- [x] Database schema v0
- [x] User journey flows v0
- [ ] Open questions in spec §11 answered
- [ ] 40-day reading plan content (chapters per day)
- [ ] Stage 1 — scaffolding + auth + first lesson

## 🏗️ Tech Stack

```
Frontend    : Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4
Backend     : Supabase (PostgreSQL + Auth + Realtime + Storage)
Bible Text  : 從 UNV-bible-reader-2025 抽出 bible-data.json
PWA         : sw.js + manifest + IndexedDB syncManager + Web Push
Native App  : Capacitor (Stage 2)
Design      : Google DESIGN.md → tailwind.theme.json
Dev Loops   : 5 個 autonomous loops (見 mvp-spec §9)
```

## 🛠️ Setup

```bash
git clone https://github.com/appstester0919/bible-quest-2026.git
cd bible-quest-2026

# (Stage 1 後)
npm install
cp .env.local.example .env.local  # fill in Supabase credentials
npm run dev
```

## 📄 License

TBD (Stage 1 時定)

---

**Built on top of learnings from:**
- [appstester0919/UNV-bible-reader-2025](https://github.com/appstester0919/UNV-bible-reader-2025) — 中文和合本 + TTS
- [appstester0919/bible-reading-quest-2025](https://github.com/appstester0919/bible-reading-quest-2025) — Next.js + Supabase + PWA
