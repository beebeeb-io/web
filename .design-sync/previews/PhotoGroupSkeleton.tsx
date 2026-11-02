import { PhotoGroupSkeleton } from '@beebeeb/shared'

export const Group = () => (
  <div className="w-[560px] bg-paper p-4">
    <PhotoGroupSkeleton />
  </div>
)

export const Dark = () => (
  <div className="dark w-[560px] bg-paper p-4">
    <PhotoGroupSkeleton />
  </div>
)
