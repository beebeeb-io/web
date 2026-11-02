/**
 * LD-0001 PR-A: §3 bounds and §5.3 offset → chunk mapping.
 * Contract: docs/specs/2026-10-30-ld-0001-web-media-streaming-contract.md §3, §10 T5.
 */
import { describe, expect, test } from 'bun:test'
import { chunkForOffset, streamBounds } from '../src/lib/media-stream/bounds'

const MiB = 1024 * 1024

describe('LD-0001 stream bounds', () => {
  test('range_maps_to_chunk_and_offset', () => {
    // 100-byte chunks, 3 chunks, last one 50 bytes.
    expect(chunkForOffset(0, 100, 3, 250)).toEqual({ index: 0, offsetInChunk: 0, available: 100 })
    expect(chunkForOffset(99, 100, 3, 250)).toEqual({ index: 0, offsetInChunk: 99, available: 1 })
    expect(chunkForOffset(100, 100, 3, 250)).toEqual({ index: 1, offsetInChunk: 0, available: 100 })
    expect(chunkForOffset(199, 100, 3, 250)).toEqual({ index: 1, offsetInChunk: 99, available: 1 })
    expect(chunkForOffset(200, 100, 3, 250)).toEqual({ index: 2, offsetInChunk: 0, available: 50 })
    expect(chunkForOffset(249, 100, 3, 250)).toEqual({ index: 2, offsetInChunk: 49, available: 1 })

    // A file whose size is an exact multiple of the chunk size: the last chunk is full.
    expect(chunkForOffset(200, 100, 3, 300)).toEqual({ index: 2, offsetInChunk: 0, available: 100 })

    expect(() => chunkForOffset(-1, 100, 3, 250)).toThrow(RangeError)
    expect(() => chunkForOffset(250, 100, 3, 250)).toThrow(RangeError)
    expect(() => chunkForOffset(0, 0, 3, 250)).toThrow(RangeError)
  })

  test('stream_bounds_match_the_contract_table', () => {
    expect(streamBounds(4 * MiB)).toEqual({ budgetBytes: 64 * MiB, readAhead: 8, concurrency: 4 })
    expect(streamBounds(8 * MiB)).toEqual({ budgetBytes: 64 * MiB, readAhead: 6, concurrency: 4 })
    expect(streamBounds(16 * MiB)).toEqual({ budgetBytes: 64 * MiB, readAhead: 2, concurrency: 2 })
    expect(streamBounds(32 * MiB)).toEqual({ budgetBytes: 96 * MiB, readAhead: 1, concurrency: 1 })
    // Larger chunks are not streaming-eligible, but the formula stays defined.
    expect(streamBounds(128 * MiB)).toEqual({ budgetBytes: 384 * MiB, readAhead: 1, concurrency: 1 })
  })
})
