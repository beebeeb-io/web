// The import tree row renderers for Dropbox and Google Drive.
import {
  Icon,} from '@beebeeb/shared'
import type { GDriveTreeNode, TreeNode } from './tree-model'
import { formatBytes } from './dropbox-model'

// ── Dropbox tree row ─────────────────────────────────────────────────────────

export function DropboxTreeRow({
  node, depth, selected, onToggleSelect, onToggleExpand,
}: {
  node: TreeNode
  depth: number
  selected: boolean
  onToggleSelect: (path: string, tag: TreeNode['tag']) => void
  onToggleExpand: (path: string) => void
}) {
  const indent = depth * 20

  return (
    <>
      <div
        className="flex items-center gap-2 px-4 py-2 hover:bg-paper-2/60 group transition-colors"
        style={{ paddingLeft: 16 + indent }}
      >
        {node.tag === 'folder' ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.path)}
            className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-ink cursor-pointer shrink-0 transition-colors"
            aria-label={node.expanded ? 'Collapse' : 'Expand'}
          >
            {node.loading ? (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10"
                className={`transition-transform ${node.expanded ? 'rotate-90' : ''}`}>
                <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(node.path, node.tag)}
          className="accent-amber-deep shrink-0 cursor-pointer"
          aria-label={`Select ${node.name}`}
        />
        <span className="shrink-0 text-ink-3">
          {node.tag === 'folder'
            ? <Icon name="folder" size={14} className="text-amber-deep" />
            : <Icon name="file" size={14} />}
        </span>
        <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{node.name}</span>
        {node.size != null && (
          <span className="text-[11px] text-ink-4 font-mono shrink-0">{formatBytes(node.size)}</span>
        )}
      </div>
      {node.expanded && node.children && (
        <>
          {node.children.map(child => (
            <DropboxTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
          {node.hasMore && (
            <div
              className="px-4 py-1.5 text-[11.5px] text-ink-4 italic"
              style={{ paddingLeft: 16 + (depth + 1) * 20 }}
            >
              More items not shown — full list loaded during import
            </div>
          )}
        </>
      )}
    </>
  )
}

// ── Google Drive tree row ────────────────────────────────────────────────────

export function GDriveTreeRow({
  node, depth, selected, onToggleSelect, onToggleExpand,
}: {
  node: GDriveTreeNode
  depth: number
  selected: boolean
  onToggleSelect: (id: string) => void
  onToggleExpand: (id: string) => void
}) {
  const indent = depth * 20
  const isGdoc = node.tag === 'gdoc'

  return (
    <>
      <div
        className={`flex items-center gap-2 px-4 py-2 transition-colors ${isGdoc ? 'opacity-50' : 'hover:bg-paper-2/60'}`}
        style={{ paddingLeft: 16 + indent }}
        title={isGdoc ? 'Google Docs cannot be downloaded — export not supported yet' : undefined}
      >
        {node.tag === 'folder' ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-ink cursor-pointer shrink-0 transition-colors"
            aria-label={node.expanded ? 'Collapse' : 'Expand'}
          >
            {node.loading ? (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10"
                className={`transition-transform ${node.expanded ? 'rotate-90' : ''}`}>
                <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => !isGdoc && onToggleSelect(node.id)}
          disabled={isGdoc}
          className="accent-amber-deep shrink-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Select ${node.name}`}
        />
        <span className="shrink-0 text-ink-3">
          {node.tag === 'folder'
            ? <Icon name="folder" size={14} className="text-amber-deep" />
            : <Icon name="file" size={14} />}
        </span>
        <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{node.name}</span>
        {isGdoc && (
          <span className="text-[10px] text-ink-4 italic shrink-0">Google Doc</span>
        )}
        {!isGdoc && node.size != null && (
          <span className="text-[11px] text-ink-4 font-mono shrink-0">{formatBytes(node.size)}</span>
        )}
      </div>
      {node.expanded && node.children && (
        <>
          {node.children.map(child => (
            <GDriveTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
          {node.hasMore && (
            <div
              className="px-4 py-1.5 text-[11.5px] text-ink-4 italic"
              style={{ paddingLeft: 16 + (depth + 1) * 20 }}
            >
              More items not shown — full list loaded during import
            </div>
          )}
        </>
      )}
    </>
  )
}
