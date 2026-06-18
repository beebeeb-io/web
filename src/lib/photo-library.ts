// ─── Photo-library heuristics (cover.jpg stopgap) ──────────────────────────
//
// The Photos view shows every file the client flagged `is_media` at upload —
// and `is_media` today is set purely by MIME prefix (image/* or video/*) in
// encrypted-upload.ts. That means album art (`cover.jpg` inside a Music folder),
// app icons, and tiny sprite images all leak into Photos alongside real photos.
//
// This module is the *stopgap* from docs/specs/2026-06-17-media-features-design.md
// §ASK 3 — "Pragmatic cover.jpg fix (ships independently)". It is a pure,
// dependency-free predicate so both the upload path and the Photos view can use
// the SAME rule (a file's membership must not flicker depending on which surface
// last evaluated it).
//
// The full source-folder model (designated photo-source roots, `in_photo_library`
// server column, shared rule in repos/core) lands later. Until then, this catches
// the obvious, high-confidence cases of "this is artwork/an icon, not a photo."
//
// DESIGN PRINCIPLE: err toward INCLUSION. A false positive here HIDES a real
// photo from the user's library — far worse than letting one stray cover.jpg
// through. So every sentinel below is a well-known, near-unambiguous artwork or
// icon name, and the size threshold is deliberately tiny. We never guess from
// fuzzy signals.

/** Image extensions we consider for the artwork-name match. Video is never
 *  treated as album art, so it is intentionally excluded. */
const ARTWORK_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
])

/**
 * Exact filename stems (basename without extension, lowercased) that are
 * near-universally album art / folder thumbnails / media-center poster art,
 * never a user's actual photo. Matched against the whole stem (not a substring)
 * so a real photo like `front-door.jpg` or `coverage-map.png` is NOT caught.
 */
const ARTWORK_STEM_EXACT = new Set([
  'cover',
  'folder',
  'front',
  'back',
  'albumart',
  'albumartsmall',
  'poster',
  'thumb',
  'fanart',
  'banner',
  'disc',
  'cdart',
  'clearart',
  'clearlogo',
  'landscape',
  'logo',
])

/**
 * Stem PREFIXES for the small family of art files that carry a trailing hash or
 * size suffix (Windows Media Player / iTunes generate these). e.g.
 * `AlbumArt_{GUID}_Large.jpg`, `AlbumArtSmall.jpg`, `Folder.jpg`. Kept very
 * narrow — only the well-known media-player artwork prefixes, so it cannot swallow
 * an ordinary photo named e.g. `albums-2024.jpg`.
 */
const ARTWORK_STEM_PREFIXES = ['albumart']

/**
 * Hidden/sidecar art names that begin with a dot (e.g. `.thumb`, the dotfile
 * thumbnails some tools drop). The leading dot makes `split('.')` treat the
 * whole thing as the extension, so we test the raw basename separately.
 */
const HIDDEN_ART_BASENAMES = new Set([
  '.thumb',
  '.folder',
])

/**
 * Images at or below this byte size are almost certainly icons, sprites, or
 * tiny embedded album thumbnails — not photographs. A real phone/camera JPEG is
 * tens of KB to several MB even at the smallest. 20 KB is conservative: it
 * catches favicons and 32–128px art while leaving genuine small photos alone.
 */
const TINY_IMAGE_MAX_BYTES = 20 * 1024

/** Extract the lowercased basename of a path (handles both / and \\ separators
 *  so this works for names that arrived from a Windows-origin client too). */
function basename(name: string): string {
  const trimmed = name.trim()
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return (lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed).toLowerCase()
}

/** Split a basename into { stem, ext }, both lowercased. A name with no dot (or a
 *  leading-dot dotfile) yields an empty ext and the whole basename as the stem. */
function splitName(base: string): { stem: string; ext: string } {
  const dot = base.lastIndexOf('.')
  // No dot, or a leading-dot dotfile (dot at index 0) → treat as extension-less.
  if (dot <= 0) return { stem: base, ext: '' }
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1) }
}

/**
 * True when a media file should be EXCLUDED from the Photos library because it is
 * obvious album art, an icon, or a media-center thumbnail rather than a real photo.
 *
 * Conservative by design (see module header): only catches high-confidence
 * artwork — known sentinel filenames OR tiny images. Anything ambiguous is kept.
 *
 * @param name      The (decrypted) filename. May be a full path; only the basename matters.
 * @param sizeBytes The plaintext file size in bytes.
 * @param mimeType  Optional MIME type. Used only to scope the size heuristic to images.
 */
export function isLikelyAlbumArtOrIcon(
  name: string,
  sizeBytes: number,
  mimeType?: string | null,
): boolean {
  const base = basename(name)
  if (!base) return false

  // Hidden sidecar art (.thumb, .folder) — exact basename match.
  if (HIDDEN_ART_BASENAMES.has(base)) return true

  const { stem, ext } = splitName(base)

  // Only images can be artwork/icons. If we can tell it's a video (by extension
  // or MIME), it is never album art — keep it.
  const isVideoMime = mimeType?.startsWith('video/') ?? false
  const looksLikeImage = ARTWORK_IMAGE_EXTENSIONS.has(ext) || (mimeType?.startsWith('image/') ?? false)
  if (isVideoMime) return false

  // 1) Known artwork/icon filename sentinels (image extension required so a
  //    `cover.mp4` home video is never excluded).
  if (looksLikeImage) {
    if (ARTWORK_STEM_EXACT.has(stem)) return true
    if (ARTWORK_STEM_PREFIXES.some((p) => stem.startsWith(p))) return true
  }

  // 2) Tiny images are almost certainly icons / embedded thumbnails, not photos.
  //    Scope to images only (we never want to drop a tiny non-image that somehow
  //    got flagged media). A size of 0 is treated as unknown → not excluded, to
  //    avoid hiding a real photo whose size wasn't populated.
  if (looksLikeImage && sizeBytes > 0 && sizeBytes < TINY_IMAGE_MAX_BYTES) return true

  return false
}
