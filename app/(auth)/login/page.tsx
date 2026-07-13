'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-[var(--spacing-md)] bg-[var(--color-background)]">
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-[var(--radius-lg)] p-[var(--spacing-xl)] shadow-[var(--shadow-floating)]">
        {/* Logo / Title */}
        <div className="text-center mb-[var(--spacing-lg)]">
          <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight mb-[var(--spacing-xs)]">
            Bible Quest
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            每日讀經，養成習慣
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-[var(--spacing-md)] p-[var(--spacing-sm)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-[var(--radius-sm)] text-sm text-[var(--color-danger)] text-center">
            {error}
          </div>
        )}

        {/* Email + Password Form */}
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
              autoComplete="current-password"
              className="w-full px-[var(--spacing-md)] py-3 rounded-[var(--radius-md)] border border-[var(--color-muted)]/30 bg-[var(--color-surface)] text-[var(--color-primary)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-success)] focus:ring-2 focus:ring-[var(--color-success)]/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-[14px] px-[var(--spacing-lg)] bg-[var(--color-success)] text-[var(--color-surface)] rounded-[var(--radius-md)] font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-[1px] active:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? '登入中...' : '登入'}
          </button>
        </form>

        {/* Sign up link */}
        <p className="mt-[var(--spacing-lg)] text-center text-sm text-[var(--color-muted)]">
          還未有帳戶？{' '}
          <a
            href="/signup"
            className="font-bold text-[var(--color-success)] hover:underline"
          >
            立即註冊
          </a>
        </p>
      </div>
    </main>
  );
}
