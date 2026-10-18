// Brand UI primitives shared across web and admin.
//
// All components here are stateless (or lightly stateful) leaf components
// styled with Tailwind tokens defined in ../tokens.css. Consuming apps must
// import that stylesheet so the `bg-amber`, `text-ink`, `rounded-md`, etc.
// utilities resolve correctly.

export { BBButton, bbButtonClassName, canonicalButtonVariant } from './bb-button'
export type { BBButtonSize, BBButtonVariant } from './bb-button'
export { BBChip } from './bb-chip'
export { BBCheckbox } from './bb-checkbox'
export { BBInput } from './bb-input'
export { BBLogo } from './bb-logo'
export { BBToggle } from './bb-toggle'
export { BBDensityProvider, useBBDensity } from './density'
export type { BBDensity } from './density'
export { Icon } from './icons'
export type { IconName } from './icons'
export {
  CardSkeleton,
  FileRowSkeleton,
  PhotoGroupSkeleton,
  PhotoTileSkeleton,
  SharedRowSkeleton,
  SkeletonLine,
  SkeletonRect,
  TrashRowSkeleton,
} from './skeleton'
