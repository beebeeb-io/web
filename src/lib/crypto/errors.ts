/**
 * One typed error for every crypto failure (W-P2-4).
 *
 * Core's wasm reports failures as codes inside an `Error` message
 * (`decryption failed`, `length_invalid`, `bytes_invalid`, `… too short`).
 * Callers used to branch on those strings; they can branch on `kind` instead.
 * A wrong key and a corrupted tag are the same AES-256-GCM failure at the
 * wasm boundary, so `bad-tag` is what a decrypt reports for both — the caller
 * that knows the key was just derived may read it as `bad-key`.
 */
export type CryptoErrorKind = 'bad-key' | 'bad-tag' | 'truncated' | 'unknown'

const TRUNCATED = /too short|truncat|missing ciphertext|bytes_invalid|length_invalid|size mismatch|total mismatch/i
const BAD_KEY = /key must be|must be (?:exactly )?(?:\d+ )?bytes|invalid key|key_invalid/i
const BAD_TAG = /decryption failed|authentication|bad tag|aead|unable to authenticate/i

export class CryptoError extends Error {
  readonly kind: CryptoErrorKind

  constructor(kind: CryptoErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? defaultMessage(kind), options)
    this.name = 'CryptoError'
    this.kind = kind
  }

  static badKey(cause?: unknown): CryptoError {
    return CryptoError.from(cause, 'bad-key')
  }

  static badTag(cause?: unknown): CryptoError {
    return CryptoError.from(cause, 'bad-tag')
  }

  static truncated(cause?: unknown): CryptoError {
    return CryptoError.from(cause, 'truncated')
  }

  /** Keep a `CryptoError` as-is; otherwise wrap the cause under the given kind. */
  static from(cause: unknown, kind: CryptoErrorKind = cryptoErrorKindOf(cause)): CryptoError {
    if (cause instanceof CryptoError) return cause
    return new CryptoError(kind, messageOf(cause), { cause })
  }
}

function defaultMessage(kind: CryptoErrorKind): string {
  switch (kind) {
    case 'bad-key': return 'the key does not open this data'
    case 'bad-tag': return 'decryption failed'
    case 'truncated': return 'the encrypted data is truncated'
    case 'unknown': return 'crypto operation failed'
  }
}

function messageOf(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string' && cause.length > 0) return cause
  return undefined
}

/**
 * Classify a thrown value by core's error code. Order matters: a length
 * failure is reported before a tag failure because wasm checks the frame
 * length first.
 */
export function cryptoErrorKindOf(err: unknown): CryptoErrorKind {
  if (err instanceof CryptoError) return err.kind
  const message = messageOf(err) ?? ''
  if (TRUNCATED.test(message)) return 'truncated'
  if (BAD_KEY.test(message)) return 'bad-key'
  if (BAD_TAG.test(message)) return 'bad-tag'
  return 'unknown'
}

/** Wrap a crypto call so every failure surfaces as a `CryptoError`. */
export async function withCryptoError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw CryptoError.from(err)
  }
}
