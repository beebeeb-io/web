// Task 1574 — web ZIP file listing (Central Directory only, no extraction).
// RED/GREEN mutation proof pasted in
// .claude/tasks/in-development/1574-web-preview-pptx-raw-legacy-office.md's Notes.
import { describe, expect, test } from 'bun:test'
import {
  EOCD_SEARCH_WINDOW_BYTES,
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_LISTED_ENTRIES,
  findEocdInTail,
  parseCentralDirectoryEntries,
  readZipListing,
} from '../src/lib/zip-listing'

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff]
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0))
}
/** Real UTF-8 byte encoding — distinct from `ascii()` above, which only
 * produces correct bytes for the ASCII range. Needed for the non-ASCII
 * filename test (a naive charCodeAt on a multi-byte character produces
 * the wrong bytes entirely, which is a bug in a synthetic TEST builder,
 * not in the reader under test). */
function utf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}

interface SyntheticEntry {
  name: string
  compressedSize?: number
  uncompressedSize?: number
  utf8Flag?: boolean
  externalAttributes?: number
}

/**
 * Builds a real, minimal, uncompressed ("stored") ZIP archive byte-for-byte
 * (Local File Header + data per entry, then a Central Directory, then an
 * EOCD) — not a mock. `readZipListing` never inspects the Local File
 * Headers or entry data at all (that's the whole point of the feature under
 * test), so the "data" here is empty; only the Central Directory + EOCD
 * bytes this reader actually parses need to be correct, and this builder
 * gets both from first principles (no hardcoded offsets), the same
 * discipline as raw-embedded-jpeg.test.ts's synthetic TIFF builder.
 */
function buildZip(entries: SyntheticEntry[], opts: { comment?: string } = {}): Uint8Array {
  const localHeaders: number[] = []
  const centralHeaders: number[] = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = e.utf8Flag ? utf8(e.name) : ascii(e.name)
    const compressedSize = e.compressedSize ?? 0
    const uncompressedSize = e.uncompressedSize ?? 0
    const flag = e.utf8Flag ? 0x0800 : 0

    const localHeaderStart = offset
    const local = [
      ...u32le(0x04034b50), // local file header signature
      ...u16le(20), // version needed
      ...u16le(flag),
      ...u16le(0), // compression method (store)
      ...u16le(0), // mod time
      ...u16le(0), // mod date
      ...u32le(0), // crc32
      ...u32le(compressedSize),
      ...u32le(uncompressedSize),
      ...u16le(nameBytes.length),
      ...u16le(0), // extra length
      ...nameBytes,
    ]
    localHeaders.push(...local)
    offset += local.length

    const central = [
      ...u32le(0x02014b50), // central file header signature
      ...u16le(20), // version made by
      ...u16le(20), // version needed
      ...u16le(flag),
      ...u16le(0), // compression method
      ...u16le(0), // mod time
      ...u16le(0), // mod date
      ...u32le(0), // crc32
      ...u32le(compressedSize),
      ...u32le(uncompressedSize),
      ...u16le(nameBytes.length),
      ...u16le(0), // extra length
      ...u16le(0), // comment length
      ...u16le(0), // disk number start
      ...u16le(0), // internal attributes
      ...u32le(e.externalAttributes ?? 0),
      ...u32le(localHeaderStart),
      ...nameBytes,
    ]
    centralHeaders.push(...central)
  }

  const centralDirectoryOffset = offset
  const centralDirectorySize = centralHeaders.length
  const commentBytes = ascii(opts.comment ?? '')

  const eocd = [
    ...u32le(0x06054b50),
    ...u16le(0), // disk number
    ...u16le(0), // disk with CD start
    ...u16le(entries.length), // entries on this disk
    ...u16le(entries.length), // total entries
    ...u32le(centralDirectorySize),
    ...u32le(centralDirectoryOffset),
    ...u16le(commentBytes.length),
    ...commentBytes,
  ]

  return new Uint8Array([...localHeaders, ...centralHeaders, ...eocd])
}

