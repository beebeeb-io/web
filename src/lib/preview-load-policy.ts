/**
 * LD-0001 §4 row 5 — the whole-file media cap.
 *
 * A video or audio file over 2 GiB must not be downloaded into a Blob: the
 * preview shows the honest download card instead. Pure so it is testable
 * without a renderer.
 */
export const WHOLE_FILE_MEDIA_CAP_BYTES = 2 * 1024 ** 3

// Mirrors the preview's own video/audio routing sets (file-preview.tsx).
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'ogv', 'hevc'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'aif', 'wma', 'alac'])

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

function mediaKind(mimeType: string | null | undefined, filename: string): 'video' | 'audio' | null {
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  const ext = extensionOf(filename)
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return null
}

/** True when this whole-file media load must show the download card instead. */
export function isWholeFileMediaOverCap(
  mimeType: string | null | undefined,
  filename: string,
  sizeBytes: number,
): boolean {
  if (!(sizeBytes > WHOLE_FILE_MEDIA_CAP_BYTES)) return false
  return mediaKind(mimeType, filename) !== null
}

/** The card's copy for an over-cap video/audio file, or null for anything else. */
export function wholeFileMediaCapCopy(
  mimeType: string | null | undefined,
  filename: string,
): string | null {
  const kind = mediaKind(mimeType, filename)
  if (kind === 'video') return 'This video is too large to play in the browser. Download it to watch.'
  if (kind === 'audio') return 'This audio file is too large to play in the browser. Download it to listen.'
  return null
}
