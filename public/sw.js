/* eslint-disable no-undef */

const CACHE_NAME = 'bible-quest-v1'

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
          if (response.ok) {
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
  try { data = event.data.json() } catch { data = { title: '📖 Bible Quest', body: event.data.text() } }

  event.waitUntil(
    self.registration.showNotification(data.title ?? '📖 Bible Quest', {
      body: data.body ?? '今日記得讀經！',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'bible-quest',
      renotify: true,
      data: { url: data.url ?? '/dashboard' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/dashboard'
  event.waitUntil(self.clients.openWindow(url))
})
