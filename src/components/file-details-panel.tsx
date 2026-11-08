// Web wrapper for the shared details panel (moved to @beebeeb/shared/drive-ui, desktop v2 B01): the
// versions tab, the encrypted note and the thumbnail load stay here, on web's API and keys.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, BBButton } from '@beebeeb/shared'
import { FileDetailsPanel as SharedFileDetailsPanel, formatBytes, type FileDetailsMeta as BaseFileDetailsMeta, type FileDetailsPanelProps as BaseProps } from '@beebeeb/shared/drive-ui'
import { listVersions, type VersionListItem } from '../lib/api'
import { canDeleteVersion, versionContentBytes, versionDeleteCopy } from '../lib/version-delete-copy'
import { useVersionDelete, VersionDeleteConfirm } from './version-delete'
import { useKeys } from '../lib/key-context'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { openFileNote, writeFileNote, UNVERIFIED_NOTE_OWNER_COPY } from '../lib/file-note'
import { ownerWriteRefusal, type WriteTarget } from '../lib/owner-write-guard'
import { UnverifiedFileMetadataError } from '../lib/crypto'

export type { FileAccessEntry, FileActivityEntry } from '@beebeeb/shared/drive-ui'

export interface FileDetailsMeta extends BaseFileDetailsMeta {
  /** The file's (or folder's) current `name_encrypted`; the note writer reads its pin from it. */
  nameEncrypted: string
  noteEncrypted?: string | null
  /** The listed row: a note write runs the SF-0002 write-time read-only check on it. */
  writeTarget: WriteTarget
}

// ─── Versions tab (inline, inside the detail panel) ─────────────────────────

