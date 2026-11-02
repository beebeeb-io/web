// The Dropbox import folder tree.
import {
  useState,
  useEffect,
  useCallback,} from 'react'
import {
  BBButton,} from '@beebeeb/shared'
import {
  Icon,} from '@beebeeb/shared'
import {
  useToast,} from '../../../components/toast'
import { findNode, newNode, updateNode, type TreeNode } from './tree-model'
import { ACCOUNT_KEY, dbxListFolder, dbxListFolderContinue, formatBytes } from './dropbox-model'
import { DropboxTreeRow } from './tree-rows'

// ── Dropbox tree panel ───────────────────────────────────────────────────────

export function DropboxTree({
  token, onDisconnect, onStartImport, importRunning,
}: {
  token: string
  onDisconnect: () => void
  onStartImport: (selectedPaths: Set<string>, selectAll: boolean, nodes: TreeNode[]) => void
  importRunning: boolean
}) {
  const { showToast } = useToast()
  const account = sessionStorage.getItem(ACCOUNT_KEY)

  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [rootHasMore, setRootHasMore] = useState(false)
  const [rootCursor, setRootCursor] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  const totalFiles   = nodes.filter(n => n.tag === 'file').length
  const totalFolders = nodes.filter(n => n.tag === 'folder').length
  const totalSize    = nodes.filter(n => n.tag === 'file').reduce((s, n) => s + (n.size ?? 0), 0)

  useEffect(() => {
    async function loadRoot() {
      try {
        const result = await dbxListFolder(token, '')
        setNodes(result.entries.map(newNode))
        setRootHasMore(result.has_more)
        setRootCursor(result.cursor)
      } catch (err) {
        showToast({ icon: 'x', title: 'Could not load Dropbox', description: err instanceof Error ? err.message : 'Unknown error', danger: true })
      } finally {
        setLoadingRoot(false)
      }
    }
    void loadRoot()
  }, [token, showToast])

  const handleToggleExpand = useCallback(async (path: string) => {
    const node = findNode(nodes, path)
    if (!node || node.tag !== 'folder') return

    if (node.expanded) { setNodes(prev => updateNode(prev, path, { expanded: false })); return }
    if (node.children && node.children.length > 0) { setNodes(prev => updateNode(prev, path, { expanded: true })); return }

    setNodes(prev => updateNode(prev, path, { loading: true, expanded: true }))
    try {
      const result = await dbxListFolder(token, path)
      setNodes(prev => updateNode(prev, path, {
        loading: false, children: result.entries.map(newNode),
        hasMore: result.has_more, cursor: result.cursor,
      }))
    } catch (err) {
      showToast({ icon: 'x', title: 'Could not expand folder', danger: true, description: err instanceof Error ? err.message : '' })
      setNodes(prev => updateNode(prev, path, { loading: false, expanded: false }))
    }
  }, [nodes, token, showToast])

  function handleToggleSelect(path: string, _tag: TreeNode['tag']) {
    setSelectAll(false)
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function handleSelectAll(checked: boolean) {
    setSelectAll(checked)
    if (checked) setSelectedPaths(new Set())
  }

  const selectedCount = selectAll ? 'All files' : `${selectedPaths.size} item${selectedPaths.size !== 1 ? 's' : ''}`
  const canImport = selectAll || selectedPaths.size > 0

  return (
    <div className="rounded-xl border border-line bg-paper overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line bg-paper-2">
        <svg width="20" height="18" viewBox="0 0 40 33" fill="none" className="shrink-0">
          <path d="M10 0L0 6.5l10 6.5 10-6.5L10 0Z" fill="#0061FF"/>
          <path d="M30 0L20 6.5l10 6.5 10-6.5L30 0Z" fill="#0061FF"/>
          <path d="M0 19.5L10 26l10-6.5L10 13l-10 6.5Z" fill="#0061FF"/>
          <path d="M20 19.5L30 26l10-6.5L30 13l-10 6.5Z" fill="#0061FF"/>
          <path d="M10 27.77L20 34l10-6.23V24l-10 6.23L10 24v3.77Z" fill="#0061FF"/>
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink">Dropbox</div>
          {account && <div className="text-[11.5px] text-ink-3">Connected as {account}</div>}
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green/10 border border-green/30 text-[10.5px] font-medium text-green">
          <span className="w-1.5 h-1.5 rounded-full bg-green" />
          Connected
        </span>
        <button type="button" onClick={onDisconnect}
          className="text-[11.5px] text-ink-4 hover:text-red transition-colors cursor-pointer">
          Disconnect
        </button>
      </div>

      <div className="flex items-start gap-2 px-5 py-2.5 border-b border-line bg-paper-2/50">
        <Icon name="info" size={12} className="text-ink-4 shrink-0 mt-0.5" />
        <p className="text-[11px] text-ink-4 leading-relaxed">
          Connects to Dropbox (US service). Files are downloaded directly to your browser and encrypted before upload to Beebeeb. Dropbox does not receive your encryption keys.
        </p>
      </div>

      {loadingRoot ? (
        <div className="flex items-center justify-center py-12 gap-2 text-ink-3">
          <svg className="animate-spin h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-[13px]">Loading your Dropbox…</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-paper-2">
            <input type="checkbox" checked={selectAll} onChange={e => handleSelectAll(e.target.checked)}
              className="accent-amber-deep cursor-pointer" id="select-all-dbx" />
            <label htmlFor="select-all-dbx" className="text-[13px] font-medium text-ink cursor-pointer flex-1">All files</label>
            <span className="text-[11px] text-ink-4 font-mono">
              {totalFolders} folder{totalFolders !== 1 ? 's' : ''} · {totalFiles} file{totalFiles !== 1 ? 's' : ''}{totalSize > 0 ? ` · ${formatBytes(totalSize)} visible` : ''}
            </span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
            {nodes.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-ink-3">Your Dropbox is empty.</div>
            ) : (
              nodes.map(node => (
                <DropboxTreeRow key={node.path} node={node} depth={0}
                  selected={selectAll || selectedPaths.has(node.path)}
                  onToggleSelect={handleToggleSelect} onToggleExpand={handleToggleExpand} />
              ))
            )}
            {rootHasMore && (
              <button type="button"
                onClick={async () => {
                  try {
                    const result = await dbxListFolderContinue(token, rootCursor)
                    setNodes(prev => [...prev, ...result.entries.map(newNode)])
                    setRootHasMore(result.has_more)
                    setRootCursor(result.cursor)
                  } catch (err) {
                    showToast({ icon: 'x', title: 'Could not load more', danger: true, description: err instanceof Error ? err.message : '' })
                  }
                }}
                className="w-full px-4 py-2.5 text-[12.5px] text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors cursor-pointer border-t border-line text-center">
                Load more items…
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 px-5 py-3.5 border-t border-line bg-paper-2">
            <span className="text-[12.5px] text-ink-3 flex-1">
              {canImport
                ? <><span className="text-ink font-medium">{selectedCount}</span> selected</>
                : 'Select files or folders to import'}
            </span>
            <BBButton variant="amber" size="md" disabled={!canImport || importRunning}
              onClick={() => onStartImport(selectedPaths, selectAll, nodes)} className="gap-1.5">
              <Icon name="download" size={13} />
              {importRunning ? 'Import running…' : 'Start import'}
            </BBButton>
          </div>
        </>
      )}
    </div>
  )
}
