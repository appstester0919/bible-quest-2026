'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ALL_IDENTITIES, IDENTITIES, DEFAULT_IDENTITY, isIdentity, type Identity } from '@/lib/identity'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // ─── Identity picker: chosen at signup, written to profiles.identity
  // immediately. The user can change it later in Settings, but the
  // onboarding (reading plan) flow never re-asks for it. ─────────────────
  const [identity, setIdentity] = useState<Identity>(DEFAULT_IDENTITY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('兩次輸入的密碼不相同')
      return
    }

    if (password.length < 6) {
      setError('密碼至少需要 6 個字元')
      return
    }

    if (!isIdentity(identity)) {
      setError('請選擇你的身份')
      return
    }

    setLoading(true)
    const supabase = createClient()
    let signUpError: { message: string } | null = null
    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { identity }, // pass through to handle_new_user trigger (see migration 016)
        },
      })
      signUpError = err
    } catch (err) {
      setError('網絡或服務異常，請稍後再試')
      setLoading(false)
      return
    }

    if (signUpError) {
      const msg = signUpError?.message || ''
      setError(msg || '註冊失敗，請稍後再試')
      setLoading(false)
      return
    }

    // Identity persistence is handled by the database trigger
    // `trg_copy_signup_identity` (see supabase/migrations/20260723000000_
    // profile_identity.sql). It reads raw_user_meta_data->>'identity' set
    // above in the signUp call and writes it to profiles.identity. We don't
    // belt-and-suspenders UPDATE from the client because:
    //   - signup with email confirm = no session yet, getUser() returns null
    //   - signup without email confirm = RLS may block UPDATE on profiles
    //     before the row is fully written
    // Trigger fires inside the DB transaction that creates auth.users, so
    // it's atomic. User can override in Settings if they want a different one.

    router.push('/onboarding')
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-[var(--spacing-md)] bg-[var(--color-background)]">
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-[var(--radius-lg)] p-[var(--spacing-xl)] shadow-[var(--shadow-floating)]">
        {/* Logo / Title */}
        <div className="text-center mb-[var(--spacing-lg)]">
          <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight mb-[var(--spacing-xs)]">
            加入 Bible Quest
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            開始你的讀經之旅
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-[var(--spacing-md)] p-[var(--spacing-sm)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-[var(--radius-sm)] text-sm text-[var(--color-danger)] text-center">
            {error}
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSubmit} className="space-y-[var(--spacing-md)]">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-bold text-[var(--color-primary)] mb-[var(--spacing-xs)]"
            >
              電郵
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
              className="w-full px-[var(--spacing-md)] py-3 rounded-[var(--radius-md)] border border-[var(--color-muted)]/30 bg-[var(--color-surface)] text-[var(--color-primary)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-success)] focus:ring-2 focus:ring-[var(--color-success)]/20 transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-bold text-[var(--color-primary)] mb-[var(--spacing-xs)]"
            >
              密碼
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              className="w-full px-[var(--spacing-md)] py-3 rounded-[var(--radius-md)] border border-[var(--color-muted)]/30 bg-[var(--color-surface)] text-[var(--color-primary)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-success)] focus:ring-2 focus:ring-[var(--color-success)]/20 transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-bold text-[var(--color-primary)] mb-[var(--spacing-xs)]"
            >
              確認密碼
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              className="w-full px-[var(--spacing-md)] py-3 rounded-[var(--radius-md)] border border-[var(--color-muted)]/30 bg-[var(--color-surface)] text-[var(--color-primary)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-success)] focus:ring-2 focus:ring-[var(--color-success)]/20 transition-colors"
            />
          </div>

          {/* ─── Identity picker ─────────────────────────────────────────
              Radio cards. Selected card shows a green ring + check.
              Live preview: body[data-identity] updates immediately on select,
              so the user sees the new background before submitting. */}
          <fieldset>
            <legend className="block text-sm font-bold text-[var(--color-primary)] mb-[var(--spacing-xs)]">
              你的身份
            </legend>
            <p className="text-xs text-[var(--color-muted)] mb-[var(--spacing-sm)]">
              揀選你屬於哪個營會／群組，之後可隨時喺「設定」更改。
            </p>
            <div className="grid grid-cols-1 gap-2">
              {ALL_IDENTITIES.map((code) => {
                const meta = IDENTITIES[code]
                const selected = identity === code
                return (
                  <label
                    key={code}
                    className={
                      'flex items-center gap-3 p-3 rounded-[var(--radius-md)] border-2 cursor-pointer transition-all ' +
                      (selected
                        ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                        : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-muted)]')
                    }
                  >
                    <input
                      type="radio"
                      name="identity"
                      value={code}
                      checked={selected}
                      onChange={() => {
                        setIdentity(code)
                        // Live preview: reflect the picked identity on the
                        // <body> immediately so the user sees the right
                        // background before submitting. The server will
                        // re-render and keep this selection.
                        if (typeof document !== 'undefined') {
                          document.body.setAttribute('data-identity', code)
                        }
                      }}
                      className="sr-only"
                    />
                    <span
                      className={
                        'flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ' +
                        (selected
                          ? 'border-[var(--color-success)] bg-[var(--color-success)]'
                          : 'border-[var(--color-muted)]')
                      }
                    >
                      {selected && (
                        <span className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-[var(--color-primary)]">
                        {meta.name_zh}
                      </span>
                      <span className="block text-xs text-[var(--color-muted)] mt-0.5">
                        {meta.preview}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-[14px] px-[var(--spacing-lg)] bg-[var(--color-success)] text-[var(--color-surface)] rounded-[var(--radius-md)] font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-[1px] active:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? '註冊中...' : '建立帳戶'}
          </button>
        </form>

        {/* Login link */}
        <p className="mt-[var(--spacing-lg)] text-center text-sm text-[var(--color-muted)]">
          已有帳戶？{' '}
          <a
            href="/login"
            className="font-bold text-[var(--color-success)] hover:underline"
          >
            立即登入
          </a>
        </p>
      </div>
    </main>
  );
}
