/**
 * Task 2237b — the shared-folder page shows a member exactly what their level
 * allows, and a refused write downgrades the page instead of retrying.
 *
 * No DOM here: `SharedFolderScreen` is the presentational half of the page and
 * is rendered to static markup; the interactions are covered by the Task 17
 * Playwright run against the local API.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { mockModuleScoped } from './helpers/scoped-module-mock'

await mockModuleScoped('../src/components/drive-layout', import.meta.dir, {
  DriveLayout: ({ children }: { children: unknown }) => createElement('div', null, children as never),
})

const { SharedFolderScreen } = await import('../src/pages/shared-folder')
const { writeErrorAction } = await import('../src/lib/member-write')
const { ApiError } = await import('../src/lib/api')

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function file(id: string, name: string, isFolder = false) {
  return {
    file: {
      id,
      name_encrypted: '',
      mime_type: 'text/plain',
      size_bytes: 5,
      is_folder: isFolder,
      is_trashed: false,
      parent_id: null,
      chunk_count: 1,
    },
    name,
    mime: 'text/plain',
  }
}

const baseProps = {
  role: 'member' as const,
  level: 'view' as const,
  displayName: 'Sam',
  ownerEmail: 'owner@example.com',
  memberCount: 2,
  inviteId: 'invite-1',
  keyMissing: false,
  loading: false,
  rows: [file('f1', 'note.txt'), file('d1', 'Photos', true)],
  selectedId: null,
  progress: [],
  breadcrumbs: [],
  rootName: 'Shared folder',
  errorMessage: null,
  onUpload: () => undefined,
  onRename: () => undefined,
  onDelete: () => undefined,
  onSelect: () => undefined,
  onNavigate: () => undefined,
  onBreadcrumb: () => undefined,
  onDownload: () => undefined,
}

function screen(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SharedFolderScreen, { ...baseProps, ...overrides } as never)),
  )
}

describe('what a level may see', () => {
  test('view shows no upload, rename or delete', () => {
    const html = screen({ level: 'view' })
    expect(html).not.toContain('member-upload-input')
    expect(html).not.toContain('member-rename')
    expect(html).not.toContain('member-delete')
    expect(plain(html)).toContain('note.txt')
  })

  test('add shows upload and folder upload, but no rename or delete', () => {
    const html = screen({ level: 'add' })
    expect(html).toContain('member-upload-input')
    expect(html).toContain('member-upload-folder-input')
    expect(html).not.toContain('member-rename')
    expect(html).not.toContain('member-delete')
  })

  test('edit shows rename and delete too', () => {
    const html = screen({ level: 'edit' })
    expect(html).toContain('member-upload-input')
    expect(html).toContain('member-rename')
    expect(html).toContain('member-delete')
  })
})

describe('a refused write', () => {
  test('a 403 asks the page to refetch the level, anything else is just reported', () => {
    expect(writeErrorAction(new ApiError('forbidden', 403, 'forbidden'))).toBe('refetch')
    expect(writeErrorAction(new ApiError('boom', 500, 'server_error'))).toBe('report')
    expect(writeErrorAction(new Error('network'))).toBe('report')
  })

  test('after the refetch drops to add, the edit affordances are gone', () => {
    const html = screen({ level: 'add', selectedId: 'f1' })
    expect(html).not.toContain('member-rename')
    expect(html).not.toContain('member-delete')
  })
})

describe('the page frame', () => {
  test('a signed-in member sees the editing strip with their name', () => {
    const html = plain(screen({ level: 'edit', displayName: 'Sam' }))
    expect(html).toContain("You're editing as Sam")
  })

  test('the owner does not see the editing strip', () => {
    const html = screen({ role: 'owner', level: 'edit' })
    expect(html).not.toContain('shared-folder-editing-as')
  })

  test('the key-missing state keeps its test id', () => {
    const html = screen({ keyMissing: true })
    expect(html).toContain('data-testid="shared-folder-key-missing"')
    expect(plain(html)).toContain("This folder can't be opened")
  })

  test('an upload in flight renders a progress row above the list', () => {
    const html = plain(screen({ level: 'add', progress: [{ name: 'big.zip', percent: 42 }] }))
    expect(html).toContain('big.zip')
    expect(html).toContain('42%')
    expect(html.indexOf('big.zip')).toBeLessThan(html.indexOf('note.txt'))
  })
})
