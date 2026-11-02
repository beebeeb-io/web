import { SkeletonLine, SkeletonRect } from '@beebeeb/shared'

export const Shapes = () => (
  <div className="flex items-end gap-4 bg-paper p-4">
    <SkeletonRect width="28px" height="28px" />
    <SkeletonRect width="40px" height="40px" />
    <SkeletonRect width="120px" height="80px" />
  </div>
)

export const WithText = () => (
  <div className="flex w-72 items-center gap-3 bg-paper p-4">
    <SkeletonRect width="40px" height="40px" />
    <div className="flex flex-1 flex-col gap-2">
      <SkeletonLine width="70%" />
      <SkeletonLine width="40%" />
    </div>
  </div>
)
