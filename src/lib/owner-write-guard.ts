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
//
// Round 2 (W5): the request is the shared download request (auth, a
// `429 server_busy` retry, the caller's AbortSignal), and a writable verdict is
// remembered per (file, content version) for the session, so repeated renames
// of one row probe once. Cleared with the read-only marks on lock. Round 3
// (X7): the version is the server's current object version from a fresh
// `GET /files/:id`, never the listing row.

import { getFile, restoreVersion, type DriveFile, type FileVersion } from './api'
import { ownerRepairContentKey } from './crypto'
import { parseHeaderInt, requestEncryptedBody } from './encrypted-download'
import { isRequestUpload } from './file-request-crypto'
import {
  OWNER_REPAIR_READ_ONLY,
  isKnownWritableVersion,
  isOwnerRepairReadOnly,
  markOwnerRepairReadOnly,
  rememberWritableVersion,
} from './owner-repair'

/** Shown when the check itself could not reach a verdict (network, server, or no frame authenticated). Retryable. */
export const OWNER_WRITE_CHECK_FAILED = "Couldn't check this file before changing it. Try again."

/** Shown when the check needs the vault (its key, or the account it belongs to) and does not have it. */
export const OWNER_WRITE_NEEDS_UNLOCK = 'Unlock the vault before changing this file.'

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
   * A row another member uploaded is then skipped. Unknown (null) refuses any
   * row with a recorded uploader (round 3, X4).
   */
  viewerId?: string | null
  /** Cancels the check (an AbortError is rethrown as is, never as a verdict). */
  signal?: AbortSignal
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** The row as `GET /files/:id` answers it: the listing type plus the server's current version. */
type FreshRow = DriveFile & { download_version?: { object_version_id?: string | null } | null }

/**
 * Round 3 (X7): the session cache key of the row's CURRENT content version,
 * from a FRESH read of the row, never the listing (a stale listing row would
 * let a new version skip the probe). Keyed on the server's object version id;
 * a row without one (legacy v1 rows; a legacy restore clears it) is not cached
 * and is probed on every write.
 */
function freshVersionKey(fresh: FreshRow): string | null {
  const id = fresh.download_version?.object_version_id
  return id ? `${fresh.id}|ov:${id}` : null
}

/** The check needs the vault and does not have it (round 3, X2 and X4). */
function needsUnlock(): Error {
  return new Error(OWNER_WRITE_NEEDS_UNLOCK)
}

/** The write was refused because no verdict was reached; retrying may succeed. */
function checkFailed(cause?: unknown): Error {
  return new Error(OWNER_WRITE_CHECK_FAILED, cause === undefined ? undefined : { cause })
}

/**
 * Is this row's content sealed under one of the OWNER's conventions?
 * - `other`: a request upload (sealed content key), a guest's row (link) or a
 *   row another member uploaded. The owner's master key resolves nothing for
 *   it, so there is nothing to check.
 * - `owner`: the viewer's own upload, or a row with no uploader recorded
 *   (legacy rows; the server sets `uploaded_by` at upload commit).
 * - `unknown` (round 3, X4): an uploader is recorded but the viewer is not
 *   known. Probing it under the owner's key would refuse a member's row for
 *   good, and skipping it would let an owner row through: the caller refuses
 *   with the unlock copy instead.
 */
function contentOwner(file: WriteTarget, viewerId: string | null | undefined): 'owner' | 'other' | 'unknown' {
  if (isRequestUpload(file)) return 'other'
  if (file.acted_via_share_id != null) return 'other'
  if (!file.uploaded_by) return 'owner'
  if (!viewerId) return 'unknown'
  return file.uploaded_by === viewerId ? 'owner' : 'other'
}

/** True when the owner check applies; throws the unlock copy when the viewer is unknown. */
function isOwnerContentRow(file: WriteTarget, viewerId: string | null | undefined): boolean {
  const owner = contentOwner(file, viewerId)
  if (owner === 'unknown') throw needsUnlock()
  return owner === 'owner'
}

/**
 * Candidate wire-frame lengths for chunk 0, most likely first, never past one
 * frame. The ONE list both the read length and the tries come from (round 3,
 * X5). A single-chunk version's frame is the whole body.
 */
export function chunk0Candidates(
  sizeBytes: number,
  chunkCount: number,
  chunkSize: number | null,
  contentLength: number | null,
): number[] {
  const out: number[] = []
  const push = (v: number) => {
    const len = Math.min(v, MAX_FRAME)
    if (Number.isInteger(len) && len > 0 && !out.includes(len)) out.push(len)
  }
  if (chunkCount <= 1) {
    push(contentLength ?? sizeBytes + NONCE_AND_TAG)
    return out
  }
  if (chunkSize) push(chunkSize + NONCE_AND_TAG)
  push(DEFAULT_CHUNK + NONCE_AND_TAG)
  push(FILE_PROVIDER_CHUNK + NONCE_AND_TAG)
  if (sizeBytes > 0) push(Math.floor((sizeBytes + NONCE_AND_TAG * chunkCount) / chunkCount))
  return out
}

/**
 * How many bytes the check reads, from the candidate list: with the server's
 * chunk size, frame 0 is that long and only it is read (candidates that fit in
 * it are still tried); without it, enough for the longest candidate.
 */
