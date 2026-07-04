# Bible Reading App — MVP Spec (v0.1, working draft)

> Living document. Decision owners: KH Lai + 開發團隊
> Last updated: 2026-07-04

---

## 1. 定位

- **對象**：年輕大專基督徒（16–25 歲，學青/大專團契）
- **目標**：用 Duolingo 化嘅 streak + 朋輩推動，養成每日讀經習慣
- **MVP 規模**：1–2 個團契試點 50–100 人

## 2. 核心 gimmick（MVP 必備）

| # | Feature | 備註 |
|---|---|---|
| 1 | **每日 1 lesson** | 經文 + 簡短反思引導，5–10 分鐘 |
| 2 | **Streak** | 連續打卡日數，miss 1 日有 1 次 freeze |
| 3 | **XP + Level** | 完成 lesson = XP（章節長度計），升級解鎖新 features |
| 4 | **Achievement badges** | 例：「讀完約翰福音」「連續 7/30/100 日」「首次邀請拍檔」 |
| 5 | **1-on-1 accountability partner** | 邀請同伴、互相睇 streak（唔做 chat） |
| 6 | **Push notification** | 每日 20:00 提醒（用戶可選時間） |

### 唔做嘅（MVP 唔包）
- ❌ 以色列地圖 / 得地為業（舊 quest 反饋差）
- ❌ 跑道式 leaderboard（用 XP 數字排行取代）
- ❌ Leagues（競爭感 vs 靈修初心有衝突）
- ❌ In-app chat / group chat（避免 moderation 負擔）
- ❌ Gems / 商店（後加）

## 3. Reading Plan — Hybrid Model

### Onboarding Flow（2-step wizard）

```
Step 1: 揀範圍
   ○ 新約 only
   ○ 舊約 only
   ○ 新約 + 舊約       → 解鎖 Step 2

Step 2 (only if Both): 揀 reading order
   ○ 先新後舊
   ○ 先舊後新
   ○ 新舊並行          (動態比例，舊 quest 嘅 smart algorithm)

Step 3: Duration slider
   ┌─────────────────────────────────┐
   │ 起點 40 日                       │
   │ 40 → 60: step 1 日               │
   │ 60 → 90: step 5 日               │
   │ 90 → 180: step 10 日             │
   │ 180 → 365: step 30 日            │
   │   (跳過 360 → 直接 365 — TBD)    │
   └─────────────────────────────────┘

Step 4: 即時 preview
   - 每日新約 X 章
   - 每日舊約 Y 章
   - 每日總計 ≈ Z 分鐘
   - 完成日期 [start + N 日]
   - 兩約同日完成? ✓/✗ (only for 並行)

Step 5: Confirm → INSERT user_plan_enrollments
```

### Slider values (anchored 40–365, dynamic step)

| Range | Step | # Ticks | Values |
|---|---|---|---|
| 40–60 | 1 | 21 | 40, 41, …, 60 |
| 60–90 | 5 | 7 | 60, 65, 70, 75, 80, 85, 90 |
| 90–180 | 10 | 10 | 90, 100, 110, …, 180 |
| 180–365 | 30 (skip 360) | 7 | 180, 210, 240, 270, 300, 330, **365** |

> 確認：Slider 180→365 用 (a) — 由 330 直接跳 365，中間唔包 360。

### Duration logic

- Slider 揀嘅日數係 **commitment target**（用戶希望幾耐做完）
- 實際每日讀 chapter count = `ceil(total_chapters_in_scope / commitment_days)`
  - NT 260 章 / 40 日 = 7 章/日
  - OT 929 章 / 40 日 = 24 章/日（≈ 30 分鐘）
  - NT+OT 1189 章 / 365 日 = 4 章/日
- **實際完成日期** = `start_date + ceil(total_chapters / per_day) days`
  - 例 NT-only / 365 日：260/365 = 0.7 → ceil = 1 章/日 → 260 日完成
  - 例 OT-only / 365 日：929/365 = 2.5 → ceil = 3 章/日 → 310 日完成
