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

export interface GroupMemberStatus {
  user_id: string
  display_name: string
  completed_today: boolean
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
  /** Per-member status: all members with today's check-in flag. UI can render
   *  "name ✅" for completed, "name ⏳" for not. */
  member_status: GroupMemberStatus[]
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

// The DB enforces group_members.display_name <= 3 chars. Long usernames (e.g.
// 'josephinechan0814') must be truncated to a 3-char nickname before insert.
// Fall back to '組員' when the profile display name is empty.
async function getMemberDisplayName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', userId).single()
  const raw = profile?.display_name?.trim() || '組員'
  return raw.length <= 3 ? raw : raw.slice(0, 3)
}

// ─── Create group ─────────────────────────────────────────────────────────────
export async function createGroup(name: string): Promise<{ success: boolean; groupId?: string; inviteCode?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 30) return { success: false, error: '群組名稱必須為 1-30 字' }

  // Get display name from profile (truncated to <=3 chars per DB constraint).
  const displayName = await getMemberDisplayName(supabase, user.id)

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

  // Check member count limit (30) — don't even allow request if full
  const { count: memberCount } = await supabase
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', group.id)
  if ((memberCount ?? 0) >= 30) return { success: false, error: '群組已滿（最多30人）' }

  // Get display name from profile (truncated to <=3 chars per DB constraint).
  const displayName = await getMemberDisplayName(supabase, user.id)

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

  // ─── Backfill today's check-in if user already completed reading today ─────────
  const today = getHKTDateStr()
  const { data: sessionToday } = await supabase
    .from('reading_sessions')
    .select('id')
    .eq('user_id', req.user_id)
    .eq('date_local', today)
    .limit(1)
    .maybeSingle()
  if (sessionToday) {
    // User already marked reading today → backfill this group with today's check-in
    await supabase.from('group_checkins').upsert({
      group_id: req.group_id,
      user_id: req.user_id,
      date_local: today,
    }, { onConflict: 'group_id,user_id,date_local' })
  }

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

  // If user was the creator, promote a random remaining member (or delete group if empty)
  if (group.created_by === user.id) {
    // Fetch all remaining members and pick one at random
    const { data: remaining } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
    if (remaining && remaining.length > 0) {
      // Random selection from remaining members
      const newAdmin = remaining[Math.floor(Math.random() * remaining.length)]
      await supabase.from('groups').update({ created_by: newAdmin.user_id }).eq('id', groupId)
      await supabase.from('group_members').update({ role: 'admin' }).eq('group_id', groupId).eq('user_id', newAdmin.user_id)
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

  // Revalidate dashboard so group check-in status reflects immediately
  revalidatePath('/dashboard')

  return { success: true, count, debug: { memberships, upsertResults } }
}

// ─── Get my groups with progress ──────────────────────────────────────────────
export async function getMyGroups(): Promise<{ groups: GroupWithProgress[]; error?: string }> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { groups: [], error: 'Not authenticated' }

  // Step 1: get memberships (needed to know which group IDs to query)
  const { data: memberships } = await supabase
    .from('group_members').select('group_id, role').eq('user_id', user.id)
  if (!memberships || memberships.length === 0) return { groups: [] }

  const groupIds = memberships.map(m => m.group_id)
  const myRoleByGroup = new Map(memberships.map(m => [m.group_id, m.role]))

  // Step 2: generate dates (needed for checkins query)
  const today = new Date()
  const dates: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getTime() - i * 86400000)
    dates.push(getHKTDateStr(d))
  }
  const todayStr = getHKTDateStr(today)

  // Step 3: parallel fetch groups + members + checkins
  const [groupsResult, allMembersResult, checkinsResult] = await Promise.all([
    supabase.from('groups').select('id, name, invite_code, created_by, created_at').in('id', groupIds),
    supabase.from('group_members').select('group_id, user_id, display_name, joined_at').in('group_id', groupIds),
    supabase.from('group_checkins').select('group_id, user_id, date_local')
      .in('group_id', groupIds)
      .in('date_local', dates),
  ])

  const { data: groups, error: gErr } = groupsResult
  if (gErr || !groups) return { groups: [], error: gErr?.message }

  const { data: allMembers } = allMembersResult
  const { data: checkins } = checkinsResult

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

    // Today's completed names (kept for backward-compat with existing UI label)
    const todayCompletedNames = members
      .filter(m => todaySet.has(m.user_id))
      .map(m => m.display_name)

    // Full member status: each member + whether they completed today.
    // Allows UI to show "name ✅" / "name ⏳" so group card reflects ALL members.
    const member_status = members.map(m => ({
      user_id: m.user_id,
      display_name: m.display_name,
      completed_today: todaySet.has(m.user_id),
    }))

    // Last 5 days progress — left=oldest day, right=newest (today)
    const last5 = [...dates].reverse().map(date => {
      const set = dm.get(date) || new Set()
      const rate = members.length > 0 ? set.size / members.length : 0
      return { date, rate }
    })

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
      member_status,
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
  const { error: gmErr } = await supabase.from('group_members').update({ display_name: trimmed }).eq('user_id', user.id)
  console.log('[updateDisplayName] group_members sync:', gmErr ?? 'ok')

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Rename group (admin only) ────────────────────────────────────────────────
export async function renameGroup(groupId: string, newName: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const trimmed = newName.trim()
  if (!trimmed || trimmed.length > 30) {
    return { success: false, error: '群組名稱必須為 1-30 字' }
  }

  // Verify the caller is the group creator (admin)
  const { data: group } = await supabase
    .from('groups')
    .select('id, created_by')
    .eq('id', groupId)
    .single()
  if (!group) return { success: false, error: '群組不存在' }
  if (group.created_by !== user.id) {
    return { success: false, error: '只有組長可以更改群組名稱' }
  }

  const { error } = await supabase
    .from('groups')
    .update({ name: trimmed })
    .eq('id', groupId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}

// ─── Group nudge (Duolingo Friend Streak pattern) ────────────────────────────
// v0.3 (2026-08-15). Server actions for the "nudge member who hasn't completed
// today's reading" feature. Spec: ~/.hermes/plans/bible-quest-2026-group-nudge-2026-08-15.md

/** Recipient shape accepted by sendNudge(). Trimmed at the UI boundary. */
interface NudgeRecipient {
  user_id: string
  display_name: string
  group_id: string
}

/** Return shape for sendNudge. */
interface SendNudgeResult {
  ok: boolean
  /** Number of push notifications that returned 2xx (0 if push infra unavailable). */
  delivered?: number
  /** Number of rows actually inserted into group_nudges (= how many recipients got the nudge row). */
  enqueued?: number
  /** Number of recipients skipped because receive_nudges=false (NOT counted toward sender quota). */
  disabled_skipped?: number
  error?: string
  conflictedIds?: string[] // recipients the sender already nudged today
}

/**
 * Internal: has the sender already sent a nudge today (cross-group, 1/day)?
 * Returns the set of recipient_ids the sender has already nudged today.
 */
async function checkSenderQuota(
  supabase: Awaited<ReturnType<typeof createClient>>,
  senderId: string,
  dateLocal: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('group_nudges')
    .select('recipient_id')
    .eq('sender_id', senderId)
    .eq('nudge_date_local', dateLocal)
  return new Set((data || []).map(r => r.recipient_id))
}

/**
 * Internal: filter out recipients the sender has already nudged today.
 * Cross-receiver dedup: if ANY recipient already on the sent list, the sender
 * is blocked entirely (sender's 1/day quota is enforced upstream — see spec).
 * Returns the list of recipient_ids that would conflict.
 */
async function checkRecipientsQuota(
  supabase: Awaited<ReturnType<typeof createClient>>,
  senderId: string,
  recipientIds: string[],
  dateLocal: string
): Promise<string[]> {
  if (recipientIds.length === 0) return []
  const { data } = await supabase
    .from('group_nudges')
    .select('recipient_id')
    .eq('sender_id', senderId)
    .eq('nudge_date_local', dateLocal)
    .in('recipient_id', recipientIds)
  return (data || []).map(r => r.recipient_id)
}

/**
 * Get all members across sender's groups who have NOT completed today's reading
 * (HKT ±4h grace window via reading_sessions.created_at, to avoid the 2026-08-13
 * HKT-midnight bug where a late-night checkin was bucketed as next-day).
 *
 * Dedupe by user_id across groups (a user in multiple groups with the sender
 * appears once; group_id is the first membership found).
 */
export async function getIncompleteGroupMembersToday(): Promise<{
  members: NudgeRecipient[]
  error?: string
}> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { members: [], error: 'Not authenticated' }

  // 1. Sender's groups
  const { data: memberships, error: mErr } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)
  if (mErr) return { members: [], error: mErr.message }
  if (!memberships || memberships.length === 0) return { members: [] }

  const groupIds = memberships.map(m => m.group_id)

  // 2. All members of those groups except self
  const { data: allMembers, error: amErr } = await supabase
    .from('group_members')
    .select('group_id, user_id, display_name')
    .in('group_id', groupIds)
    .neq('user_id', user.id)
  if (amErr) return { members: [], error: amErr.message }
  if (!allMembers || allMembers.length === 0) return { members: [] }

  // 3. Members who completed today's reading — use the group's local date
  //    PLUS a ±4h grace window on reading_sessions.created_at. The grace
  //    window catches late-night checkins around the HKT midnight boundary
  //    that would otherwise be bucketed into the next day.
  const today = getHKTDateStr()

  const otherUserIds = [...new Set(allMembers.map(m => m.user_id))]
  const { data: todayCheckins } = await supabase
    .from('group_checkins')
    .select('user_id')
    .in('user_id', otherUserIds)
    .in('group_id', groupIds)
    .eq('date_local', today)
  const completedToday = new Set((todayCheckins || []).map(c => c.user_id))

  // Belt-and-suspenders: also check reading_sessions with a wide grace window
  // (covers the case where markDayCompleteBatch was called but the group
  // checkin hasn't been rolled up yet, AND the 2026-08-13 CityBUs HKT
  // midnight bug where late-night checkins write date_local=next day).
  // Window: 14h ago → 4h from now. Centered around "did this user read
  // sometime in the last 14 hours?" — covers HKT 23:00 yesterday through
  // HKT 04:00 today even when sender queries at HKT noon.
  const graceStart = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString()
  const graceEnd = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  const { data: recentSessions } = await supabase
    .from('reading_sessions')
    .select('user_id')
    .in('user_id', otherUserIds)
    .gte('created_at', graceStart)
    .lte('created_at', graceEnd)
  const recentUserIds = new Set((recentSessions || []).map(s => s.user_id))

  // 4. Filter & dedupe by user_id (cross-group aggregation). group_id = first
  //    membership found for that user.
  const seen = new Map<string, NudgeRecipient>()
  for (const m of allMembers) {
    if (seen.has(m.user_id)) continue
    if (completedToday.has(m.user_id)) continue
    if (recentUserIds.has(m.user_id)) continue
    seen.set(m.user_id, {
      user_id: m.user_id,
      display_name: m.display_name,
      group_id: m.group_id,
    })
  }

  return { members: [...seen.values()] }
}

