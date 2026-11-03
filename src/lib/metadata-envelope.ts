// The JSON metadata envelope (a name, note or metadata blob's stored form),
// both directions, from core's `metadata_wire` module.
//
// One grammar for web, CLI, mobile and core: the reader accepts every stored
// form those clients have written (`{"nonce","ciphertext"}` with base64 or
// numeric bytes, an optional `cipher_suite`, Swift's short `n`/`c`), and the
// writer emits core's frozen canonical form
// `{"ciphertext":"<base64>","nonce":"<base64>"}`. Names sealed by older web
// builds therefore keep opening after the switch: only the writer changed.
//
// These are plain functions over the beebeeb-wasm module, like
// `content-crypto.ts`: the crypto worker runs them, unit tests run the same
// functions over the committed WASM build (`initSync`).
import type * as Wasm from 'beebeeb-wasm'

/** The slice of the beebeeb-wasm module the envelope codec uses. */
export type EnvelopeWasm = Pick<typeof Wasm, 'encodeMetadataEnvelope' | 'decodeMetadataEnvelope'>

export interface EnvelopeBytes {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** Serialize a nonce + ciphertext pair into core's canonical wire format. */
export function encodeEnvelope(wasm: EnvelopeWasm, nonce: Uint8Array, ciphertext: Uint8Array): string {
  return wasm.encodeMetadataEnvelope(nonce, ciphertext)
}

/**
 * Parse any accepted stored envelope. Throws `invalid input: …` (core's own
 * text) for invalid JSON, a missing or non-byte field, an unknown cipher
 * suite or a `null` field; fields core does not know are ignored.
 */
export function decodeEnvelope(wasm: EnvelopeWasm, payload: string): EnvelopeBytes {
  const envelope = wasm.decodeMetadataEnvelope(payload) as {
    nonce: ArrayLike<number>
    ciphertext: ArrayLike<number>
  }
  return {
    nonce: Uint8Array.from(envelope.nonce),
    ciphertext: Uint8Array.from(envelope.ciphertext),
  }
}
