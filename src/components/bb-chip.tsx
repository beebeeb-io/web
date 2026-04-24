import type { ReactNode } from 'react'

type Variant = 'default' | 'amber' | 'green'

interface BBChipProps {
  variant?: Variant
  children: ReactNode
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-paper-2 text-ink-2 border border-line',
  amber: 'bg-amber-bg text-amber-deep',
  green: 'bg-green/10 text-green',
}

export function BBChip({ variant = 'default', children }: BBChipProps) {
  return (
    <span
      className={`inline-flex items-center px-sm py-xs text-xs font-medium rounded-sm ${variantClasses[variant]}`}
    >
      {children}
    </span>
  )
}
