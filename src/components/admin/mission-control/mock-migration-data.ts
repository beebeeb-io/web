/**
 * Mock migration data for developing the Mission Control file log components
 * without a live server WebSocket. Two parallel datasets are exported:
 *
 *  - `mockMigrationEvents` — a chronological event stream as it would arrive
 *    on the WebSocket. Mix per the brief: 20 done, 3 failed, 2 in-flight
 *    copying (started but not yet completed), 5 pending (no events emitted
 *    yet — they show up as a snapshot count, not in the stream).
 *  - `mockMigrationFiles` — the same set of files as the table view sees
 *    them, including the 5 pending rows that have no events yet.
 */

import type { MigrationFileEntry, MigrationFileEvent } from './types'

const TARGET_POOL = 'pool-eu-002'

/** Stable RNG so the mock is deterministic across reloads. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const rand = seededRandom(20260504)

function uuidLike(prefix: number): string {
  // Roughly UUID-shaped — 8-4-4-4-12 hex. Doesn't need to be RFC-valid.
  const hex = (n: number, len: number) =>
    Math.floor(n * 16 ** len)
      .toString(16)
      .padStart(len, '0')
  return [
    hex(rand(), 8),
    hex(rand(), 4),
    hex(rand(), 4),
    hex(rand(), 4),
    `${prefix.toString(16).padStart(4, '0')}${hex(rand(), 8)}`,
  ].join('-')
}

const SAMPLE_ERRORS = [
  'chunk hash mismatch on chunk 12 — verifying',
  'target pool returned 503 (storage backend unavailable)',
  'connection reset while streaming chunk 7/40',
]

interface MockFile {
  id: string
  size: number
  bucket: 'done' | 'failed' | 'copying' | 'pending'
}

function buildFiles(): MockFile[] {
  const files: MockFile[] = []
  const sizes = [
    524_288, 1_048_576, 4_194_304, 12_582_912, 33_554_432,
    67_108_864, 134_217_728, 268_435_456,
  ]
  for (let i = 0; i < 30; i++) {
    let bucket: MockFile['bucket']
    if (i < 20) bucket = 'done'
    else if (i < 23) bucket = 'failed'
    else if (i < 25) bucket = 'copying'
    else bucket = 'pending'
    files.push({
      id: uuidLike(i + 1),
      size: sizes[Math.floor(rand() * sizes.length)],
      bucket,
    })
  }
  return files
}

const FILES = buildFiles()

// Anchor mock timeline ~10 minutes ago so timestamps look "recent".
const NOW = Date.now()
const START = NOW - 10 * 60_000

function isoAt(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString()
}

function buildEvents(): MigrationFileEvent[] {
  const events: MigrationFileEvent[] = []
  let cursor = 0

  for (const f of FILES) {
    if (f.bucket === 'pending') continue

    // file_started at cursor
    events.push({
      type: 'file_started',
      file_id: f.id,
      size_bytes: f.size,
      chunks: Math.max(1, Math.ceil(f.size / 4_194_304)),
      at: isoAt(cursor),
    })
    cursor += 200 + Math.floor(rand() * 800)

    if (f.bucket === 'done') {
      const duration = 800 + Math.floor(rand() * 6_000)
      events.push({
        type: 'file_done',
        file_id: f.id,
        bytes_copied: f.size,
        duration_ms: duration,
        at: isoAt(cursor),
      })
      cursor += 100 + Math.floor(rand() * 400)
    } else if (f.bucket === 'failed') {
      events.push({
        type: 'file_failed',
        file_id: f.id,
        error: SAMPLE_ERRORS[Math.floor(rand() * SAMPLE_ERRORS.length)],
        at: isoAt(cursor),
      })
      cursor += 100 + Math.floor(rand() * 400)
    } else {
      // copying — emit a progress event partway through, no terminal event
      const chunks = Math.max(1, Math.ceil(f.size / 4_194_304))
      const chunksCopied = Math.max(1, Math.floor(chunks * (0.3 + rand() * 0.5)))
      events.push({
        type: 'file_progress',
        file_id: f.id,
        chunks_copied: chunksCopied,
        bytes_copied: Math.floor(f.size * (chunksCopied / chunks)),
        at: isoAt(cursor),
      })
      cursor += 100 + Math.floor(rand() * 400)
    }
  }

  return events
}

function buildFileEntries(): MigrationFileEntry[] {
  return FILES.map((f, i) => {
    const startedOffset = i * 700
    const startedAt = f.bucket === 'pending' ? null : isoAt(startedOffset)
    const completedAt =
      f.bucket === 'done' || f.bucket === 'failed'
        ? isoAt(startedOffset + 1500 + Math.floor(rand() * 4000))
        : null
    let bytesCopied = 0
    if (f.bucket === 'done') bytesCopied = f.size
    else if (f.bucket === 'copying') bytesCopied = Math.floor(f.size * (0.3 + rand() * 0.5))
    const error =
      f.bucket === 'failed'
        ? SAMPLE_ERRORS[i % SAMPLE_ERRORS.length]
        : null

    const status: MigrationFileEntry['status'] =
      f.bucket === 'done'
        ? 'done'
        : f.bucket === 'failed'
        ? 'failed'
        : f.bucket === 'copying'
        ? 'copying'
        : 'pending'

    return {
      file_id: f.id,
      status,
      size_bytes: f.size,
      started_at: startedAt,
      completed_at: completedAt,
      error,
      bytes_copied: bytesCopied,
    }
  })
}

export const mockTargetPoolName = TARGET_POOL

/** Chronological event stream — ~50 entries (file_started + terminal/progress per file). */
export const mockMigrationEvents: MigrationFileEvent[] = buildEvents()

/** Snapshot of file_migrations rows, including pending files. */
export const mockMigrationFiles: MigrationFileEntry[] = buildFileEntries()
