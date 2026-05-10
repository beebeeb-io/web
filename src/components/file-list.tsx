import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { BBCheckbox } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { FileIcon, getFileType } from './file-icon'
import { ContextMenu } from './context-menu'
import { FileRowSkeleton } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { decryptFilename, fromBase64 } from '../lib/crypto'
import { onDecrypted } from '../lib/decrypt-events'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { modKey } from '../hooks/use-keyboard-shortcuts'
import { formatBytes } from '../lib/format'
import { getPreference, setPreference } from '../lib/api'
import { SharePopover } from './share-popover'
import { useToast } from './toast'
import type { DriveFile, MyShare } from '../lib/api'

// ─── Sort types ─────────────────────────────────────

type SortKey =
  | 'name-asc' | 'name-desc'
  | 'modified-desc' | 'modified-asc'
  | 'size-desc' | 'size-asc'
  | 'type-asc'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name-asc',      label: 'Name (A → Z)' },
  { key: 'name-desc',     label: 'Name (Z → A)' },
  { key: 'modified-desc', label: 'Modified (newest)' },
  { key: 'modified-asc',  label: 'Modified (oldest)' },
  { key: 'size-desc',     label: 'Size (largest)' },
  { key: 'size-asc',      label: 'Size (smallest)' },
  { key: 'type-asc',      label: 'Type' },
]

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
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const raw = localStorage.getItem('bb_drive_sort')
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

  useEffect(() => {
    try {
      localStorage.setItem('bb_drive_sort', JSON.stringify({ key: sortKey }))
    } catch { /* ignore */ }
  }, [sortKey])

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
      const fileKey = await getFileKey(file.id)
      const outer = JSON.parse(file.name_encrypted) as { nonce: string; ciphertext: string }
      const plain = await decryptFilename(fileKey, fromBase64(outer.nonce), fromBase64(outer.ciphertext))
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
          // Capture a small ciphertext prefix so we can correlate which client
          // (iOS vs web) wrote the metadata when investigating "Encrypted file"
          // placeholders. Only logged on failure — never on success — so we do
          // not leak ciphertext into the console for healthy items.
          // eslint-disable-next-line no-console
          console.error('[file-list] decryption failed', {
            fileId: file.id,
            isFolder: file.is_folder,
            mimeType: file.mime_type,
            nameEncryptedPrefix: file.name_encrypted?.slice(0, 64),
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

  // ─── Pinned folders ────────────────────────────────
  const [pinnedFolderIds, setPinnedFolderIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    getPreference<{ folder_ids: string[] }>('pinned_folders')
      .then(pref => setPinnedFolderIds(new Set(pref?.folder_ids ?? [])))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function onPinChanged() {
      getPreference<{ folder_ids: string[] }>('pinned_folders')
        .then(pref => setPinnedFolderIds(new Set(pref?.folder_ids ?? [])))
        .catch(() => {})
    }
    window.addEventListener('beebeeb:pins-changed', onPinChanged)
    return () => window.removeEventListener('beebeeb:pins-changed', onPinChanged)
  }, [])

  const MAX_PINS = 10

  async function handleTogglePin(folderId: string) {
    const pref = await getPreference<{ folder_ids: string[] }>('pinned_folders').catch(() => null)
    const current = pref?.folder_ids ?? []
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

  // ─── Context menu ──────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; fileId: string; fileName: string; isFolder: boolean; versionNumber: number; isStarred: boolean
  }>({ open: false, x: 0, y: 0, fileId: '', fileName: '', isFolder: false, versionNumber: 1, isStarred: false })

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

  const sortedFiles = useMemo(() => (
    sortable
      ? [...files].sort((a, b) => {
          if (a.is_folder && !b.is_folder) return -1
          if (!a.is_folder && b.is_folder) return 1
          switch (sortKey) {
            case 'name-asc':      return safeName(a).localeCompare(safeName(b))
            case 'name-desc':     return safeName(b).localeCompare(safeName(a))
            case 'modified-desc': return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
            case 'modified-asc':  return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
            case 'size-desc':     return b.size_bytes - a.size_bytes
            case 'size-asc':      return a.size_bytes - b.size_bytes
            case 'type-asc': {
              const ta = (a.mime_type || safeName(a).split('.').pop() || '').toLowerCase()
              const tb = (b.mime_type || safeName(b).split('.').pop() || '').toLowerCase()
              if (ta !== tb) return ta.localeCompare(tb)
              return safeName(a).localeCompare(safeName(b))
            }
          }
        })
      : files
  ), [files, sortable, sortKey, decryptedNames])

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
        onDoubleClick={() => {
          if (!file.is_folder) onFileAction?.('open', file)
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
          })

        }}
        onKeyDown={(e) => {
          // Enter: open folder or preview file
          if (e.key === 'Enter') {
            e.preventDefault()
            if (file.is_folder) onNavigateFolder?.(file)
            else onSelectFile?.(file)
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
            })
          }
          // Arrow keys: move focus to adjacent rows
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            ;(e.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
          }
          else if (e.key === 'ArrowUp') {
            e.preventDefault()
            ;(e.currentTarget.previousElementSibling as HTMLElement | null)?.focus()
          }
        }}
      >
        {/* Checkbox */}
        <span
          className={`flex items-center justify-center ${
            selectable && isSelected ? '' : 'opacity-0 group-hover:opacity-100'
          } transition-opacity`}
          onClick={(e) => selectable && handleCheckboxClick(file.id, e)}
        >
          {selectable && <BBCheckbox checked={isSelected} onChange={() => {}} />}
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
          <FileIcon type={fileType} />
        )}

        {/* Name column */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {name !== null
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
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
            <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
            <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Modified</span>
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
          <div>{Array.from({ length: 8 }, (_, i) => <FileRowSkeleton key={i} />)}</div>
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
