import { TrashRowSkeleton } from '@beebeeb/shared'

export const Rows = () => (
  <div className="w-[760px] divide-y divide-line rounded-md border border-line bg-paper">
    <TrashRowSkeleton />
    <TrashRowSkeleton />
    <TrashRowSkeleton />
    <TrashRowSkeleton />
  </div>
)

export const Dark = () => (
  <div className="dark w-[760px] divide-y divide-line rounded-md border border-line bg-paper">
    <TrashRowSkeleton />
    <TrashRowSkeleton />
  </div>
)