- Grace period（slider 揀嘅日數 > 實際完成日）係 **純 cosmetic**
  - 顯示 "你嘅 plan 提早 X 日完成 🎉"
  - Enrollment status 自動變 `completed`
  - 唔影響 streak / XP（streak 係 daily lesson，唔係 plan-level）

### Edge cases
- NT-only / OT-only 都唔需要 Step 2（reading order 預設線性）
- ❌ 唔 enforce min chapters/day（user 揀 365 日 OT-only 都接受）
- ❌ 唔 enforce hard warning for high load（user 自己 commit）
- ✅ Plan 完成日係 actual completion，唔係 slider 揀嘅日數

## 4. Tech Stack（承繼 bible-reading-quest-2025）

```
Frontend    : Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4
Backend     : Supabase (PostgreSQL + Auth + Realtime + Storage)
Bible Text  : 從 UNV-bible-reader-2025 抽出 bible-data.json
             存 Supabase Storage 或公開 table
PWA         : sw.js + manifest + IndexedDB syncManager
             + Web Push API
Native App  : Capacitor (Stage 2, 同一份 Next.js bundle)
Design      : Google DESIGN.md (C vibe: Duolingo 風活潑)
             export → tailwind.theme.json
Dev Loops   : 5 個 autonomous loops（見 §9 Loop Engineering）
```

## 5. Supabase Schema（MVP）

### 沿用自 bible-reading-quest-2025
- `profiles`, `reading_plans`, `reading_progress`

### 新增
```sql
-- User progression
user_stats (
  user_id PK,
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_completed_date DATE,
  total_xp INT DEFAULT 0,
  level INT DEFAULT 1,
  streak_freezes_available INT DEFAULT 1  -- 每月補發
)

-- Reading sessions (for XP calculation)
reading_sessions (
  id PK,
  user_id FK,
  plan_id FK,
  chapter_ref TEXT,        -- "John 3"
  completed_at TIMESTAMPTZ,
  xp_earned INT,
  date_local DATE          -- user local date for streak counting
)

-- Accountability partners (1-on-1)
partner_pairs (
  user_id PK,
  partner_id FK,
  paired_at TIMESTAMPTZ,
  status TEXT              -- 'pending', 'active', 'ended'
)

partner_invites (
  id PK,
  inviter_id FK,
  invitee_email TEXT,
  token TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  status TEXT
)

-- Achievements
achievements (
  id PK,
  code TEXT UNIQUE,        -- 'read_john', 'streak_7', 'streak_30'
  name_zh TEXT,
  description_zh TEXT,
  icon TEXT,
  criteria JSONB           -- {type: 'streak', days: 7} etc.
)

user_achievements (
  user_id FK,
  achievement_id FK,
  unlocked_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, achievement_id)
)

-- Reading plans catalog (curated)
reading_plans_catalog (
  id PK,
  slug TEXT UNIQUE,        -- 'john-30', 'nt-90', 'bible-365'
  name_zh TEXT,
  description_zh TEXT,
  duration_days INT,
  structure JSONB          -- [{day: 1, book: 'John', chapter: 1}, ...]
)

-- User plan enrollments
user_plan_enrollments (
  id PK,
  user_id FK,
  plan_slug FK,
  started_at TIMESTAMPTZ,
  current_day INT DEFAULT 1,
  daily_chapter_count INT DEFAULT 1,
  status TEXT              -- 'active', 'paused', 'completed'
)
```

## 6. User Journey（MVP）

### First-time user
1. **Sign up** (email or Google OAuth)
2. **Pick a standard plan** (3 選項，預設「30 日約翰福音」)
3. **Optional: invite partner** (skip-able)
4. **Landing on dashboard** — see today's chapter + streak status

### Daily flow
1. **Push notification** (20:00)
2. Open app → **Today's lesson** page
3. Read chapter (中文和合本)
4. Optional: tap "完成" → +XP, streak++
5. Streak counter 動畫 + confetti + 提示 badge

