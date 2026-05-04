import type { ThroughputSample } from './throughput-chart'

/**
 * Mock data for local development of Mission Control. Generates 60 throughput
 * samples (one per second over the last minute), 3 error timestamps scattered
 * inside the window, and 2 phase transition markers near the start.
 *
 * Anchored to a fixed pseudo-`now` so re-renders during dev don't shift the
 * window by a few hundred ms each frame and cause visual jitter. Pass an
 * explicit `now` to override.
 */

export interface MockThroughputData {
  samples: ThroughputSample[]
  errors: { at: string; file_id: string }[]
  phases: { from: string; to: string; at: string }[]
  startedAt: string
  endedAt: string
  totalFiles: number
  filesDone: number
}

const DEFAULT_SECONDS = 60

export function generateMockThroughput(
  now: Date = new Date(),
  durationSeconds: number = DEFAULT_SECONDS,
): MockThroughputData {
  const endMs = now.getTime()
  const startMs = endMs - durationSeconds * 1000

  // ─── Samples ──────────────────────────────────────────────────────────
  // Realistic throughput: oscillating around 150 MB/s (1.5e8 B/s) with
  // periodic dips (errors cause throughput to drop). Files/sec scales
  // loosely with bytes — assume ~3 MB average file.
  const samples: ThroughputSample[] = []
  for (let i = 0; i < durationSeconds; i++) {
    const t = startMs + i * 1000
    // Slow sine for the baseline, faster sine for noise, random jitter.
    const baseMbps =
      150 +
      30 * Math.sin(i / 8) +
      10 * Math.sin(i / 2.3) +
      (Math.random() - 0.5) * 8
    // Three dips simulating brief stalls — these correspond to error events.
    const dipFactor =
      i === 18 || i === 19 || i === 20
        ? 0.25
        : i === 35 || i === 36
          ? 0.4
          : i === 50
            ? 0.5
            : 1
    const mbps = Math.max(20, baseMbps * dipFactor)
    const bytes_per_sec = mbps * 1_000_000
    const files_per_sec = bytes_per_sec / (3 * 1_000_000) // ~3 MB avg file
    samples.push({
      bytes_per_sec,
      files_per_sec,
      at: new Date(t).toISOString(),
    })
  }

  // ─── Errors ───────────────────────────────────────────────────────────
  // Aligned with the dips above so the markers match the visual story.
  const errors = [
    {
      at: new Date(startMs + 19 * 1000).toISOString(),
      file_id: 'file_3a7c91',
    },
    {
      at: new Date(startMs + 36 * 1000).toISOString(),
      file_id: 'file_b218d4',
    },
    {
      at: new Date(startMs + 50 * 1000).toISOString(),
      file_id: 'file_e0f5a2',
    },
  ]

  // ─── Phase transitions ────────────────────────────────────────────────
  const phases = [
    {
      from: 'quiescing',
      to: 'migrating',
      at: new Date(startMs + 5 * 1000).toISOString(),
    },
    {
      from: 'migrating',
      to: 'verifying',
      at: new Date(startMs + 45 * 1000).toISOString(),
    },
  ]

  return {
    samples,
    errors,
    phases,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    totalFiles: 22000,
    filesDone: 14832,
  }
}

/** A frozen snapshot for tests / static stories. */
export const MOCK_THROUGHPUT = generateMockThroughput(
  new Date('2026-05-04T12:00:00Z'),
)
