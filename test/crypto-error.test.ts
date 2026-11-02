/**
 * Task W-P2-4 — one typed error for crypto failures. The variants are the
 * failures the plan names (bad key, bad tag, truncated) plus the honest
 * unknown; the classifier reads core's wasm codes.
 */
import { describe, expect, test } from 'bun:test'
import { CryptoError, cryptoErrorKindOf, withCryptoError } from '../src/lib/crypto/errors'

describe('CryptoError variants', () => {
  test('bad key, bad tag and truncated each carry their kind', () => {
    expect(CryptoError.badKey().kind).toBe('bad-key')
    expect(CryptoError.badTag().kind).toBe('bad-tag')
    expect(CryptoError.truncated().kind).toBe('truncated')
    expect(CryptoError.badKey().name).toBe('CryptoError')
  })

  test('the cause message survives, so existing message matches still work', () => {
    const err = CryptoError.badTag(new Error('decryption failed'))
    expect(err.message).toBe('decryption failed')
    expect(err.cause).toBeInstanceOf(Error)
  })

  test('from() keeps a CryptoError as-is and wraps anything else', () => {
    const original = CryptoError.truncated()
    expect(CryptoError.from(original)).toBe(original)
    const wrapped = CryptoError.from(new Error('wrap is too short'))
    expect(wrapped).toBeInstanceOf(CryptoError)
    expect(wrapped.kind).toBe('truncated')
  })
})

describe('cryptoErrorKindOf', () => {
  test('classifies core whisker codes: length before tag', () => {
    expect(cryptoErrorKindOf(new Error('length_invalid'))).toBe('truncated')
    expect(cryptoErrorKindOf(new Error('bytes_invalid'))).toBe('truncated')
    expect(cryptoErrorKindOf(new Error('ciphertext total mismatch: emitted 3'))).toBe('truncated')
    expect(cryptoErrorKindOf(new Error('decryption failed'))).toBe('bad-tag')
    expect(cryptoErrorKindOf(new Error('master_key must be exactly 32 bytes'))).toBe('bad-key')
    expect(cryptoErrorKindOf('some string failure')).toBe('unknown')
    expect(cryptoErrorKindOf(new TypeError('x'))).toBe('unknown')
    expect(cryptoErrorKindOf(CryptoError.badKey())).toBe('bad-key')
  })
})

describe('withCryptoError', () => {
  test('passes a success through untouched', async () => {
    await expect(withCryptoError(async () => 42)).resolves.toBe(42)
  })

  test('turns any rejection into a CryptoError of the right kind', async () => {
    const err = await withCryptoError(async () => { throw new Error('decryption failed') }).catch((e) => e)
    expect(err).toBeInstanceOf(CryptoError)
    expect(err.kind).toBe('bad-tag')

    const len = await withCryptoError(async () => { throw new Error('wrap is too short') }).catch((e) => e)
    expect(len.kind).toBe('truncated')
  })
})
