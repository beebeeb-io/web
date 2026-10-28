import type { ReactNode } from 'react'
import { FileIcon, getFileType } from '../file-icon'
import { formatBytes } from '../../lib/format'
import { isNodeClickable, type GuestNode } from './use-guest-listing'

/**
 * Task 2237b — the guest grid.
 *
 * Nothing here is owner-only: a card shows a thumbnail (or a file icon until it
 * resolves) and a name. The only extra affordance is the action menu, which the
 * caller passes in at add/edit level.
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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return
                if (node.item.is_folder) props.onOpenFolder(node.item.id)
                else props.onPreview(node)
              }}
              className="block w-full text-left disabled:cursor-default"
            >
              <span className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-paper-2">
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon
                    type={getFileType(node.name ?? '', node.item.is_folder)}
                    size={28}
                  />
                )}
              </span>
              <span className="mt-1.5 line-clamp-2 break-words text-sm leading-snug">
                {name}
              </span>
              <span className="mt-0.5 block font-mono text-xs text-ink-3">
                {node.item.is_folder
                  ? 'Folder'
                  : formatBytes(node.item.size_bytes)}
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
