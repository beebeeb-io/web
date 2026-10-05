/**
 * Deleting a kept version of a file (task 1809): what can be deleted, how many
 * bytes the delete gives back, and the words the confirmation uses.
 *
 * Pure on purpose: `test/1809-version-delete-copy.test.ts` pins every sentence,
 * because the confirmation is a promise about permanent data loss and about
 * storage, and both halves must stay true.
 */
import { formatBytes } from './format'

/** AES-GCM framing per chunk (12-byte nonce + 16-byte tag), as the server counts it. */
export const CHUNK_OVERHEAD_BYTES = 28

/** The slice of a version-list item the delete flow reads. */
export interface DeletableVersion {
  version_number: number
  size_bytes: number
  chunk_count: number
  /** Server flag (`false` only for the file's current object version). Absent on an older server. */
  deletable?: boolean
  /** Which history model the row came from; v2 rows report the ENCRYPTED size. */
  source?: 'object_version' | 'file_version'
}

/**
 * The bytes a version holds as the account's storage counts them: a v2 row's
 * `size_bytes` is the encrypted total (`chunk_count * 28` more than the content),
 * a legacy `file_versions` row's is the content size already. The same formula the
 * server's quota uses, so the number on screen is the number a delete gives back.
 */
export function versionContentBytes(v: Pick<DeletableVersion, 'size_bytes' | 'chunk_count' | 'source'>): number {
  if (v.source === 'object_version') {
    return Math.max(v.size_bytes - v.chunk_count * CHUNK_OVERHEAD_BYTES, 0)
  }
  return Math.max(v.size_bytes, 0)
}

/**
 * Whether the row offers Delete. The server decides (`deletable`); an older
 * server that does not send the flag falls back to "not the current version".
 */
export function canDeleteVersion(v: Pick<DeletableVersion, 'version_number' | 'deletable'>, currentVersion: number): boolean {
  if (typeof v.deletable === 'boolean') return v.deletable
  return v.version_number !== currentVersion
}

export interface VersionDeleteCopy {
  title: string
  body: string
  confirmLabel: string
  /** Toast title after the delete went through. */
  doneTitle: string
}

/**
 * The confirmation. `countsTowardQuota` is the server's
 * `versions_count_toward_quota` (true while the account has no plan): only then
 * does a delete give storage back, and the copy must not promise it otherwise.
 */
export function versionDeleteCopy(opts: {
  versionNumber: number
  contentBytes: number
  countsTowardQuota: boolean
}): VersionDeleteCopy {
  const size = formatBytes(opts.contentBytes)
  const n = opts.versionNumber
  const body = opts.countsTowardQuota
    ? `This removes version ${n} (${size}) for good and gives that space back to your storage. We can't recover it. The current version of the file is not affected.`
    : `This removes version ${n} (${size}) for good. We can't recover it. Versions are not counted against your plan's storage, so your storage total will not change. The current version of the file is not affected.`
  return {
    title: `Delete version ${n}?`,
    body,
    confirmLabel: 'Delete version',
    doneTitle: `Version ${n} deleted`,
  }
}
