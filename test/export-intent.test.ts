import { describe, expect, test } from 'bun:test'

import {
  PENDING_EXPORT_KEY,
  consumePendingExport,
  dataExportDownloadFilename,
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
  test('a captured export intent is detected, then consumed (cleared)', () => {
    const storage = new MemoryStorage()

    markPendingExport(storage)

    expect(hasPendingExport(storage)).toBe(true)
    expect(consumePendingExport(storage)).toBe(true)
    expect(hasPendingExport(storage)).toBe(false)
  })

  test('an expired (>10min) capture does NOT resume and is evicted (TTL, 0720)', () => {
    const storage = new MemoryStorage()
    // Stamp it 11 minutes ago — past the 10-minute TTL.
    storage.setItem(PENDING_EXPORT_KEY, String(Date.now() - 11 * 60 * 1000))

    expect(hasPendingExport(storage)).toBe(false)
    expect(consumePendingExport(storage)).toBe(false)
    // Stale value evicted so it can never linger.
    expect(storage.getItem(PENDING_EXPORT_KEY)).toBeNull()
  })

  test('a malformed/non-numeric flag is treated as no pending export', () => {
    const storage = new MemoryStorage()
    storage.setItem(PENDING_EXPORT_KEY, 'not-a-timestamp')
    expect(hasPendingExport(storage)).toBe(false)
  })

  test('uses a zip filename for data export downloads', () => {
    const date = new Date('2026-05-12T15:30:00.000Z')

    expect(dataExportDownloadFilename(date)).toBe('beebeeb-export-2026-05-12.zip')
  })
})
