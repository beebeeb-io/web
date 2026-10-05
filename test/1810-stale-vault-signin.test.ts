import { describe, test, expect, beforeEach } from 'bun:test'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

/**
 * Task 1810 (P0, Guus, prod 2026-10-05): after a password change the device's
 * local vault is still sealed under the OLD password; the next sign-in (OPAQUE
 * proves the NEW password) hit "Could not unlock vault. Try logging in again."
 * with no way out.
 *
 * Proven here, at the unit level (the browser walk is e2e/1810-after-password-change.spec.ts):
 *  - the sign-in decision: a server-proven password that cannot open the local
 *    vault means the vault is stale -> discard it, then the recovery phrase;
 *  - clearPasswordVault removes ONLY the password-sealed key, never a passkey vault;
 *  - after it, the old password opens nothing and the phrase screen can re-seal
 *    the key under the new password;
 *  - the 2FA "incorrect" copy says a code works once.
 */

const fakeIdb = installFakeIndexedDB()
beforeEach(() => fakeIdb.reset())

const { wrapAndStore, wrapAndStoreWithPasskey, unwrap, hasVault, clearPasswordVault } = await import('../src/lib/vault')
const { resolveSignInUnlock, STALE_VAULT_NOTICE } = await import('../src/lib/sign-in-unlock')
const { TWO_FACTOR_INCORRECT_MESSAGE } = await import('../src/lib/two-factor-login')

const USER = 'user-1810-0000-0000-0000-000000000000'
const OLD_PW = 'old-password-1810-xxxxxxxxxx'
const NEW_PW = 'new-password-1810-yyyyyyyyyy'

function key(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

describe('task 1810: what a sign-in does with the local vault once the password is server-proven', () => {
  test('the three outcomes map to proceed / provision / discard-then-provision', () => {
    expect(resolveSignInUnlock('unlocked')).toBe('proceed')
    expect(resolveSignInUnlock('needs_provisioning')).toBe('provision')
    expect(resolveSignInUnlock('wrong_password')).toBe('discard_then_provision')
  })

  test('the stale notice names the cause and the next step', () => {
    expect(STALE_VAULT_NOTICE).toContain('previous password')
    expect(STALE_VAULT_NOTICE).toContain('recovery phrase')
  })
})

describe('task 1810: a vault sealed under the old password is gone after the discard', () => {
  test('RED CASE: the new password cannot open the old-password vault (this is the reported dead end)', async () => {
    await wrapAndStore(key(), OLD_PW, USER)
    expect(await unwrap(NEW_PW, USER)).toBeNull()
    expect((await unwrap(OLD_PW, USER))?.untagged).toBe(false) // it IS the old password's vault
  })

  test('clearPasswordVault removes the password vault: nothing opens it, hasVault is false', async () => {
    await wrapAndStore(key(), OLD_PW, USER)
    expect(await clearPasswordVault()).toBe(true)
    expect(await unwrap(OLD_PW, USER)).toBeNull()
    expect(await unwrap(NEW_PW, USER)).toBeNull()
    expect(await hasVault()).toBe(false)
  })

  test('a second call is a no-op (false), not an error', async () => {
    await wrapAndStore(key(), OLD_PW, USER)
    expect(await clearPasswordVault()).toBe(true)
    expect(await clearPasswordVault()).toBe(false)
  })

  test('with no vault at all it returns false', async () => {
    expect(await clearPasswordVault()).toBe(false)
  })

  test('a passkey-sealed vault is NOT touched (it does not depend on the password)', async () => {
    await wrapAndStore(key(), OLD_PW, USER)
    await wrapAndStoreWithPasskey(key(), crypto.getRandomValues(new Uint8Array(32)), USER)
    expect(await clearPasswordVault()).toBe(true)
    expect(await unwrap(OLD_PW, USER)).toBeNull()
    expect(await hasVault()).toBe(true) // the passkey entry survives
  })

  test('the phrase screen then seals the SAME master key under the new password only', async () => {
    const master = key()
    await wrapAndStore(master, OLD_PW, USER)
    await clearPasswordVault()
    await wrapAndStore(master, NEW_PW, USER) // what DeviceProvision -> setMasterKey does
    expect(await unwrap(OLD_PW, USER)).toBeNull()
    const reopened = await unwrap(NEW_PW, USER)
    expect(reopened).not.toBeNull()
    expect(Array.from(reopened!.key)).toEqual(Array.from(master))
  })
})

describe('task 1810: the 2FA "incorrect" message says a code works once', () => {
  test('still reads as an incorrect-code message, and names the one-time rule + the backup code', () => {
    expect(TWO_FACTOR_INCORRECT_MESSAGE).toMatch(/^incorrect code/i)
    expect(TWO_FACTOR_INCORRECT_MESSAGE).toMatch(/only once/i)
    expect(TWO_FACTOR_INCORRECT_MESSAGE).toMatch(/backup code/i)
  })
})
