import type { ButtonHTMLAttributes } from 'react'
import { useBBDensity, type BBDensity } from './density'

/**
 * Variants (admin "Component kit", design/admin-redesign-2026-10/Kit-Desktop.dc.html):
 * - `primary`: amber. One per page; amber marks primary actions and encryption state only.
 * - `secondary`: neutral, bordered.
 * - `ghost`: no box until hover.
 * - `danger`: a destructive action that OPENS a confirm step (outlined red in compact).
 * - `danger-solid`: the filled red button. Only inside that confirm step.
 * `amber` and `default` are the older names of `primary` and `secondary`.
 */
export type BBButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'amber' | 'default'

/**
 * Sizes. In compact density: `sm` 28 px, `md` 34 px, `touch` 44 px tall, and every size is
 * 44 × 44 px below the `md` breakpoint. `lg` is the web app's large button; compact renders it
 * as `touch`.
 */
export type BBButtonSize = 'sm' | 'md' | 'touch' | 'lg'

type CanonicalVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

export function canonicalButtonVariant(variant: BBButtonVariant): CanonicalVariant {
  if (variant === 'amber') return 'primary'
  if (variant === 'default') return 'secondary'
  return variant
}

// ─── comfortable (web) ───────────────────────────────────────────────────────
// These strings are the web app's buttons as they were before S1; keep them byte-identical
// (bb-button.test.tsx pins them).
const COMFORTABLE_BASE =
  'inline-flex items-center justify-center font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-deep focus-visible:ring-offset-2'

const COMFORTABLE_VARIANT: Record<CanonicalVariant, string> = {
  primary: 'bg-amber text-[oklch(0.22_0.01_70)] hover:brightness-95 active:brightness-90',
  secondary: 'bg-paper text-ink border border-line hover:bg-paper-2 active:bg-paper-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-paper-2 active:bg-paper-3',
  danger: 'bg-red text-white hover:brightness-95 active:brightness-90',
  'danger-solid': 'bg-red text-white hover:brightness-95 active:brightness-90',
}

const COMFORTABLE_SIZE: Record<BBButtonSize, string> = {
  sm: 'px-sm py-xs text-sm rounded-sm',
  md: 'px-md py-sm text-sm rounded-md',
  lg: 'px-lg py-md text-base rounded-lg',
  touch: 'min-h-11 px-lg py-sm text-base rounded-lg',
}

// ─── compact (admin kit) ─────────────────────────────────────────────────────
// Phone first (every size 44 × 44, 14 px type), `md:` is the desktop size from the kit.
// Colours without a token are the kit's literal values.
const COMPACT_BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap leading-none border transition-[background-color,border-color,color,box-shadow,filter] cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_oklch(0.82_0.17_84/0.45)]'

const COMPACT_DISABLED_BOX =
  'disabled:bg-[oklch(0.975_0.005_85)] disabled:border-line disabled:text-[oklch(0.50_0.01_78)]'

const COMPACT_VARIANT: Record<CanonicalVariant, string> = {
  primary: `bg-amber border-[oklch(0.72_0.16_80)] text-[oklch(0.20_0.02_70)] font-semibold enabled:hover:brightness-95 enabled:active:brightness-90 ${COMPACT_DISABLED_BOX}`,
  secondary: `bg-[oklch(0.995_0.002_85)] border-line-2 text-ink font-medium enabled:hover:bg-paper-2 enabled:active:bg-paper-3 ${COMPACT_DISABLED_BOX}`,
  ghost:
    'bg-transparent border-transparent text-[oklch(0.30_0.01_72)] font-medium enabled:hover:bg-paper-2 enabled:hover:border-line enabled:active:bg-paper-3 disabled:text-[oklch(0.50_0.01_78)]',
  danger: `bg-[oklch(0.995_0.002_85)] border-red-border text-[oklch(0.50_0.18_25)] font-medium enabled:hover:bg-red-bg enabled:active:brightness-95 ${COMPACT_DISABLED_BOX}`,
  'danger-solid': `bg-[oklch(0.52_0.19_25)] border-[oklch(0.52_0.19_25)] text-[oklch(0.99_0.003_85)] font-semibold enabled:hover:brightness-95 enabled:active:brightness-90 ${COMPACT_DISABLED_BOX}`,
}

const COMPACT_TOUCH = 'min-h-11 min-w-11 px-4 text-[14px] rounded-lg'

const COMPACT_SIZE: Record<BBButtonSize, string> = {
  sm: 'min-h-11 min-w-11 px-3.5 text-[14px] rounded-lg md:min-h-7 md:min-w-0 md:px-2.5 md:text-[12.5px] md:rounded-md',
  md: 'min-h-11 min-w-11 px-3.5 text-[14px] rounded-lg md:min-h-[34px] md:min-w-0 md:text-[13px] md:rounded-[8px]',
  touch: COMPACT_TOUCH,
  lg: COMPACT_TOUCH,
}

/** The classes BBButton renders, without the caller's `className`. Also for `<a>`/`<Link>` that must look like a button. */
export function bbButtonClassName(
  variant: BBButtonVariant = 'secondary',
  size: BBButtonSize = 'md',
  density: BBDensity = 'comfortable',
): string {
  const v = canonicalButtonVariant(variant)
  if (density === 'compact') return `${COMPACT_BASE} ${COMPACT_VARIANT[v]} ${COMPACT_SIZE[size]}`
  return `${COMFORTABLE_BASE} ${COMFORTABLE_VARIANT[v]} ${COMFORTABLE_SIZE[size]}`
}

interface BBButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BBButtonVariant
  size?: BBButtonSize
}

export function BBButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: BBButtonProps) {
  const density = useBBDensity()
  // Compact marks its own controls so the admin stylesheet can leave them alone.
  const marker =
    density === 'compact'
      ? { 'data-bb': 'button', 'data-variant': canonicalButtonVariant(variant), 'data-size': size === 'lg' ? 'touch' : size }
      : {}
  return (
    <button className={`${bbButtonClassName(variant, size, density)} ${className}`} {...marker} {...props}>
      {children}
    </button>
  )
}
