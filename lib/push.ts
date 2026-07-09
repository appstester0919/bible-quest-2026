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

  // Sync to Supabase
  const supabase = (await import('@/lib/supabase/client')).createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    })
  }

  return json
}

/**
 * Unsubscribe from push.
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
      await supabase.from('push_subscriptions').delete().eq('user_id', user.id)
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
