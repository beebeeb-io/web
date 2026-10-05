import { describe, expect, test } from 'bun:test'
import {
  CHUNK_OVERHEAD_BYTES,
  canDeleteVersion,
  versionContentBytes,
  versionDeleteCopy,
} from '../src/lib/version-delete-copy'

/**
 * Task 1809 — deleting a kept version of a file. The confirmation is a promise
 * about permanent data loss AND about storage, so every sentence is pinned, and the
 * byte figure on screen must be the figure the server's quota counts.
 */
describe('versionContentBytes', () => {
  test('a v2 row reports the encrypted total: 28 bytes per chunk are not content', () => {
    // Server: object_versions.size_bytes = encrypted total; quota counts size - chunk_count * 28.
    expect(CHUNK_OVERHEAD_BYTES).toBe(28)
    expect(versionContentBytes({ size_bytes: 300, chunk_count: 1, source: 'object_version' })).toBe(272)
    expect(versionContentBytes({ size_bytes: 3 * 64 + 3 * 28, chunk_count: 3, source: 'object_version' })).toBe(192)
  })

  test('a legacy file_versions row already reports the content size', () => {
    expect(versionContentBytes({ size_bytes: 800, chunk_count: 1, source: 'file_version' })).toBe(800)
  })

  test('a server that sends no source is read as content size (never subtracts on a guess)', () => {
    expect(versionContentBytes({ size_bytes: 800, chunk_count: 2 })).toBe(800)
  })

  test('never negative', () => {
    expect(versionContentBytes({ size_bytes: 10, chunk_count: 5, source: 'object_version' })).toBe(0)
    expect(versionContentBytes({ size_bytes: -5, chunk_count: 0, source: 'file_version' })).toBe(0)
  })
})

describe('canDeleteVersion', () => {
  test('the server flag decides when present', () => {
    expect(canDeleteVersion({ version_number: 1, deletable: true }, 3)).toBe(true)
    expect(canDeleteVersion({ version_number: 3, deletable: false }, 3)).toBe(false)
    // The flag wins even where the numbers would say otherwise (a restored file's current row).
    expect(canDeleteVersion({ version_number: 1, deletable: false }, 3)).toBe(false)
  })

  test('an older server without the flag: everything but the current version', () => {
    expect(canDeleteVersion({ version_number: 2 }, 3)).toBe(true)
    expect(canDeleteVersion({ version_number: 3 }, 3)).toBe(false)
  })
})

describe('versionDeleteCopy', () => {
  test('a plan-less account is told the space comes back, and that it cannot be recovered', () => {
    const c = versionDeleteCopy({ versionNumber: 2, contentBytes: 12_000_000, countsTowardQuota: true })
    expect(c.title).toBe('Delete version 2?')
    expect(c.body).toBe(
      "This removes version 2 (12 MB) for good and gives that space back to your storage. We can't recover it. The current version of the file is not affected.",
    )
    expect(c.confirmLabel).toBe('Delete version')
    expect(c.doneTitle).toBe('Version 2 deleted')
  })

  test('a paying account is NOT promised storage back: its versions are not counted', () => {
    const c = versionDeleteCopy({ versionNumber: 5, contentBytes: 4_000, countsTowardQuota: false })
    expect(c.body).toBe(
      "This removes version 5 (4 KB) for good. We can't recover it. Versions are not counted against your plan's storage, so your storage total will not change. The current version of the file is not affected.",
    )
    expect(c.body).not.toContain('gives that space back')
  })

  test('house voice: no reassurance words, no emoji, no hedging', () => {
    for (const counts of [true, false]) {
      const { title, body, confirmLabel } = versionDeleteCopy({ versionNumber: 1, contentBytes: 1, countsTowardQuota: counts })
      const all = `${title} ${body} ${confirmLabel}`
      expect(all).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      expect(all).not.toMatch(/\b(safe|safely|oops|sorry|just|simply|bank-grade)\b/i)
      expect(all).toContain("We can't recover it")
    }
  })
})
