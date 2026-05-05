import { useState, useEffect, useCallback } from 'react'
import { BBButton } from './bb-button'
import { formatBytes } from '../lib/format'
import { Icon } from './icons'
import { useToast } from './toast'
import { useKeys } from '../lib/key-context'
import { decryptVersionToBlob } from '../lib/encrypted-download'
import {
  listVersions,
  restoreVersion,
  deleteVersion,
  type FileVersion,
} from '../lib/api'

interface VersionHistoryProps {
  open: boolean
  onClose: () => void
  fileId: string
  fileName: string
  /** Used to pick the right MIME for the decrypted version blob. */
  mimeType?: string
  onVersionRestored?: () => void
}


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function VersionHistory({
  open,
  onClose,
  fileId,
  fileName,
  mimeType,
  onVersionRestored,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [currentVersion, setCurrentVersion] = useState(1)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()
  const { getFileKey } = useKeys()

  const fetchVersions = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      const data = await listVersions(fileId)
      setVersions(data.versions)
      setCurrentVersion(data.current_version)
    } catch (err) {
      console.error('[VersionHistory] Failed to load versions:', err)
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    if (open) {
      setSelectedIdx(0)
      fetchVersions()
    }
  }, [open, fetchVersions])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  async function handleDownload(version: FileVersion) {
    try {
      const fileKey = await getFileKey(fileId)
      const plaintext = await decryptVersionToBlob(
        fileId,
        version.id,
        fileKey,
        mimeType ?? 'application/octet-stream',
        version.chunk_count,
        version.size_bytes,
      )
      const url = URL.createObjectURL(plaintext)
      const a = document.createElement('a')
      a.href = url
      // Inject the version suffix before the extension so the file still
      // opens correctly: "report.pdf" → "report_v3.pdf".
      const dot = fileName.lastIndexOf('.')
      const base = dot > 0 ? fileName.slice(0, dot) : fileName
      const ext = dot > 0 ? fileName.slice(dot) : ''
      a.download = `${base}_v${version.version_number}${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast({ icon: 'x', title: 'Download failed', danger: true })
    }
  }

  async function handleRestore(version: FileVersion) {
    if (!confirm(`Restore version ${version.version_number}? The current version will be saved as a previous version.`)) return
    try {
      await restoreVersion(fileId, version.id)
      showToast({ icon: 'check', title: `Restored to version ${version.version_number}` })
      fetchVersions()
      onVersionRestored?.()
    } catch {
      showToast({ icon: 'x', title: 'Restore failed', danger: true })
    }
  }

  async function handleDelete(version: FileVersion) {
    if (!confirm(`Delete version ${version.version_number}? This cannot be undone.`)) return
    try {
      await deleteVersion(fileId, version.id)
      showToast({ icon: 'check', title: `Version ${version.version_number} deleted` })
      fetchVersions()
    } catch {
      showToast({ icon: 'x', title: 'Delete failed', danger: true })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/20" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[540px] h-full bg-paper border-l border-line-2 shadow-3 overflow-hidden flex flex-col"
      >
        <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
          <Icon name="clock" size={14} className="text-amber-deep" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink">Version history</div>
            <div className="text-[11px] text-ink-3 mt-0.5 truncate">
              {fileName} — current v{currentVersion}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-md bg-paper-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-xl py-12 text-center text-sm text-ink-3">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="px-xl py-12 text-center">
              <div className="text-sm text-ink-3">No previous versions</div>
              <div className="text-[11px] text-ink-4 mt-1">
                Versions are created when you re-upload a file with the same name
              </div>
            </div>
          ) : (
            <div className="py-1 relative" role="listbox" aria-label="Version history" aria-orientation="vertical">
              <div
                className="absolute bg-line-2"
                style={{ left: 28, top: 14, bottom: 14, width: 1 }}
              />

              {versions.map((v, i) => {
                const isSelected = i === selectedIdx
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-label={`Version ${v.version_number}, ${timeAgo(v.created_at)}, ${formatBytes(v.size_bytes)}`}
                    className="w-full text-left relative cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-deep focus-visible:ring-inset"
                    style={{
                      padding: '12px 16px 12px 44px',
                      background: isSelected ? 'var(--color-paper-2)' : 'transparent',
                      borderLeft: isSelected
                        ? '3px solid var(--color-amber-deep)'
                        : '3px solid transparent',
                    }}
                    onClick={() => setSelectedIdx(i)}
                  >
                    <div
                      className="absolute rounded-full border-2"
                      style={{
                        left: 23,
                        top: 16,
                        width: 11,
                        height: 11,
                        background: isSelected ? 'var(--color-amber)' : 'var(--color-paper)',
                        borderColor: isSelected ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
                      }}
                    />

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-ink">
                        v{v.version_number}
                      </span>
                      <span className="text-[11px] text-ink-3">{timeAgo(v.created_at)}</span>
                      <span className="text-[11px] font-mono text-ink-4">{formatBytes(v.size_bytes)}</span>
                    </div>

                    <div className="text-[11px] text-ink-4 mt-0.5 font-mono">
                      {new Date(v.created_at).toLocaleString()}
                    </div>

                    {isSelected && (
                      <div className="flex gap-1.5 mt-2">
                        <BBButton size="sm" variant="ghost" onClick={() => handleDownload(v)}>
                          Download
                        </BBButton>
                        <BBButton size="sm" variant="amber" onClick={() => handleRestore(v)}>
                          Restore
                        </BBButton>
                        <BBButton size="sm" variant="danger" onClick={() => handleDelete(v)}>
                          Delete
                        </BBButton>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-xl py-sm border-t border-line bg-paper-2">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <Icon name="lock" size={10} className="text-amber" />
            Encrypted — versions stored with your file key
          </div>
        </div>
      </div>
    </div>
  )
}
