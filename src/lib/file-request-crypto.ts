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
import {
  FILE_REQUEST_EMPTY_ID,
  fromBase64,
  isForeignItemIdWorker,
  openRequestUpload,
  readNameMetadata,
  resolveOwnedItemWorker,
  resolveRequestRowWorker,
  unwrapRequestPrivate,
  zeroize,
} from './crypto'

/**
 * 2275 L13 / A9c — the dual-key view of a request row. The row's CONTENT stays
 * under the sealed content key C; its NAME is derived-or-C (derived first),
 * because an old client may have renamed the row under the string convention.
 * Core `resolveRequestRow` decides which name key opens and returns it with the
 * decrypted name. Read-only: a request row has no write target.
 */
export interface ResolvedRowKeys {
  contentKey: Uint8Array
  nameKey: Uint8Array
  nameOrigin: string
  /** Core returns the name FLAT (a string), not a nested object. */
  name: string | null
  mimeType?: string | null
  chunkFormat?: number
}

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
  /**
   * Recover the content key C for a request-uploaded file. F6: this is the same
   * gated reader as `resolveRow` — the download, zip, share-link, Recent,
   * Starred, Quick Access and office-editor paths all come through here.
   */
  resolveFileKey(
    file: Pick<DriveFile, 'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
    masterKey: Uint8Array,
  ): Promise<Uint8Array>
  /**
   * 2275 L13 / A9c — resolve BOTH keys of a request row through core
   * `resolveRequestRow`: content stays under C, name is derived-or-C with the
   * derived key tried first. Returns the name core decrypted, so callers never
   * re-implement the "derived first" choice. Read-only; there is no write
   * target to return.
   */
  resolveRow(
    file: Pick<DriveFile, 'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
    masterKey: Uint8Array,
  ): Promise<ResolvedRowKeys>
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

  /** The owning request row, reloading once when a newer request is missing. */
  const requestFor = async (
    requestId: string,
  ): Promise<FileRequest & { wrapped_private_key: string; wrap_nonce: string }> => {
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
    // Re-assert the guarded fields so callers see them as non-null strings.
    return { ...req, wrapped_private_key: req.wrapped_private_key, wrap_nonce: req.wrap_nonce }
  }

  /** The unwrapped R_priv for a request, unwrapped at most once and cached. */
  const privateFor = async (requestId: string, masterKey: Uint8Array): Promise<Uint8Array> => {
    let rPriv = rPrivCache.get(requestId)
    if (!rPriv) {
      const req = await requestFor(requestId)
      rPriv = await unwrapRequestPrivate(masterKey, fromBase64(req.wrapped_private_key), fromBase64(req.wrap_nonce))
      rPrivCache.set(requestId, rPriv)
    }
    return rPriv
  }

  /**
   * R5: the pre-2236 request reader. Production (upload-request.tsx) seals C
   * with the FIXED EMPTY context, while core's bound `resolveRequestRow` opens
   * the seal with the row id, so a production row cannot open there.
   *
   * INVARIANT: not a general request-row reader. A caller reaches it only
   * after core refused the row, and only when both gates pass — the same two
   * the CLI applies (cli a3887e2):
   *   1. the id is OWNER class (a foreign id never resolves through a request
   *      envelope; core refuses it and no fallback may override that), and
   *   2. the name is an encrypted envelope (a plaintext name authenticates
   *      nothing, so opening it would show an unproven row as proven).
   * The legacy shape can prove no more than that; it is not authentication.
   */
  const legacyRowKeys = async (
    file: Pick<DriveFile, 'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
    masterKey: Uint8Array,
  ): Promise<ResolvedRowKeys> => {
    const rPriv = await privateFor(file.file_request_id!, masterKey)
    // Empty seal context — what the shipped web uploader wrote.
    const contentKey = await openRequestUpload(
      rPriv,
      fromBase64(file.sender_ephemeral_pubkey!),
      fromBase64(file.wrapped_content_key!),
    )

    // Name: derived first (a rename by an L13 client), else C (the original).
    try {
      const derived = await resolveOwnedItemWorker({
        masterKey,
        itemId: file.id,
        kind: 1,
        nameEncrypted: file.name_encrypted,
      })
      return {
        contentKey,
        nameKey: derived.key,
        nameOrigin: derived.origin,
        name: derived.name?.name ?? null,
        mimeType: derived.name?.mimeType ?? null,
        chunkFormat: derived.name?.chunkFormat,
      }
    } catch {
      // Core's own strict reader: throws for a wrong key or a bad envelope.
      const meta = await readNameMetadata(contentKey, file.name_encrypted)
      return {
        contentKey,
        nameKey: contentKey,
        nameOrigin: 'request_content',
        name: meta.name,
        mimeType: meta.mimeType,
        chunkFormat: meta.pin,
      }
    }
  }

  /**
   * F6: the ONE gated reader for a request row. Every key path goes through it:
   * core's bound resolver, then — only behind the owner-class id gate and the
   * encrypted-name gate — the R5 legacy reader. A member's F row the server
   * marks as a request row is refused here, never opened by an empty-id seal.
   */
  const resolveGatedRow = async (
    file: Pick<DriveFile, 'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
    masterKey: Uint8Array,
  ): Promise<ResolvedRowKeys> => {
    if (!isRequestUpload(file)) {
      throw new Error('resolveRow called on a non-request file')
    }
    const req = await requestFor(file.file_request_id!)
      try {
        const row = await resolveRequestRowWorker({
          masterKey,
          itemId: file.id,
          // Core opens the per-upload seal with the ROW's id bytes as HKDF info,
          // while the request-private wrap uses the fixed EMPTY convention.
          requestId: FILE_REQUEST_EMPTY_ID,
          wrappedRequestPrivate: fromBase64(req.wrapped_private_key),
          wrapNonce: fromBase64(req.wrap_nonce),
          senderEphemeralPubkey: fromBase64(file.sender_ephemeral_pubkey!),
          wrappedContentKey: fromBase64(file.wrapped_content_key!),
          nameEncrypted: file.name_encrypted,
        })
        return {
          contentKey: row.contentKey,
          nameKey: row.nameKey,
          nameOrigin: row.nameOrigin,
          name: row.name,
          mimeType: row.mimeType,
          chunkFormat: row.chunkFormat,
        }
      } catch (err) {
        // Only a row core refused for "not a bound envelope" may try R5. The
        // class and name gates are the minimum the legacy shape can prove; a
        // failure of either re-throws core's refusal unchanged.
        let foreign = true
        try {
          foreign = await isForeignItemIdWorker(file.id)
        } catch {
          // Not a canonical id at all: core would refuse it — no fallback.
        }
        if (foreign) throw err
        if (!file.name_encrypted.startsWith('{')) throw err
        return legacyRowKeys(file, masterKey)
      }
  }

  return {
    async resolveFileKey(file, masterKey) {
      // F6: the content key comes from the same gated reader as the dual-key
      // path; there is no unchecked empty-id opening.
      return (await resolveGatedRow(file, masterKey)).contentKey
    },
    resolveRow: resolveGatedRow,

    clear() {
      for (const k of rPrivCache.values()) zeroize(k)
      rPrivCache.clear()
      requestsPromise = null
    },
  }
}
