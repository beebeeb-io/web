import { describe, expect, test } from 'bun:test'

import {
  DATA_EXPORT_ROUTE,
  PENDING_EXPORT_KEY,
  consumePendingExport,
  dataExportDownloadFilename,
  getPostLoginPath,
  hasPendingExport,
  markPendingExport,
} from '../src/lib/export-intent'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

describe('export intent helpers', () => {
  test('routes the next login back to privacy while preserving the pending export flag', () => {
    const storage = new MemoryStorage()

    markPendingExport(storage)

    expect(getPostLoginPath(storage)).toBe(DATA_EXPORT_ROUTE)
    expect(consumePendingExport(storage)).toBe(true)
    expect(getPostLoginPath(storage)).toBe('/')
  })

  test('an expired (>10min) capture does NOT resume and is evicted (TTL, 0720)', () => {
    const storage = new MemoryStorage()
    // Stamp it 11 minutes ago — past the 10-minute TTL.
    storage.setItem(PENDING_EXPORT_KEY, String(Date.now() - 11 * 60 * 1000))

    expect(hasPendingExport(storage)).toBe(false)
    expect(getPostLoginPath(storage)).toBe('/')
    expect(consumePendingExport(storage)).toBe(false)
    // Stale value evicted so it can never linger.
    expect(storage.getItem(PENDING_EXPORT_KEY)).toBeNull()
  })

  test('a malformed/non-numeric flag is treated as no pending export', () => {
    const storage = new MemoryStorage()
    storage.setItem(PENDING_EXPORT_KEY, 'not-a-timestamp')
    expect(hasPendingExport(storage)).toBe(false)
    expect(getPostLoginPath(storage)).toBe('/')
  })

  test('uses a zip filename for data export downloads', () => {
    const date = new Date('2026-05-12T15:30:00.000Z')

    expect(dataExportDownloadFilename(date)).toBe('beebeeb-export-2026-05-12.zip')
  })
})
