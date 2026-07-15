'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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

    setLoading(true)
    const supabase = createClient()
    let result
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      })
      result = signUpError
    } catch (err) {
      setError('網絡或服務異常，請稍後再試')
      setLoading(false)
      return
    }

    if (result) {
      const msg = result?.message || ''
      setError(msg || '註冊失敗，請稍後再試')
      setLoading(false)
      return
    }

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
