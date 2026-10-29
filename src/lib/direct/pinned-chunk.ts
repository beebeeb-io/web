import type { DirectSession } from './session'
import { getDirectSession } from './session'
import { directApi, wait } from './api'

export async function fetchPinnedChunk(fileId: string, index: number, versionId: string, signal: AbortSignal, session?: DirectSession): Promise<Uint8Array> {
  const s = session ?? await getDirectSession()
  let waited = 0
  for (let attempt = 1; ; attempt++) {
    const answer = await directApi(s, `/api/v1/files/${encodeURIComponent(fileId)}/chunks/${index}?object_version_id=${encodeURIComponent(versionId)}`, 'pinned_chunk', signal)
    if (answer.status === 200 && answer.outcome.kind === 'proceed') return answer.bytes
    if (answer.outcome.kind === 'restart') throw new Error('File changed during download')
    const decision = s.wasm.pinnedRetryDecision(answer.outcome, attempt, waited)
    if (decision.kind !== 'wait') throw new Error('Pinned download failed')
    await wait(decision.millis, signal)
    waited += decision.millis
  }
}
