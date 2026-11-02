import type { ComponentProps } from 'react'
import { FileDetailsPanel } from '../../components/file-details-panel'
import { TrustDetailsPanel } from '../../components/trust-details-panel'
import { ShareDialog } from '../../components/share-dialog'
import { ShareInfoModal } from '../../components/share-info-modal'
import { MoveModal } from '../../components/move-modal'
import { RenameDialog } from '../../components/rename-dialog'
import { VersionHistory } from '../../components/version-history'
import { FilePreview } from '../../components/preview/file-preview'
import type { FileActivityEntry, FileDetailsMeta } from '../../components/file-details-panel'
import type { TrustFile } from '../../components/trust-details-panel'
import type { DriveFile, MyShare } from '../../lib/api'
import { fileStorageCountry } from '../../lib/storage-regions'

type MoveOwn = ComponentProps<typeof MoveModal>
type RenameOwn = ComponentProps<typeof RenameDialog>

export interface DriveFileOverlaysProps {
  selectedFile: DriveFile | null
  onCloseDetails: () => void
  buildDetailsMeta: (file: DriveFile) => FileDetailsMeta
  fileActivity: FileActivityEntry[]
  onDownloadSelected: (file: DriveFile) => void
  onShareSelected: (file: DriveFile) => void
  onStarSelected: (file: DriveFile) => void
  onMoveSelected: (file: DriveFile) => void
  onTrashSelected: (file: DriveFile) => void
  onVersionHistorySelected: (file: DriveFile) => void
  onPreviewSelected: (file: DriveFile) => void
  onNoteUpdated: (fileId: string, encrypted: string | null) => void
  previewFile: DriveFile | null
  externalDecryptedNames: Record<string, string | null>
  previewEditFileId: string | null
  onClosePreview: () => void
  files: DriveFile[]
  onOpenPreview: (file: DriveFile) => void
  onDeletePreview: (file: DriveFile) => void
  trustFileId: string | null
  onCloseTrust: () => void
  displayName: (file: DriveFile) => string
  shareFileId: string | null
  shareFile: DriveFile | null
  onCloseShare: () => void
  onShareCreated: () => void
  bundleFiles: { id: string; name: string; size: number }[]
  onCloseBundle: () => void
  manageSharesFileId: string | null
  onCloseManageShares: () => void
  myShares: MyShare[]
  currentParentId: string | null
  onCreateNewShare: (file: DriveFile) => void
  onSharesRevoked: () => void
  moveFileId: string | null
  moveFile: DriveFile | null
  onCloseMove: () => void
  onMoveConfirm: MoveOwn['onConfirm']
  bulkMoveOpen: boolean
  bulkMoveIds: string[]
  onCloseBulkMove: () => void
  onBulkMoveConfirm: MoveOwn['onConfirm']
  renameFileId: string | null
  renameFile: DriveFile | null
  onCloseRename: () => void
  onRenameConfirm: RenameOwn['onRename']
  renameSiblingNames: RenameOwn['existingNames']
  versionFileId: string | null
  onCloseVersionHistory: () => void
  onVersionRestored: () => void
}

