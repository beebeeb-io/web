import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { listFiles, restoreFile, permanentDeleteFile, confirmAction, ApiError, type DriveFile } from '../lib/api'
import { useToast } from '../components/toast'
import { useKeys } from '../lib/key-context'
import { TrashRowSkeleton } from '../components/skeleton'
import { decryptFilename, fromBase64 } from '../lib/crypto'
import { useWsEvent } from '../lib/ws-context'
import { EmptyTrash } from '../components/empty-states/empty-trash'
import { ConfirmPasswordModal } from '../components/confirm-password-modal'
import { formatBytes } from '../lib/format'

// ─── Helpers ─────────────────────────────────────


function daysUntilShred(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime()
  const shredDate = deleted + 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  return Math.max(0, Math.ceil((shredDate - now) / (24 * 60 * 60 * 1000)))
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

function getIconForName(name: string, isFolder: boolean): IconName {
  if (isFolder) return 'folder'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg'].includes(ext)) return 'image'
  return 'file'
}

// ─── Confirmation dialog ────────────────────────

interface ConfirmDeleteDialogProps {
  open: boolean
  count: number
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDeleteDialog({ open, count, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-ink/20" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="trash" size={14} className="text-red" />
            <span className="text-sm font-semibold text-ink">Permanent deletion</span>
            <button
              onClick={onCancel}
              className="ml-auto text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div className="p-xl">
          <div className="flex items-start gap-2.5 px-3 py-2.5 mb-lg rounded-md border border-red-border bg-red-bg">
            <Icon name="shield" size={12} className="text-red mt-0.5 shrink-0" />
            <p className="text-[12px] text-ink-2 leading-relaxed">
              This will permanently delete {count} file{count !== 1 ? 's' : ''}. Your vault key{count !== 1 ? 's' : ''} for {count !== 1 ? 'these files' : 'this file'} will be destroyed. This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <BBButton size="md" onClick={onCancel}>Cancel</BBButton>
            <BBButton size="md" variant="danger" onClick={onConfirm}>
              Delete permanently
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Trash page ──────────────────────────────────

export function Trash() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { getFileKey, isUnlocked } = useKeys()
  const [files, setFiles] = useState<(DriveFile & { was_in: string })[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    fileIds: string[]
  }>({ open: false, fileIds: [] })
  const [pwPrompt, setPwPrompt] = useState<{ open: boolean; fileIds: string[] }>({
    open: false,
    fileIds: [],
  })
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(
    null,
  )

  // Fetch trashed files from API
  const fetchTrash = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listFiles(undefined, true)
      setFiles(data.map((f) => ({ ...f, was_in: '/' })))
    } catch (err) {
      console.error('[Trash] Failed to load trashed files:', err)
      showToast({ icon: 'x', title: 'Failed to load trash', danger: true })
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrash()
  }, [fetchTrash])

  // Real-time: refresh trash when files are trashed, restored, or permanently deleted
  useWsEvent(
    ['file.trashed', 'file.restored', 'file.deleted'],
    useCallback(() => {
      fetchTrash()
    }, [fetchTrash]),
  )

  // Decrypt file names when files or unlock state change
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
          // Decryption failed — never fall back to file.name_encrypted, which
          // is `{"nonce":"…","ciphertext":"…"}` JSON for ZK files and would
          // expose raw ciphertext to the user. The displayName() helper below
          // already substitutes "Encrypted file" when a name is missing.
          names[file.id] = 'Encrypted file'
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [files, isUnlocked, getFileKey])

  /** Get the display name for a file (decrypted if available, raw otherwise). */
  function displayName(file: DriveFile): string {
    return decryptedNames[file.id] ?? 'Encrypted file'
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRestore = async (id: string) => {
    setLoading(true)
    try {
      await restoreFile(id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      showToast({ icon: 'check', title: 'File restored', description: 'Moved back to your vault' })
    } catch (err) {
      showToast({ icon: 'x', title: 'Restore failed', description: err instanceof Error ? err.message : 'Could not restore file', danger: true })
    } finally {
      setLoading(false)
    }
  }

  /** Show confirmation before permanent delete of a single file. */
  const requestPermanentDelete = (id: string) => {
    setConfirmDialog({ open: true, fileIds: [id] })
  }

  /** Show confirmation before emptying trash (all files). */
  const requestEmptyTrash = () => {
    setConfirmDialog({ open: true, fileIds: files.map((f) => f.id) })
  }

  /** Show confirmation before permanent delete of selected files. */
  const requestDeleteSelected = () => {
    setConfirmDialog({ open: true, fileIds: Array.from(selected) })
  }

  /** Step 1 — confirm intent, then prompt for password to step up. */
  const executePermanentDelete = () => {
    const ids = confirmDialog.fileIds
    setConfirmDialog({ open: false, fileIds: [] })
    if (ids.length === 0) return
    setPwPrompt({ open: true, fileIds: ids })
  }

  /**
   * Step 2 — fire deletes sequentially, minting a fresh single-use confirmation
   * token for each file from the verified password. Confirmation tokens are
   * single-use server-side, so a parallel Promise.all with one token would
   * succeed only for the first request and 403 the rest.
   */
  const performPermanentDelete = async (initialToken: string, password: string) => {
    const ids = pwPrompt.fileIds
    setPwPrompt({ open: false, fileIds: [] })
    if (ids.length === 0) return

    setDeleteProgress({ current: 0, total: ids.length })
    setLoading(true)

    const succeededIds: string[] = []
    const failures: { id: string; message: string }[] = []
    let token: string | null = initialToken

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      setDeleteProgress({ current: i + 1, total: ids.length })

      try {
        if (token === null) {
          const fresh = await confirmAction(password)
          token = fresh.confirmation_token
        }
        await permanentDeleteFile(id, token)
        succeededIds.push(id)
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 403
            ? 'Re-authentication expired'
            : err instanceof Error
              ? err.message
              : 'Unknown error'
        failures.push({ id, message })
      } finally {
        token = null
      }
    }

    setDeleteProgress(null)

    const succeededSet = new Set(succeededIds)
    setFiles((prev) => prev.filter((f) => !succeededSet.has(f.id)))
    setSelected((prev) => {
      const next = new Set(prev)
      succeededSet.forEach((id) => next.delete(id))
      return next
    })

    if (failures.length === 0) {
      showToast({
        icon: 'trash',
        title: `Permanently deleted ${succeededIds.length} file${succeededIds.length !== 1 ? 's' : ''}`,
        description: 'Vault keys destroyed. Data is unrecoverable.',
      })
    } else {
      showToast({
        icon: 'x',
        title: `Deleted ${succeededIds.length} of ${ids.length}`,
        description: `${failures.length} file${failures.length !== 1 ? 's' : ''} could not be deleted: ${failures[0].message}`,
        danger: true,
      })
      fetchTrash()
    }

    setLoading(false)
  }

  const handleRestoreAll = async () => {
    setLoading(true)
    try {
      await Promise.all(files.map((f) => restoreFile(f.id)))
      setFiles([])
      setSelected(new Set())
      showToast({ icon: 'check', title: 'All files restored', description: 'Moved back to your vault' })
    } catch (err) {
      showToast({ icon: 'x', title: 'Restore all failed', description: err instanceof Error ? err.message : 'Some files could not be restored', danger: true })
      fetchTrash()
    } finally {
      setLoading(false)
    }
  }

  return (
    <DriveLayout>
        {/* Confirmation dialog */}
        <ConfirmDeleteDialog
          open={confirmDialog.open}
          count={confirmDialog.fileIds.length}
          onConfirm={executePermanentDelete}
          onCancel={() => setConfirmDialog({ open: false, fileIds: [] })}
        />

        {/* Step-up re-auth prompt */}
        <ConfirmPasswordModal
          open={pwPrompt.open}
          title="Confirm permanent delete"
          description="Re-enter your password to permanently delete. This cannot be undone."
          confirmLabel="Delete permanently"
          onConfirmed={performPermanentDelete}
          onCancel={() => setPwPrompt({ open: false, fileIds: [] })}
        />

        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-2.5">
          <Icon name="trash" size={14} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">Trash</div>
            <div className="text-[11px] text-ink-3">
              Items auto-shredded 30 days after deletion -- your vault key is destroyed last
            </div>
          </div>
          <div className="flex gap-2">
            <BBButton size="sm" onClick={handleRestoreAll} disabled={loading || files.length === 0}>
              Restore all
            </BBButton>
            <BBButton
              size="sm"
              variant="danger"
              onClick={requestEmptyTrash}
              disabled={loading || files.length === 0}
            >
              Empty trash
            </BBButton>
          </div>
        </div>

        {/* Table header */}
        <div
          className="px-5 py-2 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '24px 1.4fr 1fr 110px 110px 110px 100px',
            gap: 14,
          }}
        >
          <div />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Was in</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Deleted</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Shreds in</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span />
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div>{Array.from({ length: 6 }, (_, i) => <TrashRowSkeleton key={i} />)}</div>
          ) : files.length === 0 ? (
            <EmptyTrash onGoToDrive={() => navigate('/')} />
          ) : (
            files.map((file, i, arr) => {
              const days = daysUntilShred(file.updated_at)
              const urgent = days < 7
              const name = displayName(file)
              const iconName = getIconForName(name, file.is_folder)

              return (
                <div
                  key={file.id}
                  className="group hover:bg-paper-2 transition-colors"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1.4fr 1fr 110px 110px 110px 100px',
                    gap: 14,
                    padding: '10px 20px',
                    alignItems: 'center',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                  }}
                >
                  <BBCheckbox
                    checked={selected.has(file.id)}
                    onChange={() => toggleSelect(file.id)}
                  />
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      name={iconName}
                      size={14}
                      className={iconName === 'folder' ? 'text-amber-deep' : 'text-ink-3'}
                    />
                    <span className="text-[13px] text-ink-2 truncate">{name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-ink-3">{file.was_in}</span>
                  <span className="font-mono text-[11px] text-ink-3">{timeAgo(file.updated_at)}</span>
                  <span
                    className={`font-mono text-[11px] ${
                      urgent ? 'font-semibold text-red' : 'text-ink-3'
                    }`}
                  >
                    {days} day{days !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {file.is_folder ? '--' : formatBytes(file.size_bytes)}
                  </span>
                  <div className="flex gap-1.5 justify-end">
                    <button
                      onClick={() => handleRestore(file.id)}
                      disabled={loading}
                      className="text-amber-deep text-[11.5px] font-medium cursor-pointer hover:underline"
                    >
                      Restore
                    </button>
                    <span className="text-ink-4 text-[11px]">|</span>
                    <button
                      onClick={() => requestPermanentDelete(file.id)}
                      disabled={loading}
                      className="text-red text-[11.5px] font-medium cursor-pointer hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          {deleteProgress ? (
            <span className="font-mono text-red flex items-center gap-1.5">
              <Icon name="trash" size={12} className="text-red" />
              Deleting {deleteProgress.current} of {deleteProgress.total}…
            </span>
          ) : (
            <>
              <span className="font-mono">{files.length} item{files.length !== 1 ? 's' : ''} in trash</span>
              <span>--</span>
              <span className="flex items-center gap-1.5">
                <Icon name="shield" size={12} className="text-amber-deep" />
                Encrypted at rest -- AES-256-GCM
              </span>
            </>
          )}
          {selected.size > 0 && !deleteProgress && (
            <span className="ml-auto flex items-center gap-2">
              <span className="font-mono">{selected.size} selected</span>
              <BBButton
                size="sm"
                variant="danger"
                onClick={requestDeleteSelected}
                disabled={loading}
              >
                Delete permanently
              </BBButton>
            </span>
          )}
        </div>
    </DriveLayout>
  )
}
