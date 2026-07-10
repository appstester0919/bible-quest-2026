'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getGroupByInviteCode, requestJoinGroup } from '@/lib/groupActions'

export default function JoinPage() {
  const params = useParams<{ code: string }>()
  const router = useRouter()
  const code = params.code
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [hasDisplayName, setHasDisplayName] = useState(false)
  const [group, setGroup] = useState<{ id: string; name: string; member_count: number; preview_members: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<'pending' | 'already' | null>(null)
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push(`/login?next=${encodeURIComponent('/join/' + code)}`)
        return
      }
      setAuthenticated(true)

      // Check profile display_name
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
      if (profile?.display_name) {
        setDisplayName(profile.display_name)
        setHasDisplayName(true)
      }

      // Get group preview
      const res = await getGroupByInviteCode(code)
      if (!res.success || !res.group) {
        setError(res.error || '找不到這個群組')
        setLoading(false)
        return
      }
      setGroup(res.group)

      // Check if already member
      const { data: existing } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', res.group.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (existing) {
        setDone('already')
      }

      setLoading(false)
    }
    init()
  }, [code, router])

  async function handleSaveName() {
    const trimmed = displayName.trim()
    if (trimmed.length === 0 || trimmed.length > 3) {
      alert('顯示名稱必須為 1-3 字')
      return
    }
    setSavingName(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
      if (error) { alert('保存失敗：' + error.message); return }
      setHasDisplayName(true)
    } finally {
      setSavingName(false)
    }
  }

  async function handleRequestJoin() {
    if (!hasDisplayName) {
      alert('請先設定你的顯示名稱')
      return
    }
    setSubmitting(true)
    try {
      const res = await requestJoinGroup(code)
      if (res.success) {
        setDone('pending')
      } else {
        alert('申請失敗：' + (res.error || ''))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-muted">載入中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] p-6">
        <div className="max-w-sm mx-auto mt-20 text-center">
          <span className="text-6xl">😢</span>
          <p className="text-lg font-bold mt-4">找不到群組</p>
          <p className="text-sm text-muted mt-2">{error}</p>
          <p className="text-xs text-muted mt-1">邀請碼：{code}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-6 px-6 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold"
          >
            返回主頁
          </button>
        </div>
      </div>
    )
  }

  if (!group) return null

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-6">
      <div className="max-w-sm mx-auto mt-12">
        <div className="card text-center">
          <span className="text-5xl">👋</span>
          <h1 className="text-xl font-extrabold mt-3">你被邀請加入</h1>
          <p className="text-2xl font-extrabold text-[var(--color-primary)] mt-2">{group.name}</p>

          {group.preview_members.length > 0 && (
            <div className="mt-4 text-left">
              <p className="text-xs text-muted mb-2">組員（{group.member_count} 人）：</p>
              <div className="flex flex-wrap gap-1">
                {group.preview_members.map((name, i) => (
                  <span key={i} className="px-2 py-1 bg-gray-100 rounded-full text-xs font-bold">
                    {name}
                  </span>
                ))}
                {group.member_count > group.preview_members.length && (
                  <span className="px-2 py-1 text-xs text-muted">+{group.member_count - group.preview_members.length}</span>
                )}
              </div>
            </div>
          )}

          {/* Already member */}
          {done === 'already' && (
            <div className="mt-6">
              <p className="text-sm text-[var(--color-success)] mb-3">✓ 你已是這個群組的成員</p>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold"
              >
                返回主頁
              </button>
            </div>
          )}

          {/* Pending */}
          {done === 'pending' && (
            <div className="mt-6">
              <p className="text-sm text-blue-700 mb-1">⏳ 申請已送出</p>
              <p className="text-xs text-muted mb-3">等待組長批准後即可加入</p>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold"
              >
                返回主頁
              </button>
            </div>
          )}

          {/* Need to set display name first */}
          {done === null && !hasDisplayName && (
            <div className="mt-6 text-left">
              <p className="text-sm text-amber-700 mb-2">⚠️ 請先設定你的顯示名稱</p>
              <p className="text-xs text-muted mb-2">最多 3 個中文字，用於群組內顯示</p>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={3}
                placeholder="如：小明"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base text-center"
              />
              <button
                onClick={handleSaveName}
                disabled={savingName || displayName.trim().length === 0}
                className="w-full mt-2 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold disabled:opacity-50"
              >
                {savingName ? '保存中...' : '保存名稱'}
              </button>
            </div>
          )}

          {/* Ready to request */}
          {done === null && hasDisplayName && (
            <div className="mt-6">
              <p className="text-sm text-muted mb-3">
                你的顯示名稱：<span className="font-bold text-[var(--color-primary)]">{displayName}</span>
              </p>
              <button
                onClick={handleRequestJoin}
                disabled={submitting}
                className="w-full px-4 py-3 bg-[var(--color-primary)] text-white rounded-lg font-extrabold text-base disabled:opacity-50"
              >
                {submitting ? '申請中...' : '申請加入'}
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full mt-2 px-4 py-2 text-muted text-sm"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
