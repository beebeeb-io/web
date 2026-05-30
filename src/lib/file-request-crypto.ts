// ─── File-request owner decrypt path ────────────────────────────────────────
//
// Files that arrive through a file request are NOT encrypted with the owner's
// normal per-file key. Instead the anonymous uploader sealed a random content
// key C to the request's public key R_pub (ECIES), and the server stored, on
// the file row:
//   - file_request_id          → which request this belongs to
//   - sender_ephemeral_pubkey  → the uploader's ephemeral X25519 public key E_pub
//   - wrapped_content_key      → C sealed under ECDH(E, R_pub)
//
// To decrypt, the owner:
//   1. looks up the owning request → wrapped_private_key + wrap_nonce,
//   2. unwraps R_priv with the master key,
//   3. C = open_request_upload(R_priv, E_pub, EMPTY_FILE_ID, wrapped_content_key),
//   4. uses C as the file key for chunk + filename decryption.
//
// After step 4 the rest of the pipeline (encryptedDownload / decryptToBlob /
// decryptFileMetadata) is identical to a normal file — they all take a raw
// 32-byte file key.
//
// SERVER DEPENDENCY: this branch only activates once the server returns
// file_request_id / sender_ephemeral_pubkey / wrapped_content_key on file
// list/get responses. As of the 0639 server they are stored but NOT returned,
// so `isRequestUpload` is false for every file today. The crypto below is
// proven correct by the roundtrip test; wiring it into the drive is a no-op
// until the server exposes the fields.

import type { DriveFile } from './api'
import { listFileRequests, type FileRequest } from './api'
import { fromBase64, openRequestUpload, unwrapRequestPrivate, zeroize } from './crypto'

/** True when a file must be decrypted via the request-key path, not derive_file_key. */
export function isRequestUpload(file: Pick<DriveFile, 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>): boolean {
  return Boolean(file.file_request_id && file.sender_ephemeral_pubkey && file.wrapped_content_key)
}

/**
 * Recover the content key C for a single request-uploaded file.
 *
 * @param file        DriveFile carrying file_request_id + sender_ephemeral_pubkey + wrapped_content_key
 * @param masterKey   the owner's 32-byte master key
 * @param requestById a lookup of the owner's requests by id (so R_priv can be unwrapped)
 * @returns the 32-byte content key, usable anywhere a normal file key is
 */
export async function resolveRequestFileKey(
  file: Pick<DriveFile, 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
  masterKey: Uint8Array,
  requestById: Map<string, FileRequest>,
): Promise<Uint8Array> {
  if (!isRequestUpload(file)) {
    throw new Error('resolveRequestFileKey called on a non-request file')
  }
  const req = requestById.get(file.file_request_id!)
  if (!req || !req.wrapped_private_key || !req.wrap_nonce) {
    throw new Error('owning file request (or its wrapped key) not found — cannot decrypt')
  }

  const wrappedPriv = fromBase64(req.wrapped_private_key)
  const wrapNonce = fromBase64(req.wrap_nonce)
  const ePub = fromBase64(file.sender_ephemeral_pubkey!)
  const wrappedKey = fromBase64(file.wrapped_content_key!)

  const rPriv = await unwrapRequestPrivate(masterKey, wrappedPriv, wrapNonce)
  try {
    return await openRequestUpload(rPriv, ePub, wrappedKey)
  } finally {
    zeroize(rPriv)
  }
}

/**
 * Build an id→request lookup for the current owner. Convenience for callers
 * that need to decrypt several request files at once.
 */
export async function loadRequestLookup(): Promise<Map<string, FileRequest>> {
  const { file_requests } = await listFileRequests()
  return new Map(file_requests.map((r) => [r.id, r]))
}

/**
 * Caching resolver for the owner-decrypt path — mirrors the CLI's
 * `RequestKeyResolver`. It fetches GET /file-requests once (memoised), and
 * unwraps each request's R_priv at most once (cached by request id), so naming
 * + opening many request-uploaded files in the drive does O(requests) unwraps
 * rather than O(files). A cache miss (a file whose request isn't in the loaded
 * set yet — e.g. created after the first load) triggers exactly one reload.
 *
 * R_priv buffers live for the resolver's lifetime (the drive session). Call
 * `clear()` on lock/logout to zero them.
 */
export interface RequestKeyResolver {
  /** Recover the content key C for a request-uploaded file. */
  resolveFileKey(
    file: Pick<DriveFile, 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
    masterKey: Uint8Array,
  ): Promise<Uint8Array>
  /** Zero cached R_priv buffers and drop the memoised request list. */
  clear(): void
}

export function createRequestKeyResolver(): RequestKeyResolver {
  let requestsPromise: Promise<Map<string, FileRequest>> | null = null
  const rPrivCache = new Map<string, Uint8Array>()

  const loadRequests = (force: boolean): Promise<Map<string, FileRequest>> => {
    if (force || !requestsPromise) requestsPromise = loadRequestLookup()
    return requestsPromise
  }

  return {
    async resolveFileKey(file, masterKey) {
      if (!isRequestUpload(file)) {
        throw new Error('resolveFileKey called on a non-request file')
      }
      const requestId = file.file_request_id!

      // Reuse the unwrapped R_priv if we've already opened a file for this request.
      let rPriv = rPrivCache.get(requestId)
      if (!rPriv) {
        let reqMap = await loadRequests(false)
        let req = reqMap.get(requestId)
        if (!req) {
          // The request may have been created after our first load — reload once.
          reqMap = await loadRequests(true)
          req = reqMap.get(requestId)
        }
        if (!req || !req.wrapped_private_key || !req.wrap_nonce) {
          throw new Error('owning file request (or its wrapped key) not found — cannot decrypt')
        }
        rPriv = await unwrapRequestPrivate(masterKey, fromBase64(req.wrapped_private_key), fromBase64(req.wrap_nonce))
        rPrivCache.set(requestId, rPriv)
      }

      const ePub = fromBase64(file.sender_ephemeral_pubkey!)
      const wrappedKey = fromBase64(file.wrapped_content_key!)
      return openRequestUpload(rPriv, ePub, wrappedKey)
    },

    clear() {
      for (const k of rPrivCache.values()) zeroize(k)
      rPrivCache.clear()
      requestsPromise = null
    },
  }
}
