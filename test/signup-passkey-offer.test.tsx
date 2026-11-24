import { afterEach, describe, expect, test } from 'bun:test'
import { passkeyOfferSupported, SIGNUP_STEP_LABELS } from '../src/components/onboarding/passkey-offer'
import { firstFilesPending, markFirstFilesPending } from '../src/components/onboarding/first-files'

/** Master key naming 13: when step 3 is offered, and when step 4's card is due. */

const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
const saved = { window: g.window, localStorage: g.localStorage }

function setWindow(pkc: unknown) {
  g.window = pkc === undefined ? {} : { PublicKeyCredential: pkc }
}

afterEach(() => {
  g.window = saved.window
  g.localStorage = saved.localStorage
})

describe('passkeyOfferSupported', () => {
  test('no WebAuthn: not offered', async () => {
    setWindow(undefined)
    expect(await passkeyOfferSupported()).toBe(false)
  })
  test('no platform authenticator: not offered', async () => {
    setWindow({ isUserVerifyingPlatformAuthenticatorAvailable: async () => false })
    expect(await passkeyOfferSupported()).toBe(false)
  })
  test('platform authenticator without PRF: not offered', async () => {
    setWindow({
      getClientCapabilities: async () => ({ userVerifyingPlatformAuthenticator: true, 'extension:prf': false }),
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    })
    expect(await passkeyOfferSupported()).toBe(false)
  })
  test('platform authenticator with PRF: offered', async () => {
    setWindow({
      getClientCapabilities: async () => ({ userVerifyingPlatformAuthenticator: true, 'extension:prf': true }),
    })
    expect(await passkeyOfferSupported()).toBe(true)
  })
  test('no capability API: the platform check decides', async () => {
    setWindow({ isUserVerifyingPlatformAuthenticatorAvailable: async () => true })
    expect(await passkeyOfferSupported()).toBe(true)
  })
})

describe('first files flag', () => {
  test('pending only for the account that was just made', () => {
    const store = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    expect(firstFilesPending('u1')).toBe(false)
    markFirstFilesPending('u1')
    expect(firstFilesPending('u1')).toBe(true)
    expect(firstFilesPending('u2')).toBe(false)
    expect(firstFilesPending(undefined)).toBe(false)
  })
})

test('the step bar has four steps in the order of the frames', () => {
  expect(SIGNUP_STEP_LABELS).toEqual(['Master key', 'Password', 'Passkey', 'First files'])
})