function timeAgoPanel(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function VersionsTab({
  fileId,
  onOpenFullHistory,
}: {
  fileId: string
  onOpenFullHistory?: () => void
}) {
  const [versions, setVersions] = useState<VersionListItem[]>([])
  const [currentVersion, setCurrentVersion] = useState(1)
  const [countsTowardQuota, setCountsTowardQuota] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const removeVersion = useCallback(
    (versionId: string) => setVersions((prev) => prev.filter((v) => v.id !== versionId)),
    [],
  )
  const del = useVersionDelete(fileId, countsTowardQuota, removeVersion)

  useEffect(() => {
    if (!fileId) return
    setLoading(true)
    setError(false)
    listVersions(fileId)
      .then((data) => {
        setVersions(data.versions)
        setCurrentVersion(data.current_version)
        setCountsTowardQuota(data.versions_count_toward_quota === true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [fileId])

  if (loading) {
    return (
      <div className="px-xl py-10 text-center text-[12px] text-ink-3">
        Loading versions...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Icon name="clock" size={20} className="text-ink-3" />
        <p className="text-[13px] text-ink-2 font-medium">Version history</p>
        <p className="text-[12px] text-ink-3">Coming in a future update</p>
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center px-xl">
        <Icon name="clock" size={20} className="text-ink-3" />
        <p className="text-[13px] text-ink-2 font-medium">No previous versions</p>
        <p className="text-[12px] text-ink-3">
          Versions are created when you re-upload a file with the same name.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Version list */}
      <div className="py-1 relative">
        {/* Timeline connector */}
        <div
          className="absolute bg-line-2"
          style={{ left: 36, top: 14, bottom: 14, width: 1 }}
        />

        {versions.map((v) => {
          const isCurrent = v.is_current ?? v.version_number === currentVersion
          const deletable = !isCurrent && canDeleteVersion(v, currentVersion)
          const contentBytes = versionContentBytes(v)
          return (
            <div
              key={v.id}
              data-testid={`version-row-${v.version_number}`}
              className="relative flex items-start gap-3 px-xl py-2.5"
            >
              {/* Timeline dot */}
              <div
                className="rounded-full border-2 shrink-0 z-[1]"
                style={{
                  width: 10,
                  height: 10,
                  marginTop: 4,
                  background: isCurrent ? 'var(--color-amber)' : 'var(--color-paper)',
                  borderColor: isCurrent ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
                }}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11.5px] font-semibold text-ink">
                    v{v.version_number}
                  </span>
                  {isCurrent && (
                    <span className="px-1.5 py-px rounded text-[9.5px] font-semibold bg-amber/20 text-amber-deep">
                      Current
                    </span>
                  )}
                  <span className="text-[10.5px] text-ink-3 font-mono ml-auto">
                    {formatBytes(contentBytes)}
                  </span>
                </div>
                <div className="text-[10.5px] text-ink-4 mt-0.5 flex items-center gap-1">
                  <span>
                    {timeAgoPanel(v.created_at)}
                    {' · '}
                    {new Date(v.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  {deletable && del.pendingId !== v.id && (
                    <button
                      type="button"
                      onClick={() => del.request(v.id)}
                      aria-label={`Delete version ${v.version_number}`}
                      className="ml-auto text-[10.5px] text-red hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-deep rounded-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
                {deletable && del.pendingId === v.id && (
                  <VersionDeleteConfirm
                    copy={versionDeleteCopy({
                      versionNumber: v.version_number,
                      contentBytes,
                      countsTowardQuota,
                    })}
                    busy={del.busy}
                    onConfirm={() => void del.confirm(v)}
                    onCancel={del.cancel}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Link to full version history overlay */}
      {onOpenFullHistory && (
        <div className="px-xl pb-lg pt-1 border-t border-line mt-1">
          <BBButton
            size="sm"
            variant="ghost"
            className="w-full justify-center gap-1.5"
            onClick={onOpenFullHistory}
          >
            <Icon name="clock" size={11} /> Full version history
          </BBButton>
        </div>
      )}
    </div>
  )
}

// ─── Encrypted note section (server-synced, E2EE) ────────────────────────────

function EncryptedNoteSection({
  fileId,
  nameEncrypted,
  noteEncrypted,
  writeTarget,
  getFileKey,
  onNoteUpdated,
}: {
  fileId: string
  /** The file's current `name_encrypted`: its pin decides how the note is sealed (task 1943). */
  nameEncrypted: string
  noteEncrypted: string | null | undefined
  /** The row the note belongs to, for the write-time read-only check (SF-0002). */
  writeTarget: WriteTarget
  getFileKey: (id: string) => Promise<Uint8Array>
  onNoteUpdated?: (fileId: string, noteEncrypted: string | null) => void
}) {
  const { getMasterKey, getResidentUserId, isUnlocked } = useKeys()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [refused, setRefused] = useState(false)
  // SF-0002: the honest copy when the row is read-only or could not be checked.
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Decrypt the note on mount / when the file changes
  useEffect(() => {
    setText('')
    setSaved(false)
    setRefused(false)
    setWriteRefusal(null)
    if (!noteEncrypted) return
    let cancelled = false
    getFileKey(fileId)
      .then(async (fileKey) => {
        try {
          // Core's note reader: the note subkey, then the legacy raw key, so
          // notes stored before task 1943 keep opening.
          const plain = await openFileNote(fileKey, noteEncrypted)
          if (!cancelled) setText(plain)
        } catch {
          // Decryption failed — leave blank
        }
      })
      .catch(() => { /* key not available */ })
    return () => { cancelled = true }
  }, [fileId, noteEncrypted, getFileKey])

  // Clean up saved timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const handleBlur = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setRefused(false)
    setWriteRefusal(null)
    try {
      // SF-0002 round 2 (W4): the write-time read-only check runs before the
      // note is sealed or cleared (lib/file-note.ts writeFileNote).
      const stored = await writeFileNote({
        target: writeTarget,
        text,
        owner: { nameEncrypted },
        masterKey: isUnlocked ? getMasterKey() : undefined,
        residentUserId: getResidentUserId(),
        getFileKey,
      })
      onNoteUpdated?.(fileId, stored)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      // A refused owner is permanent: say so. A read-only or unchecked row
      // says so too. Anything else (network) fails silently and the user can
      // retry by blurring again.
      if (err instanceof UnverifiedFileMetadataError) setRefused(true)
      else setWriteRefusal(ownerWriteRefusal(err))
    } finally {
      setSaving(false)
    }
  }, [fileId, nameEncrypted, text, saving, writeTarget, isUnlocked, getMasterKey, getResidentUserId, getFileKey, onNoteUpdated])

  return (
    <div className="px-xl pt-lg pb-lg border-b border-line">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
        Note
      </div>
      <div className="relative">
        <textarea
          rows={3}
          value={text}
          maxLength={254}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { void handleBlur() }}
          placeholder="Add a note..."
          className="w-full resize-none rounded-md border border-line bg-paper-2 px-2.5 py-2 font-sans text-[11.5px] text-ink placeholder:text-ink-4 outline-none focus:border-amber focus:ring-2 focus:ring-amber/20 transition-colors"
          style={{ lineHeight: 1.5 }}
        />
        {/* Saved confirmation */}
        <span
          className="absolute bottom-2 right-2 text-[10px] text-ink-4 font-mono transition-opacity duration-300"
          style={{ opacity: saved ? 1 : 0 }}
        >
          Saved
        </span>
      </div>
      <div className="mt-1.5 text-[10px] text-ink-4 flex items-center gap-1">
        <Icon name="lock" size={9} />
        {saving ? 'Saving...' : 'Encrypted · synced across devices'}
      </div>
      {refused && (
        <div role="alert" className="mt-1.5 text-[10px] text-red">
          {UNVERIFIED_NOTE_OWNER_COPY}
        </div>
      )}
      {writeRefusal && (
        <div role="alert" className="mt-1.5 text-[10px] text-red" data-testid="note-write-refused">
          {writeRefusal}
        </div>
      )}
    </div>
  )
}

type WebProps = Omit<BaseProps<FileDetailsMeta>, 'renderVersions' | 'renderNote' | 'loadThumbnail' | 'canLoadThumbnail'> & {
  onNoteUpdated?: (fileId: string, noteEncrypted: string | null) => void
}

export function FileDetailsPanel({ onNoteUpdated, ...props }: WebProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const loadThumbnail = useCallback(
    async (fileId: string) => fetchAndDecryptThumbnail(fileId, await getFileKey(fileId)),
    [getFileKey],
  )
  return (
    <SharedFileDetailsPanel<FileDetailsMeta>
      {...props}
      canLoadThumbnail={isUnlocked}
      loadThumbnail={loadThumbnail}
      renderVersions={(fileId, onOpenFullHistory) => <VersionsTab fileId={fileId} onOpenFullHistory={onOpenFullHistory} />}
      renderNote={(file) => (
        <EncryptedNoteSection
          fileId={file.id}
          nameEncrypted={file.nameEncrypted}
          noteEncrypted={file.noteEncrypted}
          writeTarget={file.writeTarget}
          getFileKey={getFileKey}
          onNoteUpdated={onNoteUpdated}
        />
      )}
    />
  )
}
