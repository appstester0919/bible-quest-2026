'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getHKTDateStr(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GroupMember {
  user_id: string
  display_name: string
  role: 'admin' | 'member'
  joined_at: string
  email?: string
}

export interface GroupJoinRequest {
  id: string
  group_id: string
  user_id: string
  display_name: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface GroupWithProgress {
  id: string
  name: string
  invite_code: string
  created_by: string
  created_at: string
  my_role: 'admin' | 'member' | null
  member_count: number
  today_count: number         // signed-in members today
  today_total: number         // total approved members
  today_completed_names: string[]
  last_5_days: Array<{ date: string; rate: number }>  // 0-1 each day
}

export interface PendingRequestInfo {
  request_id: string
  group_id: string
  group_name: string
  display_name: string
  created_at: string
}

// ─── Get logged in user ───────────────────────────────────────────────────────
async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// ─── Create group ─────────────────────────────────────────────────────────────
export async function createGroup(name: string): Promise<{ success: boolean; groupId?: string; inviteCode?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 30) return { success: false, error: '群組名稱必須為 1-30 字' }

  // Get display name from profile
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single()
  const displayName = profile?.display_name?.trim() || '組員'

  // Insert group
  const { data: group, error: groupErr } = await supabase.from('groups').insert({
    name: trimmed,
    created_by: user.id,
  }).select('id, invite_code').single()
  if (groupErr || !group) return { success: false, error: groupErr?.message || '建立失敗' }

  // Auto-insert creator as admin
  const { error: memberErr } = await supabase.from('group_members').insert({
    group_id: group.id,
    user_id: user.id,
    display_name: displayName,
    role: 'admin',
  })
  if (memberErr) {
    // roll back group creation
    await supabase.from('groups').delete().eq('id', group.id)
    return { success: false, error: memberErr.message }
  }

  revalidatePath('/dashboard')
  return { success: true, groupId: group.id, inviteCode: group.invite_code }
}

// ─── Join group (request approval) ────────────────────────────────────────────
export async function requestJoinGroup(inviteCode: string): Promise<{ success: boolean; status?: 'pending' | 'approved'; groupName?: string; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Find group by invite_code
  const { data: group } = await supabase.from('groups').select('id, name').eq('invite_code', inviteCode.trim()).single()
  if (!group) return { success: false, error: '邀請碼無效' }

  // Check existing membership
  const { data: existing } = await supabase.from('group_members').select('user_id').eq('group_id', group.id).eq('user_id', user.id).single()
  if (existing) return { success: false, error: '你已是這個群組的成員' }

  // Check existing pending request
  const { data: pending } = await supabase.from('group_join_requests').select('status').eq('group_id', group.id).eq('user_id', user.id).single()
  if (pending?.status === 'pending') return { success: false, error: '你已申請過，請等待審批' }

  // Get display name from profile
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single()
  const displayName = profile?.display_name?.trim() || '組員'

  // Insert request
  const { error } = await supabase.from('group_join_requests').insert({
    group_id: group.id,
    user_id: user.id,
    display_name: displayName,
    status: 'pending',
  })
  if (error) return { success: false, error: error.message }

  return { success: true, status: 'pending', groupName: group.name }
}

