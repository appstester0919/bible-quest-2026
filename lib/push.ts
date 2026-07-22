/**
 * Web Push subscription management.
 * Stores subscriptions in localStorage for the SW to use,
 * and syncs to Supabase for the cron to read.
 */

export interface PushSubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface StoredSubscription extends PushSubscriptionJSON {
  userId: string
  createdAt: string
}

const STORAGE_KEY = 'bq_push_subscription'

/** Save subscription to localStorage (SW reads from here) */
export function saveSubscription(sub: PushSubscriptionJSON): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sub))
}

/** Remove subscription from localStorage */
export function removeSubscription(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Read stored subscription */
export function getStoredSubscription(): PushSubscriptionJSON | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * Request push permission and subscribe.
 * Returns the subscription JSON, or null if denied/unavailable.
 */
export async function subscribeToPush(): Promise<PushSubscriptionJSON | null> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return null
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const reg = await navigator.serviceWorker.ready
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vapidKey = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '') as any
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey,
  })

  const json = normalize(sub)
  saveSubscription(json)

  // Sync to Supabase. We write to `web_push_subscriptions` (per-device rows).
  // The reminder schedule columns (reminder_hour / reminder_minute / timezone /
  // enabled_reminder) are populated from localStorage so the cron picks us up.
  // All device rows for a user share the same reminder schedule — the settings
  // UI writes them via upsert with the same values.
  const supabase = (await import('@/lib/supabase/client')).createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const stored = localStorage.getItem('bq_reminder_time') || '20:00'
    const [hour, minute] = stored.split(':').map(Number)
    const { error: upsertError } = await supabase.from('web_push_subscriptions').upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      active: true,
      reminder_hour: hour,
      reminder_minute: minute,
      timezone: 'Asia/Hong_Kong',
      enabled_reminder: true,
    }, { onConflict: 'user_id,endpoint' })
    if (upsertError) {
      console.error('[push.ts] subscribe upsert failed:', upsertError)
      // Don't throw — sub is created locally; surface error to caller via console
    }
  } else {
    console.warn('[push.ts] no authenticated user; skipping Supabase sync')
  }

  return json
}

/**
 * Unsubscribe from push on THIS device only.
 *
 * Important: this only deletes the row matching the current SW push subscription's
 * endpoint. It does NOT delete other devices the user has registered (e.g. a
 * desktop browser + an Android phone each have their own endpoint / DB row).
 * The previous version used `delete().eq('user_id', user.id)` which wiped
 * every device for the user — see the fix in commit describing this.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const stored = getStoredSubscription()
  if (stored) {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub && sub.endpoint === stored.endpoint) {
      await sub.unsubscribe()
    }
    removeSubscription()

    const supabase = (await import('@/lib/supabase/client')).createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Only delete the row matching THIS device's endpoint. Multi-device
      // users (desktop + mobile) keep their other devices' subscriptions.
      await supabase
        .from('web_push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', stored.endpoint)
    }
  }
}

/** Check current permission status */
export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** Normalize PushSubscription to our interface */
function normalize(sub: globalThis.PushSubscription): PushSubscriptionJSON {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  return {
    endpoint: json.endpoint ?? '',
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  }
}
