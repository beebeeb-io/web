// The file version-history panel.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from './toast'
import { useKeys } from '../lib/key-context'
import { VersionHistoryView } from '@beebeeb/shared/drive-ui'
import { useDriveData } from '../lib/drive-data-context'
import { decryptVersionToBlob } from '../lib/encrypted-download'
import { UpgradeNudge } from './upgrade-nudge'
import { shouldShowVersionHistoryUpsell } from '../lib/version-history-copy'
import {
  getFile,
  listVersions,
  type DriveFile,
  type FileVersion,
  type VersionListItem,
} from '../lib/api'
import { ownerWriteRefusal, restoreOwnerVersion } from '../lib/owner-write-guard'
import { canDeleteVersion, versionContentBytes, versionDeleteCopy } from '../lib/version-delete-copy'
import { useVersionDelete, VersionDeleteConfirm } from './version-delete'

interface VersionHistoryProps {
  open: boolean
  onClose: () => void
  fileId: string
  fileName: string
  /** The file's current `name_encrypted`: every version is read with the pin it records (task 1943). */
  nameEncrypted: string
  /** Used to pick the right MIME for the decrypted version blob. */
  mimeType?: string
  /** The listed row, when the page has it: a restore runs the SF-0002 write check on it (fetched otherwise). */
  file?: DriveFile
  onVersionRestored?: () => void
}


export function VersionHistory({
  open,
  onClose,
  fileId,
  fileName,
  nameEncrypted,
  mimeType,
  file,
  onVersionRestored,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionListItem[]>([])
  const [currentVersion, setCurrentVersion] = useState(1)
  const [countsTowardQuota, setCountsTowardQuota] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()
  const { getFileKey, getMasterKey, getResidentUserId, isUnlocked } = useKeys()
  const navigate = useNavigate()
  const { planDetails } = useDriveData()
  const planSlug = planDetails.subscription?.plan
  const removeVersion = useCallback((versionId: string) => {
    setVersions((prev) => prev.filter((v) => v.id !== versionId))
    setSelectedIdx(0)
  }, [])
  const del = useVersionDelete(fileId, countsTowardQuota, removeVersion)

  const fetchVersions = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      const data = await listVersions(fileId)
      setVersions(data.versions)
      setCurrentVersion(data.current_version)
      setCountsTowardQuota(data.versions_count_toward_quota === true)
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

  if (!open) return null

  async function handleDownload(version: FileVersion) {
    try {
      const fileKey = await getFileKey(fileId)
      const plaintext = await decryptVersionToBlob(
        fileId,
        version.id,
        fileKey,
        nameEncrypted,
        mimeType ?? 'application/octet-stream',
        version.chunk_count,
        version.size_bytes,
        { masterKey: getMasterKey() },
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
      // SF-0002 round 2 (W4): the write-time read-only check (the row, and the
      // version being restored) runs first; nothing is POSTed when refused.
      await restoreOwnerVersion({
        file: file && file.id === fileId ? file : await getFile(fileId),
        version,
        masterKey: isUnlocked ? getMasterKey() : undefined,
        residentUserId: getResidentUserId(),
      })
      showToast({ icon: 'check', title: `Restored to version ${version.version_number}` })
      fetchVersions()
      onVersionRestored?.()
    } catch (err) {
      const refusal = ownerWriteRefusal(err)
      showToast({ icon: 'x', title: 'Restore failed', ...(refusal ? { description: refusal } : {}), danger: true })
    }
  }

  const items = versions.map((v) => ({
    id: v.id,
    versionNumber: v.version_number,
    createdAt: v.created_at,
    contentBytes: versionContentBytes(v),
    canDelete: canDeleteVersion(v, currentVersion),
  }))
  const byId = (id: string) => versions.find((v) => v.id === id)
  const pending = del.pendingId ? byId(del.pendingId) : undefined

  return (
    <VersionHistoryView
      open={open}
      onClose={onClose}
      fileName={fileName}
      currentVersion={currentVersion}
      versions={items}
      loading={loading}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      upsell={
        shouldShowVersionHistoryUpsell(planSlug) ? (
          <UpgradeNudge
            surface="version-history"
            targetPlan="basic"
            heading="Free keeps the current version only."
            body="Basic keeps 30 days of version history per file."
            onUpgrade={() => navigate('/pricing?plan=basic')}
          />
        ) : undefined
      }
      onDownload={(id) => { const v = byId(id); if (v) void handleDownload(v) }}
      onRestore={(id) => { const v = byId(id); if (v) void handleRestore(v) }}
      pendingDeleteId={del.pendingId}
      onRequestDelete={del.request}
      deleteConfirm={
        pending ? (
          <VersionDeleteConfirm
            copy={versionDeleteCopy({
              versionNumber: pending.version_number,
              contentBytes: versionContentBytes(pending),
              countsTowardQuota,
            })}
            busy={del.busy}
            onConfirm={() => void del.confirm(pending)}
            onCancel={del.cancel}
          />
        ) : undefined
      }
    />
  )
}
