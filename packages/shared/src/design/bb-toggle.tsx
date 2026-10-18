import { useBBDensity, type BBDensity } from './density'

interface BBToggleProps {
  on?: boolean
  onChange?: (on: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}

/**
 * The switch's classes. The button is a transparent hit box whose size never depends on `on`;
 * the colour sits on the inner track (admin kit: "Same size on and off. The colour sits on the
 * inner track, never on the button box").
 *
 * - comfortable (web): a 36 × 20 box, the same pixels as before S1. The knob stays the in-flow
 *   child (it gives the button its text baseline, as before) and the track is a layer behind it.
 * - compact (admin kit): 52 × 36 box around a 36 × 20 track on desktop, 60 × 44 around 44 × 26
 *   below the `md` breakpoint, so the phone hit area is 44 px tall.
 */
export function bbToggleClassNames(on: boolean, disabled: boolean, density: BBDensity = 'comfortable') {
  if (density === 'compact') {
    return {
      nested: true,
      box: 'group inline-flex shrink-0 items-center justify-center h-11 w-[60px] md:h-9 md:w-[52px] cursor-pointer focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
      track: `relative block h-[26px] w-11 md:h-5 md:w-9 rounded-full border transition-[background-color,border-color,box-shadow] group-focus-visible:shadow-[0_0_0_3px_oklch(0.82_0.17_84/0.45)] ${
        on ? 'bg-amber border-[oklch(0.66_0.15_72)]' : 'bg-[oklch(0.92_0.008_82)] border-[oklch(0.82_0.01_80)]'
      }`,
      knob: `absolute top-[2px] left-[2px] size-5 md:size-3.5 rounded-full bg-[oklch(0.995_0.002_85)] shadow-[0_1px_3px_oklch(0.18_0.01_70/0.3)] md:shadow-[0_1px_2px_oklch(0.18_0.01_70/0.3)] transition-transform ${
        on ? 'translate-x-[18px] md:translate-x-4' : 'translate-x-0'
      }`,
    }
  }
  return {
    nested: false,
    box: `relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`,
    track: `absolute -inset-px rounded-full border transition-colors ${
      on ? 'bg-amber border-amber-deep' : 'bg-paper-3 border-line-2'
    }`,
    knob: `relative inline-block h-3.5 w-3.5 rounded-full bg-white shadow-1 transition-transform ${
      on ? 'translate-x-4' : 'translate-x-0.5'
    }`,
  }
}

export function BBToggle({ on = false, onChange, disabled = false, 'aria-label': ariaLabel }: BBToggleProps) {
  const density = useBBDensity()
  const c = bbToggleClassNames(on, disabled, density)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={c.box}
      {...(density === 'compact' ? { 'data-bb': 'toggle' } : {})}
    >
      {c.nested ? (
        <span aria-hidden="true" className={c.track}>
          <span className={c.knob} />
        </span>
      ) : (
        <>
          <span aria-hidden="true" className={c.track} />
          <span className={c.knob} />
        </>
      )}
    </button>
  )
}
