/* ── Presentational primitives (task 0942 restyle) ─────────
   These are layout/markup helpers ONLY — no state, no handlers, no data
   flow. They exist so the billing markup matches the approved mockups
   (#7 summary, #8 change-plan): hairline-bordered cards, uppercase muted
   section labels, and a storage meter that can render a secondary (muted,
   non-accent) add-on bar alongside the amber primary bar.

   Extracted from the page module (task W-P2-2) so the plan card, the usage
   panel and the page draw the SAME card/label/meter instead of copies. */

import { useEffect, useState, type ReactNode } from 'react'

/* ── Animated progress bar ─────────────────────────────── */

export function AnimatedProgress({ percent, className = '' }: { percent: number; className?: string }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(percent, 100)), 80)
    return () => clearTimeout(t)
  }, [percent])

  const barColor =
    percent > 90 ? 'bg-red' :
    percent > 75 ? 'bg-amber' :
    'bg-amber-deep'

  return (
    <div className={`relative h-2 rounded-full bg-paper-3 overflow-hidden ${className}`}>
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${barColor}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

/** A hairline-bordered card matching the mockups' radii + padding. */
export function Card({ children, className = '', 'data-testid': testId }: { children: ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <div className={`border border-line rounded-xl bg-paper ${className}`} data-testid={testId}>{children}</div>
  )
}

/** Uppercase, muted, letter-spaced section label ("CURRENT PLAN", …). */
export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wider text-ink-4 ${className}`}>
      {children}
    </div>
  )
}

/** A static storage meter. `variant="secondary"` renders a muted/desaturated
    fill (the add-on meter in #7) so it reads as a SECONDARY meter, never a
    second accent. The primary variant keeps the amber usage colour cascade. */
export function MeterBar({
  percent,
  variant = 'primary',
  usagePercent,
}: {
  percent: number
  variant?: 'primary' | 'secondary'
  /** For the primary bar, drive the colour cascade off actual usage. */
  usagePercent?: number
}) {
  const up = usagePercent ?? percent
  const fill =
    variant === 'secondary'
      ? 'bg-ink-4'
      : up > 90
        ? 'bg-red'
        : up > 75
          ? 'bg-amber'
          : 'bg-amber-deep'
  return (
    <div className="relative h-2 rounded-full bg-paper-3 overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
        style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
      />
    </div>
  )
}
