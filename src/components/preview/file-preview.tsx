import { useCallback, useEffect, useRef, useState } from 'react'
import { listVersions, type DriveFile, type FileVersion } from '../../lib/api'
import { decryptToBlob, decryptVersionToBlob, streamOverCapDownload, type TransferProgress } from '../../lib/encrypted-download'
import { OWNER_REPAIR_READ_ONLY, isOwnerRepairReadOnly } from '../../lib/owner-repair'
import { ownerWriteRefusal, restoreOwnerVersion } from '../../lib/owner-write-guard'
import {
  AUDIO_EXTENSIONS_SET,
  TooLargeToPreviewError,
  VIDEO_EXTENSIONS_SET,
  WHOLE_FILE_MEDIA_CAP_BYTES,
  chooseDownloadAction,
  getExtension,
} from '../../lib/preview-load-policy'
import { formatSize } from '../../lib/format-size'
import {
  CODE_MIME_TYPES,
  EXT_LANGUAGE,
  HEIC_IMAGE_EXTS,
  HEIC_IMAGE_MIMES,
  IMAGE_EXTENSIONS_SET,
  PPTX_EXTS,
  PPTX_MIMES,
  RAW_IMAGE_EXTS,
  RAW_IMAGE_MIMES,
  TEXT_EXTENSIONS,
  TEXT_MIME_TYPES,
  TIFF_EXTS,
  TIFF_MIMES,
  ZIP_EXTS,
  getKindLabel,
  resolveEditableKind,
} from './file-kinds'
import {
  DownloadPromptCard,
  OverCapCard,
  PreviewErrorCard,
  PreviewProgress,
  ReadOnlyEditorNotice,
  StreamErrorCard,
  UNSUPPORTED_TYPE_COPY,
} from './file-preview-cards'
import { createTransferThrottle } from '../../lib/progress-throttle'
import { fetchAndDecryptLargeThumbnail, fetchAndDecryptThumbnail } from '../../lib/thumbnail'
import { PreviewChrome } from './preview-chrome'
import { InfoRail, CONTENT_CIPHER_LABEL } from './info-rail'
import { VersionScrubber } from './version-scrubber'
import { ImagePreview } from './image-preview'
import { PdfPreview } from './pdf-preview'
import { VideoPreview } from './video-preview'
import { AudioPreview } from './audio-preview'
import { useMediaStream } from '../../lib/media-stream/use-media-stream'
import { DOWNLOAD_CARD_COPY, mediaKindFor } from '../../lib/media-stream/path'
import { MarkdownPreview } from './markdown-preview'
import { TextPreview } from './text-preview'
import { DocxPreview } from './docx-preview'
import { XlsxPreview } from './xlsx-preview'
import { UnsupportedPreview } from './unsupported-preview'
import { RawPreview } from './raw-preview'
import type { RawExifInfo } from '../../lib/raw-embedded-jpeg'
import { HeicPreview } from './heic-preview'
import { TiffPreview } from './tiff-preview'
import { ZipListingPreview } from './zip-listing-preview'
import { Icon } from '@beebeeb/shared'
import { useKeys } from '../../lib/key-context'
import { needsOwnership, sharedRootFor } from '../../lib/owner-adoption'
import { sharedFoldersEnabled } from '../../lib/use-feature-flag'
import { useAuth } from '../../lib/auth-context'
import { decryptFileMetadata } from '../../lib/crypto'
import { checkEditability, type EditabilityResult } from '../../lib/text-editability'
import { FileEditor, type FileEditorHandle } from '../editor/file-editor'
import { UnsavedChangesDialog } from '../editor/unsaved-changes-dialog'
import { resolveOfficeFileKind } from '../../lib/office/office-file-kind'
import { isOfficeLabsEnabled } from '../../lib/office/office-labs'
import { rawInfoRowsOf } from '../../lib/raw-info-rows'

interface FilePreviewProps {
  file: DriveFile
  /** Pre-decrypted filename. If not provided, component will attempt to decrypt. */
  decryptedName?: string
  onClose: () => void
  /** Fires after a successful "Restore this version" so the parent can refresh listings. */
  onVersionRestored?: () => void
  /** Prev/next navigation callbacks for image galleries */
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  /** Open straight into the text editor once the file is known editable —
   *  set for a file just created from Drive's "+ New" menu (task 1582). */
  startInEditMode?: boolean
  /** The folder being browsed, so a guest-added row can find its shared root. */
  folderId?: string
  /** Trash this file — offered on the "can't open" card so the row is actionable. */
  onDelete?: (file: DriveFile) => void | Promise<void>
}

interface ImageControlProps {
  zoom: number
  rotation: number
  onZoomChange: (zoom: number) => void
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  /** RAW only (task 1574) — reports the extracted EXIF summary so the Info
   *  rail can show camera/lens/exposure, mirroring mobile's Info sheet. */
  onRawInfo?: (info: RawExifInfo | null) => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.2

function pickRenderer(
  mimeType: string | null | undefined,
  blob: Blob,
  filename: string,
  imageControls?: ImageControlProps,
  /** True once `blob` is confirmed to be the full downloaded original —
   *  false while it's still a server-generated thumbnail (task 1574 gate,
   *  Codex review round 2, 2026-09-27; see the TIFF branch below and the
   *  doc comment at this function's TIFF check for why this matters). */
  blobIsOriginal = true,
): React.ReactNode {
  const ext = getExtension(filename)

  // Office formats — client-side via lazy-loaded mammoth / SheetJS
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return <DocxPreview blob={blob} filename={filename} />
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xlsx'
  ) {
    return <XlsxPreview blob={blob} filename={filename} />
  }
  // Presentation formats + legacy .doc/.xls — show download card (see the
  // PPTX_EXTS/PPTX_MIMES doc comment above for why, task 1574).
  if (PPTX_MIMES.has(mimeType ?? '') || PPTX_EXTS.has(ext) || ext === 'doc' || ext === 'xls') {
    return <UnsupportedPreview blob={blob} filename={filename} />
  }

