/**
 * LD-0001 PR-C — exact progress copy (§7) and the whole-file media cap (§4 row 5).
 */
import { describe, expect, test } from 'bun:test'
import { progressCopy } from '../src/lib/transfer-progress-copy'
import { isWholeFileMediaOverCap } from '../src/lib/preview-load-policy'

describe('progress copy', () => {
  test('progress_copy_strings_exact', () => {
    // 12.4 MB and 48.0 MB at 1024².
    const received = 13_002_342
    const total = 50_331_648
    expect(
      progressCopy({ phase: 'downloading', receivedBytes: received, totalBytes: total, decryptedChunks: 2, totalChunks: 12 }),
    ).toBe('Downloading 12.4 of 48.0 MB · 2 of 12 parts decrypted')
    expect(
      progressCopy({ phase: 'downloading', receivedBytes: received, totalBytes: total, decryptedChunks: 0, totalChunks: 12 }),
    ).toBe('Downloading 12.4 of 48.0 MB')
    expect(
      progressCopy({ phase: 'downloading', receivedBytes: received, totalBytes: null, decryptedChunks: 0, totalChunks: 12 }),
    ).toBe('Downloading 12.4 MB')
    expect(
      progressCopy({ phase: 'decrypting', receivedBytes: total, totalBytes: total, decryptedChunks: 10, totalChunks: 12 }),
    ).toBe('Decrypting part 11 of 12')
  })
})

describe('whole-file media cap (row 5)', () => {
  test('whole_file_media_over_cap_shows_download_card', () => {
    const cap = 2 * 1024 ** 3
    expect(isWholeFileMediaOverCap('video/mp4', 'clip.mp4', cap + 1)).toBe(true)
    expect(isWholeFileMediaOverCap('video/mp4', 'clip.mp4', cap)).toBe(false)
    expect(isWholeFileMediaOverCap('application/pdf', 'big.pdf', cap + 1)).toBe(false)
    expect(isWholeFileMediaOverCap('audio/mpeg', 'song.mp3', cap + 1)).toBe(true)
  })
})
