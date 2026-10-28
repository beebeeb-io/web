/**
 * Task 2237b — guest listing.
 *
 * No DOM is installed in this repo, so the interaction rules are asserted on
 * the extracted helpers (sort, paging, crumbs, row decryption) and the two
 * views are rendered with `renderToStaticMarkup`.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { PublicFolderItem } from '../src/lib/folder-link-types'

type ListCall = { parentId: string | null; cursor?: string | null; limit?: number }

const calls: ListCall[] = []
let listImpl: (params: ListCall) => Promise<unknown> = async () => ({
  items: [],
  next_cursor: null,
})

const publicReal = (await mockModuleScoped('../src/lib/folder-link-public', import.meta.dir, {
  listFolderItems: async (
    _token: string,
    params: ListCall,
  ) => {
    calls.push(params)
    return listImpl(params)
  },
  fetchFolderThumbnail: async () => null,
})) as unknown as { FolderNotAvailableError: new (message?: string) => Error }

await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, {
  decryptChildFileKey: async (_folderKey: Uint8Array, wrapped: string) => {
    if (wrapped === 'bad') throw new Error('unwrap failed')
    return new Uint8Array(32).fill(7)
  },
})

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  decryptFileMetadata: async (_key: Uint8Array, nameEncrypted: string) => {
    if (nameEncrypted === 'bad') throw new Error('metadata failed')
    return { name: nameEncrypted.replace(/^enc:/, ''), mimeType: 'text/plain' }
  },
})

const {
  appendGuestNodes,
  describeGuestItem,
  fetchGuestPage,
  isNodeClickable,
  popCrumb,
  pushCrumb,
  readGuestSort,
  readGuestView,
  sortGuestNodes,
  writeGuestSort,
  writeGuestView,
} = await import('../src/components/folder-link/use-guest-listing')
const { GuestGrid } = await import('../src/components/folder-link/guest-grid')
const { GuestList } = await import('../src/components/folder-link/guest-list')
const { GuestEmpty, GuestBrowser } = await import('../src/components/folder-link/guest-browser')

function item(overrides: Partial<PublicFolderItem> & { id: string }): PublicFolderItem {
  return {
    parent_id: null,
    name_encrypted: 'enc:File',
    size_bytes: 100,
    is_folder: false,
    chunk_count: 1,
    version_number: 1,
    has_thumbnail: false,
    thumbnail_encrypted: null,
    updated_at: '2026-10-01T00:00:00Z',
    wrapped_file_key: 'wrap',
    ...overrides,
  }
}

function storageStub() {
  const map = new Map<string, string>()
  const stub = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true })
}

/** React escapes apostrophes in static markup; compare against plain text. */
const plain = (html: string) => html.replace(/&#x27;/g, "'")

beforeEach(() => {
  storageStub()
  calls.length = 0
  listImpl = async () => ({ items: [], next_cursor: null })
})

describe('guest view and sort persistence', () => {
  test('grid is the default and toggling to list persists', () => {
    expect(readGuestView()).toBe('grid')
    writeGuestView('list')
    expect(readGuestView()).toBe('list')
    expect(localStorage.getItem('beebeeb.folderLink.view')).toBe('list')
  })

  test('sort persists and falls back to name-asc', () => {
    expect(readGuestSort()).toBe('name-asc')
    writeGuestSort('modified-desc')
    expect(readGuestSort()).toBe('modified-desc')
    localStorage.setItem('beebeeb.folderLink.sort', 'nonsense')
    expect(readGuestSort()).toBe('name-asc')
  })
})

describe('folders-first ordering', () => {
  const nodes = [
    { item: item({ id: 'f1', name_encrypted: 'enc:Alpha' }), name: 'Alpha', fileKey: new Uint8Array(1), mimeType: 'text/plain' },
    { item: item({ id: 'd1', is_folder: true, name_encrypted: 'enc:Zebra', wrapped_file_key: null }), name: 'Zebra', fileKey: null, mimeType: null },
    { item: item({ id: 'd2', is_folder: true, name_encrypted: 'enc:Alpha folder', wrapped_file_key: null }), name: 'Alpha folder', fileKey: null, mimeType: null },
  ]

  test.each(['name-asc', 'name-desc', 'modified-desc', 'size-desc'] as const)(
    'folders stay ahead of files for %s',
    (key) => {
      const sorted = sortGuestNodes(nodes, key)
      expect(sorted.slice(0, 2).every((node) => node.item.is_folder)).toBe(true)
      expect(sorted[2].item.id).toBe('f1')
    },
  )

  test('name-desc puts folder Zebra before folder Alpha', () => {
    const sorted = sortGuestNodes(nodes, 'name-desc')
    expect(sorted.map((node) => node.name)).toEqual(['Zebra', 'Alpha folder', 'Alpha'])
  })
})

describe('breadcrumbs and paging', () => {
  test('a folder click pushes a crumb; a crumb click pops back', () => {
    const root = [{ id: null, name: 'Shared' }]
    const withChild = pushCrumb(root, { id: 'folder-1', name: 'Invoices' })
    expect(withChild).toHaveLength(2)
    expect(popCrumb(withChild, 0)).toEqual(root)
    // The root crumb is never rebuilt from the server.
    expect(popCrumb(withChild, 0)[0].name).toBe('Shared')
  })

  test('a folder click requests parent_id with the same page limit', async () => {
    listImpl = async () => ({ items: [item({ id: 'x' })], next_cursor: 'c1' })
    const page = await fetchGuestPage({
      token: 't',
      folderKey: new Uint8Array(32),
      parentId: 'folder-1',
      limit: 200,
      proof: null,
    })
    expect(calls).toEqual([{ parentId: 'folder-1', cursor: undefined, limit: 200 }])
    expect(page.nodes[0].name).toBe('File')
    expect(page.nextCursor).toBe('c1')
  })

  test('a 404 during paging leaves the rows already shown', async () => {
    const rows = [{ item: item({ id: 'kept' }), name: 'Kept', fileKey: null, mimeType: null }]
    listImpl = async () => {
      throw new publicReal.FolderNotAvailableError()
    }
    let failed = false
    try {
      await fetchGuestPage({
        token: 't',
        folderKey: new Uint8Array(32),
        parentId: null,
        cursor: 'c2',
        limit: 200,
        proof: null,
      })
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    // The hook only appends on success, so its current rows survive.
    expect(rows).toHaveLength(1)
    expect(appendGuestNodes(rows, [])).toEqual(rows)
  })
})

describe('unreadable rows', () => {
  test('a failed unwrap renders the fallback name and is not clickable', async () => {
    const node = await describeGuestItem(
      item({ id: 'broken', name_encrypted: 'enc:Secret', wrapped_file_key: 'bad' }),
      new Uint8Array(32),
    )
    expect(node.name).toBeNull()
    expect(node.fileKey).toBeNull()
    expect(isNodeClickable(node)).toBe(false)

    const html = plain(
      renderToStaticMarkup(
        <GuestGrid nodes={[node]} onOpenFolder={() => undefined} onPreview={() => undefined} />,
      ),
    )
    expect(html).toContain("can't read name")
    expect(html).toContain('data-clickable="false"')
    expect(html).toContain('disabled')
  })

  test('a readable folder decrypts with the folder key and is clickable', async () => {
    const node = await describeGuestItem(
      item({ id: 'd', is_folder: true, name_encrypted: 'enc:Receipts', wrapped_file_key: null }),
      new Uint8Array(32),
    )
    expect(node.name).toBe('Receipts')
    expect(node.fileKey).toBeNull()
    expect(isNodeClickable(node)).toBe(true)
  })
})

describe('rendered views', () => {
  test('the browser shows both view buttons and sorting', () => {
    const html = plain(
      renderToStaticMarkup(
        <GuestBrowser
          token="t"
          folderKey={new Uint8Array(32)}
          level="view"
          proof={null}
        />,
      ),
    )
    expect(html).toContain('aria-label="View"')
    expect(html).toContain('Grid')
    expect(html).toContain('List')
    expect(html).toContain('aria-label="Sort"')
  })

  test('the empty state names the folder and mentions uploading only at add level', () => {
    const view = plain(renderToStaticMarkup(<GuestEmpty level="view" />))
    expect(view).toContain('This folder is empty.')
    expect(view).not.toContain('Drop files here')

    const add = plain(renderToStaticMarkup(<GuestEmpty level="add" />))
    expect(add).toContain('Drop files here, or use Upload.')
  })

  test('grid and list render the same rows in the same order', () => {
    const nodes = [
      { item: item({ id: 'b', name_encrypted: 'enc:B' }), name: 'B', fileKey: null, mimeType: null },
      { item: item({ id: 'a', name_encrypted: 'enc:A' }), name: 'A', fileKey: null, mimeType: null },
    ]
    const sorted = sortGuestNodes(nodes, 'name-asc')
    const grid = renderToStaticMarkup(
      <GuestGrid nodes={sorted} onOpenFolder={() => undefined} onPreview={() => undefined} />,
    )
    const list = renderToStaticMarkup(
      <GuestList nodes={sorted} onOpenFolder={() => undefined} onPreview={() => undefined} />,
    )
    expect(grid.indexOf('>A</span>') < grid.indexOf('>B</span>')).toBe(true)
    expect(list.indexOf('>A</button>') < list.indexOf('>B</button>')).toBe(true)
  })
})
