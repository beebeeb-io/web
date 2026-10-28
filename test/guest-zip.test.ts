/**
 * Task 2237b — guest zip collection.
 *
 * The tree is walked with the link's own routes (`/api/v1/f/{token}/items`),
 * never `listFiles`; paths mirror the decrypted structure; the archive is
 * assembled by the same packager the owner drive uses.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { FolderNotAvailableError } from '../src/lib/folder-link-public'
import type { Proof, PublicFolderItem } from '../src/lib/folder-link-types'

type Page = { items: PublicFolderItem[]; next_cursor: string | null }

const pages: Record<string, Page | Error> = {}
const listCalls: (string | null)[] = []

await mockModuleScoped('../src/lib/folder-link-public', import.meta.dir, {
  listFolderItems: async (
    _token: string,
    params: { parentId: string | null; cursor?: string | null; limit?: number },
  ) => {
    listCalls.push(params.parentId)
    const page = pages[params.parentId ?? 'root']
    if (page instanceof Error) throw page
    return page ?? { items: [], next_cursor: null }
  },
})

await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, {
  decryptChildFileKey: async (_folderKey: Uint8Array, wrapped: string) => {
    if (wrapped.startsWith('bad:')) throw new Error('unwrap failed')
    return new TextEncoder().encode(`key:${wrapped}`)
  },
})

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  // The fixture stores the plain name in the ciphertext field.
  decryptFileMetadata: async (_key: Uint8Array, nameEncrypted: string) => ({
    name: nameEncrypted,
    mimeType: null,
  }),
})

const downloaded: string[] = []

await mockModuleScoped('../src/lib/guest-bytes', import.meta.dir, {
  fetchGuestDownloadBlob: async (args: { item: PublicFolderItem }) => {
    downloaded.push(args.item.id)
    return new Blob([`plain:${args.item.id}`], { type: 'application/octet-stream' })
  },
})

const { collectGuestZipEntries, downloadGuestZip, zipPathFor } = await import(
  '../src/lib/guest-zip'
)

function row(
  id: string,
  name: string,
  overrides: Partial<PublicFolderItem> = {},
): PublicFolderItem {
  return {
    id,
    parent_id: null,
    name_encrypted: name,
    size_bytes: 3,
    is_folder: false,
    chunk_count: 1,
    version_number: 1,
    has_thumbnail: false,
    thumbnail_encrypted: null,
    updated_at: '2026-01-01T00:00:00Z',
    wrapped_file_key: `wrapped-${id}`,
    ...overrides,
  }
}

const proof: Proof = { token: 'tok', proof: 'p', expiresAt: Date.now() + 60_000 }
const folderKey = new Uint8Array(32).fill(7)

function reset(): void {
  for (const key of Object.keys(pages)) delete pages[key]
  listCalls.length = 0
  downloaded.length = 0
}

describe('zipPathFor', () => {
  test('appends exactly one segment and drops separators inside the name', () => {
    expect(zipPathFor('Holiday', 'a/b.txt')).toBe('Holiday/b.txt')
    expect(zipPathFor('Holiday', '2019')).toBe('Holiday/2019')
    expect(zipPathFor('', 'note.txt')).toBe('note.txt')
    expect(zipPathFor('Holiday/', '/note.txt')).toBe('Holiday/note.txt')
  })
})

describe('collectGuestZipEntries', () => {
  test('walks the link tree and keeps the decrypted structure', async () => {
    reset()
    pages['root'] = {
      items: [row('f-dir', '2019', { is_folder: true, wrapped_file_key: null }), row('f-note', 'note.txt')],
      next_cursor: null,
    }
    pages['f-dir'] = { items: [row('f-photo', 'x.jpg', { parent_id: 'f-dir' })], next_cursor: null }

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.errorCount).toBe(0)
    expect(result.files.map((entry) => entry.path)).toEqual([
      'Holiday/2019/x.jpg',
      'Holiday/note.txt',
    ])
    expect(result.files.map((entry) => entry.fileId)).toEqual(['f-photo', 'f-note'])
    expect(listCalls).toEqual([null, 'f-dir'])
    expect(downloaded.sort()).toEqual(['f-note', 'f-photo'])
  })

  test('a duplicate decrypted name in the same parent does not clobber', async () => {
    reset()
    pages['root'] = {
      items: [row('f-one', 'note.txt'), row('f-two', 'note.txt')],
      next_cursor: null,
    }

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.files.map((entry) => entry.path)).toEqual([
      'Holiday/note.txt',
      'Holiday/note (2).txt',
    ])
  })

  test('a 404 mid-walk keeps the entries collected so far and counts one error', async () => {
    reset()
    pages['root'] = {
      items: [row('f-note', 'note.txt'), row('f-dir', 'later', { is_folder: true, wrapped_file_key: null })],
      next_cursor: null,
    }
    pages['f-dir'] = new FolderNotAvailableError()

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.errorCount).toBe(1)
    expect(result.files.map((entry) => entry.path)).toEqual(['Holiday/note.txt'])
  })

  test('an unwrappable file key is an error, not a broken entry', async () => {
    reset()
    pages['root'] = {
      items: [row('f-one', 'a.txt', { wrapped_file_key: 'bad:1' }), row('f-two', 'b.txt')],
      next_cursor: null,
    }

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.errorCount).toBe(1)
    expect(result.files.map((entry) => entry.path)).toEqual(['Holiday/b.txt'])
  })
})

describe('downloadGuestZip', () => {
  test('packages the collected entries with one entry per file', async () => {
    reset()
    const chunks: Uint8Array[] = []
    await downloadGuestZip(
      [
        { path: 'Holiday/note.txt', fileId: 'f-note', sizeBytes: 3, blob: new Blob(['abc']) },
        { path: 'Holiday/2019/x.jpg', fileId: 'f-photo', sizeBytes: 3, blob: new Blob(['def']) },
      ],
      'Holiday.zip',
      {
        sink: {
          write: async (chunk) => {
            chunks.push(chunk)
          },
          close: async () => {},
          abort: async () => {},
        },
      },
    )

    const bytes = chunks.reduce((n, c) => n + c.length, 0)
    expect(bytes).toBeGreaterThan(100)
    const text = new TextDecoder('latin1').decode(
      (() => {
        const out = new Uint8Array(bytes)
        let at = 0
        for (const chunk of chunks) {
          out.set(chunk, at)
          at += chunk.length
        }
        return out
      })(),
    )
    expect(text).toContain('Holiday/note.txt')
    expect(text).toContain('Holiday/2019/x.jpg')
  })
})
