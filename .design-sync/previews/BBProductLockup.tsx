// Design-sync preview of BBProductLockup for the Claude Design project.
import { BBButton, BBProductLockup } from '@beebeeb/shared'
import type { BBProduct } from '@beebeeb/shared'

const PRODUCTS: BBProduct[] = ['drive', 'pass', 'vpn', 'mail', 'chat']

export const AllProducts = () => (
  <div className="flex flex-col gap-4 bg-paper p-4">
    {PRODUCTS.map((product) => (
      <BBProductLockup key={product} product={product} />
    ))}
  </div>
)

export const AllProductsOnDark = () => (
  <div className="dark flex flex-col gap-4 bg-paper p-4">
    {PRODUCTS.map((product) => (
      <BBProductLockup key={product} product={product} tone="dark" />
    ))}
  </div>
)

export const Large = () => (
  <div className="flex flex-col gap-6 bg-paper p-6">
    {PRODUCTS.map((product) => (
      <BBProductLockup key={product} product={product} size={96} />
    ))}
  </div>
)

export const Small = () => (
  <div className="flex flex-col gap-3 bg-paper p-4">
    {PRODUCTS.map((product) => (
      <BBProductLockup key={product} product={product} size={29} />
    ))}
  </div>
)

export const InAppHeader = () => (
  <div className="flex w-[480px] items-center justify-between border-b border-line bg-paper px-4 py-3">
    <BBProductLockup product="drive" size={29} />
    <BBButton variant="amber">Share</BBButton>
  </div>
)
