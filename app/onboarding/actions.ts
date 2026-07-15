'use server'

import { createClient } from '@/lib/supabase/server'

export type RedesignPlanInput = {
  oldEnrollmentId: string
  scope: 'nt' | 'ot' | 'nt_ot'
  totalDays: number
  startDate: string | null
  ntChapters: number
  otChapters: number
  ntOtOrder: 'parallel' | 'nt_then_ot' | 'ot_then_nt'
  keepProgress: boolean
  // Issue #6: per-testament start position
  ntStartBook: number
  ntStartChapter: number
  otStartBook: number
  otStartChapter: number
}

export async function redesignPlan(input: RedesignPlanInput): Promise<{ error?: string; newEnrollmentId?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: '請先登入' }

    const { scope, totalDays, startDate, ntChapters, otChapters, ntOtOrder, keepProgress, oldEnrollmentId } = input

    // 1. Read old enrollment to determine effective start_date
    const { data: oldEnrollment, error: oldErr } = await supabase
      .from('user_plan_enrollments')
      .select('id, started_at, scope, chapters_per_day, total_days')
      .eq('id', oldEnrollmentId)
      .eq('user_id', user.id)
      .single()

    if (oldErr || !oldEnrollment) {
      return { error: '舊計劃不存在' }
    }

    // 2. Determine started_at
    //    If keepProgress: keep the OLD started_at so day-counter continues
    //    Else: use the new startDate (or today)
    let startedAt: string
    if (keepProgress) {
      startedAt = oldEnrollment.started_at
    } else {
      const d = startDate ? new Date(startDate + 'T00:00:00') : new Date()
      startedAt = d.toISOString()
    }

    // 3. Mark OLD enrollment as 'abandoned' (preserves reading_sessions FK)
    const { error: archiveErr } = await supabase
      .from('user_plan_enrollments')
      .update({ status: 'abandoned' })
      .eq('id', oldEnrollmentId)
      .eq('user_id', user.id)

    if (archiveErr) {
      console.error('[redesignPlan] archive old failed:', archiveErr)
      return { error: `標記舊計劃失敗: ${archiveErr.message}` }
    }

    // 4. Build new enrollment
    let readingOrder: string | null = null
    if (scope === 'nt_ot') {
      // Parallel: "N-OT" format. Sequential: 'nt_then_ot' / 'ot_then_nt'
      readingOrder = ntOtOrder === 'parallel' ? `${ntChapters}-${otChapters}` : ntOtOrder
    }

    const { data: newEnrollment, error: insertErr } = await supabase
      .from('user_plan_enrollments')
      .insert({
        user_id: user.id,
        scope,
        reading_order: readingOrder,
        total_days: totalDays,
        chapters_per_day: ntChapters + otChapters,
        status: 'active',
        started_at: startedAt,
      })
      .select()
      .single()

    if (insertErr) {
      console.error('[redesignPlan] insert new failed:', insertErr)
      // Rollback: restore old enrollment to active
      await supabase
        .from('user_plan_enrollments')
        .update({ status: 'active' })
        .eq('id', oldEnrollmentId)
      return { error: `建立新計劃失敗: ${insertErr.message}` }
    }

    console.log('[redesignPlan] success:', { oldId: oldEnrollmentId, newId: newEnrollment.id, keepProgress })
    return { newEnrollmentId: newEnrollment.id }
  } catch (err) {
    console.error('[redesignPlan] fatal:', err)
    return { error: `系統錯誤: ${String(err)}` }
  }
}

export async function completeOnboarding(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { error: '請先登入' }
    }

    const scope = formData.get('scope') as 'nt' | 'ot' | 'nt_ot'
    const totalDays = parseInt(formData.get('total_days') as string, 10)
    const startDate = formData.get('start_date') as string | null

    // Trust the client-supplied chapters_per_day. For nt_ot this is the sum of
    // NT + OT per day; for nt/ot it's the chapters/day the user picked.
    // (Previously this branch did `Math.ceil(259 / totalDays)` for both NT and OT,
    //  which silently produced wrong values for OT since 929 ≠ 259 — see issue #5.)
    let readingOrder: string | null = null
    if (scope === 'nt_ot') {
      // readingOrder format: "N-OT" e.g. "2-5" → nt=2, ot=5 (parallel),
      // or "nt_then_ot" / "ot_then_nt" (sequential). Only used as a stored hint;
      // planGenerator reads chapters_per_day directly.
      readingOrder = formData.get('reading_order') as string
    }

    // chapters_per_day = the value the client pre-computed and verified on submit.
    const chaptersPerDay = parseInt(formData.get('chapters_per_day') as string, 10)

    console.log('[onboarding] insert', { user_id: user.id, scope, totalDays, chaptersPerDay, readingOrder })

    // Mark any existing active enrollments as 'abandoned' before creating
    // a new one. Otherwise the user can end up with multiple 'active' rows,
    // which breaks downstream .single() queries in dashboard / calendar.
    const { error: archiveError } = await supabase
      .from('user_plan_enrollments')
      .update({ status: 'abandoned' })
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (archiveError) {
      console.error('[onboarding] archive previous active failed:', archiveError)
      // Continue — even if archive fails we still try to insert new row
    }

    const { data: enrollment, error: enrollError } = await supabase
      .from('user_plan_enrollments')
      .insert({
        user_id: user.id,
        scope,
        reading_order: readingOrder, // null for nt/ot; "N-OT" string for nt_ot (e.g. "7-5")
        total_days: totalDays,
        chapters_per_day: chaptersPerDay,
        status: 'active',
        started_at: startDate ? new Date(startDate + 'T00:00:00').toISOString() : new Date().toISOString(),
      })
      .select()
      .single()

    if (enrollError) {
      console.error('[onboarding] enrollment insert failed:', enrollError)
      return { error: `建立計劃失敗: ${enrollError.message}` }
    }

    console.log('[onboarding] enrollment created:', enrollment?.id)

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ onboarding_done: true })
      .eq('id', user.id)

    if (profileError) {
      console.error('[onboarding] profile update failed:', profileError)
      // Don't abort if profile update fails — enrollment succeeded
    }

    return {}
  } catch (err) {
    console.error('[onboarding] fatal:', err)
    return { error: `系統錯誤: ${String(err)}` }
  }
}
