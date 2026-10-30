/**
 * L13 (contract 2275, SF-0001) — resuming a persisted upload session.
 *
 * A persisted session is only resumable when the id it writes under is one
 * THIS client chose (`selfMinted`). Records written by older clients may hold
 * an id the server picked, so resuming them would seal chunks under a key
 * someone else may already hold. Those records are abandoned server-side and
 * restarted under a fresh id this client mints now — once, never in a loop.
 */
import { abandonUpload } from './api'
import { planResume, removeUploadState, type ResumePlan, type UploadState } from './upload-resume'

export interface PreparedResume extends ResumePlan {
  /** True when a legacy record was abandoned and the upload restarts fresh. */
  restarted: boolean
}

export async function prepareResume(
  record: Pick<UploadState, 'fileId' | 'selfMinted'>,
  mintId: () => string,
): Promise<PreparedResume> {
  const plan = planResume(record, mintId)
  if (!plan.abandonId) return { ...plan, restarted: false }
  // Best-effort: the abandon endpoint is idempotent and the session may already
  // be swept. The local record goes either way, so the banner never offers it
  // again and the upload cannot loop on the abandoned id.
  await abandonUpload(plan.abandonId).catch(() => {})
  await removeUploadState(plan.abandonId)
  return { ...plan, restarted: true }
}
