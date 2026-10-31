/**
 * L13 (contract 2275, SF-0001) — resuming a persisted upload session.
 *
 * A persisted session is only resumable when the id it writes under is one
 * THIS client chose (`selfMinted`). Records written by older clients may hold
 * an id the server picked, so resuming them would seal chunks under a key
 * someone else may already hold. Those records are dropped and restarted under
 * a fresh id this client mints now — once, never in a loop.
 *
 * The old session is NOT abandoned server-side: the only abandon the server
 * offers is file-wide (`POST /files/{id}/upload/abandon` has no session id),
 * so it would end whatever upload that row holds now, possibly another tab's
 * or device's live one. The server's lease sweep ends the stale session.
 */
import { planResume, removeUploadState, type ResumePlan, type UploadState } from './upload-resume'

export interface PreparedResume extends ResumePlan {
  /** True when a legacy record was dropped and the upload restarts fresh. */
  restarted: boolean
}

export async function prepareResume(
  record: Pick<UploadState, 'fileId' | 'selfMinted'>,
  mintId: () => string,
): Promise<PreparedResume> {
  const plan = planResume(record, mintId)
  if (!plan.abandonId) return { ...plan, restarted: false }
  // The local record goes, so the banner never offers it again and the upload
  // cannot loop on the old id.
  await removeUploadState(plan.abandonId)
  return { ...plan, restarted: true }
}
