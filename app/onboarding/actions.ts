'use server'

import { createClient } from '@/lib/supabase/server'

export async function completeOnboarding(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { error: '請先登入' }
    }

    const scope = formData.get('scope') as 'nt' | 'ot' | 'nt_ot'
    const readingOrder = formData.get('reading_order') as string | null
    const totalDays = parseInt(formData.get('total_days') as string, 10)
    const startDate = formData.get('start_date') as string | null

    const scopeChapters = { nt: 260, ot: 929, nt_ot: 1189 }
    const chaptersPerDay = Math.ceil(scopeChapters[scope] / totalDays)

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
        reading_order: readingOrder || null,
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
