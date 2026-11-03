// The drive's file-list view wired to the drive data and actions.
import type { ComponentProps } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { FileList } from '../../components/file-list'
import { UploadZone } from '../../components/upload-zone'
import { UploadCards } from '../../components/upload-progress-card'
import { NewMenu } from '../../components/new-menu'
import { EmptyDrive } from '../../components/empty-states/empty-drive'
import { RestoreFromEraseOffer } from '../../components/restore-from-erase'
import { EncryptionStatus } from '../../components/encryption-status'
import { FILE_STATUS_BAR } from '../../components/file-browser-row'
import type { NewDocumentType } from '../../lib/new-document'

type FileListOwn = ComponentProps<typeof FileList>
type UploadZoneOwn = ComponentProps<typeof UploadZone>

export interface DriveFileListProps {
  files: FileListOwn['files']
  loading: boolean
  syncHydrating: boolean
  currentParentId: string | undefined
  officeAvailable: boolean
  isFrozen: boolean
  onUpload: () => void
  onFiles: UploadZoneOwn['onFiles']
  onFolderFiles: UploadZoneOwn['onFolderFiles']
  onNewFolder: () => void
  onNewDocument: (type: NewDocumentType | null) => void
  onNavigateFolder: FileListOwn['onNavigateFolder']
  selectedFileId: FileListOwn['selectedFileId']
  onSelectFile: FileListOwn['onSelectFile']
  onSelectionChange: FileListOwn['onSelectionChange']
  onDecryptedNamesChange: FileListOwn['onDecryptedNamesChange']
  onFileAction: FileListOwn['onFileAction']
  onToggleStar: FileListOwn['onToggleStar']
  onDropToFolder: FileListOwn['onDropToFolder']
  onBulkTrash: FileListOwn['onBulkTrash']
  onBulkMove: FileListOwn['onBulkMove']
  onBulkShare: FileListOwn['onBulkShare']
  onBulkDownload: FileListOwn['onBulkDownload']
  bulkZipProgress: FileListOwn['bulkZipProgress']
  trashingIds: FileListOwn['trashingIds']
  starPulseId: FileListOwn['starPulseId']
  recentlyUploaded: FileListOwn['recentlyUploadedIds']
  onShowTrustDetails: FileListOwn['onShowTrustDetails']
  myShares: FileListOwn['myShares']
  folderViewerCounts: FileListOwn['folderViewerCounts']
  uploads: ComponentProps<typeof UploadCards>['uploads']
  onCancelUpload: ComponentProps<typeof UploadCards>['onCancel']
  onRetryUpload: ComponentProps<typeof UploadCards>['onRetry']
  unlocked: boolean
  hasCryptoError: boolean
  syncedAgo: number
}

export function DriveFileList(props: DriveFileListProps) {
  const {
    files,
    loading,
    syncHydrating,
    currentParentId,
    officeAvailable,
    isFrozen,
    onUpload,
    onFiles,
    onFolderFiles,
    onNewFolder,
    onNewDocument,
    onNavigateFolder,
    selectedFileId,
    onSelectFile,
    onSelectionChange,
    onDecryptedNamesChange,
    onFileAction,
    onToggleStar,
    onDropToFolder,
    onBulkTrash,
    onBulkMove,
    onBulkShare,
    onBulkDownload,
    bulkZipProgress,
    trashingIds,
    starPulseId,
    recentlyUploaded,
    onShowTrustDetails,
    myShares,
    folderViewerCounts,
    uploads,
    onCancelUpload,
    onRetryUpload,
    unlocked,
    hasCryptoError,
    syncedAgo,
  } = props
  return (
    <>
        {/* File list with upload zone. flex-1 + flex-col lets UploadZone fill the
            remaining viewport height so dragging files to the empty area below
            the list still triggers the drop zone. */}
        <div className="flex-1 flex flex-col min-h-0">
        <UploadZone onFiles={onFiles} onFolderFiles={onFolderFiles}>
          <FileList
            files={files}
            loading={loading || syncHydrating}
            parentId={currentParentId ?? null}
            emptyState={
              currentParentId ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div
                    className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--color-amber-bg)', border: '1.5px dashed var(--color-line-2)' }}
                  >
                    <Icon name="folder" size={24} className="text-amber-deep" />
                  </div>
                  <h2 className="text-[15px] font-semibold text-ink mb-1.5">This folder is empty</h2>
                  <p className="text-[13px] text-ink-3 max-w-[340px] leading-relaxed mb-5">
                    Drag files here or use the buttons below to add content to this folder.
                  </p>
                  <div className="flex gap-2">
                    <BBButton size="md" variant="amber" onClick={onUpload} className="gap-1.5">
                      <Icon name="upload" size={13} /> Upload files
                    </BBButton>
                    <NewMenu
                      officeAvailable={officeAvailable}
                      onNewFolder={onNewFolder}
                      onNewDocument={onNewDocument}
                      disabled={isFrozen}
                      disabledReason="Account is frozen"
                      variant="ghost"
                      size="md"
                      align="center"
                      testIdPrefix="empty-new-menu"
                    />
                  </div>
                </div>
              ) : (
                <EmptyDrive
                  onUpload={onUpload}
                  onCreateFolder={onNewFolder}
                  // Task 1918 round 4: after an erase the drive is empty and everything is in the
                  // trash; offer it all back here, where the owner looks first.
                  notice={<RestoreFromEraseOffer className="mb-6" />}
                  newMenu={
                    <NewMenu
                      officeAvailable={officeAvailable}
                      onNewFolder={onNewFolder}
                      onNewDocument={onNewDocument}
                      disabled={isFrozen}
                      disabledReason="Account is frozen"
                      variant="ghost"
                      size="lg"
                      align="center"
                      testIdPrefix="empty-new-menu"
                    />
                  }
                />
              )
            }
            onNavigateFolder={onNavigateFolder}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
            onSelectionChange={onSelectionChange}
            onDecryptedNamesChange={onDecryptedNamesChange}
            onFileAction={onFileAction}
            onToggleStar={onToggleStar}
            onDropToFolder={onDropToFolder}
            onBulkTrash={onBulkTrash}
            onBulkMove={onBulkMove}
            onBulkShare={onBulkShare}
            onBulkDownload={onBulkDownload}
            bulkZipProgress={bulkZipProgress}
            trashingIds={trashingIds}
            starPulseId={starPulseId}
            recentlyUploadedIds={recentlyUploaded}
            onShowTrustDetails={onShowTrustDetails}
            myShares={myShares}
            folderViewerCounts={folderViewerCounts}
            uploadCards={
              <UploadCards
                uploads={uploads}
                onCancel={onCancelUpload}
                onRetry={onRetryUpload}
              />
            }
          />
        </UploadZone>
        </div>

        {/* Status bar */}
        <div className={FILE_STATUS_BAR}>
          <span className="font-mono">{files.length} item{files.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <EncryptionStatus unlocked={unlocked} error={hasCryptoError} />
          <span className="ml-auto flex items-center gap-1.5">
            <Icon name="cloud" size={12} />
            Synced {syncedAgo}s ago
          </span>
        </div>
    </>
  )
}
