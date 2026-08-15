'use client'

import { useEffect, useMemo, useState } from 'react'
import { sendNudge } from '@/lib/groupActions'
import { pickRandomNudgeSamples, fillNudgeSenderName } from '@/lib/nudgeSamples'

const MAX_RECIPIENTS = 5

interface NudgeMember {
  user_id: string
  display_name: string
  group_id: string
}

interface NudgeDialogProps {
  members: NudgeMember[]
  senderName: string
  onClose: () => void
}

/**
 * v0.5 (2026-08-15) — NudgeDialog: modal for picking recipients + crafting
 * a nudge message and sending it via `sendNudge()`.
 *
 * Layout (Duolingo-style, mobile-first):
 *   - Sticky header (title + close X)
 *   - Scrollable body (recipient picker, sample cards, textarea)
 *   - Sticky footer (send button + hint)
 *
 * Errors from `sendNudge()` are mapped to Cantonese messages by error code.
 */
export function NudgeDialog({ members, senderName, onClose }: NudgeDialogProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // Pre-select first 3 (or fewer if list is smaller). Cap at MAX_RECIPIENTS.
    const initial = members.slice(0, Math.min(3, MAX_RECIPIENTS))
    return new Set(initial.map(m => m.user_id))
  })

  const [samples] = useState<[string, string]>(() => pickRandomNudgeSamples())
  const initialBody = useMemo(
    () => fillNudgeSenderName(samples[0], senderName),
    [samples, senderName]
  )
  const [body, setBody] = useState(initialBody)

  const [sending, setSending] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── Esc-to-close + scroll lock ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, sending])

  // ── Selection toggle ─────────────────────────────────────────────────────
  const toggle = (userId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        if (next.size >= MAX_RECIPIENTS) return prev
        next.add(userId)
      }
      return next
    })
  }

  // ── Sample click → fill body ─────────────────────────────────────────────
  const applySample = (template: string) => {
    setBody(fillNudgeSenderName(template, senderName))
  }

  // ── Send handler ─────────────────────────────────────────────────────────
  const onSend = async () => {
    if (sending) return
    const selectedMembers = members.filter(m => selectedIds.has(m.user_id))
    if (selectedMembers.length === 0) {
      setErrorMsg('請至少選擇 1 位組員')
      return
    }
    if (!body.trim()) {
      setErrorMsg('訊息不能空白')
      return
    }

    setSending(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const result = await sendNudge(selectedMembers, body)
      if (result.ok && result.error === 'all_recipients_disabled') {
        // Edge case: every selected member has receive_nudges=false.
        // Server returns ok=true so sender's quota is NOT charged.
        setErrorMsg(mapErrorToMessage('all_recipients_disabled'))
      } else if (result.ok) {
        // Show enqueued count (= inserted rows), not delivered (= push 2xx),
        // so the user sees the true number of nudges that were recorded.
        const n = result.enqueued ?? selectedMembers.length
        const disabledHint = result.disabled_skipped
          ? `（${result.disabled_skipped} 位已關提醒，已略過）`
          : ''
        setSuccessMsg(`✅ 已發送 ${n} 個提醒${disabledHint}`)
        setTimeout(() => onClose(), 1800)
      } else {
        setErrorMsg(mapErrorToMessage(result.error))
      }
    } catch (err) {
      console.error('[NudgeDialog] sendNudge threw:', err)
      setErrorMsg('⚠️ 發送失敗，請稍後再試')
    } finally {
      setSending(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const selectedCount = selectedIds.size
  const atCap = selectedCount >= MAX_RECIPIENTS
  const canSend = selectedCount > 0 && body.trim().length > 0 && !sending

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center"
      onClick={() => { if (!sending) onClose() }}
    >
      <div
        className="
          bg-white rounded-t-2xl sm:rounded-2xl
          w-full max-w-sm
          max-h-[90vh] flex flex-col
          shadow-2xl
        "
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="提醒組員"
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-extrabold text-[var(--color-primary)] flex items-center gap-2">
            <span>📣</span>
            <span>提醒組員</span>
          </h3>
          <button
            onClick={() => { if (!sending) onClose() }}
            disabled={sending}
            aria-label="關閉"
            className="
              w-9 h-9 rounded-full
              flex items-center justify-center
              bg-gray-100 hover:bg-gray-200
              text-gray-600 font-bold text-lg
              disabled:opacity-50
            "
          >
            ✕
          </button>
        </div>

        {/* ── Body (scrollable) ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Success / Error banner */}
          {successMsg && (
            <div className="rounded-xl p-3 bg-green-50 border-2 border-green-500 text-green-800 text-sm font-bold text-center">
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-xl p-3 bg-red-50 border-2 border-red-500 text-red-700 text-sm font-bold">
              {errorMsg}
            </div>
          )}

          {/* Recipient picker */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-extrabold text-[var(--color-primary)]">
                👥 選擇組員
              </p>
              <span className="text-xs font-bold text-muted">
                {selectedCount}/{MAX_RECIPIENTS}
              </span>
            </div>
            {atCap && (
              <p className="text-xs text-orange-600 font-bold mb-2">
                ⚠️ 已選滿 {MAX_RECIPIENTS} 位
              </p>
            )}
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {members.map(m => {
                const isSelected = selectedIds.has(m.user_id)
                const disabled = !isSelected && atCap
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => toggle(m.user_id)}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    className={`
                      w-full text-left flex items-center justify-between gap-2
                      px-3 py-2.5 rounded-xl border-2 transition-all
                      ${isSelected
                        ? 'bg-green-50 border-green-500 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-green-300'
                      }
                      ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-[0.99]'}
                    `}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                        ${isSelected ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}
                      `}>
                        {isSelected ? '✓' : ' '}
                      </span>
                      <span className="font-bold text-sm truncate">{m.display_name}</span>
                    </span>
                    <span className="text-[10px] text-muted font-mono shrink-0">
                      #{m.group_id.slice(0, 4)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Sample selector */}
          <section>
            <p className="text-sm font-extrabold text-[var(--color-primary)] mb-2">
              💬 訊息範本（點擊套用）
            </p>
            <div className="space-y-2">
              {[samples[0], samples[1]].map((template, i) => {
                const filled = fillNudgeSenderName(template, senderName)
                const isActive = body === filled
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applySample(template)}
                    aria-pressed={isActive}
                    className={`
                      w-full text-left p-3 rounded-xl border-2 transition-all
                      ${isActive
                        ? 'bg-orange-50 border-orange-500 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-orange-300'
                      }
                    `}
                  >
                    <p className="text-xs font-bold text-orange-600 mb-1">
                      範本 {i + 1}
                    </p>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      {filled}
                    </p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Custom message textarea */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-extrabold text-[var(--color-primary)]">
                ✏️ 自訂訊息
              </p>
              <span
                className={`text-xs font-bold ${
                  body.length > 200 ? 'text-red-600' : 'text-muted'
                }`}
              >
                {body.length}/200 字
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={200}
              rows={4}
              placeholder="寫幾句溫馨嘅鼓勵..."
              className="
                w-full px-3 py-2
                border-2 border-gray-200 focus:border-green-500 focus:outline-none
                rounded-xl text-sm leading-relaxed
                resize-none
              "
            />
          </section>
        </div>

        {/* ── Footer (sticky) ─────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-gray-100 shrink-0 bg-white">
          <button
            onClick={onSend}
            disabled={!canSend}
            className="
              w-full px-4 py-3
              bg-green-500 hover:bg-green-600 active:scale-[0.98]
              text-white font-extrabold text-base
              rounded-2xl shadow-lg
              transition-all
              disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
            "
          >
            {sending ? (
              <span>⏳ 發送中...</span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span>📤</span>
                <span>發送提醒 ({selectedCount})</span>
              </span>
            )}
          </button>
          <p className="text-[10px] text-muted text-center mt-1.5">
            每日只可發送一次提醒
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Error message mapper ──────────────────────────────────────────────────
function mapErrorToMessage(error?: string): string {
  switch (error) {
    case 'sender_quota_used':
      return '你今日已發送過提醒喇，明日再嚟！'
    case 'recipient_quota_used':
      return '部分組員今日已收過提醒'
    case 'all_recipients_disabled':
      return '所有組員都關咗提醒'
    case 'no_recipients':
      return '請選擇至少 1 位組員'
    case 'too_many_recipients':
      return '最多只可選 5 位組員'
    case 'empty_message':
      return '訊息不能空白'
    default:
      return error ? `⚠️ ${error}` : '⚠️ 發送失敗，請稍後再試'
  }
}