// ─── Approve request (admin only) ────────────────────────────────────────────
export async function approveJoinRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Get request
  const { data: req } = await supabase.from('group_join_requests').select('id, group_id, user_id, display_name, status').eq('id', requestId).single()
  if (!req) return { success: false, error: '申請不存在' }
  if (req.status !== 'pending') return { success: false, error: '已處理過' }

  // Verify user is admin (creator of group)
  const { data: group } = await supabase.from('groups').select('created_by, name').eq('id', req.group_id).single()
  if (!group) return { success: false, error: '群組不存在' }
  if (group.created_by !== user.id) return { success: false, error: '只有組長可以審批' }

  // Check member count limit (30)
  const { count: memberCount } = await supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', req.group_id)
  if ((memberCount ?? 0) >= 30) return { success: false, error: '群組已滿（最多30人）' }

  // Insert member
  const { error: mErr } = await supabase.from('group_members').insert({
    group_id: req.group_id,
    user_id: req.user_id,
    display_name: req.display_name,
    role: 'member',
  })
  if (mErr) return { success: false, error: mErr.message }

  // Update request status
  await supabase.from('group_join_requests').update({ status: 'approved' }).eq('id', requestId)

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Reject request ───────────────────────────────────────────────────────────
export async function rejectJoinRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: req } = await supabase.from('group_join_requests').select('group_id, user_id').eq('id', requestId).single()
  if (!req) return { success: false, error: '申請不存在' }

  const { data: group } = await supabase.from('groups').select('created_by').eq('id', req.group_id).single()
  if (!group || group.created_by !== user.id) return { success: false, error: '只有組長可以審批' }

  // Either update status to rejected, or delete. Use update.
  const { error } = await supabase.from('group_join_requests').update({ status: 'rejected' }).eq('id', requestId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Cancel pending request (self) ───────────────────────────────────────────
export async function cancelJoinRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase.from('group_join_requests').delete().eq('id', requestId).eq('user_id', user.id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Leave group ──────────────────────────────────────────────────────────────
export async function leaveGroup(groupId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: group } = await supabase.from('groups').select('id, created_by, name').eq('id', groupId).single()
  if (!group) return { success: false, error: '群組不存在' }

  // Get current member info
  const { data: member } = await supabase.from('group_members').select('role').eq('group_id', groupId).eq('user_id', user.id).single()
  if (!member) return { success: false, error: '你不在這個群組' }

  // Delete check-ins
  await supabase.from('group_checkins').delete().eq('group_id', groupId).eq('user_id', user.id)

  // Delete membership
  const { error: mErr } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id)
  if (mErr) return { success: false, error: mErr.message }

  // If user was the creator, promote random remaining member (or delete group if empty)
  if (group.created_by === user.id) {
    const { data: remaining } = await supabase.from('group_members').select('user_id').eq('group_id', groupId).limit(1)
    if (remaining && remaining.length > 0) {
      // Promote first remaining member as new admin (random pick — first by joined_at is acceptable here)
      await supabase.from('groups').update({ created_by: remaining[0].user_id }).eq('id', groupId)
      await supabase.from('group_members').update({ role: 'admin' }).eq('group_id', groupId).eq('user_id', remaining[0].user_id)
    } else {
      // No members left — delete the group
      await supabase.from('groups').delete().eq('id', groupId)
    }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Admin remove member ──────────────────────────────────────────────────────
export async function removeMember(groupId: string, memberUserId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: group } = await supabase.from('groups').select('created_by').eq('id', groupId).single()
  if (!group || group.created_by !== user.id) return { success: false, error: '只有組長可以移除組員' }

  // Delete check-ins
  await supabase.from('group_checkins').delete().eq('group_id', groupId).eq('user_id', memberUserId)

  // Delete membership
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', memberUserId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Delete group (admin only) ────────────────────────────────────────────────
export async function deleteGroup(groupId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: group } = await supabase.from('groups').select('created_by').eq('id', groupId).single()
  if (!group || group.created_by !== user.id) return { success: false, error: '只有組長可以刪除群組' }

  // Delete all related records (members + checkins + join requests via CASCADE on groups.id)
  await supabase.from('group_checkins').delete().eq('group_id', groupId)
  await supabase.from('group_join_requests').delete().eq('group_id', groupId)
  await supabase.from('group_members').delete().eq('group_id', groupId)
  const { error } = await supabase.from('groups').delete().eq('id', groupId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Group daily check-in (called when user completes reading) ────────────────
export async function checkInAllMyGroups(dateLocal: string): Promise<{ success: boolean; count?: number; error?: string; debug?: unknown }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  console.log('[checkInAllMyGroups] start', { user_id: user.id, dateLocal })

  // Get all groups user is in
  const { data: memberships, error: memErr } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)

  console.log('[checkInAllMyGroups] memberships result', {
    count: memberships?.length ?? 0,
    memErr: memErr?.message,
    memberships
  })

  if (!memberships || memberships.length === 0) {
    return { success: true, count: 0, debug: 'no memberships found' }
  }

  // Run upserts in parallel for speed
  const upsertPromises = memberships.map(async (m) => {
    try {
      const result = await supabase.from('group_checkins').upsert({
        group_id: m.group_id,
        user_id: user.id,
        date_local: dateLocal,
      }, { onConflict: 'group_id,user_id,date_local' })
      console.log('[checkInAllMyGroups] upsert m=', m.group_id, 'result=', JSON.stringify(result))
      return { ok: !result.error, error: result.error?.message }
    } catch (e) {
      console.error('[checkInAllMyGroups] upsert threw for m=', m.group_id, e instanceof Error ? e.message : String(e))
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const upsertResults = await Promise.all(upsertPromises)
  const count = upsertResults.filter(r => r.ok).length
  console.log('[checkInAllMyGroups] done', { dateLocal, count, total: memberships.length, results: JSON.stringify(upsertResults) })
  return { success: true, count, debug: { memberships, upsertResults } }
}

// ─── Get my groups with progress ──────────────────────────────────────────────
export async function getMyGroups(): Promise<{ groups: GroupWithProgress[]; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { groups: [], error: 'Not authenticated' }

  // Get memberships
  const { data: memberships } = await supabase.from('group_members').select('group_id, role').eq('user_id', user.id)
  if (!memberships || memberships.length === 0) return { groups: [] }

  const groupIds = memberships.map(m => m.group_id)
  const myRoleByGroup = new Map(memberships.map(m => [m.group_id, m.role]))

  // Get groups
  const { data: groups, error: gErr } = await supabase.from('groups').select('id, name, invite_code, created_by, created_at').in('id', groupIds)
  if (gErr || !groups) return { groups: [], error: gErr?.message }

  // Get all members of these groups (approved)
  const { data: allMembers } = await supabase.from('group_members').select('group_id, user_id, display_name, joined_at').in('group_id', groupIds)

  // Get all checkins for last 5 days
  const today = new Date()
  const dates: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getTime() - i * 86400000)
    dates.push(getHKTDateStr(d))
  }
  const todayStr = getHKTDateStr(today)

  const { data: checkins } = await supabase
    .from('group_checkins')
    .select('group_id, user_id, date_local')
    .in('group_id', groupIds)
    .in('date_local', dates)

  // Build progress data
  const membersByGroup = new Map<string, Array<{ user_id: string; display_name: string }>>()
  allMembers?.forEach(m => {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, [])
    membersByGroup.get(m.group_id)!.push({ user_id: m.user_id, display_name: m.display_name })
  })

  const checkinsByGroupDate = new Map<string, Map<string, Set<string>>>() // group -> date -> set of user_ids
  checkins?.forEach(c => {
    if (!checkinsByGroupDate.has(c.group_id)) checkinsByGroupDate.set(c.group_id, new Map())
    const dm = checkinsByGroupDate.get(c.group_id)!
    if (!dm.has(c.date_local)) dm.set(c.date_local, new Set())
    dm.get(c.date_local)!.add(c.user_id)
  })

  const result: GroupWithProgress[] = groups.map(g => {
    const members = membersByGroup.get(g.id) || []
    const dm = checkinsByGroupDate.get(g.id) || new Map()
    const todaySet = dm.get(todayStr) || new Set()

    // Today's completed names
    const todayCompletedNames = members
      .filter(m => todaySet.has(m.user_id))
      .map(m => m.display_name)

    // Last 5 days progress
    const last5 = dates.map(date => {
      const set = dm.get(date) || new Set()
      const rate = members.length > 0 ? set.size / members.length : 0
      return { date, rate }
    }).reverse()  // oldest to newest

    return {
      id: g.id,
      name: g.name,
      invite_code: g.invite_code,
      created_by: g.created_by,
      created_at: g.created_at,
      my_role: myRoleByGroup.get(g.id) as 'admin' | 'member' | null,
      member_count: members.length,
      today_count: todaySet.size,
      today_total: members.length,
      today_completed_names: todayCompletedNames,
      last_5_days: last5,
    }
  })

  return { groups: result }
}

// ─── Get pending requests for groups I admin ─────────────────────────────────
export async function getPendingRequestsForMyAdminGroups(): Promise<PendingRequestInfo[]> {
  const { supabase, user } = await getAuthUser()
  if (!user) return [] 

  // Find groups where I'm creator (admin)
  const { data: adminGroups } = await supabase.from('groups').select('id, name').eq('created_by', user.id)
  if (!adminGroups || adminGroups.length === 0) return []
  const groupById = new Map(adminGroups.map(g => [g.id, g.name]))

  // Find pending requests
  const { data: requests } = await supabase
    .from('group_join_requests')
    .select('id, group_id, display_name, created_at')
    .in('group_id', adminGroups.map(g => g.id))
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (!requests) return []
  return requests.map(r => ({
    request_id: r.id,
    group_id: r.group_id,
    group_name: groupById.get(r.group_id) || '',
    display_name: r.display_name,
    created_at: r.created_at,
  }))
}

// ─── Get my pending join requests ─────────────────────────────────────────────
export async function getMyPendingRequests(): Promise<Array<{ id: string; group_id: string; group_name: string; created_at: string }>> {
  const { supabase, user } = await getAuthUser()
  if (!user) return []

  const { data: requests } = await supabase
    .from('group_join_requests')
    .select('id, group_id, created_at')
    .eq('user_id', user.id)
    .eq('status', 'pending')

  if (!requests) return []

  const groupIds = requests.map(r => r.group_id)
  if (groupIds.length === 0) return []
  const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds)
  const nameById = new Map((groups || []).map(g => [g.id, g.name]))

  return requests.map(r => ({
    id: r.id,
    group_id: r.group_id,
    group_name: nameById.get(r.group_id) || '',
    created_at: r.created_at,
  }))
}