export function DriveFileOverlays(props: DriveFileOverlaysProps) {
  const {
    selectedFile,
    onCloseDetails,
    buildDetailsMeta,
    fileActivity,
    onDownloadSelected,
    onShareSelected,
    onStarSelected,
    onMoveSelected,
    onTrashSelected,
    onVersionHistorySelected,
    onPreviewSelected,
    onNoteUpdated,
    previewFile,
    externalDecryptedNames,
    previewEditFileId,
    onClosePreview,
    files,
    onOpenPreview,
    onDeletePreview,
    trustFileId,
    onCloseTrust,
    displayName,
    shareFileId,
    shareFile,
    onCloseShare,
    onShareCreated,
    bundleFiles,
    onCloseBundle,
    manageSharesFileId,
    onCloseManageShares,
    myShares,
    currentParentId,
    onCreateNewShare,
    onSharesRevoked,
    moveFileId,
    moveFile,
    onCloseMove,
    onMoveConfirm,
    bulkMoveOpen,
    bulkMoveIds,
    onCloseBulkMove,
    onBulkMoveConfirm,
    renameFileId,
    renameFile,
    onCloseRename,
    onRenameConfirm,
    renameSiblingNames,
    versionFileId,
    onCloseVersionHistory,
    onVersionRestored,
  } = props
  return (
    <>
      <FileDetailsPanel
        open={selectedFile !== null}
        onClose={onCloseDetails}
        file={selectedFile ? buildDetailsMeta(selectedFile) : null}
        activity={fileActivity}
        onDownload={() => selectedFile && onDownloadSelected(selectedFile)}
        onShare={() => selectedFile && onShareSelected(selectedFile)}
        onStar={() => selectedFile && onStarSelected(selectedFile)}
        isStarred={selectedFile?.is_starred ?? false}
        onMove={() => selectedFile && onMoveSelected(selectedFile)}
        onTrash={() => selectedFile && onTrashSelected(selectedFile)}
        onVersionHistory={() => selectedFile && onVersionHistorySelected(selectedFile)}
        onPreview={() => selectedFile && onPreviewSelected(selectedFile)}
        onNoteUpdated={onNoteUpdated}
      />

      {/* Full-screen file preview overlay */}
      {previewFile && (() => {
        const previewIdx = files.findIndex((f) => f.id === previewFile.id)
        const hasPrev = previewIdx > 0
        const hasNext = previewIdx < files.length - 1
        return (
          <FilePreview
            file={previewFile}
            decryptedName={externalDecryptedNames[previewFile.id] ?? undefined}
            onClose={onClosePreview}
            startInEditMode={previewEditFileId === previewFile.id}
            folderId={currentParentId ?? undefined}
            onDelete={onDeletePreview}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={hasPrev ? () => onOpenPreview(files[previewIdx - 1]) : undefined}
            onNext={hasNext ? () => onOpenPreview(files[previewIdx + 1]) : undefined}
          />
        )
      })()}

      <TrustDetailsPanel
        open={trustFileId !== null}
        onClose={onCloseTrust}
        file={(() => {
          const f = files.find((x) => x.id === trustFileId)
          if (!f) return null
          const trust: TrustFile = {
            id: f.id,
            name: displayName(f),
            sizeBytes: f.size_bytes,
            createdAt: f.created_at,
            cipher: 'AES-256-GCM',
            region: 'Europe',
            country: fileStorageCountry(f) ?? undefined,
          }
          return trust
        })()}
      />

      {shareFile && (
        <ShareDialog
          open={shareFileId !== null}
          onClose={onCloseShare}
          fileId={shareFile.id}
          fileName={displayName(shareFile)}
          fileSize={shareFile.size_bytes}
          isFolder={shareFile.is_folder}
          file={shareFile}
          onShareCreated={onShareCreated}
        />
      )}

      {/* Bundle share dialog (task 0417): ONE link over the selected file set. */}
      {bundleFiles.length > 1 && (
        <ShareDialog
          open={true}
          onClose={onCloseBundle}
          fileId={bundleFiles[0].id}
          fileName={bundleFiles[0].name}
          fileSize={bundleFiles[0].size}
          bundleFiles={bundleFiles}
          onShareCreated={onShareCreated}
        />
      )}

      {manageSharesFileId && (() => {
        const file = files.find((f) => f.id === manageSharesFileId)
        if (!file) return null
        return (
          <ShareInfoModal
            isOpen={true}
            onClose={onCloseManageShares}
            fileId={file.id}
            fileName={displayName(file)}
            myShares={myShares}
            onCreateNew={() => onCreateNewShare(file)}
            onRevoked={onSharesRevoked}
          />
        )
      })()}

      {moveFile && (
        <MoveModal
          open={moveFileId !== null}
          onClose={onCloseMove}
          items={[{
            id: moveFile.id,
            name: displayName(moveFile),
            isFolder: moveFile.is_folder,
          }]}
          mode="move"
          onConfirm={onMoveConfirm}
        />
      )}

      {bulkMoveOpen && bulkMoveIds.length > 0 && (
        <MoveModal
          open={bulkMoveOpen}
          onClose={onCloseBulkMove}
          items={files
            .filter((f) => bulkMoveIds.includes(f.id))
            .map((f) => ({
              id: f.id,
              name: displayName(f),
              isFolder: f.is_folder,
            }))}
          mode="move"
          onConfirm={onBulkMoveConfirm}
        />
      )}

      <RenameDialog
        open={renameFileId !== null}
        onClose={onCloseRename}
        currentName={renameFile ? displayName(renameFile) : ''}
        onRename={onRenameConfirm}
        existingNames={renameSiblingNames}
      />

      {versionFileId && (() => {
        const f = files.find((x) => x.id === versionFileId)
        return (
          <VersionHistory
            open={true}
            onClose={onCloseVersionHistory}
            fileId={versionFileId}
            fileName={f ? displayName(f) : ''}
            nameEncrypted={f?.name_encrypted ?? ''}
            mimeType={f?.mime_type ?? undefined}
            file={f}
            onVersionRestored={onVersionRestored}
          />
        )
      })()}

    </>
  )
}
