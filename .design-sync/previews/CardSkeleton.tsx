// Design-sync preview of CardSkeleton for the Claude Design project.
import { CardSkeleton } from '@beebeeb/shared'

export const Single = () => (
  <div className="w-72 bg-paper p-4">
    <CardSkeleton />
  </div>
)

export const Grid = () => (
  <div className="grid w-[560px] grid-cols-3 gap-3 bg-paper p-4">
    <CardSkeleton />
    <CardSkeleton />
    <CardSkeleton />
  </div>
)
