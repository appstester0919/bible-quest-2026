# Stage 1 Milestones — Bible Quest

> Plan date: 2026-07-04
> Target: MVP for 1–2 fellowship trial (50–100 users)
> Methodology: Plan-first, atomic steps, every task has deliverable + verification

---

## Guiding principles

1. **Atomic + verifiable** — every task has a clear deliverable AND a verification command
2. **Loop L1 first** — pre-commit gate (lint + test + build) up before any feature code
3. **Loop L3 (schema) ready early** — every `reading_sessions` write validated against `bible-data.json`
4. **Milestones over big-bang** — ship each milestone as soon as it's verifiable
5. **Token economy** — Hermes (M3) for design decisions, OpenCode free tier for mechanical code gen
6. **Mobile-first** — touch targets ≥ 44px, bottom nav, portrait-optimized, PWA-install-ready

---

## Phase 1: Foundation (Week 1)

### Task 1.1 — Fork bible-reading-quest-2025 base code

| | |
|---|---|
| **Goal** | New `BibleQuest2026/` has runnable base Next.js 15 code |
| **Steps** | (a) `cp -r /mnt/d/AI/BibleReading/bible-reading-quest/* /mnt/d/AI/BibleQuest2026/`<br/>(b) Strip legacy `_unused/`, `bible-api-mcp-server.js`, Vercel MCP, etc.<br/>(c) Update `package.json` name → `bible-quest`<br/>(d) Remove old maps, leaderboard, calendar components (we don't reuse them) |
| **Deliverable** | `npm run dev` shows hello-world at localhost:3000 |
| **Verify** | `curl http://localhost:3000` returns 200 + contains "Bible Quest" or placeholder |
| **Loop fit** | ❌ Human setup |

### Task 1.2 — Write `.claude/CLAUDE.md` convention skill

| | |
|---|---|
| **Goal** | Agent reads conventions before writing any UI code |
| **Content** | Tech stack (Next 15 / React 19 / TS strict / Supabase / Tailwind v4 / DESIGN.md)<br/>Component patterns (PascalCase in `/components`)<br/>DB query location (`/lib/supabase/queries/...`)<br/>Verification gate (no raw console.log, no alert(), use Toast/Modal)<br/>Design rule (always read DESIGN.md before UI code) |
| **Deliverable** | `/mnt/d/AI/BibleQuest2026/.claude/CLAUDE.md` |
| **Verify** | Agent given vague prompt writes component using only DESIGN.md tokens (no random hex) |
| **Loop fit** | ✅ Loop L1 input |

### Task 1.3 — Setup Loop L1: pre-commit gate

| | |
|---|---|
| **Goal** | `git commit` automatically runs lint + test + build, fails if any fail |
| **Steps** | (a) `npm install --save-dev husky lint-staged`<br/>(b) `npx husky init`<br/>(c) Add to `.husky/pre-commit`:<br/>```bash<br/>npm run lint<br/>npm test -- --passWithNoTests<br/>npm run build<br/>```<br/>(d) Setup `lint-staged` for staged files only |
| **Deliverable** | `.husky/pre-commit` + `package.json` scripts wired |
| **Verify** | (1) Introduce intentional lint error → commit fails with message<br/>(2) Fix → commit succeeds |
| **Loop fit** | ✅ **This IS Loop L1** |

### Task 1.4 — Setup Supabase project + run schema

| | |
|---|---|
| **Goal** | Production-shape Postgres running locally (or dev cloud) |
| **Steps** | (a) Create Supabase project (free tier)<br/>(b) Save `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`<br/>(c) Run `docs/schema.sql` via Supabase SQL editor (or `supabase db push`)<br/>(d) Verify all 11 tables + 2 views created |
| **Deliverable** | Supabase dashboard shows `profiles`, `user_stats`, `user_plan_enrollments`, etc. |
| **Verify** | `select count(*) from profiles;` returns 0<br/>`select count(*) from achievements;` returns 10 |
| **Loop fit** | ⚠️ Mostly manual, but schema is stable target |

### Task 1.5 — Setup Vercel + env vars

| | |
|---|---|
| **Goal** | App deployed to Vercel, connected to Supabase |
| **Steps** | (a) `vercel link` to new Vercel project<br/>(b) Set env vars in Vercel dashboard (same as `.env.local`)<br/>(c) `vercel deploy --prod` smoke test<br/>(d) Confirm production build uses Supabase URL (not localhost) |
| **Deliverable** | https://bible-quest-2026.vercel.app (or similar) loads |
| **Verify** | Visit URL → see app shell (Phase 1 minimum is just "it loads") |
| **Loop fit** | ⚠️ Manual, but one-time |

### Task 1.6 — Export DESIGN.md → tailwind theme

| | |
|---|---|
| **Goal** | Tailwind config uses DESIGN.md tokens, no hardcoded hex |
| **Steps** | (a) `npx -y @google/design.md export --format tailwind DESIGN.md > tailwind.theme.json`<br/>(b) Merge `tailwind.theme.json` into `tailwind.config.ts`<br/>(c) Replace any existing hex values in components with Tailwind classes (`bg-streak`, `text-success`)<br/>(d) Add design-lint script: `npx -y @google/design.md lint DESIGN.md` |
| **Deliverable** | Button rendered with `bg-success` resolves to `#58CC02` (Duolingo green) |
| **Verify** | Inspect button in browser devtools → background-color = `#58CC02` |
| **Loop fit** | ✅ Loop L1 can lint DESIGN.md on commit |

---

### **🎯 Milestone 1 deliverable**

Dev environment working, DB connected, design system locked, pre-commit gate operational.

**Verification script**:
```bash
cd /mnt/d/AI/BibleQuest2026
npm run dev              # localhost:3000 loads
npm run lint             # passes
npm test                 # passes (no tests yet, but should not error)
npm run build            # builds
git commit -m "test"     # pre-commit hook fires, all gates pass
```

---

## Phase 2: Core Loop (Week 2–3)

### Task 2.1 — Auth flow (sign up / sign in / sign out)

| | |
|---|---|
| **Goal** | Users can create accounts and sign in |
| **Steps** | (a) Port `/login`, `/signup` pages from bible-reading-quest-2025<br/>(b) Use Supabase Auth (email + Google OAuth)<br/>(c) Verify `handle_new_user` trigger creates profile + stats row |
| **Deliverable** | Working sign up / sign in / sign out |
| **Verify** | E2E: sign up → `select count(*) from profiles` increments → sign out → sign in → same profile |
| **Loop fit** | ⚠️ Mostly manual click-through |

### Task 2.2 — Onboarding wizard detection (middleware)

| | |
|---|---|
| **Goal** | Unfinished users auto-redirected to `/onboarding` |
| **Steps** | (a) Extend `middleware.ts` (from bible-reading-quest-2025) to check `profiles.onboarding_done`<br/>(b) If false → redirect to `/onboarding`<br/>(c) If true → dashboard |
| **Deliverable** | Middleware logic works |
| **Verify** | New user signup → lands on `/onboarding` (not dashboard) |
| **Loop fit** | ⚠️ Manual E2E |

### Task 2.3 — Plan Builder UI (single-page live preview)

| | |
|---|---|
| **Goal** | User can pick scope + (if both) order + drag slider → live preview |
| **Steps** | (a) Create `/app/(auth)/onboarding/plan/page.tsx`<br/>(b) Three radio groups: scope, (conditional) order<br/>(c) Slider with 4-tier dynamic step (40–60 step 1, 60–90 step 5, 90–180 step 10, 180–365 step 30 skip 360)<br/>(d) `useMemo` recomputes preview on any input change<br/>(e) Preview shows: 每日新約 X 章 / 每日舊約 Y 章 / 預計完成日 |
| **Deliverable** | Interactive plan builder works in browser |
| **Verify** | (1) Pick NT-only → order radio disabled<br/>(2) Drag slider to 40 → "每日 7 章 NT, 完成於 2026-08-13"<br/>(3) Switch to NT+OT + parallel + 60 → "每日 X NT + Y OT" |
| **Loop fit** | ⚠️ UX feedback required |

### Task 2.4 — Enrollment creation (DB INSERT)

| | |
|---|---|
| **Goal** | Confirm button creates `user_plan_enrollments` row with correct values |
| **Steps** | (a) Compute `chapters_per_day = ceil(scope_chapters / total_days)` from `lib/bible/scope.ts`<br/>(b) `INSERT user_plan_enrollments (user_id, scope, reading_order, total_days, chapters_per_day)`<br/>(c) Verify CHECK constraints: scope=nt → reading_order=NULL, scope=nt_ot → reading_order required |
| **Deliverable** | Confirm button writes correct row |
| **Verify** | After confirm: `select * from user_plan_enrollments` shows row with expected fields |
| **Loop fit** | ✅ Schema can be unit tested |

### Task 2.5 — Today's lesson page

| | |
|---|---|
| **Goal** | User opens dashboard → sees today's chapter (text + reference) |
| **Steps** | (a) Port `lib/bibleData.ts` (OLD/NEW_TESTAMENT_BOOKS arrays) from bible-reading-quest-2025<br/>(b) Copy `bible-data.json` (3.4MB) to `public/`<br/>(c) Generate today's reading from enrollment scope + day_number<br/>(d) Display chapter text using DESIGN.md `scripture` typography (serif, 17px, line-height 1.8) |
| **Deliverable** | Dashboard shows today's lesson |
| **Verify** | (1) NT-only plan, day 1 → "馬太福音 1-7" displays correctly<br/>(2) Inspect rendered HTML → font is Noto Serif TC, size 17px |
| **Loop fit** | ⚠️ Manual UI verify |

### Task 2.6 — Mark complete button (POST reading_sessions)

| | |
|---|---|
| **Goal** | Tap "完成" → inserts reading_sessions row |
| **Steps** | (a) Server action `markLessonComplete(enrollment_id)`<br/>(b) Insert reading_sessions with `date_local = today` in user's timezone<br/>(c) Confetti animation + XP popup |
| **Deliverable** | Button click persists |
| **Verify** | (1) Click complete → DB shows new row<br/>(2) `date_local` matches user local date (not UTC) |
| **Loop fit** | ✅ Server action can be unit tested |

### Task 2.7 — Streak trigger (auto-update user_stats)

| | |
|---|---|
| **Goal** | After reading_sessions insert, user_stats.streak auto-increments |
| **Steps** | (a) Write PL/pgSQL trigger `on_session_insert`<br/>(b) Logic: if date_local = today and last_completed_date = yesterday → streak++<br/>(c) If date_local = today and last_completed_date = today → no-op<br/>(d) If date_local = today and last_completed_date = yesterday - 1 → check freeze_available<br/>(e) Update longest_streak if current > longest |
| **Deliverable** | Streak updates automatically |
| **Verify** | (1) Insert session today → streak=1<br/>(2) Insert session tomorrow → streak=2<br/>(3) Skip day, insert next day → streak=2 (preserved)<br/>(4) Skip 2 days, insert → streak=1 (reset) |
| **Loop fit** | ✅ **Pure SQL, highly testable** — write SQL unit tests |

### Task 2.8 — Setup bible-data.json ingestion

| | |
|---|---|
| **Goal** | All 1189 chapters referenceable by book name + chapter number |
| **Steps** | (a) Copy `bible-data.json` from UNV-bible-reader-2025 → `public/`<br/>(b) Write `lib/bible/lookup.ts` with `getChapter(book_zh, chapter): string[]`<br/>(c) Write `lib/bible/scope.ts` with `getTotalChapters(scope): number` (260 / 929 / 1189)<br/>(d) Verify no orphan refs (every chapter referenced in scope exists in bible-data.json) |
| **Deliverable** | Lookup functions work |
| **Verify** | `getChapter('馬太福音', 1)` returns array of verse strings<br/>`getTotalChapters('nt')` returns 260 |
| **Loop fit** | ✅ **Loop L4 (Content QA)** — script can validate every ref |

---

### **🎯 Milestone 2 deliverable**

A user can: sign up → pick a plan → see today's chapter → mark complete → streak updates.

**End-to-end test**:
```bash
# In Supabase SQL editor
-- After manual E2E walk-through:
select u.display_name, e.scope, e.total_days, s.current_streak, count(rs.id) as sessions
from profiles u
join user_plan_enrollments e on e.user_id = u.id
left join user_stats s on s.user_id = u.id
left join reading_sessions rs on rs.user_id = u.id
group by u.id, e.id, s.current_streak;
-- Expected: 1 user, 1 enrollment, streak matches sessions
```

---

## Phase 3: Polish + Gimmicks (Week 4)

### Task 3.1 — Streak freeze cron (21:00 daily)

| | |
|---|---|
| **Goal** | Miss 1 day → auto-freeze saves streak |
| **Steps** | (a) Write `lib/cron/check-missed-streaks.ts` (Vercel cron-compatible)<br/>(b) Logic: for users with `last_completed_date = yesterday - 1` and `streak_freezes_available > 0` → set freeze_used_on, decrement freezes, preserve streak<br/>(c) Send push notification "🧊 streak saved"<br/>(d) Schedule: Vercel cron `0 13 * * *` (21:00 HKT = 13:00 UTC) |
| **Deliverable** | Cron runs daily, freezes streaks |
| **Verify** | (1) Set last_completed_date = 2 days ago<br/>(2) Run cron job manually<br/>(3) Check: streak preserved, freezes decremented |
| **Loop fit** | ✅ Pure logic, testable |

### Task 3.2 — Achievements trigger (first_lesson)

| | |
|---|---|
| **Goal** | First reading_session → "初次讀經" badge unlocks |
| **Steps** | (a) Write PL/pgSQL trigger `on_session_insert_check_achievements`<br/>(b) Insert into user_achievements when criteria met<br/>(c) Return new achievements to client (for popup) |
| **Deliverable** | Badge auto-unlocks |
| **Verify** | After first session: `select * from user_achievements where user_id = X` shows first_lesson |
| **Loop fit** | ✅ SQL trigger, testable |

### Task 3.3 — XP + level calculation

| | |
|---|---|
| **Goal** | Each chapter read = XP, level up at thresholds |
| **Steps** | (a) XP rule: 10 XP per chapter (1 XP per verse? TBD)<br/>(b) Level thresholds: `level = floor(sqrt(total_xp / 100)) + 1`<br/>(c) Streak 7 → bonus 50 XP<br/>(d) Show level up animation on level transition |
| **Deliverable** | XP accumulates, level displays |
| **Verify** | (1) Read 10 chapters → 100 XP → level 2<br/>(2) Reach streak 7 → bonus awarded |
| **Loop fit** | ⚠️ XP rule needs decision (human in loop) |

### Task 3.4 — Partner invite page

| | |
|---|---|
| **Goal** | User can copy link OR share via WhatsApp |
| **Steps** | (a) Page `/invite` or modal from profile<br/>(b) Two buttons: "📋 複製連結" + "💬 用 WhatsApp 分享"<br/>(c) WhatsApp share uses `wa.me/?text=...` with template:<br/>`我喺度用「聖經任務」讀經！一齊嚟做我嘅讀經拍檔：${link}`<br/>(d) INSERT partner_invites on click "generate invite" |
| **Deliverable** | Invite buttons work |
| **Verify** | (1) Click WhatsApp → opens wa.me with prefilled text<br/>(2) Copy link → clipboard contains `bq.app/i/{token}` |
| **Loop fit** | ⚠️ Manual E2E (WhatsApp requires real device) |

### Task 3.5 — Partner accept flow

| | |
|---|---|
| **Goal** | Receiver taps invite link → if no account, signup → pair created |
| **Steps** | (a) Page `/invite/[token]` shows "Alice 邀請你做讀經拍檔"<br/>(b) If not logged in → redirect to signup with return URL<br/>(c) After signup → INSERT partner_pairs (both directions) → mark invite accepted |
| **Deliverable** | Pair creation works |
| **Verify** | E2E: A invites → B clicks → B signs up → both have partner_pairs row |
| **Loop fit** | ⚠️ Manual E2E |

### Task 3.6 — Partner progress view

| | |
|---|---|
| **Goal** | User sees partner's streak (not specific chapters) |
| **Steps** | (a) Use `v_partner_progress` view (already in schema)<br/>(b) Display on profile/community tab<br/>(c) Show: partner name, avatar, current_streak, completed_today, level |
| **Deliverable** | Partner's stats visible |
| **Verify** | After pairing: partner sees correct stats; does NOT see specific chapter |
| **Loop fit** | ⚠️ Privacy verification required |

### Task 3.7 — Push notification setup

| | |
|---|---|
| **Goal** | User receives "今日仲未讀經 📖" at chosen time |
| **Steps** | (a) Implement Web Push subscription on client (`serviceWorker.pushManager.subscribe`)<br/>(b) Store subscription in `user_stats` (or new `push_subscriptions` table)<br/>(c) Vercel cron at user-chosen time sends push<br/>(d) Push message: title="讀經時間 📖", body="今日仲未完成讀經呀" |
| **Deliverable** | Push notifications arrive |
| **Verify** | (1) Subscribe in browser → grant permission<br/>(2) Set reminder to 5 min from now<br/>(3) Wait → push arrives |
| **Loop fit** | ⚠️ Real-device test required |

### Task 3.8 — PWA polish

| | |
|---|---|
| **Goal** | Lighthouse PWA score ≥ 90 |
| **Steps** | (a) Generate proper icons (192, 512, maskable)<br/>(b) Update `manifest.json` (name, theme_color=streak orange)<br/>(c) Add offline fallback page<br/>(d) Test install prompt on Android Chrome |
| **Deliverable** | Lighthouse PWA ≥ 90 |
| **Verify** | `npx lighthouse https://bible-quest-2026.vercel.app --view` → PWA score ≥ 90 |
| **Loop fit** | ✅ Loop L5 can run Lighthouse daily |

---

### **🎯 Milestone 3 deliverable**

Full MVP. Trial ready for 1–2 fellowships (50–100 users).

**Release checklist**:
- [ ] All 24 tasks complete
- [ ] Loop L1 (pre-commit) operational
- [ ] Loop L3 (schema validate) operational
- [ ] Loop L4 (content QA) operational
- [ ] Lighthouse PWA ≥ 90
- [ ] Privacy verified (partner sees only allowed fields)
- [ ] Test on Android Chrome + iOS Safari (push notification quirks)
- [ ] README updated with deploy instructions
- [ ] 1 demo user account for fellowship testers

---

## Out of scope for Stage 1 (Stage 2+)

- ❌ Multi-partner (drop unique partial index)
- ❌ Email invite
- ❌ Christian books reading module
- ❌ Church event RSVP module
- ❌ Prayer tracker module
- ❌ Capacitor iOS/Android build
- ❌ Advanced analytics (Mixpanel/Amplitude)
- ❌ Internationalization (i18n)
- ❌ Dark mode

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Push notification flaky on iOS Safari | High | Medium | Trial primary on Android Chrome; document iOS limitation |
| Supabase free tier rate limits hit | Medium | High | Monitor usage; have upgrade path ready |
| OpenCode free model rate limits | High | Low | Fall back to Hermes for critical paths |
| Token plan exhausted mid-stage | Medium | High | Use DESIGN.md to constrain agents; mechanical code via OpenCode |
| Chinese punctuation in bible-data.json breaks parsing | Low | Medium | Unit tests for `getChapter()` on edge cases (詩篇 119 etc) |
| User local timezone confusion (Asia vs UTC) | High | High | Always use profile.timezone, never server current_date |

---

## Decision log (referenced during Stage 1)

If during execution you hit a question that's not in this doc, the hierarchy is:

1. **`/DESIGN.md`** — for any UI/UX question
2. **`/docs/mvp-spec.md`** — for any product question
3. **`/docs/schema.sql`** — for any data question
4. **`/docs/user-flows.md`** — for any flow question
5. **This milestones doc** — for any sequencing question
6. **`.claude/CLAUDE.md`** — for any code convention question

If a decision isn't in any of these → ASK before implementing.