### Streak management
- 完成時間必須為 user local date 之內（midnight rollover）
- Miss 1 日 → streak 用 freeze 自動修復（每月 1 次 free freeze）
- Miss 2 日 → streak 歸零

### Partner interaction
- Partner 只能睇到對方 streak 數 / 今日是否完成（**唔睇到具體 chapter**）
- 完成當日 chapter 後 partner 收到 push：「XX 今日讀咗」

## 7. Roadmap

| Stage | 內容 | 時程 |
|---|---|---|
| **Stage 0** | 規劃書 + 設計 wireframe | 1–2 週 |
| **Stage 1 — MVP** | Auth + Standard plans + Daily lesson + Streak + XP | 4–6 週 |
| **Stage 2** | + Partner + Achievements + Push notification | 3–4 週 |
| **Stage 3** | + Capacitor iOS / Android build | 3–4 週 |
| **Stage 4** | 公開 beta + 多團契 onboarding | ongoing |

## 9. Loop Engineering（dev workflow）

### 5 個 autonomous loops

| Loop | 觸發 | Quality gate | Stage |
|---|---|---|---|
| **L1 Pre-commit** | `git commit` | `npm run lint && npm test && npm run build` 全綠 | Stage 1 |
| **L2 PR review** | push to feature branch | CodeRabbit 0 critical findings + human approve | Stage 1 |
| **L3 Schema validate** | `reading_plans_catalog` JSON 改動 | AJV schema pass + 所有 chapter ref resolved | Stage 1 |
| **L4 Content QA** | new plan added | bible-data.json chapter refs all match | Stage 1 |
| **L5 Cron self-improve** | daily cron | Test + Lighthouse ≥ 90 + screenshot diff | Stage 3+ |

### 不做 loop 嘅嘢（human in loop）
- UX 決策 / design tokens
- Architecture 改動
- User-facing content（讀經反思）

### 詳見 `/tmp/bible-app-loop-engineering.md`

---

## 10. Design Vibe — C (Duolingo 風活潑)

### Token palette (v0)
```yaml
colors:
  primary:    "#1F2937"   # 深墨灰（文字、nav）
  streak:     "#FF9600"   # 火橙（streak 火、提醒）
  success:    "#58CC02"   # Duolingo 綠（完成）
  gem:        "#1CB0F6"   # 寶石藍（XP / 等級）
  xp:         "#FFC800"   # 金（XP reward）
  danger:     "#FF4B4B"   # 紅（streak 將斷警告）
  surface:    "#FFFFFF"
  background: "#F7F7F7"
  muted:      "#9CA3AF"
  accent:     "#CE82FF"   # 紫（成就 badge）

typography:
  fontSans:  "Nunito, 'Noto Sans TC', sans-serif"  # Duolingo 用 Nunito
  fontSerif: "Noto Serif TC, serif"                # 經文
  # h1: 32px / 700（書名、welcome）
  # h2: 24px / 700（章節標題）
  # body: 17px / 400（經文本身）
  # label: 14px / 600 uppercase
```

### 設計精神
- ✅ 大量留白 + rounded corners (12px+)
- ✅ 顏色主要用嚟表達 state（streak=橙、success=綠、warn=紅）
- ✅ 經文本身用 serif 字體 + 較大行距，保留 reading 感
- ✅ UI chrome 用 sans + 圓角，年輕活潑
- ⚠️ 留意：避免 over-gamification（gems/leagues 唔做）

### 詳見 `/tmp/bible-app-design-system.md`

---

## 11. 開放問題（待 user 回應）

1. ~~Curated plan 邊個做 content？~~ → 預設「30 日約翰福音」要唔要請人寫每日反思？
2. ~~Partner 邀請機制~~ → 用 email 邀請？定要已經係 app user？
3. ~~Push notification provider~~ → Vercel + OneSignal / Supabase functions？
4. ~~Standard plans 內容審核~~ → 編輯流程點樣？