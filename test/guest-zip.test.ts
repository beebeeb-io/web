/**
 * Task 2237b — guest zip collection.
 *
 * The tree is walked with the link's own routes (`/api/v1/f/{token}/items`),
 * never `listFiles`; paths mirror the decrypted structure; the archive is
 * assembled by the same packager the owner drive uses.
 */
import { describe, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
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

const ROOT = '11111111-1111-4111-8111-111111111111'
/** Every L7 open the archive walk asked for. */
const opened: Array<{ rootId: string; itemId: string; isFolder: boolean }> = []
await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, {
  openChildKey: async (
    _folderKey: Uint8Array,
    ref: { rootId: string; itemId: string; isFolder: boolean },
    wrapped: string,
  ) => {
    opened.push(ref)
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
const streamed: string[] = []
const encoder = new TextEncoder()

await mockModuleScoped('../src/lib/guest-bytes', import.meta.dir, {
  // The whole-file decrypt the archive uses (rv-web198c P2-6): `cut*` dies
  // part-way (some chunks already authenticated), `gone*` before any.
  fetchGuestDownloadBlob: async (args: { item: PublicFolderItem }) => {
    downloaded.push(args.item.id)
    if (args.item.id.startsWith('gone')) throw new Error('This file is no longer available.')
    if (args.item.id.startsWith('cut')) throw new Error('network dropped')
    return new Blob([`plain:${args.item.id}`], { type: 'application/octet-stream' })
  },
  // Two chunks per file; `cut*` dies after its first chunk, `gone*` before any.
  streamGuestPlaintext: async (
    args: { item: PublicFolderItem },
    onChunk: (chunk: Uint8Array) => Promise<void>,
  ) => {
    streamed.push(args.item.id)
    if (args.item.id.startsWith('gone')) throw new Error('This file is no longer available.')
    await onChunk(encoder.encode('plain:'))
    if (args.item.id.startsWith('cut')) throw new Error('network dropped')
    await onChunk(encoder.encode(args.item.id))
    return { mimeType: null }
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
  streamed.length = 0
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
      items: [row('f-dir', '2019', { is_folder: true }), row('f-note', 'note.txt')],
      next_cursor: null,
    }
    pages['f-dir'] = { items: [row('f-photo', 'x.jpg', { parent_id: 'f-dir' })], next_cursor: null }
    opened.length = 0

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      rootId: ROOT,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.errorCount).toBe(0)
    // L7: every wrap opened for (this root, its own id, its kind).
    expect(opened).toContainEqual({ rootId: ROOT, itemId: 'f-dir', isFolder: true })
    expect(opened).toContainEqual({ rootId: ROOT, itemId: 'f-note', isFolder: false })
    expect(opened).toContainEqual({ rootId: ROOT, itemId: 'f-photo', isFolder: false })
    expect(result.files.map((entry) => entry.path)).toEqual([
      'Holiday/2019/x.jpg',
      'Holiday/note.txt',
    ])
    expect(result.files.map((entry) => entry.fileId)).toEqual(['f-photo', 'f-note'])
    expect(listCalls).toEqual([null, 'f-dir'])
    expect(downloaded).toHaveLength(0)
    for (const file of result.files) await file.load()
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
      rootId: ROOT,
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
      items: [row('f-note', 'note.txt'), row('f-dir', 'later', { is_folder: true })],
      next_cursor: null,
    }
    pages['f-dir'] = new FolderNotAvailableError()

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      rootId: ROOT,
      proof,
      rootPath: 'Holiday',
    })

    expect(result.errorCount).toBe(1)
    expect(result.files.map((entry) => entry.path)).toEqual(['Holiday/note.txt'])
  })

  test('a folder with no published wrap keeps a placeholder name: never read under the folder key (L7)', async () => {
    reset()
    pages['root'] = {
      items: [row('f-dir', 'later', { is_folder: true, wrapped_file_key: null }), row('f-note', 'note.txt')],
      next_cursor: null,
    }
    pages['f-dir'] = { items: [row('f-inside', 'x.txt', { parent_id: 'f-dir' })], next_cursor: null }
    opened.length = 0

    const result = await collectGuestZipEntries({
      token: 'tok',
      folderKey,
      rootId: ROOT,
      proof,
      rootPath: 'Holiday',
    })

    // Its own name is unreadable (the fixture would have yielded "later" for
    // any key), so the archive uses the placeholder; its files still open
    // through their own wraps.
    expect(result.errorCount).toBe(0)
    expect(result.files.map((entry) => entry.path).sort()).toEqual(['Holiday/folder-f-dir/x.txt', 'Holiday/note.txt'])
    expect(opened.some((ref) => ref.itemId === 'f-dir')).toBe(false)
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
      rootId: ROOT,
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
        { path: 'Holiday/note.txt', fileId: 'f-note', sizeBytes: 3, pathFor: () => 'Holiday/note.txt', fallbackName: 'note.txt', load: async () => ({ plaintext: new Blob(['abc']), filename: 'note.txt' }) },
        { path: 'Holiday/2019/x.jpg', fileId: 'f-photo', sizeBytes: 3, pathFor: () => 'Holiday/2019/x.jpg', fallbackName: 'x.jpg', load: async () => ({ plaintext: new Blob(['def']), filename: 'x.jpg' }) },
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


test('B zip collection keeps metadata only, never all plaintext blobs', async () => {
  reset()
  pages.root = { items: [row('a', 'a.txt'), row('b', 'b.txt')], next_cursor: null }
  const { files } = await collectGuestZipEntries({ token: 'tok', folderKey, rootId: ROOT, proof, rootPath: 'Root' })
  expect(files).toHaveLength(2)
  expect(downloaded).toHaveLength(0)
})

function memorySink(buffered: boolean) {
  const chunks: Uint8Array[] = []
  return {
    chunks,
    sink: {
      buffered,
      write: async (chunk: Uint8Array) => { chunks.push(chunk) },
      close: async () => {},
      abort: async () => {},
    },
    bytes,
    text: () => new TextDecoder('latin1').decode(bytes()),
  }
  function bytes(): Uint8Array {
    return chunks.reduce((out, chunk) => {
      const next = new Uint8Array(out.length + chunk.length)
      next.set(out)
      next.set(chunk, out.length)
      return next
    }, new Uint8Array(0))
  }
}

test('B streaming sink: each file goes in as ONE whole, authenticated entry; no size cap (rv-web198c P2-6)', async () => {
  reset()
  pages.root = { items: [row('big', 'big.jpg', { size_bytes: 200 * 1024 ** 2 })], next_cursor: null }
  const { files } = await collectGuestZipEntries({ token: 'tok', folderKey, rootId: ROOT, proof, rootPath: 'Root' })
  const out = memorySink(false)
  const result = await downloadGuestZip(files, 'Root.zip', { sink: out.sink })
  expect(result.errorCount).toBe(0)
  // Never streamed chunk by chunk into an entry: a stream cannot take back a
  // partial entry when a later chunk fails.
  expect(streamed).toEqual([])
  expect(downloaded).toEqual(['big'])
  expect(out.text()).toContain('Root/big.jpg')
  expect(out.text()).toContain('plain:big')
})

test('B buffered sink: more than 128 MiB is refused with the message before anything is fetched', async () => {
  reset()
  pages.root = { items: [row('large', 'large.jpg', { size_bytes: 128 * 1024 ** 2 + 1 })], next_cursor: null }
  const { files } = await collectGuestZipEntries({ token: 'tok', folderKey, rootId: ROOT, proof, rootPath: 'Root' })
  const out = memorySink(true)
  await expect(downloadGuestZip(files, 'Root.zip', { sink: out.sink })).rejects.toThrow(/128 MiB/)
  expect(streamed).toHaveLength(0)
  expect(downloaded).toHaveLength(0)
  expect(out.chunks).toHaveLength(0)
})

test('B buffered sink under the bound still builds the zip', async () => {
  reset()
  pages.root = { items: [row('small', 'small.jpg')], next_cursor: null }
  const { files } = await collectGuestZipEntries({ token: 'tok', folderKey, rootId: ROOT, proof, rootPath: 'Root' })
  const out = memorySink(true)
  const result = await downloadGuestZip(files, 'Root.zip', { sink: out.sink })
  expect(result.errorCount).toBe(0)
  expect(out.text()).toContain('plain:small')
})

test('B a file that fails is reported in the zip and the count, never silently dropped', async () => {
  reset()
  pages.root = {
    items: [row('cut', 'cut.jpg'), row('gone', 'gone.jpg'), row('ok', 'ok.jpg')],
    next_cursor: null,
  }
  const { files } = await collectGuestZipEntries({ token: 'tok', folderKey, rootId: ROOT, proof, rootPath: 'Root' })
  const out = memorySink(false)
  const result = await downloadGuestZip(files, 'Root.zip', { sink: out.sink })
  expect(result.errorCount).toBe(2)
  const archive = unzipSync(out.bytes())
  // rv-web198c P2-6: the file that failed part-way leaves NO entry (none of
  // its plaintext is in the archive); both failures are named in the manifest.
  expect(Object.keys(archive).sort()).toEqual(['Root/ok.jpg', '_errors.txt'])
  expect(strFromU8(archive['Root/ok.jpg'])).toBe('plain:ok')
  expect(out.text()).not.toContain('plain:cut')
  const errors = strFromU8(archive['_errors.txt'])
  expect(errors).toContain('Root/cut.jpg: network dropped')
  expect(errors).toContain('Root/gone.jpg: This file is no longer available.')
})
