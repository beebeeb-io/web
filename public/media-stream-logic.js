// media-stream-logic.js — pure decision logic for the LD-0001 `/sw-stream/`
// range responder (contract §2.1, §6 M4, §9 A8/A10/A21/A23/A24/A27).
//
// Deliberately dependency-free: no `self`, `caches` or `fetch` reference in any
// of the decision paths. That is what makes it unit-testable under `bun test`
// (see test/ld-0001-media-stream-sw.test.ts) AND loadable from the real
// service worker via `importScripts()` (classic, non-module SW script — see
// sw.js). The one thing it cannot own is the byte body: the route takes a
// `createBody(entry, start, end)` from the worker, which is where the page's
// MessagePort lives.
//
// Dual-mode export: CommonJS (`module.exports`) when required from a test
// runner, or `self.BBMediaStreamLogic` when loaded via `importScripts`. No
// build step touches this file — it is served byte-for-byte from `public/`.
;(function (root) {
  var STREAM_PATH_PREFIX = '/sw-stream/'
  /** A stream response with no `data`/`progress` for this long is errored (§3). */
  var SILENCE_TIMEOUT_MS = 30000
  /** How long the worker waits for the owner to answer a claim (§2.1). */
  var CLAIM_WAIT_MS = 2000
  /** At most this many plaintext bytes per `data` message (§3). */
  var MAX_MESSAGE_BYTES = 1024 * 1024
  /** The ONLY registered MIME types that may be echoed (A24). */
  var MIME_PATTERN = /^(video|audio)\/[a-z0-9.+-]+$/
  var SANDBOX_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'"
  var OCTET_STREAM = 'application/octet-stream'
  var STREAM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/

  /**
   * The id of a `/sw-stream/{id}` request path, or null. The id is opaque to
   * this module: it never contains a slash or a query.
   */
  function streamIdFromPath(pathname) {
    if (typeof pathname !== 'string') return null
    if (pathname.indexOf(STREAM_PATH_PREFIX) !== 0) return null
    var id = pathname.slice(STREAM_PATH_PREFIX.length)
    return STREAM_ID_PATTERN.test(id) ? id : null
  }

  /**
   * §2.1 request filter. A navigation is NEVER handled; the destination must
   * be video or audio; the requesting client must BE the registrant. An empty
   * client id is refused (B3): it never skips the owner check. `entry` is the
   * registered (or claimed) stream, or null.
   */
  function shouldHandleStreamRequest(request, clientId, entry) {
    if (!request) return false
    if (request.mode === 'navigate') return false
    if (request.destination !== 'video' && request.destination !== 'audio') return false
    if (!clientId) return false
    if (!entry || !entry.clientId || entry.clientId !== clientId) return false
    return true
  }

  var RANGE_SPEC = /^\s*(\d*)-(\d*)\s*$/

  /**
   * What a `Range` header asks for, against `total` (B9):
   *  - { kind: 'range', start, end }: one satisfiable byte range. `bytes=a-b`
   *    and `bytes=a-` are inclusive, `bytes=-n` is the last n bytes, and an
   *    end past the end is clamped;
   *  - { kind: 'multi' }: more than one well-formed range. Refused with 416,
   *    never served as its first range;
   *  - { kind: 'unsatisfiable' }: one well-formed range that cannot be served
   *    (`bytes=-0`, start > end, start >= total). 416;
   *  - { kind: 'ignore' }: not a well-formed `bytes=` range at all. The header
   *    is ignored and the whole body is served (200), as RFC 9110 allows.
   */
  function classifyRange(header, total) {
    if (typeof header !== 'string') return { kind: 'ignore' }
    var match = /^\s*bytes\s*=(.+)$/i.exec(header)
    if (!match) return { kind: 'ignore' }
    var specs = match[1].split(',')
    for (var i = 0; i < specs.length; i++) {
      var each = RANGE_SPEC.exec(specs[i])
      if (!each || (each[1] === '' && each[2] === '')) return { kind: 'ignore' }
    }
    if (specs.length > 1) return { kind: 'multi' }
    var parts = RANGE_SPEC.exec(specs[0])
    var rawStart = parts[1]
    var rawEnd = parts[2]
    if (!Number.isFinite(total) || total <= 0) return { kind: 'unsatisfiable' }
    if (rawStart === '') {
      var suffix = parseInt(rawEnd, 10)
      if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
      return { kind: 'range', start: Math.max(0, total - suffix), end: total - 1 }
    }
    var from = parseInt(rawStart, 10)
    if (!Number.isFinite(from) || from >= total) return { kind: 'unsatisfiable' }
    if (rawEnd === '') return { kind: 'range', start: from, end: total - 1 }
    var to = parseInt(rawEnd, 10)
    if (!Number.isFinite(to) || to < from) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: from, end: Math.min(to, total - 1) }
  }

  /** The satisfiable single range of a `Range` header, or null (see classifyRange). */
  function parseRange(header, total) {
    var range = classifyRange(header, total)
    return range.kind === 'range' ? { start: range.start, end: range.end } : null
  }

  /** `Content-Type` for a registered MIME, or octet-stream (A24). */
  function contentTypeFor(registeredMime) {
    if (typeof registeredMime !== 'string') return OCTET_STREAM
    return MIME_PATTERN.test(registeredMime) ? registeredMime : OCTET_STREAM
  }

  /**
   * The exact M4 response headers. `status` is 200 (no Range), 206 (a range)
   * or 416 (unsatisfiable). Nothing here is cacheable.
   */
  function responseHeaders(opts) {
    var status = opts.status
    var total = opts.total
    var headers = {
      'Content-Type': contentTypeFor(opts.mime),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': SANDBOX_CSP,
      'Accept-Ranges': 'bytes',
    }
    if (status === 416) {
      headers['Content-Range'] = 'bytes */' + total
      headers['Content-Length'] = '0'
      return headers
    }
    if (status === 206) {
      headers['Content-Range'] = 'bytes ' + opts.start + '-' + opts.end + '/' + total
      headers['Content-Length'] = String(opts.end - opts.start + 1)
      return headers
    }
    headers['Content-Length'] = String(total)
    return headers
  }

  // ── SHA-256 (the claim hash; the id itself never leaves the tab that owns it) ──

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n))
  }

  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(String(text))
    var paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
    var padded = new Uint8Array(paddedLength)
    padded.set(bytes, 0)
    padded[bytes.length] = 0x80
    var bitLength = bytes.length * 8
    // 64-bit big-endian length; the high word is 0 for any realistic id.
    padded[paddedLength - 4] = (bitLength >>> 24) & 0xff
    padded[paddedLength - 3] = (bitLength >>> 16) & 0xff
    padded[paddedLength - 2] = (bitLength >>> 8) & 0xff
    padded[paddedLength - 1] = bitLength & 0xff

    var h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ]
    var w = new Uint32Array(64)
    for (var offset = 0; offset < paddedLength; offset += 64) {
      var i
      for (i = 0; i < 16; i++) {
        var o = offset + i * 4
        w[i] = ((padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3]) | 0
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      var a = h[0]
      var b = h[1]
      var c = h[2]
      var d = h[3]
      var e = h[4]
      var f = h[5]
      var g = h[6]
      var hh = h[7]
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        var ch = (e & f) ^ (~e & g)
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        var maj = (a & b) ^ (a & c) ^ (b & c)
        var t2 = (S0 + maj) | 0
        hh = g
        g = f
        f = e
        e = (d + t1) | 0
        d = c
        c = b
        b = a
        a = (t1 + t2) | 0
      }
      h[0] = (h[0] + a) | 0
      h[1] = (h[1] + b) | 0
      h[2] = (h[2] + c) | 0
      h[3] = (h[3] + d) | 0
      h[4] = (h[4] + e) | 0
      h[5] = (h[5] + f) | 0
      h[6] = (h[6] + g) | 0
      h[7] = (h[7] + hh) | 0
    }
    var out = ''
    for (var j = 0; j < 8; j++) {
      var word = (h[j] >>> 0).toString(16)
      out += '00000000'.slice(word.length) + word
    }
    return out
  }

  /**
   * A claim is accepted only when its id hashes to the value the worker asked
   * for AND, when the missed request carried a clientId, the answering tab IS
   * that client (A27).
   */
  function claimAccepted(entry, expected) {
    if (!entry || typeof entry.id !== 'string') return false
    if (!expected || typeof expected.hash !== 'string') return false
    if (sha256Hex(entry.id) !== expected.hash) return false
    if (expected.clientId) return entry.clientId === expected.clientId
    return true
  }

  /** A `data` message must continue exactly where the response left off (A19). */
  function continuityOk(expectedOffset, offset, length) {
    return (
      Number.isInteger(expectedOffset) &&
      Number.isInteger(offset) &&
      Number.isInteger(length) &&
      offset === expectedOffset &&
      length > 0
    )
  }

  /**
   * The 30 s silence timer for one response. Any `data` or `progress` message
   * touches it; the first fire is terminal.
   */
  function createSilenceTimer(clock, onFire, timeoutMs) {
    var limit = typeof timeoutMs === 'number' ? timeoutMs : SILENCE_TIMEOUT_MS
    var fired = false
    var stopped = false
    var id = null

    function arm() {
      if (stopped || fired) return
      id = clock.setTimeout(function () {
        id = null
        if (stopped) return
        fired = true
        onFire()
      }, limit)
    }

    arm()
    return {
      touch: function () {
        if (stopped || fired) return
        if (id !== null) clock.clearTimeout(id)
        arm()
      },
      stop: function () {
        stopped = true
        if (id !== null) {
          clock.clearTimeout(id)
          id = null
        }
      },
      get fired() {
        return fired
      },
    }
  }

  /** The per-download-style registry: id → entry. Entries own their requests. */
  function createRegistry() {
    var entries = new Map()
    return {
      register: function (entry) {
        entries.set(entry.id, entry)
      },
      get: function (id) {
        return entries.get(id) || null
      },
      remove: function (id) {
        entries.delete(id)
      },
      has: function (id) {
        return entries.has(id)
      },
      ids: function () {
        return Array.from(entries.keys())
      },
      size: function () {
        return entries.size
      },
    }
  }

  function notFound() {
    return new Response('Stream not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  /**
   * The `/sw-stream/` route.
   *
   * `route(request, clientId)` is SYNCHRONOUS and returns:
   *   - null  → this route does not answer: not a stream path, or a
   *             navigation (which always falls through to the ordinary
   *             navigation handler, before any registry lookup);
   *   - { response: Promise<Response> } → the worker calls `respondWith`.
   *
   * deps: { registry, clock, claim(hash, clientId), createBody(entry, start, end),
   *         cacheStore } — `cacheStore` is passed so a test can prove the
   * route never touches it (M4). Nothing here reads or writes cache storage.
   */
  function createStreamRoute(deps) {
    var registry = deps.registry || createRegistry()

    function respond(id, request, clientId) {
      return (async function () {
        // B3: no client id, no stream: refused before any registry lookup or
        // claim broadcast.
        if (!clientId) return notFound()
        var entry = registry.get(id)
        if (!entry) {
          if (typeof deps.claim !== 'function') return notFound()
          var claimed = await deps.claim(sha256Hex(id), clientId)
          if (!claimed) return notFound()
          if (!claimAccepted(claimed, { hash: sha256Hex(id), clientId: clientId })) {
            return notFound()
          }
          registry.register(claimed)
          entry = claimed
        }
        if (!shouldHandleStreamRequest(request, clientId, entry)) return notFound()

        var total = entry.size
        if (!Number.isFinite(total) || total <= 0) return notFound()
        var rangeHeader =
          request.headers && typeof request.headers.get === 'function'
            ? request.headers.get('Range') || request.headers.get('range')
            : null
        var asked = rangeHeader ? classifyRange(rangeHeader, total) : { kind: 'ignore' }
        if (asked.kind === 'multi' || asked.kind === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: responseHeaders({ status: 416, mime: entry.mime, total: total }),
          })
        }
        // A malformed header is ignored (B9): the whole body, 200.
        var range = asked.kind === 'range' ? asked : null
        var status = range ? 206 : 200
        var start = range ? range.start : 0
        var end = range ? range.end : total - 1
        var headers = responseHeaders({
          status: status,
          mime: entry.mime,
          start: start,
          end: end,
          total: total,
        })
        var body = typeof deps.createBody === 'function' ? deps.createBody(entry, start, end) : null
        return new Response(body, { status: status, headers: headers })
      })()
    }

    /**
     * `clientId` is FetchEvent.clientId. `resultingClientId` is consulted only
     * when clientId is empty, and the request is then served only if THAT id
     * is the registrant (it is empty for every subresource request per spec).
     */
    return function route(request, clientId, resultingClientId) {
      var pathname
      try {
        pathname = new URL(request.url).pathname
      } catch (err) {
        return null
      }
      var id = streamIdFromPath(pathname)
      if (id === null) return null
      // A navigation is NEVER answered here — and no registry lookup happens
      // first (§2.1, A23). The request falls through to the existing network
      // navigation handler.
      if (request.mode === 'navigate') return null
      return { response: respond(id, request, clientId || resultingClientId || '') }
    }
  }

  /**
   * The worker side of the `/sw-stream/` relay: the registry of page-owned
   * streams, the per-response bodies, the claim round-trip and the page's
   * register/close/claim-reply messages. sw.js only wires it to `self`.
   *
   * deps: { clock, matchAll(): Promise<Array<{ id, postMessage(msg) }>> }
   *   - `clock` is the injected clock (tests drive it; nothing reads Date);
   *   - `matchAll` is `self.clients.matchAll({ type: 'window', includeUncontrolled: true })`.
   */
  function createStreamRelay(deps) {
    var clock = deps.clock
    var registry = deps.registry || createRegistry()
    var claims = new Map()
    var seq = 0

    function bindPort(entry) {
      entry.requests = entry.requests || new Map()
      var port = entry.port
      port.addEventListener('message', function (event) {
        onPortMessage(entry.id, event.data)
      })
      if (typeof port.start === 'function') port.start()
    }

    function register(entry) {
      bindPort(entry)
      entry.lastActivityAt = clock.now()
      registry.register(entry)
    }

    /** Disarm a request's silence timer (it runs only while a pull waits). */
    function stopTimer(request) {
      if (request && request.timer) {
        request.timer.stop()
        request.timer = null
      }
    }

    function finishRequest(entry, reqId, controller, error) {
      var request = entry.requests && entry.requests.get(reqId)
      var pending = null
      if (request) {
        stopTimer(request)
        entry.requests.delete(reqId)
        pending = request.reject
        request.resolve = null
        request.reject = null
      }
      try {
        if (error) controller.error(error)
      } catch (err) {
        // The stream is already closed/errored.
      }
      // A pull still waiting on the page settles now instead of hanging.
      if (pending) pending(error || new Error('stream closed'))
    }

    function pullFromPage(entry, reqId, offset, max) {
      return new Promise(function (resolve, reject) {
        var request = entry.requests && entry.requests.get(reqId)
        if (!request) {
          reject(new Error('stream closed'))
          return
        }
        request.resolve = resolve
        request.reject = reject
        // B1: the 30 s silence timer runs ONLY while this pull waits on the
        // page. A paused player with a full buffer sends no pull, so it is
        // never timed out; `progress` touches the timer, the reply disarms it.
        stopTimer(request)
        request.timer = createSilenceTimer(clock, function () {
          // A10: 30 s without data/progress errors this response and drops it.
          finishRequest(entry, reqId, request.controller, new Error('stream timed out'))
        })
        entry.port.postMessage({ type: 'pull', reqId: reqId, offset: offset, max: max })
      })
    }

    /** One open response. It owns its offset, its silence timer and no plaintext. */
    function createBody(entry, start, end) {
      var reqId = 's' + ++seq
      var offset = start
      var done = false

      return new ReadableStream({
        start: function (controller) {
          // No timer yet: it is armed per pull (pullFromPage), never while idle.
          var request = { controller: controller, resolve: null, reject: null, timer: null }
          entry.requests.set(reqId, request)
          entry.port.postMessage({ type: 'open-range', reqId: reqId, start: start, end: end })
        },
        pull: async function (controller) {
          if (done || !entry.requests || !entry.requests.has(reqId)) return
          if (offset > end) {
            done = true
            stopTimer(entry.requests.get(reqId))
            entry.requests.delete(reqId)
            controller.close()
            return
          }
          var max = Math.min(MAX_MESSAGE_BYTES, end - offset + 1)
          var expected = offset
          var reply
          try {
            reply = await pullFromPage(entry, reqId, offset, max)
          } catch (err) {
            finishRequest(entry, reqId, controller, new Error('stream failed'))
            return
          }
          if (done || !entry.requests || !entry.requests.has(reqId)) return
          var bytes = reply && reply.bytes instanceof ArrayBuffer ? new Uint8Array(reply.bytes) : null
          if (!reply || !bytes || !continuityOk(expected, reply.offset, bytes.byteLength)) {
            // A19: a gap is an error, never a short 206.
            finishRequest(entry, reqId, controller, new Error('stream offset gap'))
            return
          }
          controller.enqueue(bytes)
          offset += bytes.byteLength
          if (offset > end) {
            done = true
            stopTimer(entry.requests.get(reqId))
            entry.requests.delete(reqId)
            controller.close()
          }
        },
        cancel: function () {
          done = true
          entry.port.postMessage({ type: 'cancel', reqId: reqId })
          var request = entry.requests && entry.requests.get(reqId)
          if (request) {
            stopTimer(request)
            entry.requests.delete(reqId)
          }
        },
      })
    }

    function onPortMessage(id, data) {
      var entry = registry.get(id)
      if (!entry || !data || typeof data !== 'object') return
      var request = entry.requests && entry.requests.get(data.reqId)
      if (data.type === 'progress') {
        // A live download is alive: touch the silence timer without a byte (A10).
        if (request && request.timer) request.timer.touch()
        return
      }
      if (!request) return
      if (data.type === 'data') {
        // The reply disarms the timer until the next pull.
        stopTimer(request)
        var resolve = request.resolve
        request.resolve = null
        request.reject = null
        if (resolve) resolve(data)
        return
      }
      if (data.type === 'data-error') {
        stopTimer(request)
        var reject = request.reject
        request.resolve = null
        request.reject = null
        if (reject) reject(new Error('stream failed'))
      }
    }

    function closeStream(id) {
      var entry = registry.get(id)
      if (!entry) return
      if (entry.requests) {
        entry.requests.forEach(function (request) {
          stopTimer(request)
          try {
            request.controller.error(new Error('stream closed'))
          } catch (err) {
            // Already errored/closed.
          }
        })
        entry.requests.clear()
      }
      registry.remove(id)
      try {
        entry.port.close()
      } catch (err) {
        // Already closed.
      }
    }

    function dropWaiter(hash, waiter) {
      var list = claims.get(hash)
      if (!list) return
      var index = list.indexOf(waiter)
      if (index >= 0) list.splice(index, 1)
      if (!list.length) claims.delete(hash)
    }

    /** Ask the owning window to re-register. It must hash to `hash` (A27). */
    async function claim(hash, clientId) {
      var clients
      try {
        clients = await deps.matchAll()
      } catch (err) {
        return null
      }
      var targets = clients.filter(function (client) {
        return !clientId || client.id === clientId
      })
      if (!targets.length) return null

      // B4: every claim is its own waiter with its own timeout. A second
      // claim for the same hash (two ranges after one SW restart) never
      // orphans the first; one reply answers them all.
      var answer = new Promise(function (resolve) {
        var waiter = { resolve: resolve, timer: null }
        waiter.timer = clock.setTimeout(function () {
          dropWaiter(hash, waiter)
          resolve(null)
        }, CLAIM_WAIT_MS)
        var list = claims.get(hash)
        if (!list) {
          list = []
          claims.set(hash, list)
        }
        list.push(waiter)
      })
      targets.forEach(function (client) {
        client.postMessage({ type: 'stream-claim', hash: hash })
      })
      return await answer
    }

    /**
     * The page's messages for this relay. `sourceId` is `event.source.id`.
     * Returns true when the message was a stream message (handled or dropped).
     */
    function onMessage(data, sourceId) {
      if (!data || typeof data !== 'object') return false
      if (data.type === 'register-stream') {
        if (!data.id || !data.port) return true
        // B3: never an entry with clientId '' (it could never be owner-checked).
        if (!sourceId) return true
        // B2: a stream belongs to the tab that registered it. Another tab
        // (same origin, same file) can never replace it.
        var existing = registry.get(data.id)
        if (existing && existing.clientId !== (sourceId || '')) return true
        register({
          id: data.id,
          mime: data.mime,
          size: data.size,
          port: data.port,
          clientId: sourceId || '',
          requests: new Map(),
          lastActivityAt: clock.now(),
        })
        return true
      }
      if (data.type === 'close-stream') {
        // B2: only the owning tab may close its stream.
        var owned = registry.get(data.id)
        if (owned && owned.clientId === (sourceId || '')) closeStream(data.id)
        return true
      }
      if (data.type === 'stream-claim-reply') {
        var waiters = claims.get(data.hash)
        if (!waiters || !waiters.length) return true
        claims.delete(data.hash)
        waiters.forEach(function (w) {
          clock.clearTimeout(w.timer)
        })
        if (!data.port || !sourceId) {
          waiters.forEach(function (w) {
            w.resolve(null)
          })
          return true
        }
        var entry = {
          id: data.id,
          mime: data.mime,
          size: data.size,
          port: data.port,
          clientId: sourceId || '',
          requests: new Map(),
          lastActivityAt: clock.now(),
        }
        bindPort(entry)
        // The route applies claimAccepted() (hash + source.id) before it serves.
        waiters.forEach(function (w) {
          w.resolve(entry)
        })
        return true
      }
      return false
    }

    return {
      registry: registry,
      createBody: createBody,
      claim: claim,
      onMessage: onMessage,
      closeStream: closeStream,
    }
  }

  var api = {
    STREAM_PATH_PREFIX: STREAM_PATH_PREFIX,
    SILENCE_TIMEOUT_MS: SILENCE_TIMEOUT_MS,
    CLAIM_WAIT_MS: CLAIM_WAIT_MS,
    MAX_MESSAGE_BYTES: MAX_MESSAGE_BYTES,
    MIME_PATTERN: MIME_PATTERN,
    SANDBOX_CSP: SANDBOX_CSP,
    OCTET_STREAM: OCTET_STREAM,
    streamIdFromPath: streamIdFromPath,
    shouldHandleStreamRequest: shouldHandleStreamRequest,
    parseRange: parseRange,
    classifyRange: classifyRange,
    contentTypeFor: contentTypeFor,
    responseHeaders: responseHeaders,
    sha256Hex: sha256Hex,
    claimAccepted: claimAccepted,
    continuityOk: continuityOk,
    createSilenceTimer: createSilenceTimer,
    createRegistry: createRegistry,
    createStreamRoute: createStreamRoute,
    createStreamRelay: createStreamRelay,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.BBMediaStreamLogic = api
  }
})(typeof self !== 'undefined' ? self : globalThis)
