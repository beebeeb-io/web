// ─── SF-0002 review: a write-time read-only check ─────
//
// A read-only mark set only when a row is OPENED is not enough: a replace,
// rename or new version can be the first thing this client does with a row.
// Before such a write, the CURRENT version's chunk 0 is authenticated with
// core's per-version owner resolver. A version that resolves as `upper_repair`
// marks the row read-only and the write is refused with the honest copy.
//
// Round 2 (W2): the check fails CLOSED. Only a frame that authenticates gives a
// verdict (`string`/`binary` → writable, `upper_repair` → read-only). A failed
// request, or a prefix in which no candidate frame length authenticates under
// any owner convention, is UNKNOWN: the write is refused with a retryable
// message and the row is never marked read-only for it.
//
// Only the owner's own rows are checked: a request upload, a guest's row and
// (when the viewer is known) a member's row are not sealed under an owner
// convention, so there is nothing to resolve. Only a bounded prefix is read.

import { getApiUrl, getToken, type DriveFile } from './api'
import { ownerRepairContentKey } from './crypto'
import { isRequestUpload } from './file-request-crypto'
import { OWNER_REPAIR_READ_ONLY, isOwnerRepairReadOnly, markOwnerRepairReadOnly } from './owner-repair'

/** Shown when the check itself could not reach a verdict (network, server, or no frame authenticated). Retryable. */
export const OWNER_WRITE_CHECK_FAILED = "Couldn't check this file before changing it. Try again."

const NONCE_AND_TAG = 28
/** The older iOS File Provider's chunk size. */
const FILE_PROVIDER_CHUNK = 1024 * 1024
/** Web/desktop default chunk size (crypto.ts CHUNK_SIZE). */
const DEFAULT_CHUNK = 4 * 1024 * 1024
/** Core's maximum plaintext chunk size; the read never goes past one frame. */
const MAX_FRAME = 256 * 1024 * 1024 + NONCE_AND_TAG

export type WriteTarget = Pick<
  DriveFile,
  | 'id'
  | 'is_folder'
  | 'size_bytes'
  | 'chunk_count'
  | 'acted_via_share_id'
  | 'uploaded_by'
  | 'file_request_id'
  | 'sender_ephemeral_pubkey'
  | 'wrapped_content_key'
>

export interface WriteCheckOptions {
  /**
   * The account the resident key belongs to (`useKeys().getResidentUserId()`).
   * A row another member uploaded is then skipped; unknown (null) checks it.
   */
  viewerId?: string | null
}

/** The write was refused because no verdict was reached; retrying may succeed. */
function checkFailed(cause?: unknown): Error {
  return new Error(OWNER_WRITE_CHECK_FAILED, cause === undefined ? undefined : { cause })
}

