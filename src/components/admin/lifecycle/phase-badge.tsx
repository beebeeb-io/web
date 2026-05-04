/**
 * PhaseBadge — color-coded lifecycle phase indicator.
 *
 * Shared by the wizard page header and the infrastructure pool list.
 * Colors per spec: green=active, amber=quiescing/migrating, red=drained, gray=archived/deleted.
 */

import type { LifecyclePhase } from '../../../lib/api'

export const PHASE_LABEL: Record<LifecyclePhase, string> = {
  active: 'Active',
  quiescing: 'Quiescing',
  migrating: 'Migrating',
  drained: 'Drained',
  deleted: 'Deleted',
}

const PHASE_COLORS: Record<
  LifecyclePhase,
  { bg: string; fg: string; border: string }
> = {
  active: {
    bg: 'oklch(0.94 0.06 155)',
    fg: 'oklch(0.45 0.12 155)',
    border: 'oklch(0.85 0.10 155)',
  },
  quiescing: {
    bg: 'var(--color-amber-bg)',
    fg: 'var(--color-amber-deep)',
    border: 'var(--color-amber)',
  },
  migrating: {
    bg: 'var(--color-amber-bg)',
    fg: 'var(--color-amber-deep)',
    border: 'var(--color-amber)',
  },
  drained: {
    bg: 'oklch(0.94 0.04 20)',
    fg: 'oklch(0.50 0.16 20)',
    border: 'oklch(0.85 0.10 20)',
  },
  deleted: {
    bg: 'var(--color-paper-2)',
    fg: 'var(--color-ink-3)',
    border: 'var(--color-line)',
  },
}

interface PhaseBadgeProps {
  phase: LifecyclePhase
  className?: string
}

export function PhaseBadge({ phase, className = '' }: PhaseBadgeProps) {
  const c = PHASE_COLORS[phase]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider ${className}`}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {PHASE_LABEL[phase]}
    </span>
  )
}
