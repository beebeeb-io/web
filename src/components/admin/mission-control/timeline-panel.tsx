/**
 * Timeline panel — chronological list of phase transitions + error milestones.
 * Sidebar component in the Mission Control monitor.
 */

import type { RunProgress } from '../../../lib/api'

interface TimelineEvent {
  ts: string
  label: string
  kind: 'phase' | 'error' | 'info'
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function EventDot({ kind }: { kind: TimelineEvent['kind'] }) {
  const colors: Record<TimelineEvent['kind'], string> = {
    phase: 'var(--color-amber)',
    error: 'var(--color-red)',
    info:  'var(--color-ink-3)',
  }
  return (
    <span
      className="mt-0.5 w-2 h-2 rounded-full shrink-0"
      style={{ background: colors[kind] }}
    />
  )
}

interface TimelinePanelProps {
  progress: RunProgress | null
}

export function TimelinePanel({ progress }: TimelinePanelProps) {
  if (!progress) {
    return (
      <div className="rounded-lg border border-line bg-paper overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <span className="text-[12px] font-semibold text-ink">Timeline</span>
        </div>
        <div className="px-4 py-5 text-center">
          <p className="text-[11px] text-ink-4">Loading…</p>
        </div>
      </div>
    )
  }

  const run = progress.run
  const events: TimelineEvent[] = []

  // Phase transitions derived from run data
  events.push({
    ts: run.started_at,
    label: 'Run started — pool quiescing',
    kind: 'phase',
  })

  // If we're past quiescing, we're in migrating
  if (run.current_phase === 'migrating' || run.current_phase === 'drained') {
    events.push({
      ts: run.started_at, // best proxy without dedicated phase-start timestamps
      label: 'Migration started',
      kind: 'phase',
    })
  }

  if (progress.files_failed > 0) {
    events.push({
      ts: new Date().toISOString(),
      label: `${progress.files_failed} file${progress.files_failed !== 1 ? 's' : ''} failed — retrying`,
      kind: 'error',
    })
  }

  if (progress.files_migrated > 0) {
    events.push({
      ts: new Date().toISOString(),
      label: `${progress.files_migrated.toLocaleString()} files migrated so far`,
      kind: 'info',
    })
  }

  if (run.current_phase === 'drained') {
    events.push({
      ts: run.terminated_at ?? new Date().toISOString(),
      label: 'Pool drained — all files migrated',
      kind: 'phase',
    })
  }

  if (run.outcome !== 'in_progress') {
    const labels: Record<string, string> = {
      aborted:          'Run aborted',
      reverse_migrated: 'Reverse migration started',
      archived:         'Pool archived',
      completed_deleted: 'Pool deleted',
    }
    if (run.terminated_at) {
      events.push({
        ts: run.terminated_at,
        label: labels[run.outcome] ?? `Outcome: ${run.outcome}`,
        kind: 'phase',
      })
    }
  }

  return (
    <div className="rounded-lg border border-line bg-paper overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <span className="text-[12px] font-semibold text-ink flex-1">Timeline</span>
        <span className="font-mono text-[10px] text-ink-4">{events.length} events</span>
      </div>
      <div className="px-4 py-3 space-y-3 max-h-[360px] overflow-y-auto">
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <EventDot kind={ev.kind} />
            <div className="min-w-0">
              <p className="text-[11px] text-ink leading-snug">{ev.label}</p>
              <p className="font-mono text-[10px] text-ink-4 mt-0.5">{formatTs(ev.ts)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
