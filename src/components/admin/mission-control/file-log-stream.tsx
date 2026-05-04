/**
 * Terminal-style streaming file log for active migrations.
 *
 * Renders WebSocket events one line at a time in JetBrains Mono on a dark
 * background. New lines append at the bottom; with `autoScroll` on the
 * container scrolls to keep the newest event visible. Toggling the pause
 * button preserves the current scroll position so an operator can inspect
 * earlier events without fighting the auto-scroll.
 *
 * Each row is a CSS grid so every column has a guaranteed fixed width:
 *   TIME(8ch) · STATUS(7ch) · FILE_ID(9ch) · SIZE(8ch↔) · DUR(6ch↔) · REST
 * Numeric columns are right-aligned with tabular-nums. The REST column uses
 * a nested flex row for the optional target arrow + error message.
 */

import { useEffect, useRef } from 'react'
import { formatBytes } from '../../../lib/format'
import { Icon } from '../../icons'
import type { MigrationFileEvent, MigrationFileEventType } from './types'

interface FileLogStreamProps {
  events: MigrationFileEvent[]
  autoScroll: boolean
  onToggleAutoScroll: () => void
  /** Optional target pool label rendered after the arrow on each line. */
  targetPoolName?: string
}

type LineStatus = 'copying' | 'done' | 'failed' | 'pending'

const STATUS_COLOR: Record<LineStatus, string> = {
  done:    '#4ade80',
  failed:  '#f87171',
  copying: '#fbbf24',
  pending: '#9ca3af',
}

const STATUS_LABEL: Record<LineStatus, string> = {
  done:    'DONE',
  failed:  'FAIL',
  copying: 'COPY',
  pending: 'WAIT',
}

// Grid column template — every row uses this so columns line up across rows.
// ch units are relative to the "0" glyph of the current font (JetBrains Mono
// 11.5 px ≈ 6.9 px / char).
//   8ch  = HH:MM:SS timestamp
//   7ch  = ● DONE  status badge (bullet + space + 4-char label)
//   9ch  = 8-char hex file ID prefix
//   8ch  = right-aligned size  (up to "999.9 MB")
//   6ch  = right-aligned duration (up to "99m59s")
//   1fr  = target arrow + error message (fills remaining width)
const ROW_GRID = '8ch 7ch 9ch 8ch 6ch 1fr'

function statusFromEvent(type: MigrationFileEventType): LineStatus {
  switch (type) {
    case 'file_started':
    case 'file_progress':
      return 'copying'
    case 'file_done':
      return 'done'
    case 'file_failed':
      return 'failed'
  }
}

function formatClockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  return `${m}m${String(rem).padStart(2, '0')}s`
}

function eventSize(ev: MigrationFileEvent): number | undefined {
  if (ev.size_bytes !== undefined) return ev.size_bytes
  if (ev.bytes_copied !== undefined) return ev.bytes_copied
  return undefined
}

export function FileLogStream({
  events,
  autoScroll,
  onToggleAutoScroll,
  targetPoolName,
}: FileLogStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events, autoScroll])

  return (
    <div className="relative rounded-lg border border-line overflow-hidden bg-[#0c0d10] shadow-1">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f2229] bg-[#0a0b0e]">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }}
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#9ca3af]">
          migration.log
        </span>
        <span className="font-mono text-[10px] text-[#6b7280] ml-1">
          {events.length.toLocaleString()} {events.length === 1 ? 'event' : 'events'}
        </span>
        <button
          type="button"
          onClick={onToggleAutoScroll}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-[#1f2229] bg-[#14161b] hover:bg-[#1a1d23] text-[10px] font-mono uppercase tracking-wider text-[#cbd5e1] transition-colors"
          aria-pressed={autoScroll}
          title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
        >
          <Icon name={autoScroll ? 'pause' : 'play'} size={10} />
          {autoScroll ? 'Pause' : 'Resume'}
        </button>
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        className="font-mono text-[11.5px] leading-[1.6] text-[#cbd5e1] px-3 py-2 overflow-y-auto"
        style={{ maxHeight: 480 }}
      >
        {events.length === 0 ? (
          <div className="text-[#6b7280] text-[11px] py-6 text-center">
            Waiting for events…
          </div>
        ) : (
          events.map((ev, i) => {
            const status   = statusFromEvent(ev.type)
            const color    = STATUS_COLOR[status]
            const size     = eventSize(ev)
            const duration = ev.duration_ms

            return (
              <div
                key={`${ev.file_id}-${ev.type}-${ev.at}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: ROW_GRID,
                  columnGap: '0.75ch',
                  alignItems: 'baseline',
                  whiteSpace: 'nowrap',
                }}
              >
                {/* HH:MM:SS */}
                <span style={{ color: '#6b7280' }} className="tabular-nums">
                  {formatClockTime(ev.at)}
                </span>

                {/* ● STATUS — bullet + 4-char label in one fixed cell */}
                <span style={{ color, fontWeight: 500 }} aria-label={status}>
                  ● {STATUS_LABEL[status]}
                </span>

                {/* File ID prefix (8 hex chars) */}
                <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ev.file_id.slice(0, 8)}
                </span>

                {/* Size — right-aligned */}
                <span
                  style={{ color: '#94a3b8', textAlign: 'right' }}
                  className="tabular-nums"
                >
                  {size !== undefined ? formatBytes(size) : '—'}
                </span>

                {/* Duration — right-aligned */}
                <span
                  style={{ color: '#94a3b8', textAlign: 'right' }}
                  className="tabular-nums"
                >
                  {formatDurationMs(duration)}
                </span>

                {/* REST: optional target arrow + optional error message */}
                <span style={{ display: 'flex', columnGap: '1ch', overflow: 'hidden', minWidth: 0 }}>
                  {targetPoolName && (
                    <span style={{ color: '#64748b', flexShrink: 0 }}>
                      → {targetPoolName}
                    </span>
                  )}
                  {ev.error && (
                    <span
                      style={{
                        color: '#fca5a5',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {ev.error}
                    </span>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Footer — visible only when paused */}
      {!autoScroll && events.length > 0 && (
        <button
          type="button"
          onClick={onToggleAutoScroll}
          className="absolute bottom-2 right-3 px-2.5 py-1 rounded-sm bg-amber text-[oklch(0.22_0.01_70)] text-[10px] font-mono font-semibold uppercase tracking-wider shadow-1 hover:brightness-95 transition-all"
        >
          Resume stream
        </button>
      )}
    </div>
  )
}