  // ZIP — a listing, not extraction (task 1574).
  if (ZIP_EXTS.has(ext)) {
    return <ZipListingPreview blob={blob} filename={filename} />
  }

  // Camera RAW — extract embedded JPEG preview, fall back to download card
  if (RAW_IMAGE_MIMES.has(mimeType ?? '') || RAW_IMAGE_EXTS.has(ext)) {
    return (
      <RawPreview
        blob={blob}
        filename={filename}
        zoom={imageControls?.zoom ?? 1}
        rotation={imageControls?.rotation ?? 0}
        onZoomChange={imageControls?.onZoomChange ?? (() => {})}
        onClose={imageControls?.onClose}
        onPrev={imageControls?.onPrev}
        onNext={imageControls?.onNext}
        hasPrev={imageControls?.hasPrev}
        hasNext={imageControls?.hasNext}
        onInfo={imageControls?.onRawInfo}
      />
    )
  }

  // HEIC/HEIF — convert the decrypted blob to JPEG client-side for preview.
  if (HEIC_IMAGE_MIMES.has(mimeType ?? '') || HEIC_IMAGE_EXTS.has(ext)) {
    return (
      <HeicPreview
        blob={blob}
        filename={filename}
        zoom={imageControls?.zoom ?? 1}
        rotation={imageControls?.rotation ?? 0}
        onZoomChange={imageControls?.onZoomChange ?? (() => {})}
        onClose={imageControls?.onClose}
        onPrev={imageControls?.onPrev}
        onNext={imageControls?.onNext}
        hasPrev={imageControls?.hasPrev}
        hasNext={imageControls?.hasNext}
      />
    )
  }

  // TIFF — decoded off the main thread via utif2 (task 1574), see
  // TIFF_MIMES/TIFF_EXTS doc comment above. Checked before the generic
  // image branch below, which otherwise fed TIFF bytes straight to a plain
  // `<img>` that Chromium can never decode (task 1565 finding).
  //
  // Gated on `blobIsOriginal` (Codex review round 2, task 1574 gate,
  // 2026-09-27): a current-version TIFF CAN already have a server-side WebP
  // thumbnail (CLI/desktop/mobile decode TIFF via native/rust image
  // libraries the browser doesn't have and generate one on upload, same as
  // any other image — see repos/cli/src/thumbnail.rs). While `blob` is
  // still that thumbnail (`blobIsOriginal` false — the fast thumbnail-first
  // path below hasn't been superseded by the full download yet), routing
  // here would feed WebP bytes to utif2, which rejects them outright. Round
  // 1 of this review "fixed" that by excluding TIFF from thumbnail-first
  // entirely — which traded one bug for a worse one Codex caught in round
  // 2: a TIFF WITH a thumbnail now had to fully download+decrypt the
  // ORIGINAL (however large) before ever getting a chance to render
  // anything, even though a perfectly good thumbnail was sitting right
  // there. This is the actual fix: thumbnail-first stays ENABLED for TIFF
  // (see the `isImageFile` check above), and a still-thumbnail blob falls
  // through to the generic image branch below instead (a plain `<img>`
  // decodes WebP natively, exactly like every other image type) —
  // TiffPreview's real utif2 decode only ever runs once `blobIsOriginal` is
  // true, i.e. against the confirmed real original.
  if (blobIsOriginal && (TIFF_MIMES.has(mimeType ?? '') || TIFF_EXTS.has(ext))) {
    return (
      <TiffPreview
        blob={blob}
        filename={filename}
        zoom={imageControls?.zoom ?? 1}
        rotation={imageControls?.rotation ?? 0}
        onZoomChange={imageControls?.onZoomChange ?? (() => {})}
        onClose={imageControls?.onClose}
        onPrev={imageControls?.onPrev}
        onNext={imageControls?.onNext}
        hasPrev={imageControls?.hasPrev}
        hasNext={imageControls?.hasNext}
      />
    )
  }

  if (mimeType?.startsWith('image/') || IMAGE_EXTENSIONS_SET.has(ext)) {
    return (
      <ImagePreview
        blob={blob}
        filename={filename}
        zoom={imageControls?.zoom ?? 1}
        rotation={imageControls?.rotation ?? 0}
        onZoomChange={imageControls?.onZoomChange ?? (() => {})}
        onClose={imageControls?.onClose}
        onPrev={imageControls?.onPrev}
        onNext={imageControls?.onNext}
        hasPrev={imageControls?.hasPrev}
        hasNext={imageControls?.hasNext}
      />
    )
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return <PdfPreview blob={blob} />
  }
  if (mimeType?.startsWith('video/') || VIDEO_EXTENSIONS_SET.has(ext)) {
    return <VideoPreview blob={blob} />
  }
  if (mimeType?.startsWith('audio/') || AUDIO_EXTENSIONS_SET.has(ext)) {
    return <AudioPreview blob={blob} filename={filename} />
  }
  if (mimeType === 'text/markdown' || ext === 'md' || ext === 'mdx') {
    return <MarkdownPreview blob={blob} />
  }

  // Code files — text preview with syntax coloring
  const lang = (mimeType ? CODE_MIME_TYPES[mimeType] : undefined) ?? EXT_LANGUAGE[ext]
  if (lang) {
    return <TextPreview blob={blob} language={lang} filename={filename} />
  }

  // Plain text files
  if ((mimeType ? TEXT_MIME_TYPES.has(mimeType) : false) || TEXT_EXTENSIONS.has(ext)) {
    return <TextPreview blob={blob} filename={filename} />
  }

  return null
}

