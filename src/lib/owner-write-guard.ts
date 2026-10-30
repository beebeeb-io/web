// ─── SF-0002 review: a write-time read-only check ─────
//
// A read-only mark set only when a row is OPENED is not enough: a replace,
// rename or new version can be the first thing this client does with a row.
// Before such a write, the CURRENT version's chunk 0 is authenticated with
// core's per-version owner resolver. A version that resolves as `upper_repair`
// marks the row read-only and the write is refused with the honest copy.
//
// Only the owner's own rows are checked (a foreign/shared key is never
// switched to an owner key), and only a bounded prefix of the version is read.

import { getApiUrl, getToken, type DriveFile } from './api'
import { ownerRepairContentKey } from './crypto'
import { OWNER_REPAIR_READ_ONLY, isOwnerRepairReadOnly, markOwnerRepairReadOnly } from './owner-repair'

const NONCE_AND_TAG = 28
const FILE_PROVIDER_CHUNK = 1024 * 1024
/** Core's maximum plaintext chunk size; the read never goes past one frame. */
const MAX_CHUNK_SIZE = 256 * 1024 * 1024

type WriteTarget = Pick<DriveFile, 'id' | 'size_bytes' | 'chunk_count' | 'acted_via_share_id' | 'uploaded_by'>

function intHeader(value: string | null): number | null {
  const n = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Read at most `want` bytes of the file's body, then stop the transfer. */
async function readPrefix(fileId: string, want: number): Promise<{ bytes: Uint8Array; chunkSize: number | null }> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/download`, { headers, credentials: 'include' })
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const chunkSize = intHeader(res.headers.get('X-Chunk-Size'))
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
  return { bytes: buf.subarray(0, have), chunkSize }
}

/** Candidate wire-frame lengths for chunk 0, most likely first. */
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
  if (sizeBytes > 0) push(Math.floor((sizeBytes + NONCE_AND_TAG * chunkCount) / chunkCount))
  push(FILE_PROVIDER_CHUNK + NONCE_AND_TAG)
  push(have)
  return out
}

/**
 * Refuse a replace, rename or new version of an owner row whose current
 * version is sealed under the read-only uppercase repair convention. Throws
 * the exact copy the person sees; may be a no-op for a foreign row or when the
 * caller holds no master key.
 */
export async function assertCurrentVersionWritable(
  file: WriteTarget,
  masterKey: Uint8Array | undefined,
): Promise<void> {
  if (isOwnerRepairReadOnly(file.id)) throw new Error(OWNER_REPAIR_READ_ONLY)
  if (!masterKey) return
  // The check only reports which owner convention authenticates chunk 0 and
  // refuses on `upper_repair`; it never switches the key a write uses, so it
  // is safe for any row the caller may write.
  const chunkCount = Math.max(1, file.chunk_count ?? 1)
  const sizeBytes = file.size_bytes ?? 0
  const expected = sizeBytes + NONCE_AND_TAG * chunkCount
  const probe = chunkCount <= 1 ? expected : Math.max(FILE_PROVIDER_CHUNK + NONCE_AND_TAG, Math.floor(expected / chunkCount))
  const want = Math.max(1, Math.min(probe, MAX_CHUNK_SIZE + NONCE_AND_TAG))
  const { bytes, chunkSize } = await readPrefix(file.id, want)
  for (const len of chunk0Candidates(bytes.length, sizeBytes, chunkCount, chunkSize)) {
    let repair: { key: Uint8Array; convention: string } | null = null
    try {
      repair = await ownerRepairContentKey(masterKey, file.id, bytes.subarray(0, len))
    } catch {
      continue
    }
    if (!repair || !(repair.key instanceof Uint8Array)) continue
    if (repair.convention === 'upper_repair') {
      repair.key.fill(0)
      markOwnerRepairReadOnly(file.id)
      throw new Error(OWNER_REPAIR_READ_ONLY)
    }
    repair.key.fill(0)
  }
}
