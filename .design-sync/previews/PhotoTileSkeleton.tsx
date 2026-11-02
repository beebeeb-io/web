// Design-sync preview of PhotoTileSkeleton for the Claude Design project.
import { PhotoTileSkeleton } from '@beebeeb/shared'

export const Tiles = () => (
  <div className="grid w-72 grid-cols-3 gap-2 bg-paper p-4">
    <PhotoTileSkeleton />
    <PhotoTileSkeleton />
    <PhotoTileSkeleton />
  </div>
)
