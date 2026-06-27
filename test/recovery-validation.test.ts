import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initSync,
  generate_recovery_phrase,
  recover_from_phrase,
  compute_recovery_check,
} from 'beebeeb-wasm'
import { ApiError } from '@beebeeb/shared'
import { recoveredKeyMatchesAccount } from '../src/lib/recovery-validation'

// device-provision's gate (task 0874): a WRONG recovery phrase used to "unlock"
// the vault because `recoverFromPhrase` derives *a* valid key from any
// checksum-valid BIP39 phrase and the result was persisted with no validation.
//
// The crypto.ts wrappers funnel through a Comlink worker that can't load under
// `bun test`, so — like transfer-crypto.test.ts — we exercise the REAL core
// crypto by initializing the same committed WASM directly, and inject it as the
// gate's `computeRecoveryCheckB64`. The server's authed `verify-recovery-check`
// is modelled by a constant-time compare against the account's stored check
// (the same `{valid:true}` / 400 `invalid_recovery_phrase` contract as
// recovery.rs::verify_recovery_check).
beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Constant-time-ish compare mirroring recovery.rs::ct_eq (length not secret). */
function ctEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let acc = 0
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i]
  return acc === 0
}

/**
 * Build the gate deps for an account whose master key is `accountKey`. The
 * `verifyRecoveryCheck` stand-in is the server: it compares the submitted check
 * against the account's stored check and throws the same ApiError the web
 * client surfaces on a 400 `invalid_recovery_phrase`.
 */
function depsForAccount(accountKey: Uint8Array) {
  const storedCheck = compute_recovery_check(accountKey) as Uint8Array
  return {
    computeRecoveryCheckB64: async (k: Uint8Array) =>
      toB64(compute_recovery_check(k) as Uint8Array),
    verifyRecoveryCheck: async (recoveryCheckB64: string) => {
      const submitted = new Uint8Array(Buffer.from(recoveryCheckB64, 'base64'))
      if (!ctEq(submitted, storedCheck)) {
        throw new ApiError('invalid_recovery_phrase', 400, 'invalid_recovery_phrase')
      }
      return true
    },
  }
}

/**
 * Faithful replica of device-provision `handleRestore`'s persist/unlock
 * decision, so we can assert the security property: a rejected key is NEVER
 * persisted to the vault and NEVER unlocks.
 */
async function runGate(masterKey: Uint8Array, deps: ReturnType<typeof depsForAccount>) {
  let persisted = false
  let unlocked = false
  let error = ''
  const matches = await recoveredKeyMatchesAccount(masterKey, deps)
  if (!matches) {
    error = 'Incorrect recovery phrase. Check your words and try again.'
    return { persisted, unlocked, error }
  }
  // setMasterKey (vault.ts wrapAndStore → IndexedDB) + onProvisioned
  persisted = true
  unlocked = true
  return { persisted, unlocked, error }
}

describe('recovery-phrase unlock validation (task 0874)', () => {
  test('a checksum-valid but WRONG phrase is REJECTED — never persisted, never unlocks', async () => {
    // The account was created with phrase A.
    const accountKey = recover_from_phrase(
      (generate_recovery_phrase() as { phrase: string }).phrase,
    ) as Uint8Array

    // The user types a DIFFERENT valid 12-word phrase (B) on a new device.
    const wrongPhrase = (generate_recovery_phrase() as { phrase: string }).phrase
    const wrongKey = recover_from_phrase(wrongPhrase) as Uint8Array

    // Sanity: the derived keys (and thus checks) genuinely differ.
    expect(toB64(compute_recovery_check(wrongKey) as Uint8Array)).not.toBe(
      toB64(compute_recovery_check(accountKey) as Uint8Array),
    )

    const result = await runGate(wrongKey, depsForAccount(accountKey))
    expect(result.persisted).toBe(false)
    expect(result.unlocked).toBe(false)
    expect(result.error).toBe('Incorrect recovery phrase. Check your words and try again.')
  })

  test('the CORRECT phrase still unlocks and persists the key', async () => {
    const phrase = (generate_recovery_phrase() as { phrase: string }).phrase
    const accountKey = recover_from_phrase(phrase) as Uint8Array

    // Re-deriving the same phrase on a new device yields the same key.
    const reDerived = recover_from_phrase(phrase) as Uint8Array
    expect(toB64(reDerived)).toBe(toB64(accountKey))

    const result = await runGate(reDerived, depsForAccount(accountKey))
    expect(result.persisted).toBe(true)
    expect(result.unlocked).toBe(true)
    expect(result.error).toBe('')
  })

  test('a non-mismatch server/network error is re-thrown — never read as valid', async () => {
    const accountKey = recover_from_phrase(
      (generate_recovery_phrase() as { phrase: string }).phrase,
    ) as Uint8Array

    const deps = {
      computeRecoveryCheckB64: async (k: Uint8Array) =>
        toB64(compute_recovery_check(k) as Uint8Array),
      // Server unreachable / 500 — must NOT be swallowed into a false "valid".
      verifyRecoveryCheck: async () => {
        throw new ApiError('internal', 500, 'internal')
      },
    }

    await expect(recoveredKeyMatchesAccount(accountKey, deps)).rejects.toThrow()
  })
})
