/**
 * Settings — Import
 *
 * Import hub: connect a cloud provider and select files to migrate.
 * Day 1: Dropbox OAuth (PKCE) + file tree selection.
 * Day 2: Download → encrypt → upload pipeline (this file).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton } from '../../components/bb-button'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import { useKeys } from '../../lib/key-context'
import {
  expandDropboxPaths,
  downloadDropboxFile,
  formatEta,
  formatSpeed,
  formatBytes as fmtBytes,
} from '../../lib/dropbox-import'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { createFolder } from '../../lib/api'
import { deriveFileKey, encryptFilename, toBase64 } from '../../lib/crypto'

// ── SessionStorage keys ─────────────────────────────────────────────────────

const VERIFIER_KEY = 'bb_dbx_pkce_verifier'
const TOKEN_KEY    = 'bb_dbx_token'
const ACCOUNT_KEY  = 'bb_dbx_account'

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generateVerifier(): string {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ── Dropbox API helpers ──────────────────────────────────────────────────────

interface DbxEntry {
  '.tag': 'file' | 'folder'
  name: string
  path_lower: string
  id: string
  size?: number
  server_modified?: string
}

interface DbxListResult {
  entries: DbxEntry[]
  cursor: string
  has_more: boolean
}

async function dbxListFolder(token: string, path: string): Promise<DbxListResult> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path,
      recursive: false,
      include_media_info: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dropbox list error (${res.status}): ${text.slice(0, 120)}`)
  }
  return res.json() as Promise<DbxListResult>
}

async function dbxListFolderContinue(token: string, cursor: string): Promise<DbxListResult> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cursor }),
  })
  if (!res.ok) throw new Error(`Dropbox continue error (${res.status})`)
  return res.json() as Promise<DbxListResult>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// ── Tree node state ──────────────────────────────────────────────────────────

interface TreeNode {
  tag: 'file' | 'folder'
  name: string
  path: string
  size?: number
  children?: TreeNode[]
  expanded: boolean
  loading: boolean
  hasMore: boolean
  cursor?: string
}

function newNode(entry: DbxEntry): TreeNode {
  return {
    tag: entry['.tag'],
    name: entry.name,
    path: entry.path_lower,
    size: entry.size,
    expanded: false,
    loading: false,
    hasMore: false,
    children: entry['.tag'] === 'folder' ? undefined : [],
  }
}

// Deep-update a tree node by path
function updateNode(
  nodes: TreeNode[],
  path: string,
  patch: Partial<TreeNode>,
): TreeNode[] {
  return nodes.map(n => {
    if (n.path === path) return { ...n, ...patch }
    if (n.children) return { ...n, children: updateNode(n.children, path, patch) }
    return n
  })
}

// ── Tree row component ───────────────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  selected,
  onToggleSelect,
  onToggleExpand,
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
        {/* Expand toggle for folders */}
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
              <svg
                width="10" height="10" viewBox="0 0 10 10"
                className={`transition-transform ${node.expanded ? 'rotate-90' : ''}`}
              >
                <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(node.path, node.tag)}
          className="accent-amber-deep shrink-0 cursor-pointer"
          aria-label={`Select ${node.name}`}
        />

        {/* Icon */}
        <span className="shrink-0 text-ink-3">
          {node.tag === 'folder'
            ? <Icon name="folder" size={14} className="text-amber-deep" />
            : <Icon name="file" size={14} />
          }
        </span>

        {/* Name */}
        <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{node.name}</span>

        {/* File size */}
        {node.size != null && (
          <span className="text-[11px] text-ink-4 font-mono shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      {node.expanded && node.children && (
        <>
          {node.children.map(child => (
            <TreeRow
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

// ── Dropbox tree panel ───────────────────────────────────────────────────────

function DropboxTree({
  token,
  onDisconnect,
  onStartImport,
  importRunning,
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

  // Totals computed from visible tree (file entries have size)
  const totalFiles = nodes.filter(n => n.tag === 'file').length
  const totalFolders = nodes.filter(n => n.tag === 'folder').length
  const totalSize = nodes
    .filter(n => n.tag === 'file')
    .reduce((s, n) => s + (n.size ?? 0), 0)

  // Load root on mount
  useEffect(() => {
    async function loadRoot() {
      try {
        const result = await dbxListFolder(token, '')
        setNodes(result.entries.map(newNode))
        setRootHasMore(result.has_more)
        setRootCursor(result.cursor)
      } catch (err) {
        showToast({
          icon: 'x',
          title: 'Could not load Dropbox',
          description: err instanceof Error ? err.message : 'Unknown error',
          danger: true,
        })
      } finally {
        setLoadingRoot(false)
      }
    }
    void loadRoot()
  }, [token, showToast])

  // Expand/collapse a folder
  const handleToggleExpand = useCallback(async (path: string) => {
    const node = findNode(nodes, path)
    if (!node || node.tag !== 'folder') return

    if (node.expanded) {
      setNodes(prev => updateNode(prev, path, { expanded: false }))
      return
    }

    if (node.children && node.children.length > 0) {
      setNodes(prev => updateNode(prev, path, { expanded: true }))
      return
    }

    // Load children
    setNodes(prev => updateNode(prev, path, { loading: true, expanded: true }))
    try {
      const result = await dbxListFolder(token, path)
      setNodes(prev => updateNode(prev, path, {
        loading: false,
        children: result.entries.map(newNode),
        hasMore: result.has_more,
        cursor: result.cursor,
      }))
    } catch (err) {
      showToast({ icon: 'x', title: 'Could not expand folder', danger: true, description: err instanceof Error ? err.message : '' })
      setNodes(prev => updateNode(prev, path, { loading: false, expanded: false }))
    }
  }, [nodes, token, showToast])

  // Toggle selection
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

  const selectedCount = selectAll ? `All files` : `${selectedPaths.size} item${selectedPaths.size !== 1 ? 's' : ''}`
  const canImport = selectAll || selectedPaths.size > 0

  return (
    <div className="rounded-xl border border-line bg-paper overflow-hidden">
      {/* Connected header */}
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
        <button
          type="button"
          onClick={onDisconnect}
          className="text-[11.5px] text-ink-4 hover:text-red transition-colors cursor-pointer"
        >
          Disconnect
        </button>
      </div>

      {/* File tree */}
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
          {/* Select all row */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-paper-2">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={e => handleSelectAll(e.target.checked)}
              className="accent-amber-deep cursor-pointer"
              id="select-all-dbx"
            />
            <label htmlFor="select-all-dbx" className="text-[13px] font-medium text-ink cursor-pointer flex-1">
              All files
            </label>
            <span className="text-[11px] text-ink-4 font-mono">
              {totalFolders} folder{totalFolders !== 1 ? 's' : ''} · {totalFiles} file{totalFiles !== 1 ? 's' : ''}{totalSize > 0 ? ` · ${formatBytes(totalSize)} visible` : ''}
            </span>
          </div>

          {/* Tree rows */}
          <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
            {nodes.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-ink-3">
                Your Dropbox is empty.
              </div>
            ) : (
              nodes.map(node => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selectAll || selectedPaths.has(node.path)}
                  onToggleSelect={handleToggleSelect}
                  onToggleExpand={handleToggleExpand}
                />
              ))
            )}
            {rootHasMore && (
              <button
                type="button"
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
                className="w-full px-4 py-2.5 text-[12.5px] text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors cursor-pointer border-t border-line text-center"
              >
                Load more items…
              </button>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-t border-line bg-paper-2">
            <span className="text-[12.5px] text-ink-3 flex-1">
              {canImport ? (
                <><span className="text-ink font-medium">{selectedCount}</span> selected</>
              ) : (
                'Select files or folders to import'
              )}
            </span>
            <BBButton
              variant="amber"
              size="md"
              disabled={!canImport || importRunning}
              onClick={() => onStartImport(selectedPaths, selectAll, nodes)}
              className="gap-1.5"
            >
              <Icon name="download" size={13} />
              {importRunning ? 'Import running…' : 'Start import'}
            </BBButton>
          </div>
        </>
      )}
    </div>
  )
}

// Find a node by path in a tree
function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNode(n.children, path)
      if (found) return found
    }
  }
  return null
}

// ── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  name,
  logo,
  status,
  onConnect,
  disabled,
  comingSoon,
}: {
  name: string
  logo: React.ReactNode
  status: 'disconnected' | 'connecting' | 'connected'
  onConnect?: () => void
  disabled?: boolean
  comingSoon?: boolean
}) {
  return (
    <div className={`rounded-xl border p-5 bg-paper flex flex-col gap-4 ${
      disabled ? 'border-line opacity-60' : 'border-line hover:border-line-2 transition-colors'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center shrink-0">
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">{name}</div>
          {comingSoon && (
            <div className="text-[11px] text-ink-4">Coming soon</div>
          )}
          {!comingSoon && status === 'connected' && (
            <div className="text-[11px] text-green font-medium">Connected</div>
          )}
          {!comingSoon && status === 'disconnected' && (
            <div className="text-[11px] text-ink-3">Not connected</div>
          )}
        </div>
      </div>

      {!comingSoon && (
        <BBButton
          size="sm"
          variant={status === 'connected' ? 'default' : 'amber'}
          onClick={onConnect}
          disabled={disabled || status === 'connecting'}
          className="gap-1.5"
        >
          {status === 'connecting' ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Connecting…
            </>
          ) : status === 'connected' ? (
            <><Icon name="check" size={12} /> Connected</>
          ) : (
            <><Icon name="link" size={12} /> Connect {name}</>
          )}
        </BBButton>
      )}

      {comingSoon && (
        <BBButton size="sm" variant="default" disabled className="gap-1.5">
          <Icon name="clock" size={12} />
          Coming soon
        </BBButton>
      )}
    </div>
  )
}

// ── Dropbox logo ─────────────────────────────────────────────────────────────

const DropboxLogo = () => (
  <svg width="22" height="20" viewBox="0 0 40 33" fill="none">
    <path d="M10 0L0 6.5l10 6.5 10-6.5L10 0Z" fill="#0061FF"/>
    <path d="M30 0L20 6.5l10 6.5 10-6.5L30 0Z" fill="#0061FF"/>
    <path d="M0 19.5L10 26l10-6.5L10 13l-10 6.5Z" fill="#0061FF"/>
    <path d="M20 19.5L30 26l10-6.5L30 13l-10 6.5Z" fill="#0061FF"/>
    <path d="M10 27.77L20 34l10-6.23V24l-10 6.23L10 24v3.77Z" fill="#0061FF"/>
  </svg>
)

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsImport() {
  const { showToast } = useToast()
  const { getMasterKey } = useKeys()
  const [dbxToken, setDbxToken] = useState<string | null>(
    () => sessionStorage.getItem(TOKEN_KEY)
  )
  const [dbxConnecting, setDbxConnecting] = useState(false)

  const appKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined

  async function handleConnectDropbox() {
    if (!appKey) {
      showToast({
        icon: 'x',
        title: 'Dropbox not configured',
        description: 'VITE_DROPBOX_APP_KEY is not set. Add it to your .env file.',
        danger: true,
      })
      return
    }

    setDbxConnecting(true)
    try {
      const verifier = generateVerifier()
      const challenge = await generateChallenge(verifier)
      sessionStorage.setItem(VERIFIER_KEY, verifier)

      const redirectUri = `${window.location.origin}/settings/import/dropbox/callback`
      const params = new URLSearchParams({
        client_id: appKey,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
        token_access_type: 'online',
      })

      window.location.href = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`
    } catch (err) {
      setDbxConnecting(false)
      showToast({ icon: 'x', title: 'Could not start OAuth', description: err instanceof Error ? err.message : '', danger: true })
    }
  }

  function handleDisconnectDropbox() {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ACCOUNT_KEY)
    setDbxToken(null)
    showToast({ icon: 'check', title: 'Dropbox disconnected' })
    setImportPhase('idle')
  }

  // ── Import pipeline ──────────────────────────────────────────────────────

  type ImportPhase = 'idle' | 'building-queue' | 'importing' | 'paused' | 'done'

  interface FileProgress {
    path: string
    name: string
    size: number
    status: 'queued' | 'downloading' | 'encrypting' | 'uploading' | 'done' | 'failed'
    error?: string
  }

  const [importPhase, setImportPhase] = useState<ImportPhase>('idle')
  const [importQueue, setImportQueue] = useState<FileProgress[]>([])
  const [importIdx, setImportIdx] = useState(0)
  const [doneBytes, setDoneBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const [throughputBps, setThroughputBps] = useState(0)
  const [queueCount, setQueueCount] = useState(0)

  const pausedRef = useRef(false)
  const cancelCtrlRef = useRef<AbortController | null>(null)
  // Folder cache: dropbox path → beebeeb folder id
  const folderCacheRef = useRef<Map<string, string>>(new Map())
  // Throughput tracking
  const speedWindowRef = useRef<{ t: number; b: number }[]>([])

  function trackThroughput(bytes: number) {
    const now = Date.now()
    speedWindowRef.current.push({ t: now, b: bytes })
    // Keep 10-second window
    speedWindowRef.current = speedWindowRef.current.filter(s => now - s.t < 10_000)
    const windowBytes = speedWindowRef.current.reduce((s, x) => s + x.b, 0)
    const windowSecs = Math.max(
      (now - (speedWindowRef.current[0]?.t ?? now)) / 1000,
      0.1,
    )
    setThroughputBps(windowBytes / windowSecs)
  }

  /** Ensure the Beebeeb folder hierarchy for a Dropbox path exists, returning the leaf folder ID. */
  async function ensureFolderPath(
    dropboxFolderPath: string,
    masterKey: Uint8Array,
  ): Promise<string | undefined> {
    if (!dropboxFolderPath || dropboxFolderPath === '') return undefined
    if (folderCacheRef.current.has(dropboxFolderPath)) {
      return folderCacheRef.current.get(dropboxFolderPath)
    }

    // Ensure parent first (recursive)
    const parts = dropboxFolderPath.split('/').filter(Boolean)
    const name = parts[parts.length - 1] ?? dropboxFolderPath
    const parentPath = '/' + parts.slice(0, -1).join('/')
    const parentId = parts.length > 1
      ? await ensureFolderPath(parentPath === '/' ? '' : parentPath, masterKey)
      : undefined

    // Derive a stable folder ID from the path (deterministic → same folder on retry)
    const pathBytes = new TextEncoder().encode(dropboxFolderPath)
    const pathHash = await crypto.subtle.digest('SHA-256', pathBytes)
    const folderId = Array.from(new Uint8Array(pathHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 36)
      // Format as UUID-ish
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')

    if (folderCacheRef.current.has(folderId)) {
      return folderCacheRef.current.get(folderId)
    }

    // Encrypt the folder name
    const folderKey = await deriveFileKey(masterKey, folderId)
    const encName = await encryptFilename(folderKey, name)
    const nameEncrypted = JSON.stringify({
      nonce: toBase64(encName.nonce),
      ciphertext: toBase64(encName.ciphertext),
    })

    try {
      const folder = await createFolder(nameEncrypted, parentId, folderId)
      folderCacheRef.current.set(dropboxFolderPath, folder.id)
      return folder.id
    } catch {
      // Folder may already exist (retry scenario) — use cached ID
      folderCacheRef.current.set(dropboxFolderPath, folderId)
      return folderId
    }
  }

  async function handleStartImport(
    selectedPaths: Set<string>,
    selectAll: boolean,
    treeNodes: TreeNode[],
  ) {
    if (!dbxToken || !getMasterKey) return

    setImportPhase('building-queue')
    setImportIdx(0)
    setDoneBytes(0)
    setFailedPaths([])
    setQueueCount(0)
    speedWindowRef.current = []
    folderCacheRef.current.clear()
    pausedRef.current = false

    try {
      // Determine which paths to expand
      let pathsToExpand: string[]
      if (selectAll) {
        pathsToExpand = treeNodes.map(n => n.path)
      } else {
        pathsToExpand = Array.from(selectedPaths)
      }

      const rawQueue = await expandDropboxPaths(
        dbxToken,
        pathsToExpand,
        (n) => setQueueCount(n),
      )

      if (rawQueue.length === 0) {
        showToast({ icon: 'cloud', title: 'Nothing to import', description: 'No files found in the selected folders.' })
        setImportPhase('idle')
        return
      }

      const total = rawQueue.reduce((s, f) => s + f.size, 0)
      setTotalBytes(total)
      const queue: FileProgress[] = rawQueue.map(f => ({
        path: f.dropboxPath,
        name: f.name,
        size: f.size,
        status: 'queued',
      }))
      setImportQueue(queue)
      setImportPhase('importing')

      // ── Worker loop ────────────────────────────────────────────────────
      const masterKey = getMasterKey()
      let bytesAccum = 0

      for (let i = 0; i < rawQueue.length; i++) {
        // Check pause
        while (pausedRef.current) {
          setImportPhase('paused')
          await new Promise<void>(r => setTimeout(r, 300))
        }
        setImportPhase('importing')
        setImportIdx(i)

        const item = rawQueue[i]
        const ctrl = new AbortController()
        cancelCtrlRef.current = ctrl

        const updateStatus = (status: FileProgress['status'], error?: string) => {
          setImportQueue(prev => {
            const next = [...prev]
            next[i] = { ...next[i], status, error }
            return next
          })
        }

        let success = false
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            // ── Download from Dropbox ──────────────────────────────────
            updateStatus('downloading')
            const blob = await downloadDropboxFile(item.dropboxPath, dbxToken, ctrl.signal)
            trackThroughput(blob.size)

            // ── Ensure folder exists in Beebeeb ───────────────────────
            const parentId = await ensureFolderPath(item.parentDropboxPath, masterKey)

            // ── Derive file key ────────────────────────────────────────
            updateStatus('encrypting')
            const fileId = crypto.randomUUID()
            const fileKey = await deriveFileKey(masterKey, fileId)

            // ── Encrypt + upload ───────────────────────────────────────
            updateStatus('uploading')
            const file = new File([blob], item.name, {
              type: blob.type || 'application/octet-stream',
            })
            await encryptedUpload(
              file,
              fileId,
              fileKey,
              parentId,
              (p) => {
                if (p.stage === 'Uploading' && p.bytesUploaded) {
                  trackThroughput(p.bytesUploaded)
                }
              },
              undefined,
              undefined,
              ctrl.signal,
            )

            updateStatus('done')
            bytesAccum += item.size
            setDoneBytes(bytesAccum)
            success = true
            break
          } catch (err) {
            if (ctrl.signal.aborted) {
              // User cancelled — stop the loop entirely
              setImportPhase('idle')
              showToast({ icon: 'x', title: 'Import cancelled' })
              return
            }
            if (attempt === 1) {
              const msg = err instanceof Error ? err.message : 'Unknown error'
              updateStatus('failed', msg)
              setFailedPaths(prev => [...prev, item.dropboxPath])
            }
            // else: retry
          }
        }

        if (!success) {
          bytesAccum += item.size
          setDoneBytes(bytesAccum)
        }
      }

      setImportPhase('done')
      showToast({
        icon: 'check',
        title: `Import complete`,
        description: `${rawQueue.length} files imported${failedPaths.length > 0 ? ` · ${failedPaths.length} failed` : ''}`,
      })
    } catch (err) {
      setImportPhase('idle')
      showToast({ icon: 'x', title: 'Import failed', description: err instanceof Error ? err.message : '', danger: true })
    }
  }

  function handlePauseResume() {
    pausedRef.current = !pausedRef.current
    if (!pausedRef.current) setImportPhase('importing')
  }

  function handleCancel() {
    cancelCtrlRef.current?.abort()
    pausedRef.current = false
    setImportPhase('idle')
  }

  const isImporting = importPhase === 'importing' || importPhase === 'paused'
  const progressPct = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0
  const currentFile = importQueue[importIdx]
  const eta = formatEta(totalBytes - doneBytes, throughputBps)
  const speed = formatSpeed(throughputBps)

  return (
    <SettingsShell activeSection="import">
      <SettingsHeader
        title="Import"
        subtitle="Migrate your files from another cloud service. Files are encrypted during transfer — we never see the plaintext."
      />

      <div className="p-7 space-y-6">
        {/* ── No app key notice ── */}
        {!appKey && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber/30 bg-amber-bg text-[13px] text-ink-2">
            <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-ink mb-0.5">Dropbox app key not configured</div>
              Add <code className="font-mono text-[11.5px] bg-paper border border-line px-1 rounded">VITE_DROPBOX_APP_KEY=your_key</code> to your{' '}
              <code className="font-mono text-[11.5px] bg-paper border border-line px-1 rounded">.env</code> file to enable Dropbox import in development.
            </div>
          </div>
        )}

        {/* ── Provider card grid ── */}
        {!dbxToken && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-3">
              Connect a provider
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ProviderCard
                name="Dropbox"
                logo={<DropboxLogo />}
                status={dbxConnecting ? 'connecting' : 'disconnected'}
                onConnect={() => void handleConnectDropbox()}
                disabled={!appKey}
              />
              <ProviderCard
                name="Google Drive"
                logo={
                  <svg width="22" height="20" viewBox="0 0 87.3 78" fill="none">
                    <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 001.88 7.9z" fill="#0066DA"/>
                    <path d="M43.65 25L29.9 1.2a9.45 9.45 0 00-3.3 3.3L1.89 48.1A15.92 15.92 0 000 56h27.5z" fill="#00AC47"/>
                    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0087.3 50H59.8l5.85 12.35z" fill="#EA4335"/>
                    <path d="M43.65 25L57.4 1.2C56.05.43 54.55 0 52.95 0H34.35c-1.6 0-3.1.43-4.45 1.2z" fill="#00832D"/>
                    <path d="M59.8 50H27.5L13.75 73.8c1.35.77 2.85 1.2 4.45 1.2h50.5c1.6 0 3.1-.43 4.45-1.2z" fill="#2684FC"/>
                    <path d="M73.4 26.15l-13.3-23.05a9.45 9.45 0 00-2.7-1.9L43.65 25 59.8 50h27.45a15.92 15.92 0 00-1.88-7.9z" fill="#FFBA00"/>
                  </svg>
                }
                status="disconnected"
                comingSoon
              />
              <ProviderCard
                name="iCloud"
                logo={
                  <svg width="22" height="16" viewBox="0 0 24 16" fill="none">
                    <path d="M18.5 6.5A6.5 6.5 0 0012 2a6.5 6.5 0 00-6.13 4.38A5 5 0 000 11.5C0 14 2 16 4.5 16h14A5.5 5.5 0 0024 10.5a5.5 5.5 0 00-5.5-4z" fill="#3A82F7"/>
                  </svg>
                }
                status="disconnected"
                comingSoon
              />
            </div>
          </div>
        )}

        {/* ── Import progress panel ── */}
        {isImporting && (
          <div className="rounded-xl border border-line bg-paper overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-line bg-paper-2">
              <svg className="animate-spin h-4 w-4 text-amber shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <span className="text-[13px] font-semibold text-ink flex-1">
                {importPhase === 'paused' ? 'Import paused' : `Importing files…`}
              </span>
              <BBButton size="sm" variant="ghost" onClick={handlePauseResume} className="gap-1">
                <Icon name={importPhase === 'paused' ? 'upload' : 'clock'} size={12} />
                {importPhase === 'paused' ? 'Resume' : 'Pause'}
              </BBButton>
              <BBButton size="sm" variant="ghost" className="text-red/70 hover:text-red" onClick={handleCancel}>
                <Icon name="x" size={12} className="mr-1" />
                Cancel
              </BBButton>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* Overall bar */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12.5px] font-medium text-ink">
                    {importIdx + 1} / {importQueue.length} files
                  </span>
                  <span className="text-[11.5px] text-ink-3 font-mono">
                    {fmtBytes(doneBytes)} / {fmtBytes(totalBytes)}
                    {throughputBps > 0 && ` · ${speed} · ${eta}`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-paper-3 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="text-[10.5px] text-ink-4 mt-1">{progressPct}% complete</div>
              </div>

              {/* Current file */}
              {currentFile && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-paper-2 border border-line">
                  <Icon name="file" size={13} className="text-ink-3 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-ink truncate">{currentFile.name}</div>
                    <div className="text-[11px] text-ink-3 truncate">{currentFile.path}</div>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                    currentFile.status === 'downloading' ? 'bg-blue-50 text-blue-600' :
                    currentFile.status === 'encrypting' ? 'bg-amber-bg text-amber-deep' :
                    currentFile.status === 'uploading' ? 'bg-green/10 text-green' :
                    'text-ink-4'
                  }`}>
                    {currentFile.status.charAt(0).toUpperCase() + currentFile.status.slice(1)}
                  </span>
                </div>
              )}

              {/* Recent completions */}
              {importQueue.filter(f => f.status === 'done').slice(-3).reverse().map(f => (
                <div key={f.path} className="flex items-center gap-2 text-[11.5px] text-ink-3">
                  <Icon name="check" size={11} className="text-green shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto font-mono shrink-0">{fmtBytes(f.size)}</span>
                </div>
              ))}

              {/* Failed files */}
              {failedPaths.length > 0 && (
                <div className="text-[11.5px] text-red">
                  {failedPaths.length} file{failedPaths.length !== 1 ? 's' : ''} failed
                </div>
              )}
            </div>
          </div>
        )}

        {/* Import complete summary */}
        {importPhase === 'done' && (
          <div className="rounded-xl border border-green/30 bg-green/5 px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green/10 flex items-center justify-center shrink-0">
              <Icon name="check" size={16} className="text-green" />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-ink">Import complete</div>
              <div className="text-[12px] text-ink-3">
                {importQueue.filter(f => f.status === 'done').length} files imported
                {failedPaths.length > 0 && ` · ${failedPaths.length} failed`}
                {` · ${fmtBytes(doneBytes)} transferred`}
              </div>
            </div>
            <BBButton size="sm" variant="ghost" onClick={() => setImportPhase('idle')}>
              Done
            </BBButton>
          </div>
        )}

        {/* Building queue spinner */}
        {importPhase === 'building-queue' && (
          <div className="rounded-xl border border-line bg-paper-2 px-5 py-6 flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-amber shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <div>
              <div className="text-[13px] font-medium text-ink">Building import queue…</div>
              <div className="text-[11.5px] text-ink-3">
                {queueCount > 0 ? `${queueCount} files found so far` : 'Listing your Dropbox…'}
              </div>
            </div>
          </div>
        )}

        {/* ── Dropbox file tree (when connected and not importing) ── */}
        {dbxToken && !isImporting && importPhase !== 'done' && (
          <DropboxTree
            token={dbxToken}
            onDisconnect={handleDisconnectDropbox}
            onStartImport={(sel, all, nodes) => void handleStartImport(sel, all, nodes)}
            importRunning={importPhase !== 'idle'}
          />
        )}

        {/* ── How it works ── */}
        <div className="rounded-xl border border-line bg-paper-2 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-3">
            How import works
          </div>
          <ol className="space-y-2">
            {[
              'Connect your cloud provider via OAuth — we request read-only access',
              'Select the files and folders you want to bring over',
              'Beebeeb downloads each file and encrypts it client-side before uploading',
              'Your originals stay in Dropbox — we never delete from the source',
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-[13px] text-ink-2">
                <span className="w-5 h-5 rounded-full bg-amber-bg border border-amber/30 text-amber-deep text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </SettingsShell>
  )
}
