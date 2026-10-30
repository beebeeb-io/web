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
// LD-0001 PR-B: media-stream-logic.js holds the /sw-stream/ range responder's
// pure decisions (range parse, M4 headers, the request filter, the claim
// check); this file only wires them to clients, ports and ReadableStreams.
// That route is checked BEFORE office or any caching, and it never touches
// Cache Storage (contract §6 M4). This line also changes sw.js's bytes again
// so browsers pick the update up.
importScripts('/office-cache-logic.js')
importScripts('/media-stream-logic.js')

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

// ── LD-0001 PR-B: /sw-stream/ media streaming ───────────────────────────────
//
// The page owns the keys and the plaintext; this worker is a stateless byte
// relay (contract §2.1). A registry entry is created by 'register-stream'
// from the page and holds the MessagePort that answers `pull` with `data`.
// Nothing on this path writes to Cache Storage, and a navigation to
// /sw-stream/ is never answered here (it falls through to the navigation
// handler below).
const streams = BBMediaStreamLogic.createRegistry()

// Claim waiters, keyed by the sha256 the worker asked every window for.
const streamClaims = new Map()

let streamRequestSeq = 0

const streamClock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
}

function bindStreamPort(entry) {
  entry.requests = entry.requests || new Map()
  const port = entry.port
  port.addEventListener('message', (event) => onStreamPortMessage(entry.id, event.data))
  if (typeof port.start === 'function') port.start()
}

function registerStream(entry) {
  bindStreamPort(entry)
  entry.lastActivityAt = Date.now()
  streams.register(entry)
}

function finishStreamRequest(entry, reqId, controller, error) {
  const request = entry.requests && entry.requests.get(reqId)
  if (request) {
    request.timer.stop()
    entry.requests.delete(reqId)
    request.resolve = null
    request.reject = null
  }
  try {
    if (error) controller.error(error)
  } catch {
    // The stream is already closed/errored.
  }
}

/** One open response. It owns its offset, its silence timer and no plaintext. */
function createStreamBody(entry, start, end) {
  const reqId = `s${++streamRequestSeq}`
  let offset = start
  let done = false

  return new ReadableStream({
    start(controller) {
      const request = { controller, resolve: null, reject: null, timer: null }
      request.timer = BBMediaStreamLogic.createSilenceTimer(streamClock, () => {
        // A10: 30 s without data/progress errors this response and drops it.
        finishStreamRequest(entry, reqId, controller, new Error('stream timed out'))
      })
      entry.requests.set(reqId, request)
      entry.port.postMessage({ type: 'open-range', reqId, start, end })
    },
    async pull(controller) {
      if (done || !entry.requests || !entry.requests.has(reqId)) return
      if (offset > end) {
        done = true
        entry.requests.get(reqId).timer.stop()
        entry.requests.delete(reqId)
        controller.close()
        return
      }
      const max = Math.min(BBMediaStreamLogic.MAX_MESSAGE_BYTES, end - offset + 1)
      const expected = offset
      let reply
      try {
        reply = await pullFromPage(entry, reqId, offset, max)
      } catch (err) {
        finishStreamRequest(entry, reqId, controller, new Error('stream failed'))
        return
      }
      if (done || !entry.requests || !entry.requests.has(reqId)) return
      const bytes = reply && reply.bytes instanceof ArrayBuffer ? new Uint8Array(reply.bytes) : null
      if (
        !reply ||
        !bytes ||
        !BBMediaStreamLogic.continuityOk(expected, reply.offset, bytes.byteLength)
      ) {
        // A19: a gap is an error, never a short 206.
        finishStreamRequest(entry, reqId, controller, new Error('stream offset gap'))
        return
      }
      controller.enqueue(bytes)
      offset += bytes.byteLength
      if (offset > end) {
        done = true
        entry.requests.get(reqId).timer.stop()
        entry.requests.delete(reqId)
        controller.close()
      }
    },
    cancel() {
      done = true
      entry.port.postMessage({ type: 'cancel', reqId })
      const request = entry.requests && entry.requests.get(reqId)
      if (request) {
        request.timer.stop()
        entry.requests.delete(reqId)
      }
    },
  })
}