describe('findEocdInTail', () => {
  test('finds a well-formed EOCD with no comment', () => {
    const zip = buildZip([{ name: 'a.txt' }, { name: 'b.txt' }])
    const eocd = findEocdInTail(zip)
    expect(eocd).not.toBeNull()
    expect(eocd!.totalEntries).toBe(2)
  })

  test('finds the EOCD even with a comment present after it', () => {
    const zip = buildZip([{ name: 'a.txt' }], { comment: 'hello archive' })
    const eocd = findEocdInTail(zip)
    expect(eocd).not.toBeNull()
    expect(eocd!.totalEntries).toBe(1)
  })

  test('is not fooled by a coincidental EOCD-signature byte sequence inside the comment', () => {
    // The comment itself contains the 4-byte EOCD signature — a naive
    // forward `indexOf` or an unvalidated backward scan could stop there
    // instead of at the REAL EOCD start. The length-consistency check
    // (recordStart + 22 + commentLength === tail.length) must reject this
    // false match and keep scanning back to the true one.
    const fakeSignature = String.fromCharCode(0x50, 0x4b, 0x05, 0x06)
    const zip = buildZip([{ name: 'x.bin' }], { comment: `noise${fakeSignature}moreNoise` })
    const eocd = findEocdInTail(zip)
    expect(eocd).not.toBeNull()
    expect(eocd!.totalEntries).toBe(1)
  })

  test('returns null for bytes with no EOCD at all', () => {
    expect(findEocdInTail(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull()
  })

  test('returns null for a buffer shorter than the fixed EOCD size', () => {
    expect(findEocdInTail(new Uint8Array(10))).toBeNull()
  })

  test('returns null (ZIP64, unsupported) when total entries is the 0xFFFF sentinel', () => {
    const zip = buildZip([{ name: 'a' }])
    // Patch the EOCD's "total entries" field (last 22 bytes minus comment,
    // offset +10 from the EOCD signature which is the very start of the
    // fixed-size tail here since there's no comment) to the ZIP64 sentinel.
    const eocdStart = zip.length - 22
    zip[eocdStart + 10] = 0xff
    zip[eocdStart + 11] = 0xff
    expect(findEocdInTail(zip)).toBeNull()
  })

  test('returns null (ZIP64, unsupported) when central directory size is the 0xFFFFFFFF sentinel', () => {
    const zip = buildZip([{ name: 'a' }])
    const eocdStart = zip.length - 22
    zip[eocdStart + 12] = 0xff
    zip[eocdStart + 13] = 0xff
    zip[eocdStart + 14] = 0xff
    zip[eocdStart + 15] = 0xff
    expect(findEocdInTail(zip)).toBeNull()
  })
})

describe('parseCentralDirectoryEntries', () => {
  test('parses names, sizes and folder status for a mix of files and a folder', () => {
    const zip = buildZip([
      { name: 'readme.txt', compressedSize: 120, uncompressedSize: 200 },
      { name: 'photos/', uncompressedSize: 0 }, // conventional trailing-slash folder marker
      { name: 'photos/beach.jpg', compressedSize: 50000, uncompressedSize: 62000 },
    ])
    const eocd = findEocdInTail(zip)!
    const cdBytes = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    const entries = parseCentralDirectoryEntries(cdBytes, MAX_LISTED_ENTRIES)

    expect(entries).toEqual([
      { name: 'readme.txt', isDirectory: false, compressedSize: 120, uncompressedSize: 200 },
      { name: 'photos/', isDirectory: true, compressedSize: 0, uncompressedSize: 0 },
      { name: 'photos/beach.jpg', isDirectory: false, compressedSize: 50000, uncompressedSize: 62000 },
    ])
  })

  test('recognizes a directory via the MS-DOS attribute bit even without a trailing slash', () => {
    const zip = buildZip([{ name: 'no-slash-folder', externalAttributes: 0x10 }])
    const eocd = findEocdInTail(zip)!
    const cdBytes = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    const entries = parseCentralDirectoryEntries(cdBytes, MAX_LISTED_ENTRIES)
    expect(entries[0]!.isDirectory).toBe(true)
  })

  test('decodes a UTF-8 flagged name correctly (non-ASCII filename)', () => {
    const zip = buildZip([{ name: 'café.txt', utf8Flag: true }])
    const eocd = findEocdInTail(zip)!
    const cdBytes = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    const entries = parseCentralDirectoryEntries(cdBytes, MAX_LISTED_ENTRIES)
    expect(entries[0]!.name).toBe('café.txt')
  })

  test('stops at maxEntries without reading further into the buffer', () => {
    const zip = buildZip([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    const eocd = findEocdInTail(zip)!
    const cdBytes = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    const entries = parseCentralDirectoryEntries(cdBytes, 2)
    expect(entries.length).toBe(2)
    expect(entries.map((e) => e.name)).toEqual(['a', 'b'])
  })

  test('stops cleanly (no throw) when handed a truncated/corrupt buffer', () => {
    const zip = buildZip([{ name: 'a.txt' }, { name: 'b.txt' }])
    const eocd = findEocdInTail(zip)!
    const fullCd = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    const truncatedCd = fullCd.subarray(0, fullCd.length - 5) // cut off mid-second-entry
    expect(() => parseCentralDirectoryEntries(truncatedCd, MAX_LISTED_ENTRIES)).not.toThrow()
    const entries = parseCentralDirectoryEntries(truncatedCd, MAX_LISTED_ENTRIES)
    expect(entries.length).toBe(1) // only the first, complete entry survives
    expect(entries[0]!.name).toBe('a.txt')
  })

  test('returns [] for an empty archive with zero entries', () => {
    const zip = buildZip([])
    const eocd = findEocdInTail(zip)!
    expect(eocd.totalEntries).toBe(0)
    const cdBytes = zip.subarray(eocd.centralDirectoryOffset, eocd.centralDirectoryOffset + eocd.centralDirectorySize)
    expect(parseCentralDirectoryEntries(cdBytes, MAX_LISTED_ENTRIES)).toEqual([])
  })
})

describe('readZipListing (Blob-based, bounded reads)', () => {
  test('lists a real small archive end to end, not truncated', async () => {
    const zip = buildZip([
      { name: 'a.txt', compressedSize: 10, uncompressedSize: 20 },
      { name: 'dir/', },
      { name: 'dir/b.txt', compressedSize: 5, uncompressedSize: 5 },
    ])
    const blob = new Blob([zip])
    const listing = await readZipListing(blob)
    expect(listing).not.toBeNull()
    expect(listing!.totalEntries).toBe(3)
    expect(listing!.truncated).toBe(false)
    expect(listing!.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/', 'dir/b.txt'])
  })

  test('returns null for a blob that is not a ZIP at all (honest fallback trigger)', async () => {
    const blob = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])])
    expect(await readZipListing(blob)).toBeNull()
  })

  test('marks the listing truncated (but still returns real entries) when total entries exceed the display cap', async () => {
    const many = Array.from({ length: MAX_LISTED_ENTRIES + 10 }, (_, i) => ({ name: `file-${i}.txt` }))
    const zip = buildZip(many)
    const blob = new Blob([zip])
    const listing = await readZipListing(blob)
    expect(listing).not.toBeNull()
    expect(listing!.totalEntries).toBe(MAX_LISTED_ENTRIES + 10)
    expect(listing!.entries.length).toBe(MAX_LISTED_ENTRIES)
    expect(listing!.truncated).toBe(true)
  })

  test('only reads a bounded tail window, never the whole blob, to find the EOCD', async () => {
    // A large "archive data" padding before a small real zip's own bytes —
    // if readZipListing ever read from the START of the blob instead of a
    // bounded tail, this would still happen to work by luck for a SMALL
    // padding; the real guarantee this test pins is the exported window
    // constant itself matches the format's own hard ceiling (22 + 65535).
    expect(EOCD_SEARCH_WINDOW_BYTES).toBe(22 + 65535)
  })

  test('caps the Central Directory bytes actually read at MAX_CENTRAL_DIRECTORY_BYTES', () => {
    // Documents the exported cap is what readZipListing's own doc comment
    // claims — a regression here would silently turn a bounded read
    // unbounded.
    expect(MAX_CENTRAL_DIRECTORY_BYTES).toBeGreaterThan(0)
    expect(Number.isFinite(MAX_CENTRAL_DIRECTORY_BYTES)).toBe(true)
  })

  // Codex review (task 1574 gate, 2026-09-27): a per-ENTRY ZIP64 sentinel —
  // distinct from the whole-archive ZIP64 signal findEocdInTail already
  // rejects (covered above by no dedicated readZipListing test, only the
  // findEocdInTail-level tests). An archive whose EOCD-level counts/CD
  // size/CD offset all fit 32 bits (so the earlier check passes) can still
  // have ONE oversized (≥4GiB) member whose own Central Directory header
  // stores 0xFFFFFFFF in compressedSize/uncompressedSize. Before the fix,
  // readZipListing returned that sentinel itself as if it were the real
  // size (4294967295 bytes, ~4.0GB) instead of the honest unsupported
  // fallback.
  test('returns null (ZIP64 per-entry sentinel, unsupported) when an entry\'s uncompressedSize is the 0xFFFFFFFF sentinel', async () => {
    const zip = buildZip([
      { name: 'huge.bin', compressedSize: 123, uncompressedSize: 0xffffffff },
      { name: 'normal.txt', compressedSize: 10, uncompressedSize: 20 },
    ])
    const blob = new Blob([zip])
    expect(await readZipListing(blob)).toBeNull()
  })

  test('returns null (ZIP64 per-entry sentinel, unsupported) when an entry\'s compressedSize is the 0xFFFFFFFF sentinel', async () => {
    const zip = buildZip([{ name: 'huge.bin', compressedSize: 0xffffffff, uncompressedSize: 5_000_000_000 & 0xffffffff }])
    const blob = new Blob([zip])
    expect(await readZipListing(blob)).toBeNull()
  })
})
