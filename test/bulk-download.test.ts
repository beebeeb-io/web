/**
 * Task 2237b — the zip packager is shared by the owner drive and the guest
 * link holder. This file pins the behavioural equivalence of the port
 * delegation and the error manifest, without a DOM: the archive is captured
 * through an injected sink instead of the service worker / anchor download.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { BulkDownloadPorts, ZipSink } from '../src/lib/bulk-download'
import type { DriveFile } from '../src/lib/api'

function file(id: string, nameEncrypted: string, overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    name_encrypted: nameEncrypted,
    mime_type: null,
    size_bytes: 4,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const root = file('f-root', 'Holiday', { is_folder: true, size_bytes: 0 })
const sub = file('f-sub', '2019', { is_folder: true, parent_id: 'f-root', size_bytes: 0 })
const photo = file('f-photo', 'x.jpg', { parent_id: 'f-sub' })
const note = file('f-note', 'note.txt', { parent_id: 'f-root' })

let tree: Record<string, DriveFile[]> = {
  'f-root': [sub, note],
  'f-sub': [photo],
}

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  listFiles: async (folderId: string) => tree[folderId] ?? [],
})

const names: Record<string, string> = {
  'f-root': 'Holiday',
  'f-sub': '2019',
  'f-photo': 'x.jpg',
  'f-note': 'note.txt',
}

await mockModuleScoped('../src/lib/encrypted-download', import.meta.dir, {
  decryptToBlob: async (fileId: string) => ({
    plaintext: new Blob([`bytes:${fileId}`]),
    filename: names[fileId] ?? `file-${fileId}`,
  }),
})

const {
  downloadAsZip,
  downloadAsZipWith,
  expandDownloadEntries,
  ownerDownloadPorts,
  uniqueZipPath,
} = await import('../src/lib/bulk-download')

function keyFor(id: string): Uint8Array {
  return new TextEncoder().encode(id.padEnd(32, '.'))
}

function recordingSink(): { sink: ZipSink; bytes: () => Uint8Array } {
  const chunks: Uint8Array[] = []
  return {
    sink: {
      write: async (chunk) => {
        chunks.push(chunk)
      },
      close: async () => {},
      abort: async () => {},
    },
    bytes: () => {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let at = 0
      for (const chunk of chunks) {
        out.set(chunk, at)
        at += chunk.length
      }
      return out
    },
  }
}

/** Names in the order their local file headers appear in the archive. */
function entryNames(bytes: Uint8Array): string[] {
  const found: string[] = []
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) {
      continue
    }
    const nameLength = bytes[i + 26] | (bytes[i + 27] << 8)
    if (nameLength <= 0 || i + 30 + nameLength > bytes.length) continue
    found.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLength)))
  }
  return found
}

function portsFor(
  onDecrypt?: (file: DriveFile) => void,
): BulkDownloadPorts {
  return {
    listChildren: async (folderId) => tree[folderId] ?? [],
    getFileKey: async (f) => keyFor(f.id),
    decryptToBlob: async (f, key) => {
      onDecrypt?.(f)
      return { plaintext: new Blob([`bytes:${f.id}`]), filename: names[f.id] ?? `file-${f.id}` }
    },
  }
}

describe('bulk download ports', () => {
  test('downloadAsZip delegates to downloadAsZipWith with owner ports', async () => {
    const getKey = async (f: DriveFile) => keyFor(f.id)
    const direct = recordingSink()
    await downloadAsZip([root], getKey, { sink: direct.sink, zipFilename: 'a.zip' })
    const viaPorts = recordingSink()
    await downloadAsZipWith(ownerDownloadPorts(getKey), [root], {
      sink: viaPorts.sink,
      zipFilename: 'a.zip',
    })

    const directNames = entryNames(direct.bytes())
    expect(directNames).toEqual(viaPorts ? entryNames(viaPorts.bytes()) : [])
    expect(directNames).toEqual(['Holiday/2019/x.jpg', 'Holiday/note.txt'])
  })

  test('a failing port contributes one error and an _errors.txt entry', async () => {
    const ports: BulkDownloadPorts = {
      ...portsFor(),
      decryptToBlob: async (f) => {
        if (f.id === 'f-photo') throw new Error('boom')
        return { plaintext: new Blob(['ok']), filename: names[f.id] ?? f.id }
      },
    }
    const sink = recordingSink()
    const result = await downloadAsZipWith(ports, [root], { sink: sink.sink })

    expect(result.errorCount).toBe(1)
    const packed = entryNames(sink.bytes())
    expect(packed).toEqual(['Holiday/note.txt', '_errors.txt'])
  })

  test('expandDownloadEntries walks the tree once and keeps zip prefixes', async () => {
    const entries = await expandDownloadEntries([root], portsFor())
    expect(entries.map((entry) => `${entry.prefix}${names[entry.file.id]}`)).toEqual([
      'Holiday/2019/x.jpg',
      'Holiday/note.txt',
    ])
  })

  test('duplicate archive paths get a numbered suffix instead of clobbering', () => {
    const used = new Set<string>()
    expect(uniqueZipPath('Holiday/note.txt', used)).toBe('Holiday/note.txt')
    expect(uniqueZipPath('Holiday/note.txt', used)).toBe('Holiday/note (2).txt')
    expect(uniqueZipPath('Holiday/note.txt', used)).toBe('Holiday/note (3).txt')
  })
})
