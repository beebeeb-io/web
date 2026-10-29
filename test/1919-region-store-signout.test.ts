import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1919, review thread on web#167: signing out is a soft SPA transition, so
 * the region store (a module-level cache, one GET per person per page load)
 * outlived the session. Signing back in as the SAME person found the old owner
 * in `ready` and skipped the GET, so a preference changed elsewhere and the
 * server's datacenter list stayed stale for the whole new session.
 */

let gets = 0
let preferred: string | null = 'hel1'

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getUserRegion: async () => {
    gets++
    return { preferred_region: preferred, available_regions: [], choices: [] }
  },
})

const { loadRegionChoices, regionOwnerChanged, resetRegionStore } = await import('../src/lib/use-region-choices')

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  resetRegionStore()
  gets = 0
  preferred = 'hel1'
})

describe('the region store does not outlive a sign-out', () => {
  test('same person, signed out and back in: the list is fetched again', async () => {
    regionOwnerChanged('u-1')
    await settle()
    expect(gets).toBe(1)
    // Signed out (no person), then the preference changes elsewhere.
    regionOwnerChanged(null)
    preferred = 'nbg1'
    regionOwnerChanged('u-1')
    await settle()
    expect(gets).toBe(2)
  })

  test('without a sign-out the same person is fetched once per page load', async () => {
    regionOwnerChanged('u-1')
    await settle()
    regionOwnerChanged('u-1')
    await loadRegionChoices('u-1')
    expect(gets).toBe(1)
  })
})

describe('signing out from this tab or another resets it too', () => {
  // The consumer (drive layout, settings page) may unmount in the same render
  // that drops the person, so its effect never sees `null`. The sign-out paths
  // reset the store themselves.
  const auth = readFileSync(fileURLToPath(new URL('../src/lib/auth-context.tsx', import.meta.url)), 'utf8')
  test('logout() resets the region store', () => {
    const from = auth.indexOf('const logout = useCallback')
    expect(from).toBeGreaterThan(-1)
    const next = auth.indexOf('useCallback', from + 'const logout = useCallback'.length)
    const body = auth.slice(from, next === -1 ? undefined : next)
    expect(body).toContain('resetRegionStore()')
  })
  test("another tab's sign-out resets it", () => {
    const handler = auth.slice(auth.indexOf('const onMessage'), auth.indexOf("channel.addEventListener('message'"))
    expect(handler).toMatch(/type === 'logout'\) \{[^}]*resetRegionStore\(\)/s)
  })
})
