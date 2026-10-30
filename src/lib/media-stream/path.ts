/**
 * LD-0001 PR-B: which path a video/audio preview takes (contract §4).
 *
 * Pure. Every fact it needs is passed in: the row's fields, the environment
 * (a live Service-Worker controller), the kill switch, and the element facts
 * (`canPlayType`, what already failed). `choosePreviewPath` is the single
 * decision point, so the table can be read and tested row by row.
 */
import { MAX_STREAM_CHUNK_BYTES } from './bounds'

/** Row 5: a whole-file media load over this size shows the download card. */
export const WHOLE_FILE_MEDIA_CAP_BYTES = 2 * 1024 * 1024 * 1024

export const DOWNLOAD_CARD_COPY =
  'This video is too large to play in the browser. Download it to watch.'

/** The kill switch, read exactly as §2.1 requires: in a try/catch, 'off' only. */
export function mediaStreamKillSwitch(
  storage: { getItem(key: string): string | null } | null | undefined,
): boolean {
  try {
    return storage?.getItem('bb.mediaStream') === 'off'
  } catch {
    return false
  }
}

export type MediaKind = 'video' | 'audio'

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'ogv', 'avi', 'mkv', 'mpeg', 'mpg', '3gp'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'])

/** The media kind a preview would route to (mirrors file-preview's routing). */
export function mediaKindFor(mime: string | null | undefined, extension: string): MediaKind | null {
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return null
}

export type PreviewPath =
  | 'streaming'
  | 'whole-file'
  | 'whole-file-fallback'
  | 'download-card'
  | 'unsupported'
  | 'error'
  | 'changed'

export interface PathFacts {
  /** null when this is not a video/audio preview at all. */
  media: MediaKind | null
  /** `share-view.tsx` never streams (row 4; follow-up WL-0001). */
  sharedLink: boolean
  liveVersion: boolean
  /** `download_version.object_version_id` — required for streaming (§4 row 1). */
  objectVersionId: string | null
  chunkCount: number
  /** S = chunk 0's plaintext size, from `download_version.chunk_size_bytes`. */
  chunkSize: number | null
  sizeBytes: number
  hasServiceWorkerController: boolean
  /** true when `localStorage['bb.mediaStream'] === 'off'`. */
  killSwitch: boolean
  /** `element.canPlayType(mime)`; '' means the browser refuses the codec. */
  canPlayType: string
  /** Row 6 already ran once for this preview. */
  fallbackUsed: boolean
  /** The streaming setup failed, or the element errored before metadata. */
  streamRejected: boolean
  /** Row 8/9: a terminal failure from the session. */
  terminalError: 'auth' | 'changed' | null
  /** Row 7: the element errored after `loadedmetadata`. */
  elementErroredAfterMetadata: boolean
}

function streamingEligible(facts: PathFacts): boolean {
  return (
    facts.liveVersion &&
    !!facts.objectVersionId &&
    facts.chunkCount >= 2 &&
    facts.chunkSize !== null &&
    facts.chunkSize > 0 &&
    facts.chunkSize <= MAX_STREAM_CHUNK_BYTES &&
    facts.hasServiceWorkerController &&
    !facts.killSwitch
  )
}

/**
 * Rows 1-9. Precedence: a terminal error is never a fallback (row 8) and a
 * replaced file is never an auth error (row 9); non-media and shared links
 * never stream; a whole-file media load over the cap is the download card.
 */
export function choosePreviewPath(facts: PathFacts): PreviewPath {
  if (facts.terminalError === 'auth') return 'error'
  if (facts.terminalError === 'changed') return 'changed'
  if (!facts.media) return 'whole-file'
  if (facts.sharedLink) return 'whole-file'
  if (facts.streamRejected) {
    if (facts.fallbackUsed) return 'unsupported'
    return facts.sizeBytes > WHOLE_FILE_MEDIA_CAP_BYTES ? 'download-card' : 'whole-file-fallback'
  }
  if (facts.elementErroredAfterMetadata || !facts.canPlayType) return 'unsupported'
  if (streamingEligible(facts)) return 'streaming'
  return facts.sizeBytes > WHOLE_FILE_MEDIA_CAP_BYTES ? 'download-card' : 'whole-file'
}