export function FilePreview({ file, decryptedName: decryptedNameProp, onClose, onVersionRestored, onPrev, onNext, hasPrev, hasNext, startInEditMode, folderId, onDelete }: FilePreviewProps) {
  const { getFileKeyForFile, getFileKeyForSharedFile, getSharedFileOrigin, getMasterKey, getResidentUserId, isUnlocked } = useKeys()
  // SF-0002: the row's name or a version was sealed under the iOS Files-app
  // convention, so it is openable/downloadable but not writable in place.
  const ownerReadOnly = isOwnerRepairReadOnly(file.id)
  const [blob, setBlob] = useState<Blob | null>(null)
  /** True when `blob` holds the full original (non-image / fallback / version
   *  paths). False when `blob` is only a thumbnail (the thumbnail-first image
   *  path). The toolbar Download must always save the original — never a
   *  downscaled thumbnail — so it fetches the original when this is false. */
  const [blobIsOriginal, setBlobIsOriginal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  /** Bytes saved so far by the over-cap card's stream-to-disk (C4). */
  const [savedProgress, setSavedProgress] = useState<{ written: number; total: number | null } | null>(null)
  /** The over-cap download in flight: closing the preview aborts it (C4). */
  const overCapAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const [error, setError] = useState<string | null>(null)
  /** Live whole-file transfer progress (LD-0001 PR-C); null before the first event. */
  const [transfer, setTransfer] = useState<TransferProgress | null>(null)
  /** Set when this load was skipped because the media is over the 2 GiB cap. */
  const [capCopy, setCapCopy] = useState<string | null>(null)
  const [localDecryptedName, setLocalDecryptedName] = useState<string | null>(null)
  /** MIME type extracted from encrypted metadata (null for legacy files) */
  const [localMimeType, setLocalMimeType] = useState<string | null>(null)

  // Image zoom + rotation state — reset on each new file
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  // RAW EXIF summary (camera/lens/exposure), task 1574 — reported by
  // RawPreview once its worker-based extraction resolves; null for every
  // non-RAW file and reset on each new file below.
  const [rawExifInfo, setRawExifInfo] = useState<RawExifInfo | null>(null)
  const prevFileIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevFileIdRef.current !== file.id) {
      setZoom(1)
      setRotation(0)
      setRawExifInfo(null)
      // Navigating to a different file (prev/next) always leaves edit mode —
      // there is no cross-file unsaved draft to guard here since a plain
      // navigation only happens when nothing was dirty (the close/nav guard
      // below blocks it otherwise).
      setEditing(false)
      setDirty(false)
      setEditability(null)
      setDecodedText(null)
      // Reset the save-conflict baseline to the NEW file's own version
      // immediately (PR #103 review thread) — the version-list-fetch effect
      // below only corrects it when the destination file has > 1 version
      // (it early-returns to `setVersions(null)` for a version-1 file
      // without touching this number), so navigating from a v5 file to a
      // v1 file left `currentVersionNumber` stuck at 5. A save opened on
      // that v1 file then compared a racing v2 against baseline 5 — no
      // conflict shown, silent overwrite. Reproduced live: see
      // e2e/1563-text-editor.spec.ts "prev/next resets the save-conflict
      // baseline".
      setCurrentVersionNumber(file.version_number ?? 1)
      prevFileIdRef.current = file.id
    }
  }, [file.id])

  // ── Text/markdown/code editor (task 1563) ────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editability, setEditability] = useState<EditabilityResult | null>(null)
  const [decodedText, setDecodedText] = useState<string | null>(null)
  const [unsavedGuard, setUnsavedGuard] = useState<'close' | 'exit-edit' | null>(null)
  const editorRef = useRef<FileEditorHandle>(null)
  // The DOM node PreviewChrome's merged top bar renders while editing — the
  // editor's own Split preview / Wrap / Save controls portal into it (PR
  // #103 review: "double header" — see preview-chrome.tsx `onToolbarSlotReady`
  // and file-editor.tsx's `toolbarSlotEl`/`createPortal`). State (not a bare
  // ref) because the portal target needs a re-render once the ref callback
  // actually fires with the mounted node.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)

  // Version state — only populated for files with > 1 version.
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  // Mirrors `versions` for the content-loading effect below (task 1563 bug
  // fix). That effect reads `versions` ONLY in its historical-version
  // branch (selectedVersionId !== null) — it used to also list `versions`
  // in its dependency array, so ANY setVersions() call (e.g. after a
  // task-1563 save refreshes the version list) re-ran the WHOLE effect even
  // while viewing the live version, re-fetching + re-decrypting the file
  // from the network using the now-STALE `file.size_bytes` prop (the parent
  // hasn't re-rendered with fresh metadata yet) against the server's
  // ALREADY-UPDATED ciphertext — a GCM tag mismatch ("decryption failed:
  // ciphertext is invalid or key is wrong"), reproduced live via the
  // task-1563 e2e save test. Reading the historical branch's lookup through
  // a ref (kept current, but NOT a dependency) fixes the live-view case
  // without changing behavior for the historical-version branch, which
  // still sees the latest array.
  const versionsRef = useRef<FileVersion[] | null>(null)
  useEffect(() => {
    versionsRef.current = versions
  }, [versions])
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>(file.version_number ?? 1)
  // null = viewing the live current version; otherwise a historical version id.
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  // Bumped on every successful blob swap so the canvas key changes and
  // the renderer re-mounts with the decrypt-fade-in animation.
  const [renderKey, setRenderKey] = useState(0)
  // Task 2237b: set when this row was added through a folder link and neither
  // the owner wrap nor the folder key opens it. `undefined` = not applicable,
  // `null` = cannot open with no known label.
  const [shareOrigin, setShareOrigin] = useState<string | null | undefined>(undefined)
  const { user } = useAuth()
  const sharedFile = needsOwnership(file, user?.user_id)

  /** Every load path asks here: an ordinary file derives from the master key,
   *  a guest- or member-added row goes through the shared-folder resolver. */
  // `ownerDerived` says whether the key came from the owner's own derivation.
  // Only then may a content read ask core for the read-only repair key: a
  // shared-folder or foreign key is never switched to an owner key (SF-0002
  // review).
  const resolveFileKey = useCallback(async (): Promise<{ key: Uint8Array; ownerDerived: boolean }> => {
    if (!sharedFile) return { key: await getFileKeyForFile(file), ownerDerived: true }
    // rv-web198d R1: with the flag off there is no shared-folder walk for the
    // owner (no invites read, no link route asked); the key is derived, as on main.
    if (!(await sharedFoldersEnabled())) return { key: await getFileKeyForFile(file), ownerDerived: true }
    const root = await sharedRootFor(folderId ?? null, file.id)
    const key = root ? await getFileKeyForSharedFile(file, root) : null
    if (key) return { key, ownerDerived: false }
    const label = root ? await getSharedFileOrigin(file, root) : null
    setShareOrigin(label)
    throw new Error(label ? `Can't open this file (added via ${label})` : "Can't open this file")
  }, [sharedFile, getFileKeyForFile, getFileKeyForSharedFile, getSharedFileOrigin, file, folderId])

  // Display name: use prop, then locally decrypted, then raw
  const name = decryptedNameProp ?? localDecryptedName ?? file.name_encrypted

  // Decrypt filename (and MIME type if present in encrypted metadata)
  // decryptFileMetadata handles both legacy (bare filename) and new
  // ({ name, mime_type }) formats. Result sets both localDecryptedName
  // and localMimeType so the renderer can infer format even when
  // file.mime_type is null (ZK uploads from commit 85310c5+).
  useEffect(() => {
    if (decryptedNameProp || !isUnlocked) return
    let cancelled = false
    async function decrypt() {
      try {
        const { key: fileKey } = await resolveFileKey()
        const { name, mimeType } = await decryptFileMetadata(fileKey, file.name_encrypted)
        if (!cancelled) {
          setLocalDecryptedName(name)
          setLocalMimeType(mimeType)
        }
      } catch {
        // Decryption failed — leave name/mime as null
      }
    }
    decrypt()
    return () => { cancelled = true }
  }, [file.id, file.name_encrypted, decryptedNameProp, isUnlocked, getFileKeyForFile, resolveFileKey, file])

  // Fetch the version list once per file (only if there's actually history).
  useEffect(() => {
    if (!isUnlocked) return
    if ((file.version_number ?? 1) <= 1) {
      setVersions(null)
      return
    }
    let cancelled = false
    listVersions(file.id)
      .then((res) => {
        if (cancelled) return
        setVersions(res.versions)
        setCurrentVersionNumber(res.current_version)
      })
      .catch(() => {
        if (!cancelled) setVersions(null)
      })
    return () => { cancelled = true }
  }, [file.id, file.version_number, isUnlocked])

  // Effective MIME: prefer server value (legacy), then encrypted metadata, then null
  const effectiveMime = file.mime_type ?? localMimeType

  // C6 (round 3): the load below is keyed on the content identity only (file
  // id, version, unlock state, chunk count, size). The name, the MIME, the
  // file object and the key resolver are read at the start of each load
  // through this ref, so the name resolving, or a parent re-render with a new
  // file object, never restarts a download (progress used to jump back to 0).
  const loadInputsRef = useRef({ file, name, effectiveMime, resolveFileKey })
  loadInputsRef.current = { file, name, effectiveMime, resolveFileKey }

  /** The streaming reader's key resolver: the same lookup, key only. */
  const resolveStreamKey = useCallback(
    async () => (await resolveFileKey()).key,
    [resolveFileKey],
  )

  // LD-0001 PR-B: the streaming session (contract §4). The path is decided
  // synchronously on this render, so the whole-file effect below can never
  // start a download for a file that will stream. Keyed by (file.id,
  // selectedVersionId) inside the hook — a parent re-render with a new `file`
  // object does not restart playback.
  const mediaKind = mediaKindFor(effectiveMime, getExtension(name))
  const stream = useMediaStream({
    file,
    mediaKind,
    selectedVersionId,
    isUnlocked,
    mime: effectiveMime,
    // The stream reader takes the bare key: SF-0002's repair is not applied on
    // the streaming path, so a repaired row shows the stream error card.
    resolveFileKey: resolveStreamKey,
  })

  // Load + decrypt content for the current selection (null = live version).
  // For images viewing the current version, try large thumbnail first to avoid
  // downloading the full original (spec 031 — thumbnail-first viewing).
  useEffect(() => {
    const { file, name, effectiveMime, resolveFileKey } = loadInputsRef.current
    let cancelled = false
    setBlob(null)
    setBlobIsOriginal(false)
    setError(null)
    setTransfer(null)
    setCapCopy(null)
    // Every run starts (and every cleanup ends) with the version spinner off:
    // an aborted version load used to leave it spinning forever (item 7).
    setVersionLoading(false)
    if (!isUnlocked) return
    // LD-0001 PR-B: a file on the streaming path must NEVER load whole-file,
    // nor a video whose stream errored after metadata (round 3 B8: the
    // unsupported card stays; a whole-file reload would hit the same codec).
    if (stream.streaming || stream.blockWholeFile) {
      setVersionLoading(false)
      return
    }

    const abort = new AbortController()

    const imageExt = getExtension(name)
    // TIFF stays IN the thumbnail-first fast-path eligibility (task 1574
    // gate, Codex review round 2, 2026-09-27 — this was briefly excluded in
    // round 1's fix, which traded the round-1 bug for a worse one: ANY TIFF
    // with a thumbnail then had to fully download+decrypt the original,
    // however large, before ever rendering anything, defeating the whole
    // point of thumbnail-first for exactly the files it matters most for
    // — large studio/professional TIFFs, the ones most likely to come from
    // a CLI/desktop/mobile client that generates thumbnails). The actual
    // fix for round 1's bug (a WebP thumbnail reaching utif2, which rejects
    // non-TIFF bytes) lives in `pickRenderer`'s TIFF branch instead: it only
    // routes to `TiffPreview` once `blobIsOriginal` is true, so a
    // still-thumbnail blob renders via the generic image branch (a plain
    // `<img>` decodes WebP natively) until the real original has loaded.
    const isImageFile =
      effectiveMime?.startsWith('image/') || IMAGE_EXTENSIONS_SET.has(imageExt) || HEIC_IMAGE_EXTS.has(imageExt)

    // One React update per 150 ms at most, plus every phase change and the
    // final event (item 12): a fast transfer used to re-render the preview on
    // every network read.
    const throttle = createTransferThrottle((p) => {
      if (!cancelled) setTransfer(p)
    })
    const onTransfer = (p: TransferProgress) => {
      if (!cancelled) throttle.push(p)
    }

    async function loadAndDecrypt() {
      try {
        const { key: fileKey, ownerDerived } = await resolveFileKey()

        // Thumbnail-first path for images (current version only)
        if (isImageFile && selectedVersionId === null) {
          // Only request the large variant when the server says it exists.
          // Mobile/CLI/legacy uploads have only a medium thumbnail, so an
          // unconditional /thumbnail/large request would waste a guaranteed-404.
          // The medium fallback below is a reachable sibling: it runs whenever
          // the large fetch is skipped (no large variant) OR fails.
          if (file.has_large_thumbnail) {
            const largeThumbnailUrl = await fetchAndDecryptLargeThumbnail(file.id, fileKey)
            if (largeThumbnailUrl && !cancelled) {
              const thumbRes = await fetch(largeThumbnailUrl)
              if (thumbRes.ok) {
                const thumbBlob = await thumbRes.blob()
                if (!cancelled) {
                  setBlob(thumbBlob)
                  setRenderKey((k) => k + 1)
                  return
                }
              }
            }
          }
          // Large skipped or failed — try medium thumbnail
          if (!cancelled) {
            const mediumThumbnailUrl = await fetchAndDecryptThumbnail(file.id, fileKey)
            if (mediumThumbnailUrl && !cancelled) {
              const thumbRes = await fetch(mediumThumbnailUrl)
              if (thumbRes.ok) {
                const thumbBlob = await thumbRes.blob()
                if (!cancelled) {
                  setBlob(thumbBlob)
                  setRenderKey((k) => k + 1)
                  return
                }
              }
            }
          }
        }

        // If this effect run was superseded (the file's decrypted name/versions
        // resolved async and re-ran loadAndDecrypt), bail BEFORE the full download.
        // Otherwise a stale run would fetch the entire original even though a
        // newer run is already rendering the thumbnail — wasting bandwidth and
        // defeating thumbnail-first viewing (spec 031).
        if (cancelled) return

        // Full download path (non-images, historical versions, or thumbnail fallback)
        let plaintext: Blob
        if (selectedVersionId === null) {
          const res = await decryptToBlob(
            file.id,
            fileKey,
            file.name_encrypted,
            effectiveMime ?? undefined,
            file.chunk_count,
            file.size_bytes,
            {
              onProgress: onTransfer,
              signal: abort.signal,
              mediaCapBytes: WHOLE_FILE_MEDIA_CAP_BYTES,
              // C5: the renderer's rule (row MIME first) decides "is media".
              rowMimeType: file.mime_type ?? null,
              // SF-0002: only an OWNER key may fall back to a repaired key.
              masterKey: ownerDerived ? getMasterKey() : undefined,
            },
          )
          plaintext = res.plaintext
        } else {
          const v = versionsRef.current?.find((x) => x.id === selectedVersionId)
          if (!v) throw new Error('Version not found')
          setVersionLoading(true)
          plaintext = await decryptVersionToBlob(
            file.id,
            v.id,
            fileKey,
            file.name_encrypted,
            effectiveMime ?? undefined,
            v.chunk_count,
            v.size_bytes,
            {
              onProgress: onTransfer,
              signal: abort.signal,
              mediaCapBytes: WHOLE_FILE_MEDIA_CAP_BYTES,
              // C5: the renderer's rule (row MIME first) decides "is media".
              rowMimeType: file.mime_type ?? null,
              // SF-0002: only an OWNER key may fall back to a repaired key.
              masterKey: ownerDerived ? getMasterKey() : undefined,
            },
          )
        }
        if (!cancelled) {
          setBlob(plaintext)
          setBlobIsOriginal(true)
          setRenderKey((k) => k + 1)
        }
      } finally {
        if (!cancelled) setVersionLoading(false)
      }
    }

    // A transient network blip (offline flicker, dropped connection) makes
    // fetch() reject with a TypeError "Failed to fetch" — distinct from a
    // permanent failure (404, decrypt error). Retry those a couple of times with
    // backoff so the preview recovers instead of dead-ending on the error card
    // (task 0691). Permanent errors fail fast.
    function isTransientNetworkError(err: unknown): boolean {
      return err instanceof TypeError && /fetch|network|load failed/i.test(err.message)
    }

    async function loadWithRetry() {
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          // Each attempt starts from a clean transfer state (item 10): a retry
          // must not show the previous attempt's bytes/parts. C7: the throttle
          // starts fresh too, so the new attempt's first event is not held
          // behind the previous attempt's 150 ms window.
          throttle.reset()
          if (!cancelled) setTransfer(null)
        }
        try {
          await loadAndDecrypt()
          return
        } catch (err: unknown) {
          if (cancelled) return
          // An over-cap card is a decision, not a failure: show the card.
          if (err instanceof TooLargeToPreviewError) {
            setCapCopy(err.message)
            return
          }
          if (isTransientNetworkError(err) && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 400 * attempt))
            if (cancelled) return
            continue
          }
          setError(err instanceof Error ? err.message : 'Failed to load file')
          return
        }
      }
    }
    loadWithRetry()

    return () => {
      cancelled = true
      throttle.cancel()
      // A cleanup always clears the version spinner too (item 7).
      setVersionLoading(false)
      abort.abort()
    }
    // `versions` is intentionally NOT a dependency — see versionsRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- C6: keyed on content identity; inputs via loadInputsRef
  }, [file.id, selectedVersionId, isUnlocked, file.chunk_count, file.size_bytes, stream.streaming, stream.blockWholeFile])

  const handleRestore = useCallback(async () => {
    if (selectedVersionId === null) return
    const version = versions?.find((v) => v.id === selectedVersionId)
    if (!version) return
    if (!confirm('Restore this version? The current version becomes a previous one.')) return
    try {
      // SF-0002 round 2 (W4): refused when the row is read-only, and when the
      // version being restored is upper_repair-sealed; nothing is POSTed then.
      await restoreOwnerVersion({
        file,
        version,
        masterKey: isUnlocked ? getMasterKey() : undefined,
        residentUserId: getResidentUserId(),
      })
      // After restore: refetch versions, snap back to live.
      const res = await listVersions(file.id)
      setVersions(res.versions)
      setCurrentVersionNumber(res.current_version)
      setSelectedVersionId(null)
      onVersionRestored?.()
    } catch (err) {
      setError(ownerWriteRefusal(err) ?? 'Restore failed. The version may have been deleted.')
    }
  }, [file, versions, selectedVersionId, isUnlocked, getMasterKey, getResidentUserId, onVersionRestored])

  // ── Text/markdown/code editor (task 1563) ─────────────────────────────────
  // Editing is only offered for the LIVE version — editing a historical
  // version directly isn't supported (restore it first, then edit).
  const editKind = selectedVersionId === null ? resolveEditableKind(effectiveMime, name) : null

  // ── Office editor (task 1567) — docx/doc/odt/xlsx/xls/ods/pptx/ppt/odp,
  // feature-flagged off by default (see src/lib/flags.ts). Same LIVE-version-
  // only restriction as the text editor above. Mutually exclusive with
  // `editKind` (disjoint mime/extension sets). Opens in its OWN top-level
  // tab (`/office/<fileId>`, see office-editor-page.tsx's header
  // comment for why) rather than inline here — the engine's SharedArrayBuffer
  // requirement needs the TOP-LEVEL document itself cross-origin isolated,
  // which this page (shared with the rest of Drive) deliberately is not.
  // Gated by the build flag only (isOfficeLabsEnabled() aliases
  // FEATURE_OFFICE_EDITOR since the Labs opt-in was dropped — office-labs.ts).
  const officeKind =
    isOfficeLabsEnabled() && selectedVersionId === null ? resolveOfficeFileKind(effectiveMime, name) : null
  const canEditOffice = !!officeKind

  function openOfficeEditorTab() {
    window.open(`/office/${encodeURIComponent(file.id)}`, `bb-office-${file.id}`)
  }

  useEffect(() => {
    let cancelled = false
    if (!blob || !blobIsOriginal || !editKind) {
      setEditability(null)
      setDecodedText(null)
      return
    }
    blob
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return
        const bytes = new Uint8Array(buf)
        const result = checkEditability(bytes)
        setEditability(result)
        setDecodedText(result.editable ? new TextDecoder('utf-8').decode(bytes) : null)
      })
      .catch(() => {
        if (!cancelled) {
          setEditability(null)
          setDecodedText(null)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, blobIsOriginal, editKind?.isMarkdown, editKind?.language])

  const canEdit = !!editKind && editability?.editable === true

  // "+ New" → Text file / Markdown (task 1582): enter edit mode by itself,
  // once, as soon as the (empty) file has been decrypted and checked. Keyed
  // on the file id so prev/next never inherits it.
  const autoEditedFileIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!startInEditMode || !canEdit || editing) return
    if (autoEditedFileIdRef.current === file.id) return
    autoEditedFileIdRef.current = file.id
    setEditing(true)
  }, [startInEditMode, canEdit, editing, file.id])

  const requestExitEdit = useCallback(() => {
    if (dirty) {
      setUnsavedGuard('exit-edit')
    } else {
      setEditing(false)
    }
  }, [dirty])

  const requestClose = useCallback(() => {
    if (editing && dirty) {
      setUnsavedGuard('close')
    } else {
      onClose()
    }
  }, [editing, dirty, onClose])

  function handleGuardDiscard() {
    const action = unsavedGuard
    // Cancel whatever save/conflict-resolution upload FileEditor might have
    // in flight BEFORE it unmounts (both branches below unmount it — 'close'
    // tears down the whole preview, 'exit-edit' flips back to read mode).
    // Without this, "Discard changes" only cleared React state; a save
    // already in progress kept running in the background and could still
    // land as a new version moments after the dialog said it would be
    // discarded (PR #103 review thread).
    editorRef.current?.abortSave()
    setUnsavedGuard(null)
    setDirty(false)
    if (action === 'close') {
      setEditing(false)
      onClose()
    } else if (action === 'exit-edit') {
      setEditing(false)
    }
  }

  function handleGuardCancel() {
    setUnsavedGuard(null)
  }

  /** A same-file save (new version) — refresh the read-mode blob + version
   *  list in place so switching back to Read shows the saved content
   *  without a reload, and Drive's own listing picks up the new version. */
  function handleEditorSaved(updatedFile: DriveFile, savedText: string) {
    setBlob(new Blob([savedText], { type: effectiveMime ?? 'text/plain' }))
    setBlobIsOriginal(true)
    setRenderKey((k) => k + 1)
    setCurrentVersionNumber(updatedFile.version_number ?? currentVersionNumber + 1)
    listVersions(file.id)
      .then((res) => {
        setVersions(res.versions)
        setCurrentVersionNumber(res.current_version)
      })
      .catch(() => {})
    onVersionRestored?.()
  }

  /** Keep Both created a sibling file — this file's own content is
   *  untouched, so there's nothing to refresh here beyond Drive's listing.
   *  Exits edit mode directly (not through requestExitEdit's dirty guard):
   *  the edit that would have been "lost" was just saved successfully as
   *  the sibling, so there's nothing left to confirm discarding. */
  function handleEditorSiblingCreated(_newFile: DriveFile) {
    setDirty(false)
    setEditing(false)
    onVersionRestored?.()
  }


  const sizeStr = formatSize(file.size_bytes)
  const kindLabel = getKindLabel(effectiveMime, name)

  // Zoom helpers
  const imageExt = getExtension(name)
  // RAW is included here (task 1574) now that RawPreview delegates its
  // actual rendering to ImagePreview once extraction succeeds — before this
  // task, `isImage` excluded RAW entirely, so the top-bar zoom/rotate
  // buttons were never wired for it and RawPreview's own wheel-zoom handler
  // received a permanent no-op `onZoomChange` (imageControls was always
  // `undefined`) — zoom silently did nothing. TIFF was already covered via
  // IMAGE_EXTENSIONS_SET.
  const isImage =
    effectiveMime?.startsWith('image/') ||
    IMAGE_EXTENSIONS_SET.has(imageExt) ||
    HEIC_IMAGE_EXTS.has(imageExt) ||
    RAW_IMAGE_EXTS.has(imageExt) ||
    RAW_IMAGE_MIMES.has(effectiveMime ?? '')
  function handleZoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))
  }
  function handleZoomOut() {
    setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))
  }
  function handleRotate() {
    setRotation((r) => (r + 90) % 360)
  }

  const imageControls: ImageControlProps | undefined = isImage
    ? { zoom, rotation, onZoomChange: setZoom, onClose, onPrev, onNext, hasPrev, hasNext, onRawInfo: setRawExifInfo }
    : undefined

  // LD-0001 PR-B: a streaming session renders the media element against
  // /sw-stream/<id> — no blob exists on that path.
  const streamRenderer =
    stream.src && mediaKind === 'video' ? (
      <VideoPreview src={stream.src} onElement={stream.setElement} overlay={stream.overlay} />
    ) : stream.src && mediaKind === 'audio' ? (
      <AudioPreview src={stream.src} filename={name} onElement={stream.setElement} />
    ) : null
  const renderer = blob
    ? pickRenderer(effectiveMime, blob, name, imageControls, blobIsOriginal)
    : streamRenderer
  const canPreview = renderer !== null

  function saveBlob(data: Blob) {
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Download must ALWAYS save the full original — never the large/medium
  // thumbnail the image preview loads for fast rendering. Reuse the loaded blob
  // only when it IS the original (non-image, fallback, or a historical version);
  // otherwise fetch and decrypt the original on demand. On error we surface it
  // rather than silently saving a downscaled WebP.
  async function handleDownload() {
    if (downloading) return
    // The decision is pure (preview-load-policy.ts): the branch taken here is
    // the branch under test.
    const action = chooseDownloadAction({
      hasOriginalBlob: !!blob && blobIsOriginal,
      overCap: capCopy !== null,
      selectedVersionId,
      file,
      version:
        selectedVersionId === null
          ? null
          : versions?.find((x) => x.id === selectedVersionId) ?? null,
    })
    if (action.kind === 'save-blob') {
      if (blob) saveBlob(blob)
      return
    }
    try {
      setDownloading(true)
      const { key: fileKey, ownerDerived } = await resolveFileKey()
      if (action.kind === 'stream-to-disk') {
        // The over-cap card has no Blob and must NEVER load the whole file into
        // memory: stream the plaintext to disk through the service worker, the
        // same path the toolbar Download uses (item 2). `downloading` disables
        // the button for the duration. C4: closing the preview (or switching
        // file or version) aborts it, and nothing updates state afterwards.
        const abort = new AbortController()
        overCapAbortRef.current?.abort()
        overCapAbortRef.current = abort
        await streamOverCapDownload(
          {
            fileId: file.id,
            fileKey,
            nameEncrypted: file.name_encrypted,
            mimeType: effectiveMime ?? undefined,
            versionId: action.versionId,
            chunkCount: action.chunkCount,
            sizeBytes: action.sizeBytes,
          },
          {
            signal: abort.signal,
            onProgress: (written, total) => {
              if (mountedRef.current && !abort.signal.aborted) setSavedProgress({ written, total })
            },
          },
        )
        return
      }
      if (action.kind === 'version-not-found') throw new Error('Version not found')
      let original: Blob
      if (action.kind === 'decrypt-live') {
        const res = await decryptToBlob(
          file.id,
          fileKey,
          file.name_encrypted,
          effectiveMime ?? undefined,
          file.chunk_count,
          file.size_bytes,
          { masterKey: ownerDerived ? getMasterKey() : undefined },
        )
        original = res.plaintext
      } else {
        original = await decryptVersionToBlob(
          file.id,
          action.versionId,
          fileKey,
          file.name_encrypted,
          effectiveMime ?? undefined,
          action.chunkCount,
          action.sizeBytes,
          { masterKey: ownerDerived ? getMasterKey() : undefined },
        )
      }
      saveBlob(original)
    } catch (err: unknown) {
      // An abandoned (aborted) download is not an error, and an unmounted
      // preview takes no state update (C4).
      if (!mountedRef.current || (err as { name?: unknown } | null)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      if (mountedRef.current) {
        setDownloading(false)
        setSavedProgress(null)
      }
    }
  }

  // C4: a different file or version, or closing the preview, abandons an
  // over-cap download in flight.
  useEffect(() => {
    return () => {
      overCapAbortRef.current?.abort()
      overCapAbortRef.current = null
    }
  }, [file.id, selectedVersionId])

  // Keyboard navigation for prev/next (arrow keys) + ⌘E to enter the editor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // While editing, CodeMirror's own contenteditable surface owns the
      // keyboard entirely — arrow keys move the cursor, not the file
      // gallery, and Escape must NOT silently close a dirty editor (it
      // used to reach the raw onClose() here, which had no unsaved-changes
      // guard at all).
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (canEdit) {
          e.preventDefault()
          setEditing(true)
        }
        return
      }
      if (e.key === 'ArrowLeft' && onPrev && hasPrev) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext && hasNext) {
        e.preventDefault()
        onNext()
      } else if (e.key === 'Escape') {
        requestClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onPrev, onNext, hasPrev, hasNext, requestClose, editing, canEdit])

  // Read-only editor notice (design screen 06): shown whenever the file is
  // an editor candidate (markdown/code/plain-text) but fails the byte-level
  // editability gate — too large, binary, or not valid UTF-8. For
  // 'too-large' the normal renderer still shows underneath (TextPreview's
  // own 500-line cap already makes it a reasonable read-only peek); for
  // 'binary'/'invalid-utf8' the renderer is suppressed entirely rather than
  // showing garbled decoded bytes.
  const showReadOnlyNotice = !!editKind && editability !== null && !editability.editable
  const suppressRendererForNotice =
    showReadOnlyNotice && editability!.reason !== 'too-large'

  // RAW camera details (task 1574) — the Info rail's camera/lens/exposure rows.
  const rawInfoRows = rawInfoRowsOf(rawExifInfo)

  return (
    <PreviewChrome
      filename={name}
      kind={effectiveMime ?? ''}
      size={sizeStr}
      // The top bar's back control always closes the WHOLE preview, in
      // either mode — unchanged from before the header merge. "Exit edit
      // mode but stay on this file" is still its own separate control (the
      // editor's own "Done", now portaled into this same row instead of a
      // second row underneath it — PR #103 review: "double header" was
      // about the DUPLICATE FILENAME/ROW, not about collapsing these two
      // distinct actions into one).
      onClose={requestClose}
      decrypted={!!blob}
      onDownload={!editing && blob ? handleDownload : undefined}
      isStarred={file.is_starred}
      onZoomIn={isImage && blob ? handleZoomIn : undefined}
      onZoomOut={isImage && blob ? handleZoomOut : undefined}
      onRotate={isImage && blob ? handleRotate : undefined}
      onEdit={
        ownerReadOnly
          ? undefined
          : canEditOffice && !editing
          ? openOfficeEditorTab
          : canEdit && !editing
            ? () => setEditing(true)
            : undefined
      }
      editing={editing}
      dirty={dirty}
      onToolbarSlotReady={setToolbarSlot}
      belowTopBar={
        !editing && versions && versions.length > 1 ? (
          <VersionScrubber
            versions={versions}
            currentVersionNumber={currentVersionNumber}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            onRestore={handleRestore}
            loading={versionLoading}
          />
        ) : undefined
      }
      rightRail={
        editing ? undefined : (
          <InfoRail
            filename={name}
            kind={kindLabel}
            size={sizeStr}
            items={[
              ['Modified', new Date(file.updated_at).toLocaleDateString()],
              ...rawInfoRows,
            ]}
            cipher={CONTENT_CIPHER_LABEL}
            chunkCount={
              selectedVersionId === null
                ? file.chunk_count
                : versions?.find((v) => v.id === selectedVersionId)?.chunk_count
            }
            // LD-0001 PR-B: a stream verifies tags only, per distinct part.
            tagsVerified={stream.tagsVerified || (!!blob && blobIsOriginal && !error)}
            streamLine={stream.infoLine ?? undefined}
          />
        )
      }
    >
      {/* Loading state — honest whole-file progress (LD-0001 PR-C) */}
      {!blob && !error && !capCopy && !streamRenderer && !stream.errorCopy && stream.path !== 'download-card' && stream.path !== 'unsupported' && (
        <PreviewProgress transfer={transfer} />
      )}

      {/* Over the 2 GiB whole-file media cap (contract §4 row 5) */}
      {!blob && !error && capCopy && (
        <OverCapCard
          copy={capCopy}
          downloading={downloading}
          savedProgress={savedProgress}
          onDownload={handleDownload}
        />
      )}

      {/* Streaming-only states (LD-0001 PR-B, contract §4 rows 5-9). */}
      {!blob && !error && stream.errorCopy && (
        <StreamErrorCard
          copy={stream.errorCopy}
          retryable={stream.path !== 'changed'}
          onRetry={stream.retry}
        />
      )}
      {!blob && !error && stream.path === 'download-card' && (
        <DownloadPromptCard copy={DOWNLOAD_CARD_COPY} onDownload={handleDownload} />
      )}
      {!blob && !error && stream.path === 'unsupported' && (
        <DownloadPromptCard copy={UNSUPPORTED_TYPE_COPY} onDownload={handleDownload} />
      )}

      {/* Error state */}
      {error && (
        <PreviewErrorCard
          message={error}
          shareSourced={shareOrigin !== undefined}
          onClose={requestClose}
          onDelete={onDelete && shareOrigin !== undefined ? () => void onDelete(file) : undefined}
        />
      )}

      {/* Unsupported type */}
      {blob && !canPreview && (
        <DownloadPromptCard copy={UNSUPPORTED_TYPE_COPY} onDownload={handleDownload} />
      )}

      {/* Editor (task 1563) — replaces the read-mode renderer entirely
          while active. Fills the canvas area itself (PreviewChrome's canvas
          centers its children, which the editor doesn't want). */}
      {editing && blob && decodedText !== null && (
        <div className="absolute inset-0 p-3" data-testid="editor-container">
          <FileEditor
            ref={editorRef}
            file={file}
            decryptedName={name}
            initialText={decodedText}
            mimeType={effectiveMime}
            isMarkdown={editKind?.isMarkdown ?? false}
            language={editKind?.language}
            openedVersionNumber={currentVersionNumber}
            onDirtyChange={setDirty}
            onSaved={handleEditorSaved}
            onSiblingCreated={handleEditorSiblingCreated}
            toolbarSlotEl={toolbarSlot}
            onRequestExitEdit={requestExitEdit}
          />
        </div>
      )}

      {/* SF-0002: repaired-from-iOS file — readable, not writable. */}
      {!editing && ownerReadOnly && (
        <div
          className="mx-auto flex w-full max-w-[560px] items-start gap-2.5 rounded-md border border-line bg-paper px-4 py-3 text-left shadow-1"
          data-testid="owner-repair-readonly-notice"
        >
          <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <p className="text-[12.5px] leading-relaxed text-ink-2">{OWNER_REPAIR_READ_ONLY}</p>
        </div>
      )}

      {/* Read-only editor notice (design screen 06) — shown for a
          markdown/code/text file that fails the editability gate. */}
      {!editing && showReadOnlyNotice && editability && (
        <ReadOnlyEditorNotice editability={editability} onDownload={handleDownload} />
      )}

      {/* Actual preview — keyed on renderKey so each blob swap (initial
          load, version switch) triggers a fresh fade-in animation. */}
      {!editing && renderer && !suppressRendererForNotice && (
        <div key={renderKey} className="decrypt-fade-in flex h-full w-full items-center justify-center">
          {renderer}
        </div>
      )}

      {unsavedGuard && (
        <UnsavedChangesDialog onDiscard={handleGuardDiscard} onCancel={handleGuardCancel} />
      )}
    </PreviewChrome>
  )
}
