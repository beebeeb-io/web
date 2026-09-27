const PREVIEWABLE_EXTENSIONS = new Set([
  // Images (native browser + HEIC via heic2any)
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tiff', 'tif',
  // Camera RAW (download-only preview card)
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf',
  // Video (including HEVC)
  'mp4', 'mov', 'webm', 'mkv', 'hevc',
  // Audio
  'mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'aif', 'wma', 'alac',
  // Text / code
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'sh',
  // Task 1565 preview matrix: this allowlist had drifted out of sync with
  // file-preview.tsx's actual EXT_LANGUAGE/TEXT_EXTENSIONS coverage — this
  // GATE runs on double-click, BEFORE pickRenderer ever gets a chance to
  // render anything (file-list.tsx: `isPreviewable(...) ? open : toast
  // "This file type can't be previewed"`). A real .java/.yaml/.cs upload
  // never even opened the preview overlay — not a blank/spinner FAIL by the
  // task's letter, but a real, confirmed regression: the renderer fully
  // supports these, the double-click gate just never let them reach it.
  // Added to match EXT_LANGUAGE/TEXT_EXTENSIONS exactly for every extension
  // this task's own fixture set requires (see e2e/helpers/preview-matrix.ts):
  'tsv', 'yaml', 'log', 'ini', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'sql', 'toml',
  // Bare `Dockerfile` (no dot at all): fileName.split('.').pop() on a
  // dotless name returns the whole lowercased name ("dockerfile") already —
  // unlike file-preview.tsx's getExtension(), THIS function never had that
  // bug — it was only ever missing from this allowlist.
  'dockerfile',
  // Legacy .xls: XlsxRenderer explicitly mime-matches
  // application/vnd.ms-excel (file-preview.tsx L271-283) but the browser
  // may not report that mime for a plain <input type=file> pick, same class
  // of gap as the code extensions above.
  'xls',
  // Documents
  'pdf', 'docx', 'xlsx',
  // Presentations (download-only preview card)
  'pptx', 'ppt', 'odp', 'key',
])

export function isPreviewable(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (mimeType) {
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint'
    )
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && PREVIEWABLE_EXTENSIONS.has(ext)) return true
  }
  return false
}
