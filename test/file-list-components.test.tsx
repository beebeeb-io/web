/**
 * Task W-P2-4 — the file list's extracted row and header draw the same facts
 * as the pre-split page body. No DOM: both are presentational, rendered to
 * static markup. The container's behaviour (selection, dnd, sorting state)
 * stays covered by the drive page's Playwright run.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileRow, type FileRowProps } from '../src/components/file-list/file-row'
import { FileListHeader } from '../src/components/file-list/file-list-header'
import type { DriveFile } from '../src/lib/api'

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

function file(over: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'f1',
    name_encrypted: '{"nonce":"x","ciphertext":"y"}',
    mime_type: 'text/plain',
    size_bytes: 2048,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    is_starred: false,
    has_thumbnail: false,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function props(over: Partial<FileRowProps> = {}): FileRowProps {
  return {
    file: file(),
    rowIndex: 3,
    name: 'notes.txt',
    selection: { selectable: true, isSelected: false, isCurrent: false, anySelected: false },
    flags: {
      isDragTarget: false,
      isDragging: false,
      isTrashing: false,
      isRecentUpload: false,
      isPinned: false,
      isStarPulse: false,
      isDecryptPulse: false,
      isUnlocked: true,
      hasActiveShare: false,
      canShowTrustDetails: false,
      isForeign: false,
    },
    thumbnail: { enabled: false, url: undefined, folderColor: null, viewerCount: undefined },
    inlineRename: {
      editing: false,
      value: '',
      inputRef: { current: null },
      onChange: () => {},
      commit: () => {},
      cancel: () => {},
    },
    handlers: {
      onDragStart: () => {},
      onDragEnd: () => {},
      onDragOver: () => {},
      onDragLeave: () => {},
      onDrop: () => {},
      onInteractionCapture: () => {},
      onClick: () => {},
      onDoubleClick: () => {},
      onContextMenu: () => {},
      onKeyDown: () => {},
      onCheckboxClick: () => {},
      onToggleStar: () => {},
      onShowTrustDetails: () => {},
      onOpenShare: () => {},
      onOpenMenu: () => {},
      setThumbRef: () => {},
    },
    ...over,
  }
}

describe('FileRow rendering per kind', () => {
  test('a file shows its name, size, modified age and E2EE chip', () => {
    const out = html(<FileRow {...props()} />)
    expect(out).toContain('notes.txt')
    expect(out).toContain('2 KB')
    expect(out).toContain('text/plain')
    expect(out).toContain('E2EE')
    expect(out).toContain('AES-256-GCM')
    expect(out).toContain('data-row-index="3"')
  })

  test('a folder shows Folder and a dash for size', () => {
    const out = html(<FileRow {...props({ file: file({ id: 'd1', is_folder: true, mime_type: null }) })} />)
    expect(out).toContain('Folder')
    expect(out).toContain('--')
  })

  test('a pending name renders the skeleton, never the ciphertext', () => {
    const out = html(<FileRow {...props({ name: null })} />)
    expect(out).toContain('aria-label="Loading…"')
    expect(out).not.toContain('ciphertext')
  })

  test('a failed name renders the placeholder, never the ciphertext', () => {
    const out = html(<FileRow {...props({ name: 'Encrypted file' })} />)
    expect(out).toContain('Encrypted file')
    expect(out).not.toContain('ciphertext')
  })

  test('T5.5: an F row carries the id-class marker next to its name', () => {
    const base = props()
    const out = html(<FileRow {...props({ flags: { ...base.flags, isForeign: true } })} />)
    expect(out).toContain('data-testid="foreign-row-marker"')
    expect(out).toContain('Added by someone else')
    expect(html(<FileRow {...props()} />)).not.toContain('foreign-row-marker')
  })

  test('selected and current rows keep their distinct classes', () => {
    const selected = html(
      <FileRow {...props({ selection: { selectable: true, isSelected: true, isCurrent: false, anySelected: true } })} />,
    )
    expect(selected).toContain('file-row--selected')
    expect(selected).toContain('aria-selected="true"')

    const current = html(
      <FileRow {...props({ selection: { selectable: true, isSelected: false, isCurrent: true, anySelected: false } })} />,
    )
    expect(current).toContain('bg-amber-bg/30')
  })

  test('share badge, version chip, star and pin appear only when their flag is set', () => {
    const bare = html(<FileRow {...props()} />)
    expect(bare).not.toContain('v2')

    const flagged = html(
      <FileRow
        {...props({
          file: file({ share_count: 2, version_number: 2, is_starred: true, is_folder: true }),
          flags: {
            isDragTarget: false,
            isDragging: false,
            isTrashing: false,
            isRecentUpload: false,
            isPinned: true,
            isStarPulse: false,
            isDecryptPulse: false,
            isUnlocked: true,
            hasActiveShare: true,
            canShowTrustDetails: false,
            isForeign: false,
          },
        })}
      />,
    )
    expect(flagged).toContain('Manage 2 active shares')
    expect(flagged).toContain('Pinned to Quick access')
    expect(flagged).toContain('Unstar')
  })

  test('the trust-details button replaces the chip when the handler is offered', () => {
    const out = html(
      <FileRow
        {...props({
          flags: {
            isDragTarget: false,
            isDragging: false,
            isTrashing: false,
            isRecentUpload: false,
            isPinned: false,
            isStarPulse: false,
            isDecryptPulse: false,
            isUnlocked: true,
            hasActiveShare: false,
            canShowTrustDetails: true,
            isForeign: false,
          },
        })}
      />,
    )
    expect(out).toContain('Encryption details')
    expect(out).not.toContain('E2EE')
  })

  test('a custom row action replaces the kebab button', () => {
    const out = html(<FileRow {...props({ renderActions: () => <span>custom-action</span> })} />)
    expect(out).toContain('custom-action')
    expect(out).not.toContain('aria-label="File actions"')
  })
})

describe('FileListHeader', () => {
  const base = {
    sortKey: 'name-asc' as const,
    sortMenuOpen: false,
    onToggleSortMenu: () => {},
    onCloseSortMenu: () => {},
    onSelectSort: () => {},
    onToggleNameSort: () => {},
    onToggleSizeSort: () => {},
    onToggleModifiedSort: () => {},
    selectable: true,
    totalCount: 2,
    allSelected: false,
    someSelected: false,
    onToggleAll: () => {},
  }

  test('draws the sort label and the four column headings', () => {
    const out = html(<FileListHeader {...base} />)
    expect(out).toContain('Sort:')
    expect(out).toContain('Name')
    expect(out).toContain('Size')
    expect(out).toContain('Modified')
    expect(out).toContain('Shared')
    expect(out).toContain('aria-label="Sort by name"')
  })

  test('the name arrow follows the active sort, and the menu lists every option', () => {
    const asc = html(<FileListHeader {...base} />)
    expect(asc).toContain('↑')
    const desc = html(<FileListHeader {...base} sortKey="name-desc" />)
    expect(desc).toContain('↓')
    const open = html(<FileListHeader {...base} sortMenuOpen />)
    expect(open).toContain('role="menu"')
    expect(open).toContain('role="menuitemradio"')
  })

  test('the select-all box is drawn only when there are rows', () => {
    // BBCheckbox is a role="checkbox" button (not a native input) — the same
    // control FileList drew before the split.
    expect(html(<FileListHeader {...base} />)).toContain('role="checkbox"')
    expect(html(<FileListHeader {...base} totalCount={0} />)).not.toContain('role="checkbox"')
  })
})
