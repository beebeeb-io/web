import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { FileList } from '../components/file-list'
import { FileDetailsPanel, type FileDetailsMeta } from '../components/file-details-panel'
import { FilePreview } from '../components/preview/file-preview'
import { ShareDialog } from '../components/share-dialog'
import { MoveModal } from '../components/move-modal'
import { RenameDialog } from '../components/rename-dialog'
import { useFilePreview } from '../hooks/use-file-preview'
import { useToast } from '../components/toast'
import { useKeys } from '../lib/key-context'
import { encryptFilename, serializeEncryptedBlob } from '../lib/crypto'
import { encryptedDownload } from '../lib/encrypted-download'
import {
  listFiles,
  toggleStar,
  updateFile,
  deleteFile,
  type DriveFile,
} from '../lib/api'
import { useWsEvent } from '../lib/ws-context'
import { EmptyRecent } from '../components/empty-states/empty-recent'

export function Recent() {
  const { getFileKey, isUnlocked, cryptoReady } = useKeys()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { previewFile, openPreview, closePreview } = useFilePreview()

  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string | null>>({})
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // Dialog state
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listFiles(undefined, false, { recent: true })
      setFiles(data)
    } catch (err) {
      console.error('[Recent] Failed to load recent files:', err)
      showToast({ icon: 'x', title: 'Failed to load recent files', danger: true })
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  useWsEvent(
    ['file.created', 'file.uploaded', 'file.deleted', 'file.trashed', 'file.renamed', 'file.moved', 'version.restored'],
    useCallback(() => { fetchFiles() }, [fetchFiles]),
  )

  function displayName(file: DriveFile): string {
    return decryptedNames[file.id] ?? file.name_encrypted
  }

  async function handleFileDownload(file: DriveFile) {
    if (!isUnlocked || !cryptoReady || file.is_folder) return
    try {
      const fileKey = await getFileKey(file.id)
      await encryptedDownload(file.id, fileKey, file.name_encrypted, file.mime_type ?? undefined, file.chunk_count, file.size_bytes)
    } catch (err) {
      showToast({ icon: 'download', title: 'Download failed', description: err instanceof Error ? err.message : 'Could not decrypt the file.', danger: true })
    }
  }

  async function handleMoveConfirm(destinationId: string | null) {
    if (!moveFileId) return
    try {
      await updateFile(moveFileId, { parent_id: destinationId })
      showToast({ icon: 'folder', title: 'File moved', description: 'Moved successfully.' })
      fetchFiles()
    } catch (err) {
      showToast({ icon: 'x', title: 'Move failed', description: err instanceof Error ? err.message : 'Could not move file.', danger: true })
    } finally {
      setMoveFileId(null)
    }
  }

  async function handleRenameConfirm(newName: string) {
    if (!renameFileId || !isUnlocked || !cryptoReady) return
    try {
      const fileKey = await getFileKey(renameFileId)
      const enc = await encryptFilename(fileKey, newName)
      await updateFile(renameFileId, { name_encrypted: serializeEncryptedBlob(enc.nonce, enc.ciphertext) })
      showToast({ icon: 'check', title: 'Renamed', description: `Renamed to "${newName}".` })
      fetchFiles()
    } catch (err) {
      showToast({ icon: 'x', title: 'Rename failed', description: err instanceof Error ? err.message : 'Could not rename file.', danger: true })
    } finally {
      setRenameFileId(null)
    }
  }

  async function handleFileAction(action: string, file: DriveFile) {
    switch (action) {
      case 'open':
        if (file.is_folder) navigate('/')
        else openPreview(file)
        break
      case 'preview':
        if (!file.is_folder) openPreview(file)
        break
      case 'share':
        setShareFileId(file.id)
        break
      case 'move':
        setMoveFileId(file.id)
        break
      case 'rename':
        if (!isUnlocked || !cryptoReady) {
          showToast({ icon: 'lock', title: 'Vault is locked', description: 'Unlock the vault before renaming files.', danger: true })
          return
        }
        setRenameFileId(file.id)
        break
      case 'star':
        try {
          const result = await toggleStar(file.id)
          setFiles((prev) => prev.map((f) => f.id === file.id ? { ...f, is_starred: result.is_starred } : f))
        } catch (err) {
          showToast({ icon: 'star', title: 'Failed to update star', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
        }
        break
      case 'download':
        await handleFileDownload(file)
        break
      case 'trash':
        try {
          await deleteFile(file.id)
          showToast({ icon: 'trash', title: 'Moved to trash', description: displayName(file) })
          setFiles((prev) => prev.filter((f) => f.id !== file.id))
        } catch (err) {
          showToast({ icon: 'trash', title: 'Failed to trash', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
        }
        break
    }
  }

  async function handleBulkTrash(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => deleteFile(id)))
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      showToast({ icon: 'trash', title: 'Moved to trash', description: `${ids.length} file${ids.length !== 1 ? 's' : ''} moved to trash` })
    } catch (err) {
      showToast({ icon: 'trash', title: 'Failed to trash', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
    }
  }

  async function handleBulkDownload(ids: string[]) {
    const filesToDownload = files.filter((f) => ids.includes(f.id) && !f.is_folder)
    for (const file of filesToDownload) {
      await handleFileDownload(file)
    }
  }

  function buildDetailsMeta(file: DriveFile): FileDetailsMeta {
    const name = displayName(file)
    const ext = name.includes('.') ? name.split('.').pop() ?? '' : ''
    return {
      id: file.id,
      name,
      extension: ext,
      mimeType: file.mime_type || null,
      sizeBytes: file.size_bytes,
      isFolder: file.is_folder,
      hasThumbnail: file.has_thumbnail ?? false,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      location: 'Recent',
      cipher: isUnlocked ? 'AES-256-GCM' : undefined,
      keyId: isUnlocked ? file.id : undefined,
      noteEncrypted: file.note_encrypted ?? null,
    }
  }

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null
  const shareFile = files.find((f) => f.id === shareFileId) ?? null
  const moveFile = files.find((f) => f.id === moveFileId) ?? null
  const renameFile = files.find((f) => f.id === renameFileId) ?? null

  return (
    <DriveLayout>
      <div className="px-5 py-2.5 border-b border-line flex items-center gap-3">
        <Icon name="clock" size={15} />
        <div>
          <div className="text-sm font-semibold text-ink">Recent</div>
          <div className="text-[11px] text-ink-3 font-mono tabular-nums">
            {files.length} item{files.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <FileList
        files={files}
        loading={loading}
        emptyState={<EmptyRecent onUpload={() => navigate('/')} />}
        onRefresh={fetchFiles}
        sortable={false}
        showDateGroups
        onNavigateFolder={() => navigate('/')}
        onFileAction={handleFileAction}
        onDecryptedNamesChange={setDecryptedNames}
        externalDecryptedNames={Object.fromEntries(Object.entries(decryptedNames).filter((e): e is [string, string] => e[1] !== null))}
        selectedFileId={selectedFileId}
        onSelectFile={(file) => file && setSelectedFileId(file.id)}
        onBulkTrash={handleBulkTrash}
        onBulkDownload={handleBulkDownload}
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
          items={[{ id: moveFile.id, name: displayName(moveFile), isFolder: moveFile.is_folder }]}
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

      <FileDetailsPanel
        open={selectedFile !== null}
        onClose={() => setSelectedFileId(null)}
        file={selectedFile ? buildDetailsMeta(selectedFile) : null}
        onDownload={() => selectedFile && handleFileDownload(selectedFile)}
        onShare={() => {
          if (selectedFile) {
            setShareFileId(selectedFile.id)
            setSelectedFileId(null)
          }
        }}
        onStar={() => {
          if (selectedFile) {
            handleFileAction('star', selectedFile)
          }
        }}
        isStarred={selectedFile?.is_starred ?? false}
        onTrash={() => {
          if (selectedFile) {
            handleFileAction('trash', selectedFile)
            setSelectedFileId(null)
          }
        }}
        onPreview={() => {
          if (selectedFile && !selectedFile.is_folder) {
            openPreview(selectedFile)
            setSelectedFileId(null)
          }
        }}
      />

      {previewFile && (() => {
        const previewIdx = files.findIndex((f) => f.id === previewFile.id)
        const hasPrev = previewIdx > 0
        const hasNext = previewIdx < files.length - 1
        return (
          <FilePreview
            file={previewFile}
            decryptedName={decryptedNames[previewFile.id] ?? undefined}
            onClose={closePreview}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={hasPrev ? () => openPreview(files[previewIdx - 1]) : undefined}
            onNext={hasNext ? () => openPreview(files[previewIdx + 1]) : undefined}
          />
        )
      })()}
    </DriveLayout>
  )
}
