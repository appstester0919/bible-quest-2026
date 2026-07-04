# Bible Quest — User Journey Flows

> 4 個關鍵 flow。Mermaid syntax，可以直接 paste 入 GitHub markdown。

---

## Flow 1: First-time Onboarding

```mermaid
flowchart TD
    A[下載 PWA / 訪問網站] --> B{已有帳號?}
    B -- 否 --> C[Sign up: Email / Google OAuth]
    B -- 是 --> D[Sign in]
    C --> E[auth.users trigger<br/>自動建 profile + user_stats]
    D --> F[Dashboard 檢查 onboarding_done]
    E --> F
    F -->|false| G[Plan Builder — single page live preview]
    G --> G1{揀範圍}
    G1 -- 新約 only --> G2
    G1 -- 舊約 only --> G2
    G1 -- 新約 + 舊約 --> G1a[揀 reading order<br/>先新後舊 / 先舊後新 / 新舊並行]
    G1a --> G2
    G2[拖 slider 40-365 日] --> G3[即時 preview:<br/>每日 X NT + Y OT 章<br/>預計完成日]
    G3 --> H[確認 → INSERT user_plan_enrollments<br/>(scope, reading_order, total_days, chapters_per_day)]
    H --> K{想唔想即刻邀請 partner?}
    K -- 是 --> L[輸入 partner email]
    K -- 唔住 --> N[Dashboard]
    L --> M[INSERT partner_invites<br/>發 email link]
    M --> N[Dashboard]
    N --> O[設定 push notification 時間]
    O --> P[UPDATE profiles.onboarding_done = true]
    P --> Q[首頁：今日 lesson card]
```

**Key state transitions**
- `auth.users.created` → `profiles.created` + `user_stats.created` (via trigger)
- 1st `user_plan_enrollments` row created at end of plan picker
- `onboarding_done = true` only after push time set

---

## Flow 2: Daily Lesson (happy path)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant App as Next.js PWA
    participant SB as Supabase
    participant CR as Cron (loop L5)

    Note over CR: 每日 20:00 local time
    CR->>SB: SELECT profiles WHERE push_token IS NOT NULL<br/>AND reminder_hour = current_hour
    CR->>U: Web Push notification<br/>"今日仲未讀經呀 📖"
    U->>App: 開 app
    App->>SB: GET /v_user_dashboard
    SB-->>App: active_plans + today status
    alt completed_today = false
        App->>U: 顯示 streak card (橙)<br/>+ lesson card (白)
        U->>App: 點擊 lesson card
        App->>U: 顯示經文 (Noto Serif TC, 17px)
        U->>App: 讀完 → 點 "完成"
        App->>SB: POST reading_sessions<br/>{enrollment, day, book, chapter, xp}
        SB->>SB: trigger: UPDATE user_stats<br/>streak++, total_xp += XP
        SB->>SB: trigger: 檢查成就解鎖
        SB-->>App: {new_streak, xp_earned, unlocked_badges[]}
        App->>U: Confetti + 🔥 +1 animation<br/>XP reward popup (金 pill)
        opt 有新成就
            App->>U: Badge unlock modal (紫)
        end
    else completed_today = true
        App->>U: 顯示 "今日已完成 ✓" + 下次 push 時間
    end
```

**Critical**: `reading_sessions.date_local` 必須係 user local date（用 profile.timezone），唔可以用 server `current_date`。Supabase 唔會幫你做 timezone conversion，要 app layer 處理。

---

## Flow 3: Streak Break + Freeze

```mermaid
flowchart TD
    A[每日 cron 21:00] --> B[查 user_stats<br/>last_completed_date < current_date - 1]
    B --> C{有 streak 但 miss 咗?}
    C -- 否 --> Z[結束]
    C -- 是 --> D{streak_freezes_available > 0?}
    D -- 是 --> E[自動用 1 次 freeze<br/>streak 保留<br/>freeze_used_on = today]
    E --> F[發 push:<br/>'你嘅 streak 已被救回 🧊']
    D -- 否 --> G[streak 歸 0<br/>current_streak = 0]
    G --> H[發 push:<br/>'😢 streak 斷咗<br/>重新開始吧']
    E --> I[下次 cron 21:00 再 check]
    H --> I
    F --> I
```

**State machine**:
- `current_streak` only changes on `reading_sessions INSERT` or freeze trigger
- `last_completed_date` is single source of truth for "did you complete today"
- Freeze replenishes monthly via cron (function `replenish_streak_freezes`)

---

## Flow 4: Accountability Partner (1-on-1)

```mermaid
sequenceDiagram
    autonumber
    actor A as Alice (inviter)
    actor B as Bob (invitee)
    participant App
    participant SB as Supabase
    participant RT as Realtime channel

    A->>App: 點 "邀請拍檔" → 顯示 copy-link + WhatsApp share buttons
    A->>App: 點 WhatsApp share
    App->>A: 開 wa.me/?text=...<br/>自動帶 message template
    A->>App: 喺 WhatsApp 揀 contact → send
    A->>App: INSERT partner_invites<br/>(inviter=Alice, token=ABC)

    alt Bob 已有帳號
        B->>App: 點 link
        App->>SB: SELECT invite WHERE token=ABC
        App->>B: "接受 Alice 嘅邀請?"
        B->>App: 接受
        App->>SB: INSERT partner_pairs (user=Alice, partner=Bob)<br/>INSERT partner_pairs (user=Bob, partner=Alice)
        SB->>RT: Realtime broadcast
    else Bob 未有帳號
        B->>App: 點 link → 強制註冊
        App->>SB: 完成 signup
        App->>SB: 自動 accept invite → INSERT partner_pairs x2
    end

    Note over A,B: 之後每日
    A->>App: 讀完 lesson
    App->>SB: INSERT reading_sessions
    SB->>RT: Realtime → partner_done event
    RT->>App: 推 Bob 嘅 device
    App->>B: Push: "🔥 Alice 今日讀咗約翰福音 3 章"
```

**Privacy rule**: Partner can ONLY see via `v_partner_progress` view:
- ✅ display name, avatar, current_streak, longest_streak, completed_today, total_xp, level
- ❌ NOT which book/chapter they read
- ❌ NOT reflection notes (no reflection in MVP anyway)
- ❌ NOT time of day they read

---

## State Diagram: User Stats (核心 state machine)

```mermaid
stateDiagram-v2
    [*] --> New: signup
    New --> Active: 第一次 reading_session
    Active --> Active: daily reading_sessions<br/>(streak++)
    Active --> AtRisk: miss 1 day,<br/>freeze available
    AtRisk --> Active: use freeze<br/>(streak preserved)
    AtRisk --> Broken: freeze used OR<br/>miss 2 days
    Broken --> Active: restart reading<br/>(streak=1)
    Active --> LongTerm: streak ≥ 100<br/>+ achievement unlock
    LongTerm --> LongTerm: keep going
    note right of AtRisk: 21:00 cron 檢查
    note right of Broken: Push: 重新開始吧
```

---

## Critical User Flows Not Yet Drawn (待 spec 確認後再畫)

- **Push notification unsubscribe** — 用戶改變主意唔想收 push
- **Plan switch** — 用戶中途由 NT-40 轉去自訂 plan
- **Account deletion** — GDPR / 私隱 compliance
- **Achievement share** — 解鎖後分享到 IG / WhatsApp (Stage 2+)

要我畫以上任何一個 flow 即管講。