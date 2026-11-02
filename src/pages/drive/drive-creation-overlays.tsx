import type { ComponentProps } from 'react'
import { NewFolderDialog } from '../../components/new-folder-dialog'
import { NewDocumentDialog } from '../../components/new-document-dialog'
import { DeleteBackupsDialog } from '../../components/delete-backups-dialog'
import { DuplicateFileDialog } from '../../components/duplicate-file-dialog'
import type { DriveFile } from '../../lib/api'
import type { NewDocumentType } from '../../lib/new-document'

type NewFolderOwn = ComponentProps<typeof NewFolderDialog>
type NewDocumentOwn = ComponentProps<typeof NewDocumentDialog>
type DuplicateOwn = ComponentProps<typeof DuplicateFileDialog>

export type BackupsDeleteRequest =
  | { kind: 'single'; file: DriveFile }
  | { kind: 'bulk'; ids: string[] }

export interface DriveCreationOverlaysProps {
  folderDialogOpen: boolean
  onCloseFolderDialog: () => void
  onCreateFolder: NewFolderOwn['onCreate']
  newDocType: NewDocumentType | null
  existingDocNames: string[]
  namesReady: boolean
  onCloseNewDocument: () => void
  onCreateDocument: NewDocumentOwn['onCreate']
  backupsDeleteRequest: BackupsDeleteRequest | null
  files: DriveFile[]
  isBackupsRoot: (file: DriveFile) => boolean
  summarizeBackups: (backupsId: string) => { deviceCount: number; itemCount: number }
  onCancelBackups: () => void
  onConfirmBackups: (req: BackupsDeleteRequest) => void
  pendingConflict: { conflicts: DuplicateOwn['conflicts'] } | null
  onConflictReplace: DuplicateOwn['onReplace']
  onConflictKeepBoth: DuplicateOwn['onKeepBoth']
  onConflictCancel: DuplicateOwn['onCancel']
}

export function DriveCreationOverlays({
  folderDialogOpen,
  onCloseFolderDialog,
  onCreateFolder,
  newDocType,
  existingDocNames,
  namesReady,
  onCloseNewDocument,
  onCreateDocument,
  backupsDeleteRequest,
  files,
  isBackupsRoot,
  summarizeBackups,
  onCancelBackups,
  onConfirmBackups,
  pendingConflict,
  onConflictReplace,
  onConflictKeepBoth,
  onConflictCancel,
}: DriveCreationOverlaysProps) {
  return (
    <>
      <NewFolderDialog
        open={folderDialogOpen}
        onClose={onCloseFolderDialog}
        onCreate={onCreateFolder}
      />
      <NewDocumentDialog
        type={newDocType}
        existingNames={existingDocNames}
        // Every sibling name must be known before a name can be checked: the
        // server cannot catch a clash between encrypted names (PR #117
        // review). `undefined` = still decrypting; `null` = failed, which
        // can never resolve, so it does not block.
        namesReady={namesReady}
        onClose={onCloseNewDocument}
        onCreate={onCreateDocument}
      />

      {/* Extra guard before trashing the device-backup root (task 0838) */}
      {backupsDeleteRequest && (() => {
        const backupsId =
          backupsDeleteRequest.kind === 'single'
            ? backupsDeleteRequest.file.id
            : files.find((f) => backupsDeleteRequest.ids.includes(f.id) && isBackupsRoot(f))?.id ?? null
        const summary = backupsId ? summarizeBackups(backupsId) : { deviceCount: 0, itemCount: 0 }
        return (
          <DeleteBackupsDialog
            open
            deviceCount={summary.deviceCount}
            itemCount={summary.itemCount}
            onCancel={onCancelBackups}
            onConfirm={() => backupsDeleteRequest && onConfirmBackups(backupsDeleteRequest)}
          />
        )
      })()}

      {/* Duplicate-file conflict dialog — shown before uploading when names collide */}
      <DuplicateFileDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts ?? []}
        onReplace={onConflictReplace}
        onKeepBoth={onConflictKeepBoth}
        onCancel={onConflictCancel}
      />
    </>
  )
}
