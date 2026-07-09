'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Generate a partner invite token for the current user.
 */
export async function createPartnerInvite(): Promise<{ token: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Check existing active partner
  const { data: existing } = await supabase
    .from('partner_pairs')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (existing) throw new Error('你已經有讀經夥伴了')

  const { data: invite, error } = await supabase
    .from('partner_invites')
    .insert({ inviter_id: user.id, invitee_email: '' })
    .select('token')
    .single()

  if (error || !invite) throw new Error('建立邀請失敗')
  return { token: invite.token }
}

/**
 * Accept a partner invite by token.
 */
export async function acceptPartnerInvite(token: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: invite } = await supabase
    .from('partner_invites')
    .select('id, inviter_id, status')
    .eq('token', token)
    .single()

  if (!invite) throw new Error('邀請不存在或已過期')
  if (invite.status !== 'pending') throw new Error('邀請已被使用')
  if (invite.inviter_id === user.id) throw new Error('你不能成為自己的夥伴')

  const { data: inviterPair } = await supabase
    .from('partner_pairs')
    .select('id')
    .eq('user_id', invite.inviter_id)
    .eq('status', 'active')
    .single()

  if (inviterPair) throw new Error('對方已經有讀經夥伴了')

  const { data: myPair } = await supabase
    .from('partner_pairs')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (myPair) throw new Error('你已經有讀經夥伴了')

  const { error: pairError } = await supabase.from('partner_pairs').insert([
    { user_id: invite.inviter_id, partner_id: user.id, status: 'active' },
    { user_id: user.id, partner_id: invite.inviter_id, status: 'active' },
  ])

  if (pairError) throw new Error('配對失敗')

  await supabase.from('partner_invites').update({ status: 'accepted' }).eq('token', token)
  return { success: true }
}

/**
 * Get current user's partner info (if any).
 * Returns raw Supabase response — caller transforms as needed.
 */
export async function getPartnerInfo(): Promise<{
  partner_id: string
  paired_at: string
  partner: { id: string; display_name: string | null; avatar_url: string | null } | null
  partner_stats: { current_streak: number; longest_streak: number; last_completed_date: string | null; total_xp: number; level: number } | null
} | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pair } = await supabase
    .from('partner_pairs')
    .select(`
      partner_id,
      paired_at,
      partner:profiles!partner_id(id, display_name, avatar_url),
      partner_stats:user_stats!partner_id(current_streak, longest_streak, last_completed_date, total_xp, level)
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!pair) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = pair as any
  return {
    partner_id: pair.partner_id,
    paired_at: pair.paired_at,
    partner: Array.isArray(raw.partner) ? raw.partner[0] ?? null : raw.partner ?? null,
    partner_stats: Array.isArray(raw.partner_stats) ? raw.partner_stats[0] ?? null : raw.partner_stats ?? null,
  }
}
