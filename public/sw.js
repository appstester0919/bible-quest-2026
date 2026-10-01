/* eslint-disable no-undef */

const CACHE_NAME = 'bible-quest-v43' // bump v42 -> v43 (2026-10-01, TTS Round-21): 輦→連 substitution (38th TTS_CHAR_MAP entry, 車輦 chariot — 輦 is NoAudioReceived on both zh-HK voices) + regenerated 詩68, 詩104, 賽66. Audio bytes changed, so a stale cache would serve the old silent-輦 mp3s. // bump v41 -> v42 (2026-10-01): mobile UI batch on /read — audio bar rebuilt (3 grouped clusters, 40px circular play with no square chrome, 32px secondary controls), verse-area line efficiency 76%->84% (page 6px + card 10px + 1.15em number gutter), book-grid cells 0.8->1.1rem and chapter cells 0.88->1.05rem, selector dropdowns 0.95->1.05rem, and a bottom-nav scroll debounce (16px/2-event direction test + 900ms show-hold) so the bar stops flickering while the read page prepends chapters. ALL of it is /_next/static/ CSS/JS, and this SW serves static cache-first, so without this bump an installed PWA sees NONE of it. // bump v40 -> v41 (2026-10-01): mobile ergonomics batch on the /read page — two-row audio bar with >=44px touch targets, and pinch-zoom re-enabled in app/layout.tsx (removed maximumScale:1 + userScalable:false, a WCAG 1.4.4 regression). Both are /_next/static/ changes, so without this bump an installed PWA would keep serving the v40 chunks and see NONE of it — the exact failure this file's own history records (4 deploys, 4 source fixes, 0 effect until the name moved). // bump v39 -> v40 (2026-09-29): CRITICAL FIX. The SW caches /_next/static/ cache-first, so EVERY CSS/JS change since v39 was invisible to installed PWAs — the weekly-discipline emoji fixes in 8a312b3/4f07666/35ba8de/6556364/a8f7518 all shipped to the CDN but installed clients kept serving the v39-cached stylesheet. Any change under /_next/static/ MUST bump this constant; source-level CSS edits are NOT enough. Verified the lesson the hard way: 4 deploys, 4 source fixes, 0 effect on device until the cache name moved. // bump v38→v39 (2026-09-28): perf batch #5. Audio caching stays cache-first (offline listening is a product feature) but is now BOUNDED + self-healing: MAX_AUDIO_ENTRIES caps the chapter count and the oldest-inserted entries are evicted to make room, so a 1.5 GB /audio/ tree can no longer thrash the phone's storage quota. Also still covers v38's cache-first /bible-data.json + immutable Cache-Control, #1 /read shared corpus cache, #3 middleware static-asset bypass, #4 audio preload + next-chapter prefetch. IMPORTANT: any future deliberate bible-data.json change MUST bump this CACHE_NAME or clients keep the stale corpus.

// Hard cap on cached audio chapters. public/audio/ holds 1189 mp3s totalling
// 1.51 GB (measured: mean 1.30 MB/chapter, median 1.19 MB, p90 2.17 MB,
// max 6.4 MB). Caching the whole tree is not viable on mobile. 120 entries ×
// 1.30 MB mean ≈ 156 MB, which leaves comfortable headroom inside a typical
// phone's storage budget while still covering ~10% of the corpus — a typical
// user reads 1-2 chapters/day, so 120 entries is weeks of offline audio.
const MAX_AUDIO_ENTRIES = 120

// ─── Bounded, self-healing audio cache ───────────────────────────────────────
// Audio is a /audio/*.mp3 request. `cache.put()` overwrites the stored response
// but the Cache API preserves INSERTION ORDER across both `put()` (append) and
// `put()` on an existing key (position unchanged), so `await cache.keys()` —
// which resolves in insertion order — is a valid FIFO eviction queue. Oldest
// first = evict from the front; the entry we are about to write is always at
// the back, so it can never evict itself.
//
// Evicting is best-effort: any failure is swallowed, because the only thing
// we lose is offline audio for old chapters — never the live response.
async function evictOldestAudio(cache, toRemove) {
  if (toRemove <= 0) return
  try {
    // Evict ONLY audio. `cache.keys()` spans every asset class in this bucket
    // (js/css/icons/bible-data.json/mp3), so deleting its first N entries
    // blindly would evict PWA icons and the 4.2 MB corpus while only audio is
    // over budget. Filter to audio first, then take the oldest N of those —
    // insertion order is preserved, so this is FIFO.
    const audioKeys = (await cache.keys()).filter(
      (k) => k.url.includes('/audio/') || k.url.endsWith('.mp3'),
    )
    for (let i = 0; i < toRemove && i < audioKeys.length; i++) {
      try {
        await cache.delete(audioKeys[i])
      } catch {
        /* single delete failed — keep going, we still want to free space */
      }
    }
  } catch {
    /* cache.keys() failed — skip eviction, the put() below still tries */
  }
}

