import type { ReactNode } from 'react'
import { FileIcon, getFileType } from '../file-icon'
import { formatBytes } from '../../lib/format'
import { isNodeClickable, type GuestNode } from './use-guest-listing'

/** Task 2237b — the guest list, reusing the Drive row rhythm without a table. */
export function GuestList(props: {
  nodes: GuestNode[]
  onOpenFolder: (id: string) => void
  onPreview: (node: GuestNode) => void
  actionMenu?: (node: GuestNode) => ReactNode
}): ReactNode {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {props.nodes.map((node) => {
        const clickable = isNodeClickable(node)
        const name = node.name ?? "can't read name"
        return (
          <li
            key={node.item.id}
            data-testid="guest-list-row"
            data-clickable={clickable ? 'true' : 'false'}
            className="group flex items-center gap-3 px-3 py-2"
          >
            <FileIcon type={getFileType(node.name ?? '', node.item.is_folder)} size={18} />
            <button
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return
                if (node.item.is_folder) props.onOpenFolder(node.item.id)
                else props.onPreview(node)
              }}
              className="min-w-0 flex-1 truncate text-left text-sm disabled:cursor-default"
            >
              {name}
            </button>
            <span className="w-20 shrink-0 text-right font-mono text-xs text-ink-3">
              {node.item.is_folder ? '—' : formatBytes(node.item.size_bytes)}
            </span>
            <span className="hidden w-28 shrink-0 text-right font-mono text-xs text-ink-3 sm:block">
              {node.item.updated_at.slice(0, 10)}
            </span>
            {props.actionMenu ? (
              <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {props.actionMenu(node)}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
