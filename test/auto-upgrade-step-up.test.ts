import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// Task 2512 (server task 2506): the silent OPAQUE upgrade finish takes a step-up
// that proves the password. Order: earn the proof last, then hand it to the finish.
const calls: string[] = []
let finishToken: string | undefined
let confirmShouldFail = false

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  opaqueRegisterStartExisting: async () => { calls.push('start'); return { server_message: 'AA==' } },
  confirmAction: async (pw: string) => {
    calls.push(`confirm:${pw}`)
    if (confirmShouldFail) throw new Error('Incorrect password.')
    return { confirmation_token: 'proof-1', expires_at: '' }
  },
  opaqueRegisterFinishExisting: async (_m: string, _r: string, _x: string, token?: string) => {
    calls.push('finish'); finishToken = token; return { migrated: true }
  },
})
await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  opaqueRegistrationStart: async () => ({ message: new Uint8Array([1]), state: new Uint8Array([2]) }),
  opaqueRegistrationFinish: async () => new Uint8Array([3]),
  computeRecoveryCheck: async () => new Uint8Array([4]),
  deriveX25519Public: async () => new Uint8Array([5]),
})

const { autoUpgradeToV1 } = await import('../src/lib/auto-upgrade')

describe('autoUpgradeToV1 sends a password proof with the finish', () => {
  test('the proof is earned after the OPAQUE start and spent by the finish', async () => {
    calls.length = 0
    expect(await autoUpgradeToV1('pw-a', new Uint8Array(32))).toBe(true)
    expect(calls).toEqual(['start', 'confirm:pw-a', 'finish'])
    expect(finishToken).toBe('proof-1')
  })

  test('a failed proof means no finish call and a quiet false', async () => {
    calls.length = 0
    confirmShouldFail = true
    expect(await autoUpgradeToV1('pw-a', new Uint8Array(32))).toBe(false)
    expect(calls).toEqual(['start', 'confirm:pw-a'])
    confirmShouldFail = false
  })
})
