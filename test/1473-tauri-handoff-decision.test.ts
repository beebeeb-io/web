import { describe, expect, test } from 'bun:test'

/**
 * Task 1473 — the handoff DECISION: given a cookie-session user (no legacy
 * `bb_session` localStorage token) inside the Tauri shell, `handoffToTauri`
 * must resolve the raw token via the fallback (`resolveSessionToken`, see
 * test/1473-resolve-session-token.test.ts) and actually invoke the Tauri
 * bridge with it — not silently no-op the way it did before this fix.
 *
 * `resolveAndHandoffToTauri` is the extracted, directly-testable async
 * decision (mirrors this repo's no-render-harness convention — see
 * test/1471-ws-context-auth-gate.test.ts's `shouldOpenWs` /
 * test/pricing-checkout-intent-1469.test.ts's `startPlanCheckout`): takes
 * injectable `isTauriFn` / `resolveSessionTokenFn` / `pushTauriSessionFn`
 * deps instead of mocking `./tauri-bridge` or `@beebeeb/shared` via
 * `mock.module` (same process-global collision reasoning as the sibling
 * test file).
 */

const { resolveAndHandoffToTauri } = await import('../src/lib/key-context')

describe('resolveAndHandoffToTauri() — the desktop auto-unlock handoff decision (task 1473)', () => {
  test('inside Tauri, legacy slot null, cookie session resolves a token → invokes the Tauri bridge with it', async () => {
    const key = new Uint8Array([1, 2, 3, 4])
    const pushed: Array<{ token: string; key: Uint8Array; email?: string }> = []

    await resolveAndHandoffToTauri(key, 'guus@beebeeb.io', {
      isTauriFn: () => true,
      resolveSessionTokenFn: async () => 'resolved-cookie-session-token',
      pushTauriSessionFn: async (token, k, email) => {
        pushed.push({ token, key: k, email })
      },
    })

    expect(pushed).toHaveLength(1)
    expect(pushed[0].token).toBe('resolved-cookie-session-token')
    expect(pushed[0].key).toBe(key)
    expect(pushed[0].email).toBe('guus@beebeeb.io')
  })

  test('inside Tauri but resolveSessionToken comes up empty (no session at all) → does NOT invoke the bridge', async () => {
    let pushCalls = 0
    await resolveAndHandoffToTauri(new Uint8Array([1]), null, {
      isTauriFn: () => true,
      resolveSessionTokenFn: async () => null,
      pushTauriSessionFn: async () => {
        pushCalls++
      },
    })
    expect(pushCalls).toBe(0)
  })

  test('outside Tauri (plain web) → never even calls resolveSessionToken (no needless network hit on every web login)', async () => {
    let resolveCalls = 0
    let pushCalls = 0
    await resolveAndHandoffToTauri(new Uint8Array([1]), null, {
      isTauriFn: () => false,
      resolveSessionTokenFn: async () => {
        resolveCalls++
        return 'token-that-should-never-be-fetched'
      },
      pushTauriSessionFn: async () => {
        pushCalls++
      },
    })
    expect(resolveCalls).toBe(0)
    expect(pushCalls).toBe(0)
  })
})
