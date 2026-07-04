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

### 唔做嘅嘢（MVP 唔包）
- ❌ 以色列地圖 / 得地為業（舊 quest 反饋差）
- ❌ 跑道式 leaderboard（用 XP 數字排行取代）
- ❌ Leagues（競爭感 vs 靈修初心有衝突）
- ❌ In-app chat / group chat（避免 moderation 負擔）
- ❌ Gems / 商店（後加）
- ❌ Multi-partner（Stage 2+）
- ❌ Email 邀請（Stage 1 用 WhatsApp + copy-link）
- ❌ 屬靈書閱讀、教會聚會報名、禱告事項（Stage 2+ future modules）

### 跨裝置設計（mobile-first）

| 平台 | 要求 |
|---|---|
| **Mobile (primary)** | Touch target ≥ 44px、bottom nav、portrait-optimized、PWA install prompt |
| **Tablet** | 同 mobile，但可以用 2-column layout（dashboard + sidebar） |
| **Desktop** | Same React tree，max-width container，nav 可以變 top bar |

**核心策略**：Mobile-first responsive，一份 React code + Tailwind responsive utilities (`sm:`, `md:`, `lg:`)，唔做 separate desktop app。

### 預擴展 Layout 設計

```
┌─────────────────────────────────────────┐
│  Top Bar: app name + notifications 🔔   │
├─────────────────────────────────────────┤
│         Main content area                │
│         (route-based, modular)           │
├─────────────────────────────────────────┤
│  Bottom Nav:                            │
│  [讀經 📖] [進度 📊] [社群 👥] [我 👤]   │
└─────────────────────────────────────────┘
```

Stage 2+ 加新 tab（聚會、書籍、禱告）唔需要 redesign 個 nav。

### 預擴展 Component 設計

- `bottom-nav` 已經喺 DESIGN.md tokenized
- Schema 將來可以加 `module` column，但 Stage 1 唔加
- 待 future modules 設計時再 extend

## 3. Reading Plan — Hybrid Model

### Onboarding UX（single-page live preview）

```
┌─────────────────────────────────────────────┐
│  設定你的讀經計劃                            │
│                                             │
│  範圍                                        │
│  ● 新約 + 舊約                              │
│                                             │
│  Reading order                              │
│  ● 新舊並行                                  │
│                                             │
│  持續時間                                    │
│  40 ──────●───────────────────── 365         │
│            ↑ 60                              │
│  顯示：[ 60 日 ]                             │
│                                             │
│  ─── 即時預覽 ───                           │
│  每日新約：5 章                              │
│  每日舊約：16 章                             │
│  預計完成日：2026-09-01                      │
│                                             │
│           [ 確認並開始 → ]                   │
└─────────────────────────────────────────────┘
```

**Live update 規則**：
- 改範圍 → 即時重算 preview
- 改 reading order → 即時重算（NT-only / OT-only 時自動 disable）
- 拖 slider → 即時重算
- React `useState` + `useMemo` 就搞掂

### Plan Preview fields（Stage 1）

只顯示：
- ✅ 每日新約 X 章
- ✅ 每日舊約 Y 章
- ✅ 預計完成日 = start_date + ceil(total_chapters / per_day) days

**唔顯示**：
- ❌ 每日總計分鐘（每人速度唔同）
- ❌ 兩約同日完成 indicator（非必要 info）

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
  - OT 929 章 / 40 日 = 24 章/日
  - NT+OT 1189 章 / 365 日 = 4 章/日
- **實際完成日期** = `start_date + ceil(total_chapters / per_day) days`
  - 例 NT-only / 365 日：260/365 = 0.7 → ceil = 1 章/日 → 260 日完成
  - 例 OT-only / 365 日：929/365 = 2.5 → ceil = 3 章/日 → 310 日完成
- Grace period（slider 揀嘅日數 > 實際完成日）係 **純 cosmetic**
  - 顯示 "你嘅 plan 提早 X 日完成 🎉"
  - Enrollment status 自動變 `completed`

