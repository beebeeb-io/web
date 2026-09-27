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
  // Task 1565 preview matrix (full 59-fixture run): `.tsx` was ALSO missing
  // here despite file-preview.tsx's EXT_LANGUAGE mapping BOTH `jsx` and
  // `tsx` to a real CodeRenderer language for years — the exact same
  // gate-vs-renderer drift as the extensions added above. Confirmed live: a
  // real .tsx upload (browser-reported mime empty/octet-stream, so this
  // function fell through to the extension check) never opened the preview
  // OR showed the "can't be previewed" toast — a single click's
  // isPreviewable() check in file-list.tsx's handleRowClick returned false
  // and silently just selected the row instead. `jsx` shares the identical
  // gap (same EXT_LANGUAGE entry, same missing allowlist entry) even though
  // it isn't in this task's own fixture set.
  'tsx', 'jsx',
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
  // Task 1565 preview matrix (full 59-fixture run): this used to be an
  // if/else — the extension allowlist was ONLY ever consulted when
  // `mimeType` was completely absent (null/undefined/''). A `.tsv` upload
  // exposed why that's wrong: the browser reported a non-empty mime type
  // for it that matches none of the branches below (not `text/*`, not any
  // of the exact matches) — so this function returned false OUTRIGHT
  // without ever checking that `tsv` IS in PREVIEWABLE_EXTENSIONS just a
  // few lines above. Any extension whose real-world browser-reported mime
  // doesn't happen to fall in the recognized set was silently ungated
  // regardless of the allowlist — the exact same class of bug as the
  // missing-extension fixes elsewhere in this task, just on the mime side
  // instead of the extension side. Fix: treat mime and extension as two
  // INDEPENDENT ways to pass, not a fallback chain.
  if (
    mimeType &&
    (mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint')
  ) {
    return true
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && PREVIEWABLE_EXTENSIONS.has(ext)) return true
  }
  return false
}
