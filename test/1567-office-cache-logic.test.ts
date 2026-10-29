import { describe, test, expect } from 'bun:test'
// Requires the SAME plain-JS file the real service worker `importScripts()`s
// (public/office-cache-logic.js, task 1567) — one file, one behavior, tested
// the way it actually runs in the SW, not a TS re-implementation that could
// silently drift from it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logic = require('../public/office-cache-logic.js')

describe('isOfficeAssetPath', () => {
  test('matches a content-hashed asset under /office/<version>/', () => {
    expect(logic.isOfficeAssetPath('/office/a1b2c3/soffice.wasm')).toBe(true)
    expect(logic.isOfficeAssetPath('/office/a1b2c3/soffice.data')).toBe(true)
  })

  test('EXCLUDES the manifest itself — it must always hit the network', () => {
    expect(logic.isOfficeAssetPath('/office/manifest.json')).toBe(false)
  })

  test('excludes unrelated app routes', () => {
    expect(logic.isOfficeAssetPath('/')).toBe(false)
    expect(logic.isOfficeAssetPath('/api/v1/files')).toBe(false)
    expect(logic.isOfficeAssetPath('/office')).toBe(false)
    expect(logic.isOfficeAssetPath('/office/')).toBe(false)
  })

  test('rejects non-string input rather than throwing', () => {
    expect(logic.isOfficeAssetPath(null)).toBe(false)
    expect(logic.isOfficeAssetPath(undefined)).toBe(false)
  })
})

describe('officeVersionFromPath', () => {
  test('extracts the version segment from a real asset path', () => {
    expect(logic.officeVersionFromPath('/office/a1b2c3/soffice.wasm')).toBe('a1b2c3')
    expect(logic.officeVersionFromPath('/office/deadbeef/soffice.data')).toBe('deadbeef')
  })

  test('returns null for the manifest path (not a version-scoped asset)', () => {
    expect(logic.officeVersionFromPath('/office/manifest.json')).toBeNull()
  })

  test('returns null for a path with no version segment', () => {
    expect(logic.officeVersionFromPath('/office/')).toBeNull()
    expect(logic.officeVersionFromPath('/office')).toBeNull()
    expect(logic.officeVersionFromPath('/')).toBeNull()
  })
})

describe('officeCacheName', () => {
  test('is prefixed, generation-scoped (task 1584) and versioned', () => {
    expect(logic.officeCacheName('a1b2c3')).toBe('beebeeb-office-g2-a1b2c3')
  })

  test('throws on an empty/missing version rather than caching under a bogus name', () => {
    expect(() => logic.officeCacheName('')).toThrow()
    expect(() => logic.officeCacheName(undefined)).toThrow()
  })
})

describe('parseManifestVersion', () => {
  test('extracts the version field', () => {
    expect(logic.parseManifestVersion(JSON.stringify({ version: 'deadbeef', assets: [] }))).toBe('deadbeef')
  })

  test('throws on malformed JSON — caller must fall back, not cache under "undefined"', () => {
    expect(() => logic.parseManifestVersion('{not json')).toThrow()
  })

  test('throws when version is missing', () => {
    expect(() => logic.parseManifestVersion(JSON.stringify({ assets: [] }))).toThrow()
  })
})

describe('officeCacheNamesToDelete', () => {
  test('deletes old office caches, keeps the current one', () => {
    const all = ['beebeeb-office-v1', 'beebeeb-office-v2', 'beebeeb-office-v3']
    const toDelete = logic.officeCacheNamesToDelete(all, 'beebeeb-office-v3')
    expect(toDelete.sort()).toEqual(['beebeeb-office-v1', 'beebeeb-office-v2'])
  })

  test('NEVER touches the app shell cache or the thumbnail cache — only the office prefix', () => {
    const all = ['beebeeb-v2', 'beebeeb-thumbnails-v2', 'beebeeb-office-v1', 'beebeeb-office-v2']
    const toDelete = logic.officeCacheNamesToDelete(all, 'beebeeb-office-v2')
    expect(toDelete).toEqual(['beebeeb-office-v1'])
    expect(toDelete).not.toContain('beebeeb-v2')
    expect(toDelete).not.toContain('beebeeb-thumbnails-v2')
  })

  test('with no current version reachable (manifest fetch failed), every office cache is stale', () => {
    const all = ['beebeeb-v2', 'beebeeb-office-v1', 'beebeeb-office-v2']
    const toDelete = logic.officeCacheNamesToDelete(all, null)
    expect(toDelete.sort()).toEqual(['beebeeb-office-v1', 'beebeeb-office-v2'])
  })

  test('an empty cache list deletes nothing', () => {
    expect(logic.officeCacheNamesToDelete([], 'beebeeb-office-v1')).toEqual([])
  })
})

describe('isCacheableOfficeResponse', () => {
  function req(method: string) {
    return { method }
  }
  function res(ok: boolean, type = 'basic') {
    return { ok, type }
  }

  test('a successful same-origin GET is cacheable', () => {
    expect(logic.isCacheableOfficeResponse(req('GET'), res(true))).toBe(true)
  })

  test('a non-GET request is never cached', () => {
    expect(logic.isCacheableOfficeResponse(req('POST'), res(true))).toBe(false)
    expect(logic.isCacheableOfficeResponse(req('PUT'), res(true))).toBe(false)
  })

  test('a failed response (4xx/5xx) is never cached', () => {
    expect(logic.isCacheableOfficeResponse(req('GET'), res(false))).toBe(false)
  })

  test('an opaque cross-origin response is never cached (zero-egress guard)', () => {
    expect(logic.isCacheableOfficeResponse(req('GET'), res(true, 'opaque'))).toBe(false)
  })
})
