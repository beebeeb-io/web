import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, generate_recovery_phrase, recover_from_phrase, compute_recovery_check } from 'beebeeb-wasm'
import { backfillRecoveryCheckIfAbsent } from '../src/lib/recovery-validation'

// Task 0875: on a PROVEN-correct-key unlock, the web client backfills the
// account's server-stored `recovery_check` IF it is currently NULL (legacy
// accounts that predate the signup-time check). The set is idempotent
// (set-once-if-absent) and best-effort — it must never block or break unlock.
//
// crypto.ts funnels through a Comlink worker that can't load under `bun test`,
// so — like recovery-validation.test.ts — we drive the REAL core crypto via the
// committed WASM directly and inject it as `computeRecoveryCheckB64`. The server
// route is modelled by a tiny set-once store mirroring recovery.rs::
// set_recovery_check (`UPDATE … WHERE recovery_check IS NULL`).
beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Set-once-if-absent server store mirroring recovery.rs::set_recovery_check. */
function makeServer(initial: string | null) {
  let stored: string | null = initial
  let calls = 0
  return {
    get stored() {
      return stored
    },
    get calls() {
      return calls
    },
    setRecoveryCheckIfAbsent: async (recoveryCheckB64: string) => {
      calls++
      if (stored === null) {
        stored = recoveryCheckB64
        return { updated: true }
      }
      return { updated: false } // NEVER overwrite a non-NULL value
    },
  }
}

function accountKey(): Uint8Array {
  return recover_from_phrase(
    (generate_recovery_phrase() as { phrase: string }).phrase,
  ) as Uint8Array
}

describe('recovery_check backfill on proven unlock (task 0875)', () => {
  test('fires when absent — sets the computed check, reports updated', async () => {
    const key = accountKey()
    const server = makeServer(null)

    const updated = await backfillRecoveryCheckIfAbsent(key, {
      computeRecoveryCheckB64: async (k) => toB64(compute_recovery_check(k) as Uint8Array),
      setRecoveryCheckIfAbsent: server.setRecoveryCheckIfAbsent,
    })

    expect(updated).toBe(true)
    // The stored value is exactly HMAC-SHA256(masterKey, label).
    expect(server.stored).toBe(toB64(compute_recovery_check(key) as Uint8Array))
  })

  test('idempotent — a second proven unlock is a no-op and never overwrites', async () => {
    const key = accountKey()
    const server = makeServer(null)
    const deps = {
      computeRecoveryCheckB64: async (k: Uint8Array) => toB64(compute_recovery_check(k) as Uint8Array),
      setRecoveryCheckIfAbsent: server.setRecoveryCheckIfAbsent,
    }

    expect(await backfillRecoveryCheckIfAbsent(key, deps)).toBe(true)
    const afterFirst = server.stored

    // A later unlock with the SAME proven key calls the endpoint again but the
    // server no-ops; even a (hypothetical) different value can't overwrite.
    expect(await backfillRecoveryCheckIfAbsent(key, deps)).toBe(false)
    expect(server.stored).toBe(afterFirst)
    expect(server.calls).toBe(2) // genuinely hit the endpoint both times
  })

  test('already-set account — backfill is a no-op (updated:false)', async () => {
    const key = accountKey()
    const preset = toB64(compute_recovery_check(key) as Uint8Array)
    const server = makeServer(preset)

    const updated = await backfillRecoveryCheckIfAbsent(key, {
      computeRecoveryCheckB64: async (k) => toB64(compute_recovery_check(k) as Uint8Array),
      setRecoveryCheckIfAbsent: server.setRecoveryCheckIfAbsent,
    })

    expect(updated).toBe(false)
    expect(server.stored).toBe(preset)
  })

  test('never blocks or breaks unlock — a server/network error is swallowed', async () => {
    const key = accountKey()

    const updated = await backfillRecoveryCheckIfAbsent(key, {
      computeRecoveryCheckB64: async (k) => toB64(compute_recovery_check(k) as Uint8Array),
      setRecoveryCheckIfAbsent: async () => {
        throw new Error('network down')
      },
    })

    // Resolves false instead of throwing — the unlock path is never disrupted.
    expect(updated).toBe(false)
  })
})