function pullFromPage(entry, reqId, offset, max) {
  return new Promise((resolve, reject) => {
    const request = entry.requests && entry.requests.get(reqId)
    if (!request) {
      reject(new Error('stream closed'))
      return
    }
    request.resolve = resolve
    request.reject = reject
    entry.port.postMessage({ type: 'pull', reqId, offset, max })
  })
}

function onStreamPortMessage(id, data) {
  const entry = streams.get(id)
  if (!entry || !data || typeof data !== 'object') return
  const request = entry.requests && entry.requests.get(data.reqId)
  if (data.type === 'progress') {
    // A live download is alive: touch the silence timer without a byte (A10).
    if (request) request.timer.touch()
    return
  }
  if (!request) return
  if (data.type === 'data') {
    request.timer.touch()
    const resolve = request.resolve
    request.resolve = null
    request.reject = null
    if (resolve) resolve(data)
    return
  }
  if (data.type === 'data-error') {
    const reject = request.reject
    request.resolve = null
    request.reject = null
    if (reject) reject(new Error('stream failed'))
  }
}

function closeStream(id) {
  const entry = streams.get(id)
  if (!entry) return
  for (const request of entry.requests ? entry.requests.values() : []) {
    request.timer.stop()
    try {
      request.controller.error(new Error('stream closed'))
    } catch {
      // Already errored/closed.
    }
  }
  if (entry.requests) entry.requests.clear()
  streams.remove(id)
  try {
    entry.port.close()
  } catch {
    // Already closed.
  }
}

/** Ask the owning window to re-register. It must hash to `hash` (A27). */
async function claimStream(hash, clientId) {
  let clients
  try {
    clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  } catch {
    return null
  }
  const targets = clients.filter((client) => !clientId || client.id === clientId)
  if (!targets.length) return null

  const answer = new Promise((resolve) => {
    streamClaims.set(hash, resolve)
    setTimeout(() => {
      if (streamClaims.has(hash)) {
        streamClaims.delete(hash)
        resolve(null)
      }
    }, BBMediaStreamLogic.CLAIM_WAIT_MS)
  })
  for (const client of targets) client.postMessage({ type: 'stream-claim', hash })
  return await answer
}

// The route itself is pure (media-stream-logic.js). `cacheStore` is passed so
// the test can prove this path never opens or writes Cache Storage.
const streamRoute = BBMediaStreamLogic.createStreamRoute({
  registry: streams,
  clock: streamClock,
  claim: claimStream,
  createBody: createStreamBody,
  cacheStore: caches,
})

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

  if (data.type === 'register-stream') {
    const { id, mime, size, port } = data
    if (!id || !port) return
    registerStream({
      id,
      mime,
      size,
      port,
      clientId: (e.source && e.source.id) || '',
      requests: new Map(),
      lastActivityAt: Date.now(),
    })
    return
  }

  if (data.type === 'close-stream') {
    closeStream(data.id)
    return
  }

  if (data.type === 'stream-claim-reply') {
    const waiter = streamClaims.get(data.hash)
    if (!waiter) return
    streamClaims.delete(data.hash)
    if (!data.port) {
      waiter(null)
      return
    }
    const entry = {
      id: data.id,
      mime: data.mime,
      size: data.size,
      port: data.port,
      clientId: (e.source && e.source.id) || '',
      requests: new Map(),
      lastActivityAt: Date.now(),
    }
    bindStreamPort(entry)
    // The route applies claimAccepted() (hash + source.id) before it serves.
    waiter(entry)
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

  // LD-0001 PR-B: the stream route is checked BEFORE office or any caching.
  // route() is synchronous: for a navigation (or a non-stream path) it returns
  // null, so no respondWith happens and no registry lookup either — the
  // request falls through to the navigation handler at the bottom.
  const stream = streamRoute(e.request, e.clientId)
  if (stream) {
    e.respondWith(
      stream.response.catch(() =>
        new Response('Stream not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
      ),
    )
    return
  }

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
