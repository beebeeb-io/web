import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileIcon, getFileType } from '../components/file-icon'
import { ContextMenu } from '../components/context-menu'
import { ShareDialog } from '../components/share-dialog'
import { MoveModal } from '../components/move-modal'
import { RenameDialog } from '../components/rename-dialog'
import { useToast } from '../components/toast'
import { useKeys } from '../lib/key-context'
import { decryptFilename, encryptFilename, fromBase64, toBase64 } from '../lib/crypto'
import { encryptedDownload } from '../lib/encrypted-download'
import {
  listFiles,
  toggleStar,
  updateFile,
  deleteFile,
  type DriveFile,
} from '../lib/api'
import { useWsEvent } from '../lib/ws-context'
import { EmptyStarred } from '../components/empty-states/empty-starred'
import { formatBytes } from '../lib/format'

// ─── Helpers ───────────────────────────────────────


function timeAgo(dateStr: string): string {
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

// ─── Starred page ──────────────────────────────────

export function Starred() {
  const { getFileKey, isUnlocked, cryptoReady } = useKeys()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Overlays
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; fileId: string; fileName: string; isFolder: boolean
  }>({ open: false, x: 0, y: 0, fileId: '', fileName: '', isFolder: false })

  // ─── Fetch starred files from server ──────────────

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listFiles(undefined, false, { starred: true })
      setFiles(data)
    } catch (err) {
      console.error('[Starred] Failed to load starred files:', err)
      showToast({ icon: 'x', title: 'Failed to load starred files', danger: true })
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Real-time: refresh when star state changes or files are trashed/deleted
  useWsEvent(
    ['file.starred', 'file.trashed', 'file.deleted'],
    useCallback(() => {
      fetchFiles()
    }, [fetchFiles]),
  )

  // ─── Decrypt filenames ─────────────────────────────

  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedNames({})
      return
    }
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      for (const file of files) {
        if (cancelled) return
        try {
          const parsed = JSON.parse(file.name_encrypted) as {
            nonce: string
            ciphertext: string
          }
          const fileKey = await getFileKey(file.id)
          names[file.id] = await decryptFilename(
            fileKey,
            fromBase64(parsed.nonce),
            fromBase64(parsed.ciphertext),
          )
        } catch {
          names[file.id] = file.name_encrypted
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [files, isUnlocked, getFileKey])

  function displayName(file: DriveFile): string {
    return decryptedNames[file.id] ?? file.name_encrypted
  }

  // ─── Sort: folders first, then alphabetical ────────

  const sortedFiles = [...files].sort((a, b) => {
    if (a.is_folder && !b.is_folder) return -1
    if (!a.is_folder && b.is_folder) return 1
    return displayName(a).localeCompare(displayName(b))
  })

  // ─── Actions ──────────────────────────────────────

  async function handleToggleStar(fileId: string) {
    try {
      const result = await toggleStar(fileId)
      if (!result.is_starred) {
        // Unstarred -- remove from list
        setFiles((prev) => prev.filter((f) => f.id !== fileId))
      } else {
        setFiles((prev) =>
          prev.map((f) => (f.id === fileId ? { ...f, is_starred: result.is_starred } : f)),
        )
      }
    } catch (err) {
      showToast({
        icon: 'star',
        title: 'Failed to update star',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
    }
  }

  async function handleFileDownload(file: DriveFile) {
    if (!isUnlocked || !cryptoReady || file.is_folder) return
    try {
      const fileKey = await getFileKey(file.id)
      await encryptedDownload(
        file.id,
        fileKey,
        file.name_encrypted,
        file.mime_type,
        file.chunk_count,
        file.size_bytes,
      )
    } catch (err) {
      showToast({
        icon: 'download',
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'Could not decrypt the file.',
        danger: true,
      })
    }
  }

  async function handleMoveConfirm(destinationId: string | null, _mode: 'move' | 'copy') {
    if (!moveFileId) return
    try {
      await updateFile(moveFileId, { parent_id: destinationId ?? undefined })
      showToast({ icon: 'folder', title: 'File moved', description: 'Moved successfully.' })
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Move failed',
        description: err instanceof Error ? err.message : 'Could not move file.',
        danger: true,
      })
    } finally {
      setMoveFileId(null)
    }
  }

  async function handleRenameConfirm(newName: string) {
    if (!renameFileId || !isUnlocked || !cryptoReady) return
    try {
      const fileKey = await getFileKey(renameFileId)
      const enc = await encryptFilename(fileKey, newName)
      const nameEncrypted = JSON.stringify({
        nonce: toBase64(enc.nonce),
        ciphertext: toBase64(enc.ciphertext),
      })
      await updateFile(renameFileId, { name_encrypted: nameEncrypted })
      showToast({ icon: 'check', title: 'Renamed', description: `Renamed to "${newName}".` })
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Rename failed',
        description: err instanceof Error ? err.message : 'Could not rename file.',
        danger: true,
      })
    } finally {
      setRenameFileId(null)
    }
  }

  async function handleContextAction(action: string, fileId: string) {
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    switch (action) {
      case 'open':
        if (file.is_folder) {
          navigate('/')
        }
        break
      case 'share':
        setShareFileId(fileId)
        break
      case 'move':
        setMoveFileId(fileId)
        break
      case 'rename':
        if (!isUnlocked || !cryptoReady) {
          showToast({
            icon: 'lock',
            title: 'Vault is locked',
            description: 'Unlock the vault before renaming files.',
            danger: true,
          })
          return
        }
        setRenameFileId(fileId)
        break
      case 'star':
        handleToggleStar(fileId)
        break
      case 'download':
        handleFileDownload(file)
        break
      case 'trash':
        try {
          await deleteFile(fileId)
          showToast({ icon: 'trash', title: 'Moved to trash', description: displayName(file) })
          setFiles((prev) => prev.filter((f) => f.id !== fileId))
        } catch (err) {
          showToast({
            icon: 'trash',
            title: 'Failed to trash',
            description: err instanceof Error ? err.message : 'Something went wrong',
            danger: true,
          })
        }
        break
    }
  }

  // ─── Selection ─────────────────────────────────────

  function toggleSelection(fileId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  const allSelected = sortedFiles.length > 0 && selectedIds.size === sortedFiles.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < sortedFiles.length

  // ─── Bulk actions ──────────────────────────────────

  async function handleBulkUnstar() {
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map((id) => toggleStar(id)))
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      clearSelection()
      showToast({
        icon: 'star',
        title: 'Unstarred',
        description: `${ids.length} file${ids.length !== 1 ? 's' : ''} removed from starred`,
      })
    } catch (err) {
      showToast({
        icon: 'star',
        title: 'Failed to unstar',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
    }
  }

  async function handleBulkTrash() {
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map((id) => deleteFile(id)))
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      clearSelection()
      showToast({
        icon: 'trash',
        title: 'Moved to trash',
        description: `${ids.length} file${ids.length !== 1 ? 's' : ''} moved to trash`,
      })
    } catch (err) {
      showToast({
        icon: 'trash',
        title: 'Failed to trash',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
    }
  }

  async function handleBulkDownload() {
    const filesToDownload = sortedFiles.filter(
      (f) => selectedIds.has(f.id) && !f.is_folder,
    )
    if (filesToDownload.length === 0) {
      showToast({
        icon: 'download',
        title: 'Nothing to download',
        description: 'Select at least one file (not folder) to download.',
      })
      return
    }
    for (const file of filesToDownload) {
      await handleFileDownload(file)
    }
  }

  // ─── Derived data ──────────────────────────────────

  const moveFile = files.find((f) => f.id === moveFileId) ?? null
  const renameFile = files.find((f) => f.id === renameFileId) ?? null
  const shareFile = files.find((f) => f.id === shareFileId) ?? null

  return (
    <DriveLayout>
      {/* Header */}
      <div className="px-5 py-2.5 border-b border-line flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold text-ink">Starred</span>
        </div>
        <form
          className="ml-auto flex items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1.5 w-[260px]"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.querySelector('input')
            if (input?.value.trim()) navigate(`/search?q=${encodeURIComponent(input.value.trim())}`)
          }}
        >
          <Icon name="search" size={13} className="text-ink-4 shrink-0" />
          <input
            placeholder="Search files and folders..."
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-ink-4 bg-paper-2 border border-line rounded">
            <span>&#8984;</span>K
          </kbd>
        </form>
      </div>

      {/* Column header */}
      <div
        className="px-5 py-2 border-b border-line bg-paper-2"
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 32px 1fr 110px 110px 60px',
          gap: 14,
        }}
      >
        <span className="flex items-center justify-center">
          {sortedFiles.length > 0 && (
            <BBCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={() => {
                if (allSelected) clearSelection()
                else setSelectedIds(new Set(sortedFiles.map((f) => f.id)))
              }}
            />
          )}
        </span>
        <span />
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Modified</span>
        <span />
      </div>

      {/* File list */}
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget && selectedIds.size > 0) clearSelection()
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : sortedFiles.length === 0 ? (
          <EmptyStarred onGoToDrive={() => navigate('/')} />
        ) : (
          sortedFiles.map((file) => {
            const name = displayName(file)
            const fileType = getFileType(name, file.is_folder)
            const isSelected = selectedIds.has(file.id)
            return (
              <div
                key={file.id}
                className={`group transition-colors cursor-pointer ${
                  isSelected ? 'bg-amber-bg/50' : 'hover:bg-paper-2'
                }`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 32px 1fr 110px 110px 60px',
                  gap: 14,
                  padding: '11px 20px',
                }}
                onClick={() => {
                  if (file.is_folder) {
                    navigate('/')
                  }
                }}
                onDoubleClick={() => {
                  if (!file.is_folder) handleFileDownload(file)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({
                    open: true,
                    x: e.clientX,
                    y: e.clientY,
                    fileId: file.id,
                    fileName: name,
                    isFolder: file.is_folder,
                  })
                }}
              >
                <span
                  className={`flex items-center justify-center ${
                    isSelected ? '' : 'opacity-0 group-hover:opacity-100'
                  } transition-opacity`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSelection(file.id)
                  }}
                >
                  <BBCheckbox
                    checked={isSelected}
                    onChange={() => {/* handled by parent click */}}
                  />
                </span>
                <FileIcon type={fileType} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate">{name}</span>
                    {isUnlocked && (
                      <BBChip variant="amber">
                        <span className="flex items-center gap-1 text-[9.5px]">
                          <Icon name="lock" size={9} /> E2EE
                        </span>
                      </BBChip>
                    )}
                    <Icon name="star" size={11} className="text-amber-deep shrink-0" />
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5">{file.mime_type || 'Folder'}</div>
                </div>
                <span className="font-mono text-[13px] text-ink-3 tabular-nums self-center">
                  {file.is_folder ? '--' : formatBytes(file.size_bytes)}
                </span>
                <span className="text-[13px] text-ink-3 self-center">
                  {timeAgo(file.updated_at)}
                </span>
                <div className="flex justify-end self-center">
                  <BBButton
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setCtxMenu({
                        open: true,
                        x: rect.left,
                        y: rect.bottom + 4,
                        fileId: file.id,
                        fileName: name,
                        isFolder: file.is_folder,
                      })
                    }}
                  >
                    <Icon name="more" size={14} />
                  </BBButton>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="px-5 py-2.5 border-t border-line bg-ink flex items-center gap-3.5 animate-slide-in-up">
          <span className="text-sm font-medium text-paper">
            {selectedIds.size} selected
          </span>
          <button
            onClick={clearSelection}
            className="text-xs text-paper/60 hover:text-paper transition-colors cursor-pointer"
          >
            Clear
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <BBButton
              size="sm"
              variant="ghost"
              className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
              onClick={handleBulkUnstar}
            >
              <Icon name="star" size={13} /> Unstar
            </BBButton>
            <BBButton
              size="sm"
              variant="ghost"
              className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
              onClick={handleBulkTrash}
            >
              <Icon name="trash" size={13} /> Trash
            </BBButton>
            <BBButton
              size="sm"
              variant="amber"
              className="gap-1.5"
              onClick={handleBulkDownload}
            >
              <Icon name="download" size={13} /> Download
            </BBButton>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
        <span className="font-mono">{files.length} starred item{files.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          <Icon name="shield" size={12} className={isUnlocked ? 'text-amber-deep' : 'text-ink-4'} />
          {isUnlocked ? 'All encrypted · AES-256-GCM' : 'Vault locked'}
        </span>
      </div>

      {/* ─── Overlays ────────────────────────── */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        fileId={ctxMenu.fileId}
        fileName={ctxMenu.fileName}
        isFolder={ctxMenu.isFolder}
        onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
        onAction={handleContextAction}
      />

      {shareFile && (
        <ShareDialog
          open={shareFileId !== null}
          onClose={() => setShareFileId(null)}
          fileId={shareFile.id}
          fileName={displayName(shareFile)}
          fileSize={shareFile.size_bytes}
          isFolder={shareFile.is_folder}
        />
      )}

      {moveFile && (
        <MoveModal
          open={moveFileId !== null}
          onClose={() => setMoveFileId(null)}
          items={[{
            id: moveFile.id,
            name: displayName(moveFile),
            isFolder: moveFile.is_folder,
          }]}
          mode="move"
          onConfirm={handleMoveConfirm}
        />
      )}

      <RenameDialog
        open={renameFileId !== null}
        onClose={() => setRenameFileId(null)}
        currentName={renameFile ? displayName(renameFile) : ''}
        onRename={handleRenameConfirm}
      />
    </DriveLayout>
  )
}
