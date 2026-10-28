import type { ReactNode } from 'react'
import { FileBrowserRow, FILE_HEADER_BAR, FILE_HEADER_LABEL, FILE_ROW_PADDING } from '../file-browser-row'
import { FileIcon, getFileType } from '../file-icon'
import { getBadgeStyle } from '../../lib/file-colors'
import { formatBytes, timeAgo } from '../../lib/format'
import { isNodeClickable, type GuestNode } from './use-guest-listing'

/** Icon, name, size, modified, actions: the Files columns minus selection and sharing. */
export const GUEST_LIST_COLUMNS = 'grid-cols-[32px_minmax(0,1fr)_28px] md:grid-cols-[32px_minmax(0,1fr)_110px_110px_28px]'

/**
 * Task 2237b — the guest list, built from the Files row primitives
 * (`FileBrowserRow`, the Files header bar and labels, `FileIcon`, the extension
 * badge, `timeAgo`). On a phone the size and age fold under the name, as Files
 * does.
 */
export function GuestList(props: {
  nodes: GuestNode[]
  onOpenFolder: (id: string) => void
  onPreview: (node: GuestNode) => void
  thumbnails?: Map<string, string>
  actionMenu?: (node: GuestNode) => ReactNode
}): ReactNode {
  const thumbnails = props.thumbnails ?? new Map<string, string>()
  const open = (node: GuestNode) => {
    if (!isNodeClickable(node)) return
    if (node.item.is_folder) props.onOpenFolder(node.item.id)
    else props.onPreview(node)
  }
  return (
    <div>
      <div className={`${FILE_HEADER_BAR} ${GUEST_LIST_COLUMNS}`} aria-hidden="true">
        <span />
        <span className={FILE_HEADER_LABEL}>Name</span>
        <span className={`hidden md:inline ${FILE_HEADER_LABEL}`}>Size</span>
        <span className={`hidden md:inline ${FILE_HEADER_LABEL}`}>Modified</span>
        <span />
      </div>
      <ul className="divide-y divide-line" aria-label="Files and folders">
        {props.nodes.map((node) => {
          const clickable = isNodeClickable(node)
          const name = node.name ?? "can't read name"
          const type = getFileType(node.name ?? '', node.item.is_folder)
          const ext = !node.item.is_folder && node.name?.includes('.') ? node.name.split('.').pop()?.toLowerCase() ?? '' : ''
          const badge = getBadgeStyle(type)
          const thumb = thumbnails.get(node.item.id)
          const size = node.item.is_folder ? '--' : formatBytes(node.item.size_bytes)
          return (
            <li
              key={node.item.id}
              data-testid="guest-list-row"
              data-clickable={clickable ? 'true' : 'false'}
            >
              <FileBrowserRow
                onClick={() => open(node)}
                className={[
                  GUEST_LIST_COLUMNS,
                  FILE_ROW_PADDING,
                  'items-center',
                  clickable ? 'hover:bg-paper-2' : 'cursor-default',
                ].join(' ')}
              >
                {thumb ? (
                  <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md">
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </span>
                ) : (
                  <span className="inline-flex shrink-0">
                    <FileIcon type={type} />
                  </span>
                )}
                <div className="min-w-0">
                  <button
                    type="button"
                    disabled={!clickable}
                    title={name}
                    onClick={(event) => {
                      event.stopPropagation()
                      open(node)
                    }}
                    className={`block max-w-full truncate text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber rounded disabled:cursor-default ${clickable ? 'text-ink' : 'text-ink-3'}`}
                  >
                    {name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                    {ext ? (
                      <span
                        className="shrink-0 rounded px-[5px] py-px font-mono text-[10px] font-medium leading-tight"
                        style={{ color: badge.color, background: badge.background }}
                      >
                        {ext.toUpperCase()}
                      </span>
                    ) : null}
                    {node.item.is_folder ? <span>Folder</span> : null}
                    {!node.item.is_folder ? (
                      <>
                        <span className="font-mono tabular-nums md:hidden">{size}</span>
                        <span className="text-line-2 md:hidden">·</span>
                      </>
                    ) : null}
                    <span className="md:hidden">{timeAgo(node.item.updated_at)}</span>
                  </div>
                </div>
                <span className="hidden self-center font-mono text-[13px] tabular-nums text-ink-3 md:inline">
                  {size}
                </span>
                <span className="hidden self-center text-[13px] text-ink-3 md:inline">
                  {timeAgo(node.item.updated_at)}
                </span>
                <div className="flex justify-end self-center">
                  {props.actionMenu ? (
                    <span onClick={(event) => event.stopPropagation()}>{props.actionMenu(node)}</span>
                  ) : node.item.is_folder && clickable ? (
                    <span className="text-ink-4" aria-hidden="true">›</span>
                  ) : null}
                </div>
              </FileBrowserRow>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
