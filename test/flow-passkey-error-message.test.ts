/**
 * Passkey add-flow error copy (flow "web core journeys", fix lane 6).
 *
 * The server surfaces webauthn-rs's raw library strings on a failed
 * register-finish (e.g. "The clients relying party origin does not match our
 * servers information"), and the browser throws DOMExceptions with its own
 * wording. Neither belongs in a toast. `passkeyErrorMessage` maps the known
 * shapes to plain copy and lets our own already-human messages through.
 */
import { describe, expect, test } from 'bun:test'
import { passkeyErrorMessage } from '../src/lib/passkey-errors'

function domError(name: string, message = 'browser text'): Error {
  const e = new Error(message)
  e.name = name
  return e
}

describe('passkeyErrorMessage', () => {
  test('relying-party ORIGIN mismatch (webauthn-rs InvalidRPOrigin) is not shown raw', () => {
    const msg = passkeyErrorMessage(
      new Error('The clients relying party origin does not match our servers information'),
    )
    expect(msg).not.toContain('relying party')
    expect(msg).toBe(
      "This passkey was created for a different web address than the one you're on. Open Beebeeb at its usual address and try again.",
    )
  })

  test('relying-party ID hash mismatch (InvalidRPIDHash) maps to the same copy', () => {
    const msg = passkeyErrorMessage(
      new Error('The clients relying party id hash does not match the hash of our relying party id'),
    )
    expect(msg).not.toContain('relying party')
  })

  test('browser cancel / timeout (NotAllowedError) reads as cancelled', () => {
    expect(passkeyErrorMessage(domError('NotAllowedError'))).toBe(
      'Passkey creation was cancelled or timed out.',
    )
  })

  test('authenticator already registered (InvalidStateError)', () => {
    expect(passkeyErrorMessage(domError('InvalidStateError'))).toBe(
      'This device already has a passkey for your account.',
    )
  })

  test('other webauthn-rs library errors get a generic message, not the raw string', () => {
    const msg = passkeyErrorMessage(
      new Error('The client response challenge differs from the latest challenge issued to the userId'),
    )
    expect(msg).toBe("We couldn't verify this passkey. Please try again.")
  })

  test('our own human server messages pass through unchanged', () => {
    const own =
      'registration session not found, expired, already used, or not started by this account — start over'
    expect(passkeyErrorMessage(new Error(own))).toBe(own)
  })

  test('non-Error values fall back to a generic message', () => {
    expect(passkeyErrorMessage('boom')).toBe('Failed to add passkey')
    expect(passkeyErrorMessage(new Error(''))).toBe('Failed to add passkey')
  })
})
