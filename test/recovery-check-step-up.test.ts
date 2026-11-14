import { describe, expect, test } from 'bun:test'
import { ApiError } from '@beebeeb/shared'
import { backfillRecoveryCheckIfAbsent } from '../src/lib/recovery-validation'

// Task 2512 (server task 2506): a first fill of the recovery check needs a step-up
// that proves the password. The first call goes out WITHOUT a token (a filled slot
// answers `updated: false` with none); only on `confirmation_required` does the
// client earn a token with the password and retry once.

const key = new Uint8Array(32)
const deps = (over: Record<string, unknown>) => ({
  computeRecoveryCheckB64: async () => 'Y2hlY2s=',
  setRecoveryCheckIfAbsent: async () => ({ updated: false }),
  ...over,
}) as Parameters<typeof backfillRecoveryCheckIfAbsent>[1]

const needProof = () => new ApiError('step-up needed', 403, 'confirmation_required')

describe('recovery-check first fill needs a password proof', () => {
  test('empty slot: asks without a token, then retries once with a proof', async () => {
    const seen: (string | undefined)[] = []
    let confirms = 0
    const ok = await backfillRecoveryCheckIfAbsent(key, deps({
      setRecoveryCheckIfAbsent: async (_c: string, token?: string) => {
        seen.push(token)
        if (!token) throw needProof()
        return { updated: true }
      },
      confirmWithPassword: async () => { confirms++; return 'tok-1' },
    }))
    expect(ok).toBe(true)
    expect(seen).toEqual([undefined, 'tok-1'])
    expect(confirms).toBe(1)
  })

  test('filled slot: no step-up is ever earned', async () => {
    let confirms = 0
    const ok = await backfillRecoveryCheckIfAbsent(key, deps({
      confirmWithPassword: async () => { confirms++; return 'x' },
    }))
    expect(ok).toBe(false)
    expect(confirms).toBe(0)
  })

  test('no password in hand (passkey unlock): skipped quietly, no retry', async () => {
    let calls = 0
    const ok = await backfillRecoveryCheckIfAbsent(key, deps({
      setRecoveryCheckIfAbsent: async () => { calls++; throw needProof() },
    }))
    expect(ok).toBe(false)
    expect(calls).toBe(1)
  })

  test('a wrong password never loops: the proof failing ends the attempt', async () => {
    let calls = 0
    const ok = await backfillRecoveryCheckIfAbsent(key, deps({
      setRecoveryCheckIfAbsent: async () => { calls++; throw needProof() },
      confirmWithPassword: async () => { throw new Error('Incorrect password.') },
    }))
    expect(ok).toBe(false)
    expect(calls).toBe(1)
  })
})
