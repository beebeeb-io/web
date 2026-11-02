// Design-sync preview of BBProductIcon for the Claude Design project.
import { BBProductIcon } from '@beebeeb/shared'
import type { BBProduct } from '@beebeeb/shared'

const PRODUCTS: { product: BBProduct; name: string }[] = [
  { product: 'drive', name: 'Drive' },
  { product: 'pass', name: 'Pass' },
  { product: 'vpn', name: 'VPN' },
  { product: 'mail', name: 'Mail' },
  { product: 'chat', name: 'Chat' },
]

const SIZES = [96, 40, 29] as const

export const AllProducts = () => (
  <div className="flex gap-6 bg-paper p-4">
    {PRODUCTS.map(({ product, name }) => (
      <div key={product} className="flex flex-col items-center gap-2">
        <BBProductIcon product={product} size={96} title={name} />
        <span className="text-sm text-ink">{name}</span>
      </div>
    ))}
  </div>
)

export const AllProductsOnDark = () => (
  <div className="dark flex gap-6 bg-paper p-4">
    {PRODUCTS.map(({ product, name }) => (
      <div key={product} className="flex flex-col items-center gap-2">
        <BBProductIcon product={product} size={96} tone="dark" title={name} />
        <span className="text-sm text-ink">{name}</span>
      </div>
    ))}
  </div>
)

export const Sizes = () => (
  <div className="flex flex-col gap-4 bg-paper p-4">
    {SIZES.map((size) => (
      <div key={size} className="flex items-end gap-6">
        <span className="w-12 font-mono text-xs text-ink-3">{size} px</span>
        {PRODUCTS.map(({ product, name }) => (
          <BBProductIcon key={product} product={product} size={size} title={name} />
        ))}
      </div>
    ))}
  </div>
)

export const SizesOnDark = () => (
  <div className="dark flex flex-col gap-4 bg-paper p-4">
    {SIZES.map((size) => (
      <div key={size} className="flex items-end gap-6">
        <span className="w-12 font-mono text-xs text-ink-3">{size} px</span>
        {PRODUCTS.map(({ product, name }) => (
          <BBProductIcon key={product} product={product} size={size} tone="dark" title={name} />
        ))}
      </div>
    ))}
  </div>
)
