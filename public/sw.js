// Beebeeb service worker — offline fallback + streaming download proxy
const CACHE = 'beebeeb-v2'
const OFFLINE_URL = '/offline.html'

// Per-download registry. Key: download ID (UUID string). Value:
//   { stream, filename, mimeType, totalSize, registeredAt }
// Entries are created by 'register-download' messages from the page,
// and consumed (deleted) when the matching fetch event resolves.
const downloads = new Map()

// Stale download cleanup: a download is dropped if the page never opens
// the URL within this window. Avoids leaking ReadableStreams.
const DOWNLOAD_TTL_MS = 60_000

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([OFFLINE_URL]))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Drop old caches
    const names = await caches.keys()
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', e => {
  const data = e.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'register-download') {
    const { id, filename, mimeType, totalSize, stream } = data
    if (!id || !stream) {
      e.source && e.source.postMessage({ type: 'download-error', id, error: 'invalid payload' })
      return
    }
    downloads.set(id, {
      stream,
      filename: typeof filename === 'string' ? filename : 'download',
      mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'application/octet-stream',
      totalSize: typeof totalSize === 'number' && totalSize > 0 ? totalSize : null,
      registeredAt: Date.now(),
    })
    // Schedule a TTL cleanup; if the URL is never opened, drop the stream.
    setTimeout(() => {
      const entry = downloads.get(id)
      if (entry && entry.registeredAt + DOWNLOAD_TTL_MS <= Date.now()) {
        downloads.delete(id)
        try { entry.stream.cancel('timeout') } catch {}
      }
    }, DOWNLOAD_TTL_MS + 100)
    // Acknowledge so the page knows it's safe to navigate to the URL.
    e.source && e.source.postMessage({ type: 'download-registered', id })
    return
  }

  if (data.type === 'abort-download') {
    const { id } = data
    const entry = downloads.get(id)
    if (entry) {
      downloads.delete(id)
      try { entry.stream.cancel('aborted') } catch {}
    }
    return
  }

  if (data.type === 'ping') {
    e.source && e.source.postMessage({ type: 'pong' })
    return
  }
})

// RFC 5987 / 6266 — encode UTF-8 filenames safely for Content-Disposition.
function encodeContentDispositionFilename(name) {
  // ASCII fallback strips non-ASCII; we still send filename* which modern
  // browsers honour. The fallback uses quoted-printable-ish substitution.
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Streaming download interception.
  if (url.pathname.startsWith('/sw-download/')) {
    const id = url.pathname.slice('/sw-download/'.length)
    const entry = downloads.get(id)
    if (!entry) {
      // Either expired, never registered, or already consumed.
      e.respondWith(new Response('Download not found or expired', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))
      return
    }
    downloads.delete(id)

    const headers = new Headers({
      'Content-Type': entry.mimeType,
      'Content-Disposition': encodeContentDispositionFilename(entry.filename),
      // Prevent caches / extensions from re-using this URL.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    if (entry.totalSize != null) {
      headers.set('Content-Length', String(entry.totalSize))
    }
    e.respondWith(new Response(entry.stream, { status: 200, headers }))
    return
  }

  // Navigation offline fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(OFFLINE_URL))
    )
  }
})
