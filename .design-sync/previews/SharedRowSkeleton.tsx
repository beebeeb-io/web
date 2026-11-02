import { SharedRowSkeleton } from '@beebeeb/shared'

export const Rows = () => (
  <div className="w-[760px] divide-y divide-line rounded-md border border-line bg-paper">
    <SharedRowSkeleton />
    <SharedRowSkeleton />
    <SharedRowSkeleton />
    <SharedRowSkeleton />
  </div>
)

export const Dark = () => (
  <div className="dark w-[760px] divide-y divide-line rounded-md border border-line bg-paper">
    <SharedRowSkeleton />
    <SharedRowSkeleton />
  </div>
)
