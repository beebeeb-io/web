// ─── Drive top bar ─────────────────────────────────
// Breadcrumbs, the shared-folder presence avatars, the command-palette search
// button and the New/Upload controls. Lifted out of drive.tsx unchanged; every
// handler is a prop, so the page keeps the state and the effects.

import { BBButton, Icon } from '@beebeeb/shared'
import { Breadcrumb } from '../../components/breadcrumb'
import { PresenceAvatars } from '../../components/presence-avatars'
import { NewMenu } from '../../components/new-menu'
import { isMac } from '../../hooks/use-keyboard-shortcuts'
import type { NewDocumentType } from '../../lib/new-document'

export interface DriveTopBarProps {
  breadcrumbs: { id: string | null; name: string }[]
  onNavigate: (index: number) => void
  /** The folder being viewed; null at the root. */
  folderId: string | null
  /** The folders the viewer has an active share on (presence is shown only there). */
  sharedFolderIds: ReadonlySet<string>
  currentUserId: string | null
  officeAvailable: boolean
  frozen: boolean
  uploadMenuOpen: boolean
  onToggleUploadMenu: () => void
  onNewFolder: () => void
  onNewDocument: (type: NewDocumentType) => void
  onUpload: () => void
  onUploadFolder: () => void
}

export function DriveTopBar({
  breadcrumbs,
  onNavigate,
  folderId,
  sharedFolderIds,
  currentUserId,
  officeAvailable,
  frozen,
  uploadMenuOpen,
  onToggleUploadMenu,
  onNewFolder,
  onNewDocument,
  onUpload,
  onUploadFolder,
}: DriveTopBarProps) {
  return (
        <div className="px-3 md:px-5 py-2.5 border-b border-line flex items-center gap-2 md:gap-3 flex-wrap md:flex-nowrap">
          {/* Breadcrumbs */}
          <Breadcrumb items={breadcrumbs} onNavigate={onNavigate} />

          {/* Presence avatars — shown when the current folder is shared */}
          {folderId && (
            <PresenceAvatars
              folderId={
                sharedFolderIds.has(folderId)
                  ? folderId
                  : null
              }
              currentUserId={currentUserId}
            />
          )}

          {/* Search — opens the command palette (task 0842). Mobile collapses to
              an icon button; desktop shows a field-styled button with the ⌘K hint
              inside on the right (task 0841). ⌘K itself is handled globally. */}
          <button
            type="button"
            aria-label="Search files and folders"
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            onClick={() => window.dispatchEvent(new Event('beebeeb:open-command-palette'))}
            className="ml-auto md:hidden inline-flex items-center justify-center w-8 h-8 rounded-md border border-line bg-paper text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
          >
            <Icon name="search" size={14} />
          </button>
          <button
            type="button"
            aria-label="Search files and folders"
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            onClick={() => window.dispatchEvent(new Event('beebeeb:open-command-palette'))}
            className="hidden md:flex ml-auto items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1.5 w-[260px] text-left hover:bg-paper-2 hover:border-line-2 transition-colors group"
          >
            <Icon name="search" size={13} className="text-ink-4 shrink-0" />
            <span className="flex-1 text-sm text-ink-4 truncate">Search files and folders...</span>
            <kbd className="inline-flex items-center self-center gap-0.5 px-1.5 py-[3px] text-[10px] leading-none font-mono text-ink-4 bg-paper-2 border border-line rounded shrink-0">
              {isMac ? <><span className="text-[11px] leading-none">⌘</span>K</> : 'Ctrl+K'}
            </kbd>
          </button>

          {/* New + Upload */}
          <div className="flex items-center gap-1.5 shrink-0">
            <NewMenu
              officeAvailable={officeAvailable}
              onNewFolder={onNewFolder}
              onNewDocument={onNewDocument}
              disabled={frozen}
              disabledReason="Account is frozen"
            />
            <BBButton size="sm" onClick={onUpload} className="gap-1.5" aria-label="Upload files" disabled={frozen} title={frozen ? 'Account is frozen' : undefined} data-tour="upload">
              <Icon name="upload" size={13} /> <span className="hidden sm:inline" aria-hidden="true">Upload</span>
            </BBButton>
            <BBButton size="sm" onClick={onUploadFolder} className="hidden sm:inline-flex gap-1.5" disabled={frozen} title={frozen ? 'Account is frozen' : undefined}>
              <Icon name="folder" size={13} /> Upload folder
            </BBButton>
            {/* Mobile-only overflow: surfaces "Upload folder" below sm where the
                dedicated button is hidden. Keeps the toolbar from getting wider. */}
            <div className="relative sm:hidden">
              <button
                type="button"
                onClick={() => onToggleUploadMenu()}
                disabled={frozen}
                aria-label="More upload options"
                aria-haspopup="menu"
                aria-expanded={uploadMenuOpen}
                title={frozen ? 'Account is frozen' : undefined}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-line bg-paper text-ink-2 hover:text-ink hover:bg-paper-2 transition-colors disabled:opacity-50"
              >
                <Icon name="chevron-down" size={11} />
              </button>
              {uploadMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => onToggleUploadMenu()} />
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 z-40 bg-paper border border-line-2 rounded-md shadow-2 py-1 min-w-[180px]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onToggleUploadMenu(); onUploadFolder() }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-ink-2 hover:bg-paper-2 hover:text-ink transition-colors"
                    >
                      <Icon name="folder" size={11} />
                      Upload folder
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
  )
}
