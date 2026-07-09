'use server'

import { createClient } from '@/lib/supabase/server'

export async function completeOnboarding(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '請先登入' }
  }

  const scope = formData.get('scope') as 'nt' | 'ot' | 'nt_ot'
  const readingOrder = formData.get('reading_order') as string | null
  const totalDays = parseInt(formData.get('total_days') as string, 10)

  const scopeChapters = { nt: 260, ot: 929, nt_ot: 1189 }
  const chaptersPerDay = Math.ceil(scopeChapters[scope] / totalDays)

  const { error: enrollError } = await supabase
    .from('user_plan_enrollments')
    .insert({
      user_id: user.id,
      scope,
      reading_order: readingOrder || null,
      total_days: totalDays,
      chapters_per_day: chaptersPerDay,
      status: 'active',
    })

  if (enrollError) {
    return { error: enrollError.message }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ onboarding_done: true })
    .eq('id', user.id)

  if (profileError) {
    return { error: profileError.message }
  }

  return {}
}
