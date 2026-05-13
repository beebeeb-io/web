import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { BBCheckbox } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { Icon } from './icons'
import { FileIcon, getFileType } from './file-icon'
import { getBadgeStyle } from '../lib/file-colors'
import { ContextMenu } from './context-menu'
import { FileRowSkeleton } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { decryptFilename, parseEncryptedBlob, encryptFilename, serializeEncryptedBlob } from '../lib/crypto'
import { onDecrypted } from '../lib/decrypt-events'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { isPreviewable } from '../lib/preview'
import { modKey } from '../hooks/use-keyboard-shortcuts'
import { formatBytes } from '../lib/format'
import { setPreference, updateFile } from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { SharePopover } from './share-popover'
import { FolderViewerBadge } from './presence-avatars'
import { useToast } from './toast'
import { getFolderColorDot, FOLDER_COLORS } from '../lib/folder-colors'
import type { DriveFile, MyShare } from '../lib/api'

// ─── Sort types ─────────────────────────────────────

type SortKey =
  | 'name-asc' | 'name-desc'
  | 'modified-desc' | 'modified-asc'
  | 'size-desc' | 'size-asc'
  | 'type-asc'
  | 'starred-first'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name-asc',      label: 'Name (A → Z)' },
  { key: 'name-desc',     label: 'Name (Z → A)' },
  { key: 'modified-desc', label: 'Modified (newest)' },
  { key: 'modified-asc',  label: 'Modified (oldest)' },
  { key: 'size-desc',     label: 'Size (largest)' },
  { key: 'size-asc',      label: 'Size (smallest)' },
  { key: 'type-asc',      label: 'Type' },
  { key: 'starred-first', label: 'Starred first' },
]

// Type-group rank: lower = earlier in the list
function typeGroupRank(file: DriveFile, name: string): number {
  if (file.is_folder) return 0
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'tif', 'avif'].includes(ext)) return 1
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'].includes(ext)) return 2
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus'].includes(ext)) return 3
  if (['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'pages', 'md', 'mdx', 'xls', 'xlsx', 'ods', 'numbers', 'ppt', 'pptx', 'odp', 'key'].includes(ext)) return 4
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'zst', 'dmg', 'iso'].includes(ext)) return 5
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'rb', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'php', 'sh', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'sql'].includes(ext)) return 6
  return 7
}

const SORT_KEY_PREFIX = 'beebeeb.sort.'

// ─── Helpers ─────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

function dateGroup(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const fileDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (fileDay >= today) return 'Today'
  if (fileDay >= yesterday) return 'Yesterday'
  if (fileDay >= weekAgo) return 'This week'
  return 'Earlier'
}

// ─── Props ───────────────────────────────────────────

export interface FileListProps {
  files: DriveFile[]
  loading: boolean
  emptyState: ReactNode
  onRefresh?: () => void
  sortable?: boolean
  selectable?: boolean
  showDateGroups?: boolean
  /** Inline upload cards rendered at the top of the scrollable area (spec 024 §4). */
  uploadCards?: ReactNode
  /**
   * Current folder ID (or null / undefined for root). Used to key sort
   * persistence in localStorage so each folder remembers its own sort order.
   */
  parentId?: string | null

  // Navigation
  onNavigateFolder?: (folder: DriveFile) => void

  // File selection (drives detail panel)
  selectedFileId?: string | null
  onSelectFile?: (file: DriveFile | null) => void

  // Selection change for external keyboard shortcuts
  onSelectionChange?: (ids: Set<string>) => void

  // Decrypted name sync for dialog use in parent
  onDecryptedNamesChange?: (names: Record<string, string | null>) => void

  // Context menu / row action handler
  onFileAction?: (action: string, file: DriveFile) => void

  // Direct star toggle (bypasses context menu, used by inline star button)
  onToggleStar?: (fileId: string) => void

  // Drag-and-drop to folder handler
  onDropToFolder?: (draggedIds: string[], targetFolder: DriveFile) => Promise<void>

  // Custom row actions (replaces the kebab button)
  renderActions?: (file: DriveFile) => ReactNode

  // Bulk action callbacks (showing bulk bar requires at least one non-undefined)
  onBulkTrash?: (ids: string[]) => Promise<void>
  onBulkMove?: (ids: string[]) => void
  onBulkShare?: (ids: string[]) => void
  onBulkDownload?: (ids: string[]) => Promise<void>
  /** When set, shows ZIP progress in the bulk action bar and disables the download button. */
  bulkZipProgress?: { done: number; total: number } | null

  // Animation state driven by parent (for drive page micro-interactions)
  trashingIds?: Set<string>
  starPulseId?: string | null
  recentlyUploadedIds?: Set<string>

  // Pre-decrypted names override (for Shared page with custom key derivation)
  externalDecryptedNames?: Record<string, string>

  // Trust details: clicking the lock icon opens this callback's panel.
  // City defaults to "Falkenstein" — use whatever the file's storage pool returns when wired.
  onShowTrustDetails?: (file: DriveFile) => void
  encryptionCity?: string

  /** Active shares owned by the current user, used to flag rows that have at
   *  least one non-revoked share when `share_count` may not be populated yet
   *  (e.g. immediately after a share is created). */
  myShares?: MyShare[]

  /**
   * Viewer count per folder ID. When a folder has > 0 members, a compact
   * presence badge is shown in its name cell.
   * Shape: { [folderId]: { count: number; emails: string[] } }
   */
  folderViewerCounts?: Record<string, { count: number; emails: string[] }>
}

// ─── Component ───────────────────────────────────────