function intHeader(value: string | null): number | null {
  const n = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Is this row's content sealed under one of the OWNER's conventions? A request
 * upload (sealed content key), a guest's row (link) and a member's row are not:
 * the owner's master key resolves nothing for them, so there is no verdict to
 * reach. An unknown viewer keeps a member-attributed row checked (the safe side:
 * refused when undecided, never silently allowed).
 */
function isOwnerContentRow(file: WriteTarget, viewerId: string | null | undefined): boolean {
  if (isRequestUpload(file)) return false
  if (file.acted_via_share_id != null) return false
  if (file.uploaded_by && viewerId && file.uploaded_by !== viewerId) return false
  return true
}

/** Candidate wire-frame lengths for chunk 0, most likely first (none longer than `have`). */
export function chunk0Candidates(
  have: number,
  sizeBytes: number,
  chunkCount: number,
  chunkSize: number | null,
): number[] {
  const out: number[] = []
  const push = (v: number) => {
    if (Number.isInteger(v) && v > 0 && v <= have && !out.includes(v)) out.push(v)
  }
  if (chunkCount <= 1) {
    push(have)
    return out
  }
  if (chunkSize) push(chunkSize + NONCE_AND_TAG)
  push(DEFAULT_CHUNK + NONCE_AND_TAG)
  push(FILE_PROVIDER_CHUNK + NONCE_AND_TAG)
  if (sizeBytes > 0) push(Math.floor((sizeBytes + NONCE_AND_TAG * chunkCount) / chunkCount))
  return out
}

/** How many bytes the check reads: enough for the longest candidate frame 0, never past one frame. */
function prefixLength(sizeBytes: number, chunkCount: number, chunkSize: number | null, contentLength: number | null): number {
  if (chunkCount <= 1) return Math.max(1, Math.min(contentLength ?? sizeBytes + NONCE_AND_TAG, MAX_FRAME))
  const longest = Math.max(
    chunkSize ? chunkSize + NONCE_AND_TAG : 0,
    DEFAULT_CHUNK + NONCE_AND_TAG,
    FILE_PROVIDER_CHUNK + NONCE_AND_TAG,
    sizeBytes > 0 ? Math.floor((sizeBytes + NONCE_AND_TAG * chunkCount) / chunkCount) : 0,
  )
  return Math.min(longest, MAX_FRAME)
}

/** Read at most `want` bytes of a response body, then stop the transfer. */
async function readPrefix(res: Response, want: number): Promise<Uint8Array> {
  const buf = new Uint8Array(want)
  let have = 0
  if (res.body) {
    const reader = res.body.getReader()
    try {
      while (have < want) {
        const { done, value } = await reader.read()
        if (done) break
        const take = Math.min(value.length, want - have)
        buf.set(value.subarray(0, take), have)
        have += take
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* the prefix is all we needed */
      }
    }
  } else {
    const all = new Uint8Array(await res.arrayBuffer())
    have = Math.min(all.length, want)
    buf.set(all.subarray(0, have))
  }
  return buf.subarray(0, have)
}

type Verdict = 'writable' | 'read_only'

/**
 * Which owner convention seals this version's chunk 0. Throws
 * OWNER_WRITE_CHECK_FAILED when no verdict is reached.
 */
async function resolveVersion(
  path: string,
  fileId: string,
  sizeBytes: number,
  rowChunkCount: number,
  masterKey: Uint8Array,
): Promise<Verdict> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${getApiUrl()}${path}`, { headers, credentials: 'include' })
  } catch (err) {
    throw checkFailed(err)
  }
  if (!res.ok) {
    try {
      await res.body?.cancel()
    } catch {
      /* nothing to drain */
    }
    throw checkFailed()
  }
  const chunkCount = Math.max(1, intHeader(res.headers.get('X-Chunk-Count')) ?? rowChunkCount)
  const chunkSize = intHeader(res.headers.get('X-Chunk-Size'))
  const want = prefixLength(sizeBytes, chunkCount, chunkSize, intHeader(res.headers.get('Content-Length')))
  let bytes: Uint8Array
  try {
    bytes = await readPrefix(res, want)
  } catch (err) {
    throw checkFailed(err)
  }
  for (const len of chunk0Candidates(bytes.length, sizeBytes, chunkCount, chunkSize)) {
    let repair: { key: Uint8Array; convention: string } | null = null
    try {
      // A copy of just this candidate: a view would clone the whole prefix
      // buffer across the worker boundary.
      repair = await ownerRepairContentKey(masterKey, fileId, bytes.slice(0, len))
    } catch {
      // Core throws when this length authenticates under no owner convention:
      // the next candidate may be frame 0's real length.
      continue
    }
    if (!repair || !(repair.key instanceof Uint8Array)) continue
    repair.key.fill(0)
    // The first candidate that authenticates decides.
    if (repair.convention === 'upper_repair') return 'read_only'
    if (repair.convention === 'string' || repair.convention === 'binary') return 'writable'
  }
  // Nothing authenticated: no verdict, so no write.
  throw checkFailed()
}

/**
 * Refuse a replace, rename, note or new version of an owner row whose current
 * version is sealed under the read-only uppercase repair convention. Throws
 * the exact copy the person sees: OWNER_REPAIR_READ_ONLY (permanent) or
 * OWNER_WRITE_CHECK_FAILED (no verdict; retryable). A no-op for a folder, a
 * row not sealed under an owner convention, or when no master key is held.
 */
export async function assertCurrentVersionWritable(
  file: WriteTarget,
  masterKey: Uint8Array | undefined,
  opts: WriteCheckOptions = {},
): Promise<void> {
  if (isOwnerRepairReadOnly(file.id)) throw new Error(OWNER_REPAIR_READ_ONLY)
  // SF-0002 round 2 (W1): a folder has no content version, and its /download
  // answers 4xx. Its NAME is covered by the mark above (the name resolver
  // marks an upper_repair name), so nothing is fetched for it.
  if (file.is_folder) return
  if (!masterKey) return
  if (!isOwnerContentRow(file, opts.viewerId)) return
  // The check only reports which owner convention authenticates chunk 0 and
  // refuses on `upper_repair`; it never switches the key a write uses.
  const verdict = await resolveVersion(
    `/api/v1/files/${file.id}/download`,
    file.id,
    file.size_bytes ?? 0,
    Math.max(1, file.chunk_count ?? 1),
    masterKey,
  )
  if (verdict === 'read_only') {
    markOwnerRepairReadOnly(file.id)
    throw new Error(OWNER_REPAIR_READ_ONLY)
  }
}

/** The message to show for a refused owner write, or null when `err` is some other failure. */
export function ownerWriteRefusal(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  return err.message === OWNER_REPAIR_READ_ONLY || err.message === OWNER_WRITE_CHECK_FAILED ? err.message : null
}
