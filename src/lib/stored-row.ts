/**
 * SF-0001 round 3 — what a stored upload session's row looks like to THIS
 * user right now, for `planResume` (upload-resume.ts).
 *
 * `GET /files/{id}` also answers share recipients, and its answer names no
 * owner. So "a live row this user owns" is established the way the replace
 * rule already does it: the row is a file, not in the trash, and its stored
 * name authenticates under this user's key for that id (a recipient's view of
 * someone else's file does not). Network failures are not an answer: they
 * propagate, and the paused upload stays on offer.
 */
import { ApiError, getFile } from './api'
import { readFileMetadata } from './crypto'
import type { StoredRow } from './upload-resume'

export async function lookupOwnRow(fileId: string, fileKey: Uint8Array): Promise<StoredRow> {
  let row
  try {
    row = await getFile(fileId)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { state: 'gone' }
    throw err
  }
  if (row.id !== fileId || row.is_folder || row.is_trashed) return { state: 'gone' }
  try {
    await readFileMetadata(fileKey, row.name_encrypted)
  } catch {
    return { state: 'unverified' }
  }
  return { state: 'live', nameEncrypted: row.name_encrypted }
}