### Edge cases
- NT-only / OT-only 都唔需要 Step 2（reading order 預設線性）
- ❌ 唔 enforce min chapters/day（user 揀 365 日 OT-only 都接受）
- ❌ 唔 enforce hard warning for high load（user 自己 commit）
- ✅ Plan 完成日係 actual completion，唔係 slider 揀嘅日數

### Plan Adjustment（入到 plan 之後可以調）

- User 入到 dashboard 可以點「調整計劃進度」
- 拖 slider 改 total_days
- 自動 re-compute chapters_per_day
- `UPDATE user_plan_enrollments SET total_days=..., chapters_per_day=...`
- 今日之後嘅 daily schedule 即時 re-generate

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

-- ❌ DROP reading_plans_catalog (Stage 0 決定)
--   用戶 plan 全部 metadata 直接存 user_plan_enrollments
--   不再 pre-define fixed slugs

-- User plan enrollments (replaces catalog)
user_plan_enrollments (
  id              uuid PK,
  user_id         FK,
  scope           TEXT CHECK (scope IN ('nt', 'ot', 'nt_ot')),
  reading_order   TEXT CHECK (reading_order IN ('nt_ot', 'ot_nt', 'parallel')),
  -- reading_order nullable when scope IN ('nt', 'ot')
  total_days      INT CHECK (total_days BETWEEN 40 AND 365),
  chapters_per_day INT NOT NULL,   -- = ceil(scope_chapters / total_days)
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
  paused_at       TIMESTAMPTZ
)
```

### Schema 變動說明

**Stage 0**：`reading_plans_catalog` 用嚟 pre-define 4 個 fixed plans
**Stage 1**：DROP catalog，因為 user plan 係 dynamic combination (scope × order × 40-365 days)
**Stage 2+**：如果將來想加 curated 「牧者推薦 21 日 NT challenge」之類嘅 official plan，可以重新加返 catalog table，分 `is_official=true/false` 兩類

### 從 scope 計 total chapters（application layer）

| scope | total_chapters |
|---|---|
| 'nt' | 260 |
| 'ot' | 929 |
| 'nt_ot' | 1189 |

> Stage 1 將呢個 mapping hardcode 喺 `lib/bible/scope.ts`。Stage 2 可以改由 DB 讀。

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

### Partner 邀請機制

**Stage 1**：
- 用戶點「邀請拍檔」→ 系統 generate invite token → 顯示兩個按鈕
  - 📋 **複製連結**：`bq.app/i/{token}`，用戶自己貼任何地方
  - 💬 **用 WhatsApp 分享**：用 `wa.me/?text=...` deep link，自動帶 message template
- Receiver 點 link：
  - 已 signup → 直接 accept
  - 未 signup → 強制註冊後 auto-accept
- **單一 partner**：Stage 1 限制 user 只可以有 1 個 active partner
  - Schema: `create unique index on partner_pairs (user_id) where status = 'active';`
  - Stage 2 drop 呢個 index 就可以開 multi-partner

**Stage 2+**：
- Multi-partner (1-to-many) 支援
- Partner 之間互相唔知對方存在（`v_partner_progress` view 已 support）
- 可能加「拍檔群」(3-5 人) — 待 spec

### WhatsApp share template

```
我喺度用「聖經任務」讀經！一齊嚟做我嘅讀經拍檔：
https://bq.app/i/{token}
```

**Implementation**：
```js
const link = `https://bq.app/i/${token}`;
const text = `我喺度用「聖經任務」讀經！一齊嚟做我嘅讀經拍檔：${link}`;
window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
```

### 唔做嘅嘢（Stage 1）
- ❌ WhatsApp Business API（要 business account）
- ❌ 自動偵測 WhatsApp 是否安裝（universal link 已覆蓋）
- ❌ Email 邀請（Stage 1 skip，用戶用 copy-link 解決）