import { withProxy } from './service'

// ─── File requests (sealed-box / ECIES per request) ─────────────────────────
//
// All crypto is the core `file_request` binding — this layer only composes the
// pieces. Two domain-separation inputs (`request_id` for the private-key wrap,
// `file_id` for the per-upload seal) are passed to core as HKDF `info`. Because
// the SERVER assigns the request UUID and the file UUID *after* the client has
// already wrapped / sealed, neither id is known at wrap/seal time, and the
// server carries no client-chosen id to echo back. So both sides use a FIXED
// EMPTY value — the only value reconstructable by both the wrapper/unwrapper and
// the sealer/opener. This stays secure: each wrap uses a fresh random GCM nonce,
// and each seal uses a fresh ephemeral X25519 keypair, so uniqueness never
// depends on the (empty) id. Every client (web/cli/mobile) MUST use this same
// empty convention for links to round-trip cross-client.
export const FILE_REQUEST_EMPTY_ID = new Uint8Array(0)

export interface RequestKeypair {
  /** 32-byte X25519 private key (R_priv). Wrap before persisting. */
  privateKey: Uint8Array
  /** 32-byte X25519 public key (R_pub). Goes in the link fragment. */
  publicKey: Uint8Array
}

/** Generate a fresh per-request X25519 keypair. R_priv is 32 random bytes;
 *  R_pub is derived by the core binding (clamping applied internally). */
export async function generateRequestKeypair(): Promise<RequestKeypair> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32))
  const publicKey = await withProxy((p) => p.deriveX25519PublicFromPrivate(privateKey))
  return { privateKey, publicKey }
}

/** Derive R_pub from a (already-unwrapped) R_priv — used to rebuild a link. */
export async function derivePublicFromPrivate(rPriv: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.deriveX25519PublicFromPrivate(rPriv))
}

/** Wrap a request's R_priv under the owner's master key. */
export async function wrapRequestPrivate(
  masterKey: Uint8Array,
  rPriv: Uint8Array,
  requestId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<{ wrapped: Uint8Array; nonce: Uint8Array }> {
  return withProxy((p) => p.wrapRequestPrivate(masterKey, requestId, rPriv))
}

/** Unwrap a request's R_priv with the owner's master key. */
export async function unwrapRequestPrivate(
  masterKey: Uint8Array,
  wrapped: Uint8Array,
  nonce: Uint8Array,
  requestId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapRequestPrivate(masterKey, requestId, wrapped, nonce))
}

/** Seal a per-file content key C to a request public key (uploader path).
 *  Returns the uploader's ephemeral public key + the wrapped content key. */
export async function sealToRequest(
  rPub: Uint8Array,
  contentKey: Uint8Array,
  fileId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<{ ePub: Uint8Array; wrappedKey: Uint8Array }> {
  const result = await withProxy((p) => p.sealToRequest(rPub, fileId, contentKey))
  return { ePub: result.e_pub, wrappedKey: result.wrapped_key }
}

/** Open a sealed upload, recovering the content key C (owner decrypt path). */
export async function openRequestUpload(
  rPriv: Uint8Array,
  ePub: Uint8Array,
  wrappedKey: Uint8Array,
  fileId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<Uint8Array> {
  return withProxy((p) => p.openRequestUpload(rPriv, ePub, fileId, wrappedKey))
}
