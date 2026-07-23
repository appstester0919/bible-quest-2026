/* eslint-disable no-undef */

const CACHE_NAME = 'bible-quest-v9' // bump v8→v9: identity-driven background (Uni/High/Prim). Old `/bg.png` cache invalidates.

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/dashboard',
        '/offline',
        '/manifest.json',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ]).catch(() => { /* non-fatal */ })
    )
  )
  self.skipWaiting()
})

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    )
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
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return // let the browser handle it directly
  }

  // Network-first for HTML pages
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline').then((r) => r ?? caches.match('/dashboard') ??
          new Response('Offline — 請連接網絡', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
      )
    )
    return
  }

  // Cache-first for static assets
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/audio/') ||
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
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
      })
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
  try { data = event.data.json() } catch { data = { title: '📖 DuoBible', body: event.data.text() } }

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
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/dashboard'
  event.waitUntil(self.clients.openWindow(url))
})