// Store a response in the cache, keeping the audio bucket under
// MAX_AUDIO_ENTRIES. Only audio is bounded; every other asset type is small
// and static. On QuotaExceededError we evict a batch and retry ONCE, and if it
// still fails we give up silently — the response has already been handed to
// the browser by the caller, so playback is never broken by a full cache.
async function cacheWithAudioCap(cache, request, response) {
  const isAudio =
    request.url.includes('/audio/') || request.url.endsWith('.mp3')

  try {
    if (isAudio) {
      const audioCount = (await cache.keys()).filter(
        (k) => k.url.includes('/audio/') || k.url.endsWith('.mp3'),
      ).length
      // +1 for the entry about to be inserted.
      await evictOldestAudio(
        cache,
        audioCount + 1 > MAX_AUDIO_ENTRIES
          ? audioCount + 1 - MAX_AUDIO_ENTRIES
          : 0,
      )
    }

    await cache.put(request, response)
  } catch {
    // QuotaExceededError (or a transient Cache failure). Free a batch of the
    // oldest audio and retry exactly once.
    try {
      if (isAudio) {
        const audioCount = (await cache.keys()).filter(
          (k) => k.url.includes('/audio/') || k.url.endsWith('.mp3'),
        ).length
        await evictOldestAudio(cache, Math.max(audioCount, 1))
      }
      await cache.put(request, response)
    } catch {
      // Still failing — drop it. The caller returns the network response
      // regardless, so the user still hears the chapter; only offline replay
      // of this one file is lost.
    }
  }
}

// v24 added /vendor/ bypass, but a new SW only takes control after all old
// clients close — so users with the page already open kept hitting the v23
// cache-first .js rule and "Failed to fetch" persisted. Round-12 forces
// immediate activation + claim so the bypass rule runs on next request.
// TTS_CHAR_MAP note: v23 added 鉈→陀 for zh-HK SILENT fix. v28 added 賚→萊 (proper name 施提賚/亞第賚 in 代上 27:29).

// ─── Install ──────────────────────────────────────────────────────────────────
// Round-12: skipWaiting() forces the new SW to move into 'activating' state
// without waiting for all old clients to close. This is required for the
// /vendor/ bypass (added v24) to take effect on currently-open pages —
// otherwise users see the stale v23 SW intercept /vendor/html-to-image.js
// and "Failed to fetch" persists after deploy.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache
        .addAll([
          '/',
          '/dashboard',
          '/offline',
          '/manifest.json',
          '/icons/icon-192.png',
          '/icons/icon-512.png',
        ])
        .catch(() => {
          /* non-fatal */
        }),
    ),
  )
  self.skipWaiting()
})

// ─── Activate ─────────────────────────────────────────────────────────────────
// Round-12: clients.claim() makes this SW the controller for all open pages
// immediately after activation — no reload required. Pairs with skipWaiting()
// above so the /vendor/ bypass (v24) takes effect on the very next fetch
// from any already-open tab. We also delete any stale cache (v23, v24, etc.)
// so old /vendor/html-to-image.js responses cannot leak back via the default
// network-fallback path.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  )
  self.clients.claim()
})

// ─── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  if (url.protocol === 'chrome-extension:') return

  // Bypass cross-origin font requests (CSP connect-src issues with SW fetch)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    return // let the browser handle it directly
  }

  // Bypass /vendor/* — always network (Round-11, 2026-08-28).
  // Reason: /vendor/html-to-image.js is a pinned third-party UMD loaded via
  // <script src>. The SW cache-first .js rule below would otherwise cache
  // the first response indefinitely, blocking future UMD version bumps
  // (same URL, new bytes) and risking stale code serving after deploys.
  // /vendor/* is small, cacheable at the HTTP layer by the browser, and
  // not performance-critical for cold-load.
  if (url.pathname.startsWith('/vendor/')) {
    return // let the browser handle it directly
  }

  // Network-first for HTML pages
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline').then(
          (r) =>
            r ??
            caches.match('/dashboard') ??
            new Response('Offline — 請連接網絡', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }),
        ),
      ),
    )
    return
  }

  // Cache-first for static assets
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/audio/') ||
    url.pathname === '/bible-data.json' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.mp3')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          // Skip 206 Partial Content — Cache API rejects partial responses.
          // Audio range requests (e.g. HTML5 audio seek) return 206, which we
          // cannot cache; let the browser consume the streamed bytes directly.
          if (response.ok && response.status !== 206) {
            const clone = response.clone()
            // Background write — never awaited here, so a slow/failing cache
            // op can't delay the response. Audio writes go through
            // cacheWithAudioCap(), which keeps the bucket bounded; everything
            // else is small enough to store as-is.
            caches
              .open(CACHE_NAME)
              .then((cache) => cacheWithAudioCap(cache, request, clone))
          }
          return response
        })
      }),
    )
    return
  }

  // Default: network with fallback
  event.respondWith(fetch(request).catch(() => caches.match(request)))
})

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: '📖 DuoBible', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? '📖 DuoBible', {
      body: data.body ?? '今日記得讀經！',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Use a unique tag per push so Android does NOT silently dedupe.
      // tag stays "bible-quest" if we ever want to replace — but include
      // timestamp so each new notification creates a fresh one and triggers
      // sound + vibration (renotify: true alone doesn't help on Android).
      tag: `bible-quest-${Date.now()}`,
      renotify: true,
      requireInteraction: false,
      // Android sometimes silently suppresses pushes that lack a vibration
      // pattern. The 300ms-on / 200ms-off / 300ms-on triple is the standard
      // "ping" pattern that survives doze mode and Do Not Disturb (when the
      // user has explicitly enabled reminders). Length kept short so it's
      // polite for frequent reminders.
      vibrate: [300, 200, 300],
      // Visibility 'public' means the notification body shows on lock screen
      // even when the device is locked — required for a reminder app to be
      // useful when the user is away from the device.
      visibility: 'public',
      // Android: also include 'silent: false' explicitly to override any
      // channel-level silent default that some Android OEMs add.
      silent: false,
      data: { url: data.url ?? '/dashboard' },
      actions: [
        { action: 'open', title: '📖 開啟讀經' },
        { action: 'dismiss', title: '稍後再說' },
      ],
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/dashboard'
  event.waitUntil(self.clients.openWindow(url))
})
