// Beebeeb service worker — offline fallback + streaming download proxy
//
// Office bundle caching (task 1567, web delivery groundwork): the decision
// logic (which paths, which cache name, what's safe to delete) lives in the
// dependency-free public/office-cache-logic.js so it can be unit-tested
// under `bun test` (see test/1567-office-cache-logic.test.ts) — this file
// only wires that logic to the real `caches`/`fetch` APIs. `importScripts`
// is valid here because this is a CLASSIC (non-module) service worker
// script — see the plain `register('/sw.js')` call in src/main.tsx.
// Task 1584: office-cache-logic.js now carries a cache GENERATION in every
// office cache name, so this worker's activate step drops office caches that
// an earlier generation may have filled with double-encoded (br + gzip)
// responses. This comment also changes sw.js's own bytes, so browsers that
// only byte-compare the top-level script still install the update.
importScripts('/office-cache-logic.js')

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

// Determines the office cache to keep on this activation, by asking the
// server for the CURRENT manifest — never assumed, never hard-coded. If the
// office bundle isn't deployed yet (404) or is unreachable, this resolves to
// null, which is correct: an office feature that isn't live yet has no
// "current" version, so every leftover beebeeb-office-* cache is stale and
// safe to garbage-collect (inert-by-default, per this task's brief).
async function currentOfficeCacheName() {
  try {
    const res = await fetch(BBOfficeCacheLogic.OFFICE_MANIFEST_PATH, { cache: 'no-store' })
    if (!res.ok) return null
    const version = BBOfficeCacheLogic.parseManifestVersion(await res.text())
    return BBOfficeCacheLogic.officeCacheName(version)
  } catch {
    return null
  }
}

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keepOfficeCache = await currentOfficeCacheName()

    // Drop old caches — EXCLUDING the office-prefixed ones, which get their
    // own scoped, version-aware cleanup below instead of this blanket sweep.
    // (Pre-existing behavior, unchanged here: this blanket sweep still drops
    // every OTHER non-CACHE cache on each activation, e.g. the page-owned
    // thumbnail cache `beebeeb-thumbnails-v2` opened directly from
    // src/lib/thumbnail.ts — that repopulates on demand and is out of scope
    // for this task.)
    const names = await caches.keys()
    await Promise.all(
      names
        .filter(n => n !== CACHE && n.indexOf(BBOfficeCacheLogic.OFFICE_CACHE_PREFIX) !== 0)
        .map(n => caches.delete(n)),
    )

    // Scoped cleanup: delete every office cache except the current version.
    const staleOfficeCaches = BBOfficeCacheLogic.officeCacheNamesToDelete(names, keepOfficeCache)
    await Promise.all(staleOfficeCaches.map(n => caches.delete(n)))

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

// Cache-first for the immutable, content-hashed office bundle files ONLY.
// Never touches API responses or user documents — isOfficeAssetPath()
// explicitly excludes manifest.json (the small mutable pointer, always
// network) and everything not under /office/<version>/..., and
// isCacheableOfficeResponse() refuses to store anything that isn't a
// successful, same-origin GET (docs/EGRESS.md: zero egress).
async function handleOfficeAssetFetch(request, pathname) {
  const version = BBOfficeCacheLogic.officeVersionFromPath(pathname)
  if (!version) return fetch(request) // isOfficeAssetPath already guarantees this won't happen; stay safe if it ever does.

  const cache = await caches.open(BBOfficeCacheLogic.officeCacheName(version))
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (BBOfficeCacheLogic.isCacheableOfficeResponse(request, response)) {
    // Cache::put consumes the body — clone before returning the original.
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  if (BBOfficeCacheLogic.isOfficeAssetPath(url.pathname)) {
    e.respondWith(handleOfficeAssetFetch(e.request, url.pathname))
    return
  }

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
