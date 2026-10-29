// office-cache-logic.js — pure decision logic for the office bundle's
// cache-first service-worker strategy (task 1567, web delivery groundwork).
//
// Deliberately dependency-free: no `self`, `caches`, or `fetch` reference
// anywhere in this file. That is what makes it unit-testable under `bun test`
// (no DOM/SW globals available there) AND loadable from the real service
// worker via `importScripts()` (classic, non-module SW script — see sw.js).
//
// Dual-mode export: CommonJS (`module.exports`) when required from a test
// runner, or `self.BBOfficeCacheLogic` when loaded via `importScripts` inside
// the service worker's global scope. No build step touches this file — it is
// served byte-for-byte from `public/`, same as sw.js itself.
;(function (root) {
  var OFFICE_CACHE_PREFIX = 'beebeeb-office-'
  // Cache GENERATION, part of every office cache name (task 1584). Bumped
  // when responses cached under an earlier generation may be damaged: until
  // task 1584, nginx served every /office/<version>/ asset Brotli AND gzip
  // encoded, and a WebKit client could store the undecodable body under the
  // immutable, content-hashed URL — a "cache-first forever" poison that a
  // server fix alone never clears when the bundle version stays the same.
  // A new generation makes every older `beebeeb-office-*` cache stale, so the
  // activate step's officeCacheNamesToDelete() removes it.
  var OFFICE_CACHE_GENERATION = 'g2'
  var OFFICE_MANIFEST_PATH = '/office/manifest.json'

  /**
   * True for a same-origin request path this cache strategy should own:
   * the content-hashed bundle files under `/office/<version>/...`. The
   * manifest itself (`/office/manifest.json`) is explicitly EXCLUDED — it is
   * the small, mutable pointer to the current version and must always go to
   * the network (nginx already marks it `Cache-Control: no-cache`; this SW
   * must not shadow that with a stale cached copy).
   */
  function isOfficeAssetPath(pathname) {
    if (typeof pathname !== 'string') return false
    if (pathname === OFFICE_MANIFEST_PATH) return false
    return /^\/office\/[^/]+\/.+/.test(pathname)
  }

  /** Cache Storage name for a given manifest version. One cache per released version. */
  function officeCacheName(version) {
    if (!version || typeof version !== 'string') {
      throw new Error('officeCacheName requires a non-empty version string')
    }
    return OFFICE_CACHE_PREFIX + OFFICE_CACHE_GENERATION + '-' + version
  }

  /**
   * Pulls the content-hash version segment straight out of an asset request
   * path (`/office/<version>/soffice.wasm` -> `<version>`), so the fetch
   * handler can decide which per-version cache to use WITHOUT a network
   * round-trip to manifest.json — the version is already in the URL, and
   * every such URL is immutable by construction (content-hashed).
   */
  function officeVersionFromPath(pathname) {
    if (!isOfficeAssetPath(pathname)) return null
    var match = /^\/office\/([^/]+)\//.exec(pathname)
    return match ? match[1] : null
  }

  /** Extracts `{ version }` from a fetched manifest.json body. Throws on malformed input — callers decide the fallback. */
  function parseManifestVersion(manifestJsonText) {
    var parsed = JSON.parse(manifestJsonText)
    if (!parsed || typeof parsed.version !== 'string' || parsed.version.length === 0) {
      throw new Error('office manifest missing "version"')
    }
    return parsed.version
  }

  /**
   * Given every Cache Storage name that exists, the app's own top-level
   * cache name (never touched here), and the CURRENT office cache name (or
   * null if the office bundle isn't reachable / not deployed), returns the
   * list of cache names that are safe to delete: every `beebeeb-office-*`
   * cache EXCEPT the current one. Never returns a name outside that prefix —
   * this is what keeps the office cleanup from ever touching the app shell
   * cache or the unrelated thumbnail cache.
   */
  function officeCacheNamesToDelete(allCacheNames, currentOfficeCacheName) {
    if (!Array.isArray(allCacheNames)) return []
    return allCacheNames.filter(function (name) {
      if (typeof name !== 'string') return false
      if (name.indexOf(OFFICE_CACHE_PREFIX) !== 0) return false
      return name !== currentOfficeCacheName
    })
  }

  /**
   * Whether a fetched Response is eligible to be stored in the office cache.
   * Cache-first only ever caches successful, same-origin GET responses for
   * office asset paths — never an API response, never a user document, and
   * never a non-2xx/opaque response.
   */
  function isCacheableOfficeResponse(request, response) {
    if (!request || request.method !== 'GET') return false
    if (!response || !response.ok) return false
    // An opaque (cross-origin, no-cors) response has status 0 and type
    // 'opaque' — `response.ok` is already false for those in every real
    // implementation, but this is asserted explicitly since it is the
    // exact case zero-egress must never cache.
    if (response.type === 'opaque') return false
    // Task 1584: a stacked Content-Encoding ("br, gzip") is the exact
    // double-compression bug that showed the engine document as text on
    // iPhone Safari. Never pin such a response in a cache-first store.
    var enc = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-encoding') : null
    if (enc && /[,\n]/.test(enc)) return false
    return true
  }

  var api = {
    OFFICE_CACHE_PREFIX: OFFICE_CACHE_PREFIX,
    OFFICE_CACHE_GENERATION: OFFICE_CACHE_GENERATION,
    OFFICE_MANIFEST_PATH: OFFICE_MANIFEST_PATH,
    isOfficeAssetPath: isOfficeAssetPath,
    officeCacheName: officeCacheName,
    officeVersionFromPath: officeVersionFromPath,
    parseManifestVersion: parseManifestVersion,
    officeCacheNamesToDelete: officeCacheNamesToDelete,
    isCacheableOfficeResponse: isCacheableOfficeResponse,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.BBOfficeCacheLogic = api
  }
})(typeof self !== 'undefined' ? self : globalThis)
