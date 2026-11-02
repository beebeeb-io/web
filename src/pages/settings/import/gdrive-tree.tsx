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
import {
  listGoogleDriveFolder,
  GOOGLE_FOLDER_MIME,
  GOOGLE_DOCS_MIME_PREFIX,} from '../../../lib/google-import'
import {
  GD_EMAIL_KEY,} from './google-callback'
import { findGDriveNode, updateGDriveNode, type GDriveTreeNode } from './tree-model'
import { formatBytes } from './dropbox-model'
import { GDriveTreeRow } from './tree-rows'

// ── Google Drive tree panel ──────────────────────────────────────────────────

export function GoogleDriveTree({
  token, onDisconnect, onStartImport, importRunning,
}: {
  token: string
  onDisconnect: () => void
  onStartImport: (selectedIds: Set<string>, selectAll: boolean, nodes: GDriveTreeNode[]) => void
  importRunning: boolean
}) {
  const { showToast } = useToast()
  const email = sessionStorage.getItem(GD_EMAIL_KEY)

  const [nodes, setNodes] = useState<GDriveTreeNode[]>([])
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [rootHasMore, setRootHasMore] = useState(false)
  const [rootNextPage, setRootNextPage] = useState<string | undefined>()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  function gdApiFileToNode(f: { id: string; name: string; mimeType: string; size?: string }, parentPath: string): GDriveTreeNode {
    const isFolder = f.mimeType === GOOGLE_FOLDER_MIME
    const isGdoc = !isFolder && f.mimeType.startsWith(GOOGLE_DOCS_MIME_PREFIX)
    return {
      tag: isFolder ? 'folder' : isGdoc ? 'gdoc' : 'file',
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      parentPath,
      size: f.size ? parseInt(f.size, 10) : undefined,
      expanded: false,
      loading: false,
      hasMore: false,
      children: isFolder ? undefined : [],
    }
  }

  useEffect(() => {
    async function loadRoot() {
      try {
        const result = await listGoogleDriveFolder('root', token)
        setNodes(result.files.map(f => gdApiFileToNode(f, '')))
        setRootHasMore(!!result.nextPageToken)
        setRootNextPage(result.nextPageToken)
      } catch (err) {
        showToast({ icon: 'x', title: 'Could not load Google Drive', description: err instanceof Error ? err.message : 'Unknown error', danger: true })
      } finally {
        setLoadingRoot(false)
      }
    }
    void loadRoot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleToggleExpand = useCallback(async (id: string) => {
    const node = findGDriveNode(nodes, id)
    if (!node || node.tag !== 'folder') return

    if (node.expanded) { setNodes(prev => updateGDriveNode(prev, id, { expanded: false })); return }
    if (node.children && node.children.length > 0) { setNodes(prev => updateGDriveNode(prev, id, { expanded: true })); return }

    setNodes(prev => updateGDriveNode(prev, id, { loading: true, expanded: true }))
    try {
      const childPath = node.parentPath ? `${node.parentPath}/${node.name}` : `/${node.name}`
      const result = await listGoogleDriveFolder(id, token)
      setNodes(prev => updateGDriveNode(prev, id, {
        loading: false,
        children: result.files.map(f => gdApiFileToNode(f, childPath)),
        hasMore: !!result.nextPageToken,
        nextPageToken: result.nextPageToken,
      }))
    } catch (err) {
      showToast({ icon: 'x', title: 'Could not expand folder', danger: true, description: err instanceof Error ? err.message : '' })
      setNodes(prev => updateGDriveNode(prev, id, { loading: false, expanded: false }))
    }
  }, [nodes, token, showToast])

  function handleToggleSelect(id: string) {
    setSelectAll(false)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelectAll(checked: boolean) {
    setSelectAll(checked)
    if (checked) setSelectedIds(new Set())
  }

  const visibleFiles    = countGDriveFiles(nodes)
  const visibleFolders  = nodes.filter(n => n.tag === 'folder').length
  const visibleSize     = sumGDriveSize(nodes)
  const selectedCount   = selectAll ? 'All files' : `${selectedIds.size} item${selectedIds.size !== 1 ? 's' : ''}`
  const canImport       = selectAll || selectedIds.size > 0

  return (
    <div className="rounded-xl border border-line bg-paper overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line bg-paper-2">
        <svg width="20" height="18" viewBox="0 0 87.3 78" fill="none" className="shrink-0">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 001.88 7.9z" fill="#0066DA"/>
          <path d="M43.65 25L29.9 1.2a9.45 9.45 0 00-3.3 3.3L1.89 48.1A15.92 15.92 0 000 56h27.5z" fill="#00AC47"/>
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0087.3 50H59.8l5.85 12.35z" fill="#EA4335"/>
          <path d="M43.65 25L57.4 1.2C56.05.43 54.55 0 52.95 0H34.35c-1.6 0-3.1.43-4.45 1.2z" fill="#00832D"/>
          <path d="M59.8 50H27.5L13.75 73.8c1.35.77 2.85 1.2 4.45 1.2h50.5c1.6 0 3.1-.43 4.45-1.2z" fill="#2684FC"/>
          <path d="M73.4 26.15l-13.3-23.05a9.45 9.45 0 00-2.7-1.9L43.65 25 59.8 50h27.45a15.92 15.92 0 00-1.88-7.9z" fill="#FFBA00"/>
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink">Google Drive</div>
          {email && <div className="text-[11.5px] text-ink-3">Connected as {email}</div>}
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
          Connects to Google (US service). Files are downloaded directly to your browser and encrypted before upload to Beebeeb. Google does not receive your encryption keys.
        </p>
      </div>

      {loadingRoot ? (
        <div className="flex items-center justify-center py-12 gap-2 text-ink-3">
          <svg className="animate-spin h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-[13px]">Loading your Google Drive…</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-paper-2">
            <input type="checkbox" checked={selectAll} onChange={e => handleSelectAll(e.target.checked)}
              className="accent-amber-deep cursor-pointer" id="select-all-gd" />
            <label htmlFor="select-all-gd" className="text-[13px] font-medium text-ink cursor-pointer flex-1">All files</label>
            <span className="text-[11px] text-ink-4 font-mono">
              {visibleFolders} folder{visibleFolders !== 1 ? 's' : ''} · {visibleFiles} file{visibleFiles !== 1 ? 's' : ''}{visibleSize > 0 ? ` · ${formatBytes(visibleSize)} visible` : ''}
            </span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
            {nodes.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-ink-3">Your Google Drive is empty.</div>
            ) : (
              nodes.map(node => (
                <GDriveTreeRow
                  key={node.id} node={node} depth={0}
                  selected={selectAll || selectedIds.has(node.id)}
                  onToggleSelect={handleToggleSelect}
                  onToggleExpand={handleToggleExpand}
                />
              ))
            )}
            {rootHasMore && (
              <button type="button"
                onClick={async () => {
                  try {
                    const result = await listGoogleDriveFolder('root', token, rootNextPage)
                    setNodes(prev => [...prev, ...result.files.map(f => gdApiFileToNode(f, ''))])
                    setRootHasMore(!!result.nextPageToken)
                    setRootNextPage(result.nextPageToken)
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
              onClick={() => onStartImport(selectedIds, selectAll, nodes)} className="gap-1.5">
              <Icon name="download" size={13} />
              {importRunning ? 'Import running…' : 'Start import'}
            </BBButton>
          </div>
        </>
      )}
    </div>
  )
}

// Helper: count non-folder, non-gdoc nodes visible in the tree (top-level only for display)
function countGDriveFiles(nodes: GDriveTreeNode[]): number {
  return nodes.filter(n => n.tag === 'file').length
}
function sumGDriveSize(nodes: GDriveTreeNode[]): number {
  return nodes.filter(n => n.tag === 'file').reduce((s, n) => s + (n.size ?? 0), 0)
}

