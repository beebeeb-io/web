import { BB_PRODUCT_NAMES, BBProductIcon } from './bb-product-icon'
import type { BBProduct, BBProductTone } from './bb-product-icon'

// The name scales with the icon, but never below the 15px the 24px lockup needs to stay legible.
const NAME_TO_ICON_RATIO = 0.55
const MIN_NAME_SIZE = 15

interface BBProductLockupProps {
  product: BBProduct
  /** Icon edge length in px (default 40); the name scales with it. */
  size?: number
  tone?: BBProductTone
}

export function BBProductLockup({ product, size = 40, tone = 'light' }: BBProductLockupProps) {
  const nameSize = Math.max(Math.round(size * NAME_TO_ICON_RATIO), MIN_NAME_SIZE)
  return (
    <span className="inline-flex items-center gap-3">
      {/* A dark tile on a dark surface needs a hairline to keep its edge; the radius is the tile's 102/512. */}
      <span
        className="inline-flex flex-none"
        style={{
          borderRadius: '20%',
          boxShadow: tone === 'dark' ? '0 0 0 1px var(--color-line-2)' : undefined,
        }}
      >
        <BBProductIcon product={product} size={size} tone={tone} />
      </span>
      <span
        className="font-bold leading-none text-ink"
        style={{ fontSize: nameSize, letterSpacing: '-0.02em' }}
      >
        Beebeeb
        <span className="ml-[0.28em] font-medium text-ink-2">{BB_PRODUCT_NAMES[product]}</span>
      </span>
    </span>
  )
}
