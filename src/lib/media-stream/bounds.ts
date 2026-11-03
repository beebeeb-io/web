/**
 * LD-0001 PR-A: the streaming bounds, exactly as contract §3.
 *
 * S is the file's plaintext chunk size (chunk 0's wire size − 28). The web's
 * own upload ladder caps a chunk at 32 MiB; anything larger is not
 * streaming-eligible (PR-B's decision table), but the arithmetic stays defined.
 */

const MiB = 1024 * 1024

/** The largest chunk the web ladder writes (contract §1.1/§3). */
export const MAX_STREAM_CHUNK_BYTES = 32 * MiB

/** Wire overhead per frame: 12-byte nonce + 16-byte GCM tag. */
export const CHUNK_OVERHEAD = 28

export interface StreamBounds {
  /** Plaintext budget for cached + in-window chunks. */
  budgetBytes: number
  /** Chunks to fetch ahead of the latest pull. */
  readAhead: number
  /** Concurrent chunk fetches. */
  concurrency: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * §3: `B = max(64 MiB, 3·S)`, `R = clamp(floor(B/S) − 2, 1, 8)`,
 * concurrency `= clamp(floor(32 MiB / S), 1, 4)`.
 */
export function streamBounds(chunkSize: number): StreamBounds {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`invalid chunk size ${chunkSize}`)
  }
  const budgetBytes = Math.max(64 * MiB, 3 * chunkSize)
  const readAhead = clamp(Math.floor(budgetBytes / chunkSize) - 2, 1, 8)
  const concurrency = clamp(Math.floor((32 * MiB) / chunkSize), 1, 4)
  return { budgetBytes, readAhead, concurrency }
}

export interface ChunkLocation {
  /** Chunk index the offset falls in. */
  index: number
  /** Byte offset inside that chunk's plaintext. */
  offsetInChunk: number
  /** Plaintext bytes available from that offset to the end of the chunk. */
  available: number
}

/**
 * Map a plaintext byte offset to its chunk. The last chunk may be shorter than
 * S; the mapping never returns a location that crosses a chunk boundary.
 */
export function chunkForOffset(
  offset: number,
  chunkSize: number,
  chunkCount: number,
  totalSize: number,
): ChunkLocation {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`invalid stream offset ${offset}`)
  }
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`invalid chunk size ${chunkSize}`)
  }
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new RangeError(`invalid chunk count ${chunkCount}`)
  }
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    throw new RangeError(`invalid stream size ${totalSize}`)
  }
  if (offset >= totalSize) {
    throw new RangeError(`offset ${offset} is past the end of a ${totalSize}-byte stream`)
  }
  const index = Math.floor(offset / chunkSize)
  if (index >= chunkCount) {
    throw new RangeError(`offset ${offset} falls past chunk ${chunkCount - 1}`)
  }
  const chunkStart = index * chunkSize
  const chunkLength = Math.min(chunkSize, totalSize - chunkStart)
  const offsetInChunk = offset - chunkStart
  return { index, offsetInChunk, available: chunkLength - offsetInChunk }
}
