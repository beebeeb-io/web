/**
 * Task 2237b — the write affordances a member is allowed to see.
 *
 * Nothing here decides access: the server does. The component renders exactly
 * what `memberPermissions(level)` permits, so a read-only member never sees a
 * control the server would turn away.
 */
import { useRef } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { memberPermissions } from '../../lib/member-write'
import type { FolderAccessLevel } from '../../lib/folder-link-types'

export interface MemberActionsProps {
  level: FolderAccessLevel
  onUpload: (files: File[]) => void
  onRename: () => void
  onDelete: () => void
  /** When false the edit actions render disabled (nothing selected yet). */
  hasSelection?: boolean
}

export function MemberActions({ level, onUpload, onRename, onDelete, hasSelection = false }: MemberActionsProps) {
  const perms = memberPermissions(level)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  if (!perms.canUpload && !perms.canRename && !perms.canDelete) return null

  return (
    <div className="flex items-center gap-2" data-testid="member-actions">
      {perms.canUpload && (
        <>
          <BBButton size="sm" variant="ghost" onClick={() => fileInput.current?.click()} data-testid="member-upload">
            <Icon name="upload" size={13} />
            Upload
          </BBButton>
          {perms.canCreateFolder && (
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => folderInput.current?.click()}
              data-testid="member-upload-folder"
            >
              <Icon name="folder" size={13} />
              Upload folder
            </BBButton>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            data-testid="member-upload-input"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              if (picked.length > 0) onUpload(picked)
            }}
          />
          {perms.canCreateFolder && (
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              data-testid="member-upload-folder-input"
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
              if (picked.length > 0) onUpload(picked)
              }}
            />
          )}
        </>
      )}
      {perms.canRename && (
        <BBButton
          size="sm"
          variant="ghost"
          onClick={onRename}
          disabled={!hasSelection}
          data-testid="member-rename"
        >
          Rename
        </BBButton>
      )}
      {perms.canDelete && (
        <BBButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={!hasSelection}
          data-testid="member-delete"
        >
          Delete
        </BBButton>
      )}
    </div>
  )
}
