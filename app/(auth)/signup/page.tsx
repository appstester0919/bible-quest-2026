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
      setError(result.message)
      setLoading(false)
      return
    }

    router.push('/onboarding')
  }

  async function handleGoogleSignUp() {
    setError('')
    setLoading(true)
    const supabase = createClient()
    let result
    try {
      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/onboarding`,
        },
      })
      result = googleError
    } catch {
      setError('網絡或服務異常，請稍後再試')
      setLoading(false)
      return
    }
    if (result) {
      setError(result.message)
    }
    setLoading(false)
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

        {/* Divider */}
        <div className="relative my-[var(--spacing-lg)]">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--color-muted)]/20" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-[var(--spacing-sm)] bg-[var(--color-surface)] text-xs text-[var(--color-muted)] font-bold uppercase tracking-wider">
              或
            </span>
          </div>
        </div>

        {/* Google Sign Up */}
        <button
          onClick={handleGoogleSignUp}
          type="button"
          className="w-full py-[14px] px-[var(--spacing-lg)] bg-[var(--color-surface)] text-[var(--color-primary)] rounded-[var(--radius-md)] border border-[var(--color-muted)]/30 font-bold text-base hover:bg-[var(--color-background)] active:scale-[0.98] transition-all flex items-center justify-center gap-[var(--spacing-sm)]"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          用 Google 註冊
        </button>

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