function prefixLength(candidates: number[], chunkCount: number, chunkSize: number | null): number {
  if (chunkCount > 1 && chunkSize) return candidates[0]
  return Math.max(1, ...candidates)
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
  signal: AbortSignal | undefined,
): Promise<Verdict> {
  let res: Response
  try {
    res = await requestEncryptedBody(path, signal)
  } catch (err) {
    if (isAbort(err)) throw err
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
  const chunkCount = Math.max(1, parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? rowChunkCount)
  const chunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size'))
  const candidates = chunk0Candidates(sizeBytes, chunkCount, chunkSize, parseHeaderInt(res.headers.get('Content-Length')))
  const want = prefixLength(candidates, chunkCount, chunkSize)
  let bytes: Uint8Array
  try {
    bytes = await readPrefix(res, want)
  } catch (err) {
    if (isAbort(err)) throw err
    throw checkFailed(err)
  }
  // A single chunk is the whole body (a legacy row's body may end before the
  // size the row implies); otherwise each candidate that was read in full.
  const tries = chunkCount <= 1 ? (bytes.length > 0 ? [bytes.length] : []) : candidates.filter((len) => len <= bytes.length)
  for (const len of tries) {
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
 * the exact copy the person sees: OWNER_REPAIR_READ_ONLY (permanent),
 * OWNER_WRITE_CHECK_FAILED (no verdict; retryable) or OWNER_WRITE_NEEDS_UNLOCK
 * (no master key: a locked vault decides nothing, round 3 X2). A no-op for a
 * folder or a row not sealed under an owner convention.
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
  if (!isOwnerContentRow(file, opts.viewerId)) return
  // Round 3 (X2): a write that needs no key (a restore, a note clear) must not
  // pass unchecked because the vault is locked.
  if (!masterKey) throw needsUnlock()
  // Round 3 (X7): the server's row now, not the listing's: its current version
  // keys the cache, and its size and chunk count size the probe.
  let fresh: FreshRow
  try {
    fresh = (await getFile(file.id)) as FreshRow
  } catch (err) {
    if (isAbort(err)) throw err
    throw checkFailed(err)
  }
  if (fresh.is_folder || !isOwnerContentRow(fresh, opts.viewerId)) return
  const versionKey = freshVersionKey(fresh)
  if (versionKey && isKnownWritableVersion(versionKey)) return
  // The check only reports which owner convention authenticates chunk 0 and
  // refuses on `upper_repair`; it never switches the key a write uses.
  const verdict = await resolveVersion(
    `/api/v1/files/${file.id}/download`,
    file.id,
    fresh.size_bytes ?? 0,
    Math.max(1, fresh.chunk_count ?? 1),
    masterKey,
    opts.signal,
  )
  if (verdict === 'read_only') {
    markOwnerRepairReadOnly(file.id)
    throw new Error(OWNER_REPAIR_READ_ONLY)
  }
  if (versionKey) rememberWritableVersion(versionKey)
}

/**
 * SF-0002 round 2 (W4): restoring a kept version makes it current, which is a
 * new version of this row. Refused when the row is read-only (its mark), when
 * the version being restored resolves as `upper_repair` (the row is then
 * read-only: "ANY version"; it is marked), and when the current version is
 * DECIDED `upper_repair` (same rule).
 *
 * Round 3 (X6): the restore is decided by the version it restores. An
 * UNDECIDED current version (a failed request, nothing authenticated) no
 * longer blocks it; only the restored version's own check can then refuse.
 */
export async function assertRestoreWritable(
  file: WriteTarget,
  version: Pick<FileVersion, 'id' | 'size_bytes' | 'chunk_count'>,
  masterKey: Uint8Array | undefined,
  opts: WriteCheckOptions = {},
): Promise<void> {
  if (isOwnerRepairReadOnly(file.id)) throw new Error(OWNER_REPAIR_READ_ONLY)
  if (file.is_folder || !isOwnerContentRow(file, opts.viewerId)) return
  if (!masterKey) throw needsUnlock()
  try {
    await assertCurrentVersionWritable(file, masterKey, opts)
  } catch (err) {
    if (!(err instanceof Error) || err.message !== OWNER_WRITE_CHECK_FAILED) throw err
  }
  const versionKey = `${file.id}|ver:${version.id}`
  if (isKnownWritableVersion(versionKey)) return
  const verdict = await resolveVersion(
    `/api/v1/files/${file.id}/versions/${version.id}/download`,
    file.id,
    version.size_bytes ?? 0,
    Math.max(1, version.chunk_count ?? 1),
    masterKey,
    opts.signal,
  )
  if (verdict === 'read_only') {
    markOwnerRepairReadOnly(file.id)
    throw new Error(OWNER_REPAIR_READ_ONLY)
  }
  rememberWritableVersion(versionKey)
}

/** Restore `version` to current, after {@link assertRestoreWritable}. Nothing is POSTed when refused. */
export async function restoreOwnerVersion(args: {
  file: WriteTarget
  version: Pick<FileVersion, 'id' | 'size_bytes' | 'chunk_count'>
  masterKey: Uint8Array | undefined
  /** The account the resident key belongs to (`useKeys().getResidentUserId()`). */
  residentUserId: string | null
}): Promise<{ message: string; version_number: number }> {
  await assertRestoreWritable(args.file, args.version, args.masterKey, { viewerId: args.residentUserId })
  return restoreVersion(args.file.id, args.version.id)
}

/** The message to show for a refused owner write, or null when `err` is some other failure. */
export function ownerWriteRefusal(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  return err.message === OWNER_REPAIR_READ_ONLY ||
    err.message === OWNER_WRITE_CHECK_FAILED ||
    err.message === OWNER_WRITE_NEEDS_UNLOCK
    ? err.message
    : null
}
