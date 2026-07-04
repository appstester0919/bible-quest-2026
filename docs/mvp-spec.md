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

### Onboarding Plan Picker（5 選項，第一步）

| # | Plan | 範圍 | 日數 | 適合對象 |
|---|---|---|---|---|
| 1 | **自訂讀經計劃** | User 自己設 | User 設 | 已有穩定讀經習慣 |
| 2 | **40 日新約 1 次** | 新約 | 40 日 | New believer / 想認識耶穌 |
| 3 | **40 日舊約 1 次** | 舊約 | 40 日 | 想認識聖經故事 / 舊約背景 |
| 4 | **40 日新舊約 1 次** | 新舊約並行 | 40 日 | 想 short-term commit |
| 5 | **（Stage 2+）** 90 日 / 365 日 | … | … | 進階用戶 |

> 自訂 plan form = 沿用 `bible-reading-quest-2025` `PlanForm.tsx`
> 40 日 plans 嘅具體章節編排（哪日讀哪卷哪章）由內容編輯製作，MVP launch 預載佔位 schema，內容 Stage 1 後期填入

### Plan Customization（任何 plan 入到後都可調）
- 每日 chapter count 可調（multi-track：可同時進行多個 plan）
- 可中途 skip / pause / 重啟
- 完成 plan → 解鎖 achievement + option 重新 enroll

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