export function FileList({
  files,
  loading,
  emptyState,
  sortable = true,
  selectable = true,
  showDateGroups = false,
  onNavigateFolder,
  selectedFileId,
  onSelectFile,
  onSelectionChange,
  onDecryptedNamesChange,
  onFileAction,
  onDropToFolder,
  onToggleStar,
  renderActions,
  onBulkTrash,
  onBulkMove,
  onBulkShare,
  onBulkDownload,
  bulkZipProgress = null,
  trashingIds = new Set<string>(),
  starPulseId = null,
  recentlyUploadedIds = new Set<string>(),
  externalDecryptedNames,
  onShowTrustDetails,
  encryptionCity = 'Falkenstein',
  uploadCards,
  myShares,
  folderViewerCounts,
  parentId,
  onRefresh,
}: FileListProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const { showToast } = useToast()

  // ─── Active-share lookup ───────────────────────────
  // Derived set of file ids that currently have at least one non-revoked,
  // non-expired share belonging to the current user. Used to show the share
  // indicator next to filenames even when `file.share_count` is stale (the
  // server count can lag right after a share is created/revoked).
  const sharedFileIds = useMemo(() => {
    if (!myShares) return null
    const now = Date.now()
    const ids = new Set<string>()
    for (const s of myShares) {
      if (s.revoked) continue
      if (s.expires_at) {
        const exp = new Date(s.expires_at).getTime()
        if (Number.isFinite(exp) && exp <= now) continue
      }
      ids.add(s.file_id)
    }
    return ids
  }, [myShares])

  // ─── Sort state ────────────────────────────────────
  // Key per folder: beebeeb.sort.<folderId> or beebeeb.sort.root
  // Falls back to the old global key for a smooth migration.
  const sortLsKey = `${SORT_KEY_PREFIX}${parentId ?? 'root'}`

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      // Try per-folder key first, then fall back to old global key
      const raw = localStorage.getItem(sortLsKey) ?? localStorage.getItem('bb_drive_sort')
      if (raw) {
        const parsed = JSON.parse(raw) as { key?: string }
        if (parsed.key && SORT_OPTIONS.some((o) => o.key === parsed.key)) {
          return parsed.key as SortKey
        }
      }
    } catch { /* fall through */ }
    return 'name-asc'
  })
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  // Re-read from localStorage when the folder changes (parentId changed)
  const prevSortLsKeyRef = useRef(sortLsKey)
  useEffect(() => {
    if (prevSortLsKeyRef.current === sortLsKey) return
    prevSortLsKeyRef.current = sortLsKey
    try {
      const raw = localStorage.getItem(sortLsKey) ?? localStorage.getItem('bb_drive_sort')
      if (raw) {
        const parsed = JSON.parse(raw) as { key?: string }
        if (parsed.key && SORT_OPTIONS.some((o) => o.key === parsed.key)) {
          setSortKey(parsed.key as SortKey)
          return
        }
      }
    } catch { /* ignore */ }
    setSortKey('name-asc')
  }, [sortLsKey])

  useEffect(() => {
    try {
      localStorage.setItem(sortLsKey, JSON.stringify({ key: sortKey }))
    } catch { /* ignore */ }
  }, [sortKey, sortLsKey])

  // ─── Decrypted names ───────────────────────────────
  //
  // `decryptedNames[id]` semantics:
  //   undefined  →  not yet decrypted (show skeleton in UI)
  //   string     →  successfully decrypted name
  //   null       →  decryption failed (show "Encrypted file" placeholder)
  //
  // NEVER fall back to `file.name_encrypted` — that exposes raw JSON ciphertext
  // to users and is the bug this fix addresses.
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (externalDecryptedNames !== undefined) {
      setDecryptedNames(externalDecryptedNames)
      return
    }
    if (!isUnlocked) {
      setDecryptedNames({})
      return
    }
    if (files.length === 0) {
      setDecryptedNames({})
      return
    }
    let cancelled = false

    // Strict decryption: throws on failure so the caller can decide whether
    // to retry. Avoids the silent "Encrypted file" placeholder that the
    // shared decryptFileMetadata helper returns on error.
    async function decryptOne(file: DriveFile): Promise<string> {
      // Legacy format (iOS before 930c61a): plain-text name, not JSON-encrypted.
      if (!file.name_encrypted.startsWith('{')) {
        return file.name_encrypted
      }
      const fileKey = await getFileKey(file.id)
      const { nonce, ciphertext } = parseEncryptedBlob(file.name_encrypted)
      const plain = await decryptFilename(fileKey, nonce, ciphertext)
      try {
        const meta = JSON.parse(plain) as { name?: string }
        if (meta && typeof meta === 'object' && typeof meta.name === 'string' && meta.name.trim()) {
          return meta.name.trim()
        }
      } catch {
        // Legacy format — `plain` is the bare filename.
      }
      return plain
    }

    async function decryptAll() {
      const names: Record<string, string | null> = {}
      // Retry transient failures (commonly: WASM still initializing when the
      // first render fires, a brief master-key handoff race, or — for folders
      // created on iOS — the file-key being derived from a different KDF path
      // that races with the web key cache warm-up). Four attempts with mild
      // backoff costs at most ~1.5s before we surface the encrypted placeholder.
      const MAX_ATTEMPTS = 4
      const RETRY_DELAY_MS = 300
      for (const file of files) {
        if (cancelled) return
        let lastErr: unknown
        let resolved: string | null = null
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            resolved = await decryptOne(file)
            break
          } catch (err) {
            lastErr = err
            if (attempt < MAX_ATTEMPTS - 1) {
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
            }
          }
          if (cancelled) return
        }
        if (resolved !== null) {
          names[file.id] = resolved
        } else {
          names[file.id] = null
          // eslint-disable-next-line no-console
          console.error('[file-list] decryption failed', {
            fileId: file.id,
            error: lastErr instanceof Error ? lastErr.message : String(lastErr),
          })
        }
      }
      if (!cancelled) {
        setDecryptedNames(names)
      }
    }
    decryptAll()
    return () => { cancelled = true }
  }, [files, isUnlocked, getFileKey, externalDecryptedNames])

  useEffect(() => {
    onDecryptedNamesChange?.(decryptedNames)
  }, [decryptedNames, onDecryptedNamesChange])

  /**
   * Returns the display name for a file.
   *
   * - `undefined` in decryptedNames → decryption pending → returns null (caller shows skeleton)
   * - `null` in decryptedNames      → decryption failed  → returns "Encrypted file"
   * - `string` in decryptedNames    → success            → returns the name
   *
   * NEVER returns raw ciphertext JSON. The caller is responsible for rendering
   * a skeleton when this returns null.
   */
  function displayName(file: DriveFile): string | null {
    const cached = decryptedNames[file.id]
    if (cached === undefined) return null      // pending — caller shows skeleton
    if (cached === null) return 'Encrypted file' // failed
    return cached                               // success
  }

  // ─── Thumbnails ────────────────────────────────────
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const loadingThumbs = useRef(new Set<string>())
  const thumbnailsRef = useRef(thumbnails)
  useEffect(() => { thumbnailsRef.current = thumbnails }, [thumbnails])

  const loadThumbnailRef = useRef<((fileId: string) => void) | null>(null)

  const loadThumbnail = useCallback(async (fileId: string) => {
    if (thumbnailsRef.current[fileId] || loadingThumbs.current.has(fileId)) return
    loadingThumbs.current.add(fileId)
    try {
      const fileKey = await getFileKey(fileId)
      const url = await fetchAndDecryptThumbnail(fileId, fileKey)
      if (url) setThumbnails((prev) => ({ ...prev, [fileId]: url }))
    } catch { /* ignore */ }
  }, [getFileKey])

  useEffect(() => {
    loadThumbnailRef.current = loadThumbnail
  }, [loadThumbnail])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const thumbNodeRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!isUnlocked) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const fileId = (entry.target as HTMLElement).dataset.fileId
            if (fileId) loadThumbnailRef.current?.(fileId)
          }
        }
      },
      { threshold: 0.1, rootMargin: '100px' },
    )
    observerRef.current = observer
    for (const el of thumbNodeRefs.current.values()) {
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isUnlocked])

  const setThumbRef = useCallback((fileId: string, el: HTMLElement | null) => {
    if (el) {
      thumbNodeRefs.current.set(fileId, el)
      observerRef.current?.observe(el)
    } else {
      const existing = thumbNodeRefs.current.get(fileId)
      if (existing) observerRef.current?.unobserve(existing)
      thumbNodeRefs.current.delete(fileId)
    }
  }, [])

  // ─── Selection ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set<string>())
  const lastClickedIdRef = useRef<string | null>(null)

  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null)
  const [inlineRenameValue, setInlineRenameValue] = useState('')
  const inlineRenameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inlineRenameId && inlineRenameInputRef.current) {
      inlineRenameInputRef.current.focus()
      const dotIdx = inlineRenameValue.lastIndexOf('.')
      inlineRenameInputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : inlineRenameValue.length)
    }
  }, [inlineRenameId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateSelection = useCallback((next: Set<string>) => {
    setSelectedIds(next)
    onSelectionChange?.(next)
  }, [onSelectionChange])

  function toggleSelection(fileId: string) {
    const next = new Set(selectedIds)
    if (next.has(fileId)) next.delete(fileId)
    else next.add(fileId)
    updateSelection(next)
    lastClickedIdRef.current = fileId
  }

  const clearSelection = useCallback(() => {
    updateSelection(new Set<string>())
    lastClickedIdRef.current = null
  }, [updateSelection])

  // ─── Decryption pulse ──────────────────────────────
  // When a file in the list is decrypted (preview/download), briefly pulse
  // the lock chip to show "something secure happened locally".
  const [decryptPulseId, setDecryptPulseId] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = onDecrypted((fileId) => {
      setDecryptPulseId(fileId)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setDecryptPulseId(null), 900)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // ─── Pinned folders (from shared DriveDataContext) ────────────────────────
  const { pinnedFolderIds: contextPinnedIds } = useDriveData()
  const pinnedFolderIds = new Set(contextPinnedIds)

  const MAX_PINS = 10

  async function handleTogglePin(folderId: string) {
    const current = contextPinnedIds
    const isPinning = !current.includes(folderId)
    if (isPinning && current.length >= MAX_PINS) {
      showToast({
        icon: 'bell',
        title: 'Pin limit reached',
        description: 'Remove a pin first to add a new one.',
      })
      return
    }
    const newIds = isPinning
      ? [...current, folderId]
      : current.filter(id => id !== folderId)
    await setPreference('pinned_folders', { folder_ids: newIds }).catch(() => {})
    window.dispatchEvent(new Event('beebeeb:pins-changed'))
  }

  // ─── Folder color labels ───────────────────────────
  // Map of folderId → hex dot color. Initialized lazily from localStorage when
  // files load. Updated immediately on user color selection without page reload.
  const [folderColors, setFolderColors] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (files.length === 0) return
    const initial: Record<string, string | null> = {}
    for (const file of files) {
      if (file.is_folder) {
        initial[file.id] = getFolderColorDot(file.id)
      }
    }
    setFolderColors(initial)
  }, [files])

  function handleFolderColorChange(folderId: string, colorName: string | null) {
    const dot = colorName
      ? (FOLDER_COLORS.find((c) => c.name === colorName)?.dot ?? null)
      : null
    setFolderColors((prev) => ({ ...prev, [folderId]: dot }))
    // Notify quick-access and other listeners so they can re-read localStorage
    window.dispatchEvent(new CustomEvent('beebeeb:folder-color-changed', { detail: { folderId } }))
  }

  // ─── Context menu ──────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; fileId: string; fileName: string; isFolder: boolean; versionNumber: number; isStarred: boolean; mimeType: string | null
  }>({ open: false, x: 0, y: 0, fileId: '', fileName: '', isFolder: false, versionNumber: 1, isStarred: false, mimeType: null })

  // ─── Share popover ────────────────────────────────
  const [sharePopover, setSharePopover] = useState<{
    fileId: string
    anchorRect: DOMRect
  } | null>(null)

  // ─── Drag-and-drop ─────────────────────────────────
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  function handleDragStart(e: React.DragEvent, file: DriveFile) {
    const ids =
      selectedIds.size > 1 && selectedIds.has(file.id)
        ? Array.from(selectedIds)
        : [file.id]
    e.dataTransfer.setData('text/plain', JSON.stringify(ids))
    if (file.is_folder && ids.length === 1) {
      e.dataTransfer.setData('application/beebeeb-folder', file.id)
    }
    e.dataTransfer.effectAllowed = 'move'
    setDraggedFileId(file.id)

    // Custom drag image: for multi-select, show a stacked card with a count
    // badge instead of just the dragged row (which doesn't communicate that
    // multiple items are moving). For single-item drags, the default ghost
    // is fine — keep it.
    if (ids.length > 1) {
      const ghost = document.createElement('div')
      ghost.style.position = 'absolute'
      ghost.style.top = '-1000px'
      ghost.style.left = '-1000px'
      ghost.style.padding = '6px 12px 6px 14px'
      ghost.style.background = 'oklch(0.99 0.01 84)'
      ghost.style.color = 'oklch(0.20 0.02 60)'
      ghost.style.border = '1px solid oklch(0.86 0.07 90)'
      ghost.style.borderRadius = '8px'
      ghost.style.boxShadow = '0 6px 16px rgba(0,0,0,0.18), 4px 4px 0 -1px oklch(0.99 0.01 84), 4px 4px 0 0 oklch(0.86 0.07 90)'
      ghost.style.fontFamily = 'Inter, system-ui, sans-serif'
      ghost.style.fontSize = '12px'
      ghost.style.fontWeight = '500'
      ghost.style.whiteSpace = 'nowrap'
      ghost.textContent = `${ids.length} items`
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 12, 12)
      // Browsers snapshot the image synchronously, so we can clean up next tick.
      setTimeout(() => { ghost.remove() }, 0)
    }
  }

  function handleDragEnd() {
    setDraggedFileId(null)
    setDragOverFolderId(null)
  }

  function handleDragOver(e: React.DragEvent, folder: DriveFile) {
    if (!folder.is_folder) return
    if (draggedFileId === folder.id) return
    if (
      selectedIds.size > 1 &&
      selectedIds.has(draggedFileId ?? '') &&
      selectedIds.has(folder.id)
    ) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folder.id)
  }

  function handleDragLeave(e: React.DragEvent, folderId: string) {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    const currentTarget = e.currentTarget as HTMLElement
    if (relatedTarget && currentTarget.contains(relatedTarget)) return
    if (dragOverFolderId === folderId) setDragOverFolderId(null)
  }

  async function handleDrop(e: React.DragEvent, targetFolder: DriveFile) {
    e.preventDefault()
    setDragOverFolderId(null)
    setDraggedFileId(null)
    if (!targetFolder.is_folder || !onDropToFolder) return
    let fileIds: string[]
    try {
      fileIds = JSON.parse(e.dataTransfer.getData('text/plain')) as string[]
    } catch { return }
    fileIds = fileIds.filter((id) => id !== targetFolder.id)
    if (fileIds.length === 0) return
    await onDropToFolder(fileIds, targetFolder)
    clearSelection()
  }

  // ─── Sort ──────────────────────────────────────────
  // safeName(): like displayName() but returns '' while decryption is pending,
  // so sort comparators never receive null.
  function safeName(file: DriveFile): string {
    return displayName(file) ?? ''
  }

  function typeLabel(file: DriveFile): string {
    if (file.is_folder) return 'Folder'
    if (file.mime_type) return file.mime_type
    const ext = safeName(file).split('.').pop()?.trim()
    return ext ? ext.toUpperCase() : 'Encrypted file'
  }

  const sortedFiles = useMemo(() => {
    if (!sortable) return files
    return [...files].sort((a, b) => {
      // starred-first: starred items come before non-starred across the board
      if (sortKey === 'starred-first') {
        const starA = a.is_starred ? 0 : 1
        const starB = b.is_starred ? 0 : 1
        if (starA !== starB) return starA - starB
        // Within same star group: folders first, then name
        if (a.is_folder && !b.is_folder) return -1
        if (!a.is_folder && b.is_folder) return 1
        return safeName(a).localeCompare(safeName(b))
      }
      // type-asc: grouped by meaningful category (image, video, doc, …), no folder pinning override
      if (sortKey === 'type-asc') {
        const ra = typeGroupRank(a, safeName(a))
        const rb = typeGroupRank(b, safeName(b))
        if (ra !== rb) return ra - rb
        return safeName(a).localeCompare(safeName(b))
      }
      // All other sorts: folders always come first
      if (a.is_folder && !b.is_folder) return -1
      if (!a.is_folder && b.is_folder) return 1
      switch (sortKey) {
        case 'name-asc':      return safeName(a).localeCompare(safeName(b))
        case 'name-desc':     return safeName(b).localeCompare(safeName(a))
        case 'modified-desc': return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        case 'modified-asc':  return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        case 'size-desc':     return b.size_bytes - a.size_bytes
        case 'size-asc':      return a.size_bytes - b.size_bytes
      }
    })
  }, [files, sortable, sortKey, decryptedNames])

  const allSelected = sortedFiles.length > 0 && selectedIds.size === sortedFiles.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < sortedFiles.length

  // ─── Row click handler ─────────────────────────────
  function handleRowClick(file: DriveFile, e: React.MouseEvent) {
    if (e.shiftKey && lastClickedIdRef.current) {
      const ids = sortedFiles.map((f) => f.id)
      const lastIdx = ids.indexOf(lastClickedIdRef.current)
      const curIdx = ids.indexOf(file.id)
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx)
        const end = Math.max(lastIdx, curIdx)
        const next = new Set(selectedIds)
        for (const id of ids.slice(start, end + 1)) next.add(id)
        updateSelection(next)
        return
      }
    }
    if (e[modKey]) {
      toggleSelection(file.id)
      return
    }
    if (file.is_folder) {
      onNavigateFolder?.(file)
    } else if (isPreviewable(file.mime_type)) {
      onFileAction?.('preview', file)
    } else {
      onSelectFile?.(file)
    }
  }

  function handleCheckboxClick(fileId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (e.shiftKey && lastClickedIdRef.current) {
      const ids = sortedFiles.map((f) => f.id)
      const lastIdx = ids.indexOf(lastClickedIdRef.current)
      const curIdx = ids.indexOf(fileId)
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx)
        const end = Math.max(lastIdx, curIdx)
        const next = new Set(selectedIds)
        for (const id of ids.slice(start, end + 1)) next.add(id)
        updateSelection(next)
        lastClickedIdRef.current = fileId
        return
      }
    }
    toggleSelection(fileId)
  }

  // ─── Keyboard shortcuts: select all + escape ───────
  useEffect(() => {
    if (!selectable) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.target instanceof HTMLTextAreaElement) return
      if (e[modKey] && e.key === 'a') {
        e.preventDefault()
        updateSelection(new Set(sortedFiles.map((f) => f.id)))
      } else if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectable, sortedFiles, selectedIds, updateSelection, clearSelection])

  // ─── Date grouping ─────────────────────────────────
  const grouped: { label: string; files: DriveFile[] }[] | null = showDateGroups
    ? (() => {
        const order = ['Today', 'Yesterday', 'This week', 'Earlier']
        const groups: Record<string, DriveFile[]> = {}
        for (const file of sortedFiles) {
          const label = dateGroup(file.updated_at)
          if (!groups[label]) groups[label] = []
          groups[label].push(file)
        }
        return order
          .filter((label) => groups[label]?.length ?? 0 > 0)
          .map((label) => ({ label, files: groups[label] }))
      })()
    : null

  async function commitInlineRename(file: DriveFile) {
    const newName = inlineRenameValue.trim()
    setInlineRenameId(null)
    const currentName = displayName(file)
    if (!newName || newName === currentName) return
    if (!isUnlocked) {
      showToast({ icon: 'lock', title: 'Vault is locked', description: 'Unlock to rename files.', danger: true })
      return
    }
    try {
      const fileKey = await getFileKey(file.id)
      const enc = await encryptFilename(fileKey, newName)
      const nameEncrypted = serializeEncryptedBlob(enc.nonce, enc.ciphertext)
      await updateFile(file.id, { name_encrypted: nameEncrypted })
      onRefresh?.()
    } catch {
      showToast({ icon: 'x', title: 'Rename failed', description: 'Could not rename the file.', danger: true })
    }
  }

  // ─── Row renderer ──────────────────────────────────
  function renderRow(file: DriveFile) {
    // null = decryption still running for this file — show skeleton in name cell
    const name = displayName(file)
    const fileType = getFileType(name ?? '', file.is_folder)
    const isSelected = selectedIds.has(file.id)
    const isDragTarget = file.is_folder && dragOverFolderId === file.id
    const isDragging = draggedFileId === file.id
    const isTrashing = trashingIds.has(file.id)
    const isRecentUpload = recentlyUploadedIds.has(file.id)
    const hasThumbnail = !!(file.has_thumbnail && isUnlocked)
    const thumbUrl = thumbnails[file.id]

    return (
      <div
        key={file.id}
        draggable={!isTrashing}
        tabIndex={0}
        role="row"
        aria-label={
          file.is_folder
            ? `${name ?? 'Folder'}, folder`
            : `${name ?? 'Encrypted file'}, ${formatBytes(file.size_bytes)}, ${timeAgo(file.updated_at)}`
        }
        aria-selected={isSelected || undefined}
        onDragStart={(e) => handleDragStart(e, file)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, file)}
        onDragLeave={(e) => handleDragLeave(e, file.id)}
        onDrop={(e) => handleDrop(e, file)}
        className={[
          'file-row group transition-colors duration-150 cursor-pointer grid gap-2.5 md:gap-[14px]',
          'grid-cols-[20px_32px_1fr_40px] md:grid-cols-[20px_32px_1fr_110px_110px_100px_60px]',
          'px-3 md:px-5 py-[11px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber',
          isDragTarget
            ? 'file-row--drag-target bg-amber-bg ring-2 ring-amber ring-inset'
            : isSelected
              ? 'file-row--selected bg-amber-bg/50'
              : selectedFileId === file.id
                ? 'bg-amber-bg/30'
                : 'hover:bg-paper-2',
          isDragging ? 'opacity-40' : '',
          isTrashing ? 'trash-slide-out' : '',
          isRecentUpload ? 'upload-glow' : '',
        ].filter(Boolean).join(' ')}
        onClick={(e) => handleRowClick(file, e)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (file.is_folder) {
            onNavigateFolder?.(file)
            return
          }
          if (isPreviewable(file.mime_type)) {
            onFileAction?.('preview', file)
            return
          }
          showToast({
            icon: 'file',
            title: "This file type can't be previewed",
            description: 'Use Open to download it.',
          })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setCtxMenu({
            open: true,
            x: e.clientX,
            y: e.clientY,
            fileId: file.id,
            fileName: name ?? 'Encrypted file',
            isFolder: file.is_folder,
            versionNumber: file.version_number ?? 1,
            isStarred: file.is_starred ?? false,
            mimeType: file.mime_type ?? null,
          })
        }}
        onKeyDown={(e) => {
          // Enter: open folder or preview file
          if (e.key === 'Enter') {
            e.preventDefault()
            if (file.is_folder) onNavigateFolder?.(file)
            else onFileAction?.('open', file)
          }
          // Space: toggle selection
          else if (e.key === ' ') {
            e.preventDefault()
            toggleSelection(file.id)
          }
          // Context menu key or Shift+F10: open context menu at element position
          else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setCtxMenu({
              open: true,
              x: rect.left + 8,
              y: rect.bottom + 2,
              fileId: file.id,
              fileName: name ?? 'Encrypted file',
              isFolder: file.is_folder,
              versionNumber: file.version_number ?? 1,
              isStarred: file.is_starred ?? false,
              mimeType: file.mime_type ?? null,
            })
          }
          // Delete / Backspace: trash the focused file (single-file keyboard delete).
          // stopPropagation prevents the global useKeyboardShortcuts handler from
          // also firing onTrashSelected for the bulk-selection set.
          else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            e.stopPropagation()
            onFileAction?.('trash', file)
          }
          // Arrow keys: move focus to adjacent rows + scroll into view
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            const next = e.currentTarget.nextElementSibling as HTMLElement | null
            if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }) }
          }
          else if (e.key === 'ArrowUp') {
            e.preventDefault()
            const prev = e.currentTarget.previousElementSibling as HTMLElement | null
            if (prev) { prev.focus(); prev.scrollIntoView({ block: 'nearest' }) }
          }
        }}
      >
        {/* Checkbox — shows on hover (or always when selected); drag grip shows on hover when nothing is selected */}
        <span className="relative flex items-center justify-center">
          {/* Drag grip — shows behind the checkbox when hovering and no selection is active */}
          <span
            className={`absolute inset-0 flex items-center justify-center transition-opacity text-ink-4 cursor-grab active:cursor-grabbing pointer-events-none ${
              selectedIds.size === 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <circle cx="3" cy="2" r="1.2" />
              <circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="3" cy="12" r="1.2" />
              <circle cx="7" cy="12" r="1.2" />
            </svg>
          </span>
          {/* Checkbox — on top of the grip; visible when selected or when items are already selected */}
          <span
            className={`relative z-10 transition-opacity ${
              selectable && isSelected ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => selectable && handleCheckboxClick(file.id, e)}
          >
            {selectable && <BBCheckbox checked={isSelected} onChange={() => {}} />}
          </span>
        </span>

        {/* Icon or thumbnail */}
        {hasThumbnail ? (
          <div
            ref={(el) => setThumbRef(file.id, el as HTMLElement | null)}
            data-file-id={file.id}
            className="w-8 h-8 rounded-md overflow-hidden shrink-0 self-center"
          >
            {thumbUrl ? (
              <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-paper-3 flex items-center justify-center">
                <FileIcon type={fileType} />
              </div>
            )}
          </div>
        ) : (
          <div className="relative inline-flex shrink-0">
            <FileIcon type={fileType} />
            {file.is_folder && folderColors[file.id] && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: folderColors[file.id] as string,
                  boxShadow: '0 0 0 1.5px var(--color-paper)',
                }}
              />
            )}
          </div>
        )}

        {/* Name column */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {inlineRenameId === file.id ? (
              <input
                ref={inlineRenameInputRef}
                className="font-medium bg-transparent border border-amber-deep rounded px-1 outline-none min-w-0 flex-1"
                value={inlineRenameValue}
                onChange={(e) => setInlineRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void commitInlineRename(file) }
                  if (e.key === 'Escape') { e.preventDefault(); setInlineRenameId(null) }
                }}
                onBlur={() => { void commitInlineRename(file) }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : name !== null
              ? <span className="font-medium truncate">{name}</span>
              : <span
                  className="inline-block rounded bg-paper-3 animate-pulse shrink-0"
                  style={{ width: `${Math.max(60, (file.id.charCodeAt(0) % 80) + 60)}px`, height: '12px' }}
                  aria-label="Loading…"
                />
            }
            {/* Star toggle — filled when starred, outline when not */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleStar?.(file.id)
              }}
              aria-label={file.is_starred ? 'Unstar' : 'Star'}
              aria-pressed={!!file.is_starred}
              className={`inline-flex items-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber rounded ${
                file.is_starred
                  ? 'text-amber-deep'
                  : 'text-ink-4 opacity-0 group-hover:opacity-100 hover:text-amber-deep'
              }${starPulseId === file.id ? ' star-pulse' : ''}`}
            >
              <Icon name="star" size={11} />
            </button>

            {/* Pin badge — shown when folder is pinned to Quick access */}
            {file.is_folder && pinnedFolderIds.has(file.id) && (
              <span
                className="inline-flex items-center text-amber-deep"
                title="Pinned to Quick access"
                aria-label="Pinned to Quick access"
              >
                <Icon name="pin" size={10} />
              </span>
            )}

            {/* Folder viewer badge — compact presence dots for shared folders */}
            {file.is_folder && folderViewerCounts?.[file.id] && (folderViewerCounts[file.id].count > 0) && (
              <FolderViewerBadge
                count={folderViewerCounts[file.id].count}
                emails={folderViewerCounts[file.id].emails}
              />
            )}

            {/* Share badge — shown when file has active share links.
                Falls back to `myShares` when share_count is stale (e.g.
                immediately after creating a share, before the next refetch). */}
            {((file.share_count ?? 0) > 0 || sharedFileIds?.has(file.id)) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setSharePopover({ fileId: file.id, anchorRect: rect })
                }}
                aria-label={
                  (file.share_count ?? 0) > 0
                    ? `Manage ${file.share_count} active share${(file.share_count ?? 0) > 1 ? 's' : ''}`
                    : 'Manage active share'
                }
                title="Shared"
                className="inline-flex items-center gap-0.5 text-amber-deep hover:text-amber transition-colors cursor-pointer"
              >
                <Icon name="link" size={11} />
                {(file.share_count ?? 0) > 1 && (
                  <span className="font-mono text-[9px]">{file.share_count}</span>
                )}
              </button>
            )}
            {isUnlocked && (
              onShowTrustDetails && !file.is_folder ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onShowTrustDetails(file)
                  }}
                  aria-label="Encryption details"
                  className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-amber-deep hover:bg-amber-bg transition-colors cursor-pointer ${decryptPulseId === file.id ? 'decrypt-pulse' : ''}`}
                  title="View encryption details"
                >
                  <Icon name="lock" size={11} />
                </button>
              ) : (
                <span className={decryptPulseId === file.id ? 'decrypt-pulse inline-flex' : 'inline-flex'}>
                  <BBChip variant="amber">
                    <span className="flex items-center gap-1 text-[9.5px]">
                      <Icon name="lock" size={9} /> E2EE
                    </span>
                  </BBChip>
                </span>
              )
            )}
            {!file.is_folder && (file.version_number ?? 1) > 1 && (
              <span
                className="font-mono text-[9.5px] text-ink-3 bg-paper-3 border border-line rounded px-1 py-px tabular-nums"
                title={`Version ${file.version_number}`}
              >
                v{file.version_number}
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-1.5 flex-wrap">
            {!file.is_folder && name !== null ? (() => {
              const ext = name.split('.').pop()?.toLowerCase() ?? ''
              const badgeStyle = getBadgeStyle(fileType)
              return ext ? (
                <span
                  className="font-mono font-medium shrink-0 rounded px-[5px] py-px text-[10px] leading-tight"
                  style={{ color: badgeStyle.color, background: badgeStyle.background }}
                >
                  {ext.toUpperCase()}
                </span>
              ) : null
            })() : null}
            <span className="truncate">{typeLabel(file)}</span>
            {!file.is_folder && (
              <>
                <span className="md:hidden text-line-2">·</span>
                <span className="md:hidden font-mono tabular-nums">{formatBytes(file.size_bytes)}</span>
              </>
            )}
            <span className="md:hidden text-line-2">·</span>
            <span className="md:hidden">{timeAgo(file.updated_at)}</span>
          </div>
          {!file.is_folder && (
            <div className="font-mono text-[10.5px] text-ink-3 mt-0.5 truncate tabular-nums">
              AES-256-GCM · Europe · {encryptionCity}
            </div>
          )}
        </div>

        {/* Size */}
        <span className="hidden md:inline font-mono text-[13px] text-ink-3 tabular-nums self-center">
          {file.is_folder ? '--' : formatBytes(file.size_bytes)}
        </span>

        {/* Modified */}
        <span className="hidden md:inline text-[13px] text-ink-3 self-center">
          {timeAgo(file.updated_at)}
        </span>

        {/* Shared indicator */}
        <div className="hidden md:block self-center">
          {(file.share_count ?? 0) > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSharePopover({ fileId: file.id, anchorRect: rect })
              }}
              aria-label={`${file.share_count} active share link${(file.share_count ?? 0) > 1 ? 's' : ''}`}
              className="inline-flex items-center gap-1 text-[12px] text-amber-deep hover:text-amber transition-colors cursor-pointer font-medium"
            >
              <Icon name="link" size={12} />
              {(file.share_count ?? 0) > 1 && <span className="font-mono text-[11px]">{file.share_count}</span>}
            </button>
          ) : (
            <span className="text-[13px] text-ink-4">—</span>
          )}
        </div>

        {/* Row actions */}
        <div className="flex justify-end self-center">
          {renderActions ? (
            renderActions(file)
          ) : (
            <BBButton
              size="sm"
              variant="ghost"
              className="md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              aria-label="File actions"
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setCtxMenu({
                  open: true,
                  x: rect.left,
                  y: rect.bottom + 4,
                  fileId: file.id,
                  fileName: name ?? 'Encrypted file',
                  isFolder: file.is_folder,
                  versionNumber: file.version_number ?? 1,
                  isStarred: file.is_starred ?? false,
                  mimeType: file.mime_type ?? null,
                })
              }}
            >
              <Icon name="more" size={14} />
            </BBButton>
          )}
        </div>
      </div>
    )
  }

  const hasBulkBar = selectable && (onBulkTrash ?? onBulkMove ?? onBulkShare ?? onBulkDownload)

  return (
    <>
      {/* Sort button + column headers */}
      {sortable && (
        <>
          <div className="px-3 md:px-5 py-1.5 border-b border-line bg-paper-2 flex items-center justify-end relative">
            <button
              type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-ink-2 rounded hover:bg-paper hover:text-ink transition-colors"
              aria-label={`Sort: ${SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort'}`}
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
            >
              <span className="text-ink-3">Sort:</span>
              <span className="font-medium">{SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort'}</span>
              <Icon name="chevron-down" size={10} className="text-ink-3" />
            </button>
            {sortMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setSortMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-3 md:right-5 top-full mt-0.5 z-40 bg-paper border border-line-2 rounded-md shadow-2 py-1 min-w-[200px]"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      role="menuitemradio"
                      aria-checked={opt.key === sortKey}
                      onClick={() => { setSortKey(opt.key); setSortMenuOpen(false) }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-paper-2 transition-colors ${
                        opt.key === sortKey ? 'text-ink font-medium' : 'text-ink-2'
                      }`}
                    >
                      <span className="w-3 inline-flex">
                        {opt.key === sortKey && <Icon name="check" size={10} />}
                      </span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="px-3 md:px-5 py-2 border-b border-line bg-paper-2 grid gap-2.5 md:gap-[14px] grid-cols-[20px_32px_1fr_40px] md:grid-cols-[20px_32px_1fr_110px_110px_100px_60px]">
            <span className="flex items-center justify-center">
              {selectable && sortedFiles.length > 0 && (
                <BBCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => {
                    if (allSelected) clearSelection()
                    else updateSelection(new Set(sortedFiles.map((f) => f.id)))
                  }}
                />
              )}
            </span>
            <span />
            {/* Name header — toggles name-asc / name-desc */}
            <button
              type="button"
              onClick={() => setSortKey((k) => k === 'name-asc' ? 'name-desc' : 'name-asc')}
              className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-3 hover:text-ink transition-colors cursor-pointer select-none"
              aria-label="Sort by name"
            >
              Name
              <span className="text-[9px] leading-none">
                {sortKey === 'name-asc' ? '↑' : sortKey === 'name-desc' ? '↓' : <span className="opacity-30">↕</span>}
              </span>
            </button>
            {/* Size header — toggles size-desc / size-asc */}
            <button
              type="button"
              onClick={() => setSortKey((k) => k === 'size-desc' ? 'size-asc' : 'size-desc')}
              className="hidden md:flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-3 hover:text-ink transition-colors cursor-pointer select-none"
              aria-label="Sort by size"
            >
              Size
              <span className="text-[9px] leading-none">
                {sortKey === 'size-desc' ? '↓' : sortKey === 'size-asc' ? '↑' : <span className="opacity-30">↕</span>}
              </span>
            </button>
            {/* Modified header — toggles modified-desc / modified-asc */}
            <button
              type="button"
              onClick={() => setSortKey((k) => k === 'modified-desc' ? 'modified-asc' : 'modified-desc')}
              className="hidden md:flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-3 hover:text-ink transition-colors cursor-pointer select-none"
              aria-label="Sort by modified date"
            >
              Modified
              <span className="text-[9px] leading-none">
                {sortKey === 'modified-desc' ? '↓' : sortKey === 'modified-asc' ? '↑' : <span className="opacity-30">↕</span>}
              </span>
            </button>
            <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Shared</span>
            <span />
          </div>
        </>
      )}

      {/* File list body — role=rowgroup + aria-label lets screen readers announce the list */}
      <div
        role="rowgroup"
        aria-label="Files and folders"
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget && selectedIds.size > 0) clearSelection()
        }}
      >
        {/* Inline upload cards — rendered at top of scroll area (spec 024 §4) */}
        {uploadCards}
        {loading ? (
          <div aria-busy="true" aria-label="Loading files">{Array.from({ length: 8 }, (_, i) => <FileRowSkeleton key={i} />)}</div>
        ) : sortedFiles.length === 0 ? (
          emptyState
        ) : grouped ? (
          grouped.map(({ label, files: groupFiles }) => (
            <div key={label}>
              <div className="px-3 md:px-5 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wider bg-paper-2 border-b border-line sticky top-0 z-10">
                {label}
              </div>
              {groupFiles.map(renderRow)}
            </div>
          ))
        ) : (
          sortedFiles.map(renderRow)
        )}
      </div>

      {/* Bulk action bar */}
      {hasBulkBar && selectedIds.size > 0 && (
        <div className="px-3 md:px-5 py-2.5 border-t border-line bg-ink flex items-center gap-2 md:gap-3.5 animate-slide-in-up">
          <span className="text-sm font-medium text-paper">{selectedIds.size} selected</span>
          <button
            onClick={clearSelection}
            className="text-xs text-paper/60 hover:text-paper transition-colors cursor-pointer"
          >
            Clear
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {onBulkMove && (
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={() => onBulkMove(Array.from(selectedIds))}
              >
                <Icon name="folder" size={13} /> Move
              </BBButton>
            )}
            {onBulkTrash && (
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={async () => {
                  const ids = Array.from(selectedIds)
                  await onBulkTrash(ids)
                  clearSelection()
                }}
              >
                <Icon name="trash" size={13} /> Trash
              </BBButton>
            )}
            {onBulkShare && (
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={() => onBulkShare(Array.from(selectedIds))}
              >
                <Icon name="share" size={13} /> Share
              </BBButton>
            )}
            {onBulkDownload && (
              <BBButton
                size="sm"
                variant="amber"
                className="gap-1.5 min-w-[100px]"
                disabled={!!bulkZipProgress}
                onClick={async () => {
                  if (bulkZipProgress) return
                  const ids = Array.from(selectedIds)
                  await onBulkDownload(ids)
                }}
              >
                {bulkZipProgress ? (
                  <>
                    <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {bulkZipProgress.total > 0
                      ? `${bulkZipProgress.done}/${bulkZipProgress.total}`
                      : 'Zipping…'}
                  </>
                ) : (
                  <>
                    <Icon name="download" size={13} />
                    {selectedIds.size > 1 ? 'Download ZIP' : 'Download'}
                  </>
                )}
              </BBButton>
            )}
          </div>
        </div>
      )}

      {/* Context menu */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        fileId={ctxMenu.fileId}
        fileName={ctxMenu.fileName}
        isFolder={ctxMenu.isFolder}
        mimeType={ctxMenu.mimeType}
        isStarred={ctxMenu.isStarred}
        isPinned={pinnedFolderIds.has(ctxMenu.fileId)}
        hasVersions={!ctxMenu.isFolder}
        onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
        onAction={(action, fileId) => {
          if (action === 'pin' || action === 'unpin') {
            handleTogglePin(fileId)
            return
          }
          if (action === 'star' || action === 'unstar') {
            onToggleStar?.(fileId)
            return
          }
          const file = files.find((f) => f.id === fileId)
          if (file) onFileAction?.(action, file)
        }}
        onColorChange={handleFolderColorChange}
      />

      {/* Share popover — anchored to the badge that opened it */}
      {sharePopover && (
        <SharePopover
          fileId={sharePopover.fileId}
          anchorRect={sharePopover.anchorRect}
          onClose={() => setSharePopover(null)}
          onRevoked={() => {
            // Decrement share_count optimistically in the file list
            // (actual refetch happens on next navigation or pull-to-refresh)
          }}
        />
      )}
    </>
  )
}
