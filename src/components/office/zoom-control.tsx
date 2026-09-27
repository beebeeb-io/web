/**
 * ZoomControl (task 1567) — floating pill, bottom-right of the canvas.
 *
 * Design nit from the brief: the mockup's zoom pill overlaps the status bar
 * at some viewport heights. Fixed here by anchoring it `bottom-[38px]`
 * (status bar height 30px + 8px clearance) INSIDE the canvas area rather than
 * the mockup's `bottom:16px` against the whole frame — the status bar is a
 * sibling flex row below the canvas, not an overlay on top of it, so this is
 * a one-line position fix, not a z-index hack.
 */

import { IconMinus } from './office-icons'
import { Icon } from '@beebeeb/shared'

export interface ZoomControlProps {
  percent: number
  onChange: (percent: number) => void
  min?: number
  max?: number
  step?: number
}

export function ZoomControl({ percent, onChange, min = 50, max = 200, step = 10 }: ZoomControlProps) {
  return (
    <div
      className="absolute bottom-[38px] right-4 z-[3] flex h-[30px] items-center gap-2 rounded-full border border-line bg-paper-2 px-2 font-mono text-[11px] text-ink-3 shadow-2"
      data-testid="office-zoom-control"
    >
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => onChange(Math.max(min, percent - step))}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper-3 text-ink"
      >
        <IconMinus size={10} />
      </button>
      <span className="w-9 text-center tabular-nums">{percent}%</span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => onChange(Math.min(max, percent + step))}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper-3 text-ink"
      >
        <Icon name="plus" size={10} />
      </button>
    </div>
  )
}