// ─── Get group members (for admin management) ────────────────────────────────
export async function getGroupMembers(groupId: string): Promise<{ success: boolean; members?: GroupMember[]; isAdmin?: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: group } = await supabase.from('groups').select('created_by').eq('id', groupId).single()
  if (!group) return { success: false, error: '群組不存在' }

  const { data: members } = await supabase
    .from('group_members')
    .select('user_id, display_name, role, joined_at')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })

  return {
    success: true,
    members: (members || []) as GroupMember[],
    isAdmin: group.created_by === user.id,
  }
}

// ─── Get group info by invite code (for /join page) ──────────────────────────
export async function getGroupByInviteCode(code: string): Promise<{ success: boolean; group?: { id: string; name: string; member_count: number; preview_members: string[] }; error?: string }> {
  const codeUpper = code.trim()
  const supabase = await createClient()
  const { data: group } = await supabase.from('groups').select('id, name').eq('invite_code', codeUpper).single()
  if (!group) return { success: false, error: '邀請碼無效' }

  const { data: members } = await supabase
    .from('group_members')
    .select('display_name')
    .eq('group_id', group.id)
    .limit(10)  // preview first 10 names

  return {
    success: true,
    group: {
      id: group.id,
      name: group.name,
      member_count: members?.length ?? 0,
      preview_members: (members || []).map(m => m.display_name),
    },
  }
}

// ─── Update display_name on profile ───────────────────────────────────────────
export async function updateDisplayName(name: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 3) return { success: false, error: '顯示名稱必須為 1-3 字' }

  const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
  if (error) return { success: false, error: error.message }

  // Sync to existing group memberships (so display name updates in groups too)
  await supabase.from('group_members').update({ display_name: trimmed }).eq('user_id', user.id)

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true }
}
