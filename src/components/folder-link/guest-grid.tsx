import type { ReactNode } from 'react'
import { FileIcon, getFileType } from '../file-icon'
import { formatBytes } from '../../lib/format'
import { isNodeClickable, type GuestNode } from './use-guest-listing'

/**
 * Guus, 2026-10-28: "On the screenshots i think the grid items are too big, so
 * make it smaller" → "More towards 80px". One tile is an 80 px square with the
 * name under it, so a phone fits four per row and a laptop a dozen or more.
 */
export const GUEST_GRID_TILE_PX = 80

/**
 * Task 2237b — the guest grid.
 *
 * Nothing here is owner-only: a tile shows a thumbnail (or the Files file-type
 * icon until it resolves), the name on one line with an ellipsis (the full
 * name on hover via `title`), and the size. The whole tile is the tap target
 * (80 px wide, well over 44 px tall). The only extra affordance is the action
 * menu, which the caller passes in at edit level.
 */
export function GuestGrid(props: {
  nodes: GuestNode[]
  onOpenFolder: (id: string) => void
  onPreview: (node: GuestNode) => void
  thumbnails?: Map<string, string>
  actionMenu?: (node: GuestNode) => ReactNode
}): ReactNode {
  const thumbnails = props.thumbnails ?? new Map<string, string>()
  return (
    <ul
      className="grid gap-x-1.5 gap-y-4 p-2 md:gap-x-4 md:gap-y-5 md:p-5"
      style={{ gridTemplateColumns: `repeat(auto-fill, ${GUEST_GRID_TILE_PX}px)` }}
      aria-label="Files and folders"
    >
      {props.nodes.map((node) => {
        const clickable = isNodeClickable(node)
        const name = node.name ?? "can't read name"
        const thumb = thumbnails.get(node.item.id)
        return (
          <li
            key={node.item.id}
            data-testid="guest-grid-cell"
            data-clickable={clickable ? 'true' : 'false'}
            className="group relative min-w-0"
            style={{ width: GUEST_GRID_TILE_PX }}
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return
                if (node.item.is_folder) props.onOpenFolder(node.item.id)
                else props.onPreview(node)
              }}
              title={name}
              className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber disabled:cursor-default"
            >
              <span
                className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-paper-2 transition-colors ${clickable ? 'border-line group-hover:border-line-2 group-hover:bg-paper-3' : 'border-line opacity-70'}`}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <FileIcon type={getFileType(node.name ?? '', node.item.is_folder)} size={28} />
                )}
              </span>
              <span className={`mt-1.5 block truncate text-[12px] font-medium leading-snug ${clickable ? 'text-ink' : 'text-ink-3'}`}>
                {name}
              </span>
              <span className="mt-px block truncate font-mono text-[10.5px] tabular-nums text-ink-3">
                {node.item.is_folder ? 'Folder' : formatBytes(node.item.size_bytes)}
              </span>
            </button>
            {props.actionMenu ? (
              <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {props.actionMenu(node)}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