/**
 * Send a nudge to up to 5 recipients. Server-side authority for:
 *   - sender 1/day quota (cross-group)
 *   - receiver 1/day per (sender, recipient, date)
 *   - receive_nudges=false filter (BEFORE insert, sender quota not deducted)
 *   - audit (insert group_nudges row)
 *   - push fire-and-forget via /api/push/nudge POST
 *
 * The caller (UI) has already filled [SENDER_NAME] in `messageBody` via
 * fillNudgeSenderName() — we do NOT touch the body here.
 */
export async function sendNudge(
  recipients: NudgeRecipient[],
  messageBody: string
): Promise<SendNudgeResult> {
  const { supabase, user } = await getAuthUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!recipients || recipients.length === 0) {
    return { ok: false, error: 'no_recipients' }
  }
  if (recipients.length > 5) {
    return { ok: false, error: 'too_many_recipients' }
  }
  if (!messageBody || !messageBody.trim()) {
    return { ok: false, error: 'empty_message' }
  }

  const today = getHKTDateStr()
  const trimmedBody = messageBody.trim()

  // ── Sender quota: cross-group 1/day ───────────────────────────────────────
  // Per spec: sender side blocks if ANY recipient already nudged today.
  const alreadySent = await checkSenderQuota(supabase, user.id, today)
  if (alreadySent.size > 0) {
    return { ok: false, error: 'sender_quota_used' }
  }

  // ── Receiver quota: 1/day per (sender, recipient, date) ───────────────────
  const recipientIds = [...new Set(recipients.map(r => r.user_id))]
  const conflictedIds = await checkRecipientsQuota(supabase, user.id, recipientIds, today)
  if (conflictedIds.length > 0) {
    return { ok: false, error: 'recipient_quota_used', conflictedIds }
  }

  // ── Filter out receive_nudges=false BEFORE insert (no sender quota cost) ──
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, receive_nudges')
    .in('id', recipientIds)
  if (pErr) return { ok: false, error: pErr.message }
  const disabled = new Set(
    (profiles || []).filter(p => p.receive_nudges === false).map(p => p.id)
  )
  const enabledRecipients = recipients.filter(r => !disabled.has(r.user_id))
  if (enabledRecipients.length === 0) {
    return {
      ok: true,
      delivered: 0,
      enqueued: 0,
      disabled_skipped: recipientIds.length,
      error: 'all_recipients_disabled',
    }
  }

  // ── Insert group_nudges rows (one per enabled recipient) ───────────────────
  const rows = enabledRecipients.map(r => ({
    sender_id: user.id,
    recipient_id: r.user_id,
    group_id: r.group_id,
    custom_message: trimmedBody,
    message_template: null,
    nudge_date_local: today,
    push_delivered: false,
  }))
  const { data: inserted, error: insErr } = await supabase
    .from('group_nudges')
    .insert(rows)
    .select('id, recipient_id, group_id')
  if (insErr) return { ok: false, error: insErr.message }
  if (!inserted || inserted.length === 0) {
    return { ok: true, delivered: 0, enqueued: 0, disabled_skipped: 0 }
  }

  // ── Fire push via /api/push/nudge (Best-effort, parallel) ─────────────────
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const cronToken = process.env.CRON_RELAY_TOKEN
  let delivered = 0

  if (cronToken) {
    const pushPromises = inserted.map(async (row) => {
      try {
        const res = await fetch(`${baseUrl}/api/push/nudge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cronToken}`,
          },
          body: JSON.stringify({
            nudge_id: row.id,
            recipient_id: row.recipient_id,
            group_id: row.group_id,
            body: trimmedBody,
          }),
        })
        if (res.ok) {
          await supabase
            .from('group_nudges')
            .update({ push_delivered: true })
            .eq('id', row.id)
          return true
        }
        console.warn('[sendNudge] push failed for', row.id, res.status, await res.text().catch(() => ''))
        return false
      } catch (e) {
        console.error('[sendNudge] push threw for', row.id, e instanceof Error ? e.message : String(e))
        return false
      }
    })
    const results = await Promise.all(pushPromises)
    delivered = results.filter(Boolean).length
  } else {
    console.warn('[sendNudge] CRON_RELAY_TOKEN not set; skipping push fan-out (rows persisted for audit)')
  }

  return {
    ok: true,
    delivered,
    enqueued: inserted.length,
    disabled_skipped: disabled.size,
  }
}
