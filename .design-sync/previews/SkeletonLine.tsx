import { SkeletonLine } from '@beebeeb/shared'

export const Widths = () => (
  <div className="flex w-72 flex-col gap-2.5 bg-paper p-4">
    <SkeletonLine />
    <SkeletonLine width="80%" />
    <SkeletonLine width="60%" />
    <SkeletonLine width="40%" />
  </div>
)

export const ActivityItem = () => (
  <div className="flex w-72 flex-col gap-2 rounded-md border border-line bg-paper p-4">
    <SkeletonLine width="70%" />
    <SkeletonLine width="35%" />
  </div>
)
