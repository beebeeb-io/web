/**
 * Settings — Import
 *
 * Import hub: connect a cloud provider and select files to migrate.
 * Supported: Dropbox (Day 1+2) · Google Drive (S2)
 *
 * Both providers share the encrypt→upload pipeline (encryptedUpload).
 * Only the download step and tree listing differ per provider.
 */

import { useState, useEffect, useRef } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import { useKeys } from '../../lib/key-context'
import {
  expandDropboxPaths,
  downloadDropboxFile,
  formatEta,
  formatSpeed,
  formatBytes as fmtBytes,
} from '../../lib/dropbox-import'
import {
  downloadGoogleFile,
  expandGoogleDrivePaths,
  
  
  
  GoogleAuthError,
  type GDriveImportItem,
} from '../../lib/google-import'
import { googleTokenRefresh } from '../../lib/api'
import { createImportFolderTree, importFileInto } from '../../lib/import-folders'
import { userFriendlyError } from '../../lib/user-friendly-error'
import { ACCOUNT_KEY, TOKEN_KEY, VERIFIER_KEY, generateChallenge, generateVerifier } from './import/dropbox-model'
import { findGDriveNode, type GDriveTreeNode, type TreeNode } from './import/tree-model'
import { DropboxTree } from './import/dropbox-tree'
import { GoogleDriveTree } from './import/gdrive-tree'
import { ProviderCard, DropboxLogo, GoogleDriveLogo } from './import/provider-card'
import {
  GD_TOKEN_KEY,
  GD_REFRESH_KEY,
  GD_EMAIL_KEY,
  GD_VERIFIER_KEY,
} from './import/google-callback'

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsImport() {
  const { showToast } = useToast()
  const { getMasterKey } = useKeys()

  // ── Dropbox auth ────────────────────────────────────────────────────────────
  const [dbxToken, setDbxToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY))
  const [dbxConnecting, setDbxConnecting] = useState(false)
  const appKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined

  // ── Google Drive auth ───────────────────────────────────────────────────────
  const [gdToken, setGdToken] = useState<string | null>(() => sessionStorage.getItem(GD_TOKEN_KEY))
  const [gdConnecting, setGdConnecting] = useState(false)
  const gdClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  // Keep a ref for the current GD token so the import loop can update it on refresh
  const gdTokenRef = useRef<string | null>(gdToken)
  useEffect(() => { gdTokenRef.current = gdToken }, [gdToken])

  // ── Security: purge OAuth tokens from sessionStorage immediately after reading into state.
  // Tokens are held in React state for the session; sessionStorage is only used as a
  // callback handoff and must not persist (any XSS could steal live tokens from storage).
  useEffect(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ACCOUNT_KEY)
  }, [])
  useEffect(() => {
    sessionStorage.removeItem(GD_TOKEN_KEY)
    // GD_REFRESH_KEY is intentionally kept until disconnect — it is re-read during
    // token refresh inside the import loop. It is removed in handleDisconnectGDrive.
  }, [])

  // ── Import pipeline state (shared across providers) ─────────────────────────
  type ImportPhase = 'idle' | 'building-queue' | 'importing' | 'paused' | 'done'

  interface FileProgress {
    path: string   // used as unique key (dropbox path or google file ID)
    name: string
    size: number
    status: 'queued' | 'downloading' | 'encrypting' | 'uploading' | 'done' | 'failed'
    error?: string
  }

  const [importPhase, setImportPhase]     = useState<ImportPhase>('idle')
  const [importQueue, setImportQueue]     = useState<FileProgress[]>([])
  const [importIdx, setImportIdx]         = useState(0)
  const [doneBytes, setDoneBytes]         = useState(0)
  const [totalBytes, setTotalBytes]       = useState(0)
  const [failedPaths, setFailedPaths]     = useState<string[]>([])
  const [throughputBps, setThroughputBps] = useState(0)
  const [queueCount, setQueueCount]       = useState(0)
  const [skippedDocs, setSkippedDocs]     = useState(0)
  const [activeProvider, setActiveProvider] = useState<'dropbox' | 'google' | null>(null)

  const pausedRef    = useRef(false)
  const cancelCtrlRef = useRef<AbortController | null>(null)
  const speedWindowRef = useRef<{ t: number; b: number }[]>([])

  function trackThroughput(bytes: number) {
    const now = Date.now()
    speedWindowRef.current.push({ t: now, b: bytes })
    speedWindowRef.current = speedWindowRef.current.filter(s => now - s.t < 10_000)
    const windowBytes = speedWindowRef.current.reduce((s, x) => s + x.b, 0)
    const windowSecs = Math.max((now - (speedWindowRef.current[0]?.t ?? now)) / 1000, 0.1)
    setThroughputBps(windowBytes / windowSecs)
  }

  function resetImportState() {
    setImportIdx(0)
    setDoneBytes(0)
    setFailedPaths([])
    setQueueCount(0)
    setSkippedDocs(0)
    speedWindowRef.current = []
    pausedRef.current = false
  }

  // ── Core worker loop (runs the actual import for any provider) ───────────────

  async function runWorkerLoop(
    rawQueue: Array<{ key: string; name: string; parentPath: string; size: number }>,
    downloadFn: (key: string, signal: AbortSignal) => Promise<Blob>,
    masterKey: Uint8Array,
  ) {
    let bytesAccum = 0
    const localFailed: string[] = []
    // L13 (SF-0001): one folder tree per run, under ids this run mints. A
    // folder whose create failed stops its subtree for the rest of the run:
    // each file under it fails with that error (src/lib/import-folders.ts).
    const folders = createImportFolderTree(masterKey, {
      onFolderFailed: (folderPath, error) => showToast({
        icon: 'folder',
        title: 'Folder not created',
        description: `${folderPath}: ${userFriendlyError(error)} Nothing in it was imported.`,
        danger: true,
      }),
    })

    for (let i = 0; i < rawQueue.length; i++) {
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
          await importFileInto({
            folders,
            parentPath: item.parentPath,
            name: item.name,
            masterKey,
            download: (signal) => downloadFn(item.key, signal),
            signal: ctrl.signal,
            onStatus: updateStatus,
            onBytes: trackThroughput,
          })

          updateStatus('done')
          bytesAccum += item.size
          setDoneBytes(bytesAccum)
          success = true
          break
        } catch (err) {
          if (ctrl.signal.aborted) {
            setImportPhase('idle')
            showToast({ icon: 'x', title: 'Import cancelled' })
            return
          }
          if (attempt === 1) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            updateStatus('failed', msg)
            localFailed.push(item.key)
            setFailedPaths(prev => [...prev, item.key])
          }
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
      title: 'Import complete',
      description: `${rawQueue.length} files imported${localFailed.length > 0 ? ` · ${localFailed.length} failed` : ''}`,
    })
  }

  // ── Dropbox import ───────────────────────────────────────────────────────────

  async function handleStartImport(selectedPaths: Set<string>, selectAll: boolean, treeNodes: TreeNode[]) {
    if (!dbxToken || !getMasterKey) return

    setActiveProvider('dropbox')
    setImportPhase('building-queue')
    resetImportState()

    try {
      const pathsToExpand = selectAll ? treeNodes.map(n => n.path) : Array.from(selectedPaths)
      const rawQueue = await expandDropboxPaths(dbxToken, pathsToExpand, n => setQueueCount(n))

      if (rawQueue.length === 0) {
        showToast({ icon: 'cloud', title: 'Nothing to import', description: 'No files found in the selected folders.' })
        setImportPhase('idle')
        return
      }

      setTotalBytes(rawQueue.reduce((s, f) => s + f.size, 0))
      setImportQueue(rawQueue.map(f => ({ path: f.dropboxPath, name: f.name, size: f.size, status: 'queued' })))
      setImportPhase('importing')

      const masterKey = getMasterKey()
      const token = dbxToken
      await runWorkerLoop(
        rawQueue.map(f => ({ key: f.dropboxPath, name: f.name, parentPath: f.parentDropboxPath, size: f.size })),
        async (path, signal) => downloadDropboxFile(path, token, signal),
        masterKey,
      )
    } catch (err) {
      setImportPhase('idle')
      showToast({ icon: 'x', title: 'Import failed', description: err instanceof Error ? err.message : '', danger: true })
    }
  }

  // ── Google Drive import ──────────────────────────────────────────────────────

  async function handleStartGDriveImport(
    selectedIds: Set<string>,
    selectAll: boolean,
    treeNodes: GDriveTreeNode[],
  ) {
    if (!gdToken || !getMasterKey) return

    setActiveProvider('google')
    setImportPhase('building-queue')
    resetImportState()

    try {
      // Collect items to expand from the tree
      let itemsToExpand: Array<{ id: string; name: string; mimeType: string; parentPath: string; size?: number }>
      if (selectAll) {
        itemsToExpand = treeNodes
          .filter(n => n.tag !== 'gdoc')
          .map(n => ({ id: n.id, name: n.name, mimeType: n.mimeType, parentPath: n.parentPath, size: n.size }))
      } else {
        itemsToExpand = Array.from(selectedIds).flatMap(id => {
          const node = findGDriveNode(treeNodes, id)
          if (!node || node.tag === 'gdoc') return []
          return [{ id: node.id, name: node.name, mimeType: node.mimeType, parentPath: node.parentPath, size: node.size }]
        })
      }

      const { files: rawQueue, skippedDocs: docCount } = await expandGoogleDrivePaths(
        gdToken,
        itemsToExpand,
        n => setQueueCount(n),
      )

      setSkippedDocs(docCount)

      if (rawQueue.length === 0) {
        const msg = docCount > 0
          ? `No files found. ${docCount} Google Doc${docCount !== 1 ? 's' : ''} skipped (export not supported yet).`
          : 'No files found in the selected folders.'
        showToast({ icon: 'cloud', title: 'Nothing to import', description: msg })
        setImportPhase('idle')
        return
      }

      setTotalBytes(rawQueue.reduce((s, f) => s + f.size, 0))
      setImportQueue(rawQueue.map((f: GDriveImportItem) => ({
        path: f.fileId, name: f.name, size: f.size, status: 'queued' as const,
      })))
      setImportPhase('importing')

      const masterKey = getMasterKey()

      // Download function with 401 → refresh → retry
      const downloadWithRefresh = async (fileId: string, signal: AbortSignal): Promise<Blob> => {
        try {
          return await downloadGoogleFile(fileId, gdTokenRef.current!, signal)
        } catch (err) {
          if (err instanceof GoogleAuthError) {
            // Refresh the token
            const refreshToken = sessionStorage.getItem(GD_REFRESH_KEY)
            if (!refreshToken) throw new Error('Google token expired and no refresh token available.')
            const refreshed = await googleTokenRefresh(refreshToken)
            sessionStorage.setItem(GD_TOKEN_KEY, refreshed.access_token)
            gdTokenRef.current = refreshed.access_token
            setGdToken(refreshed.access_token)
            // Retry with new token
            return downloadGoogleFile(fileId, refreshed.access_token, signal)
          }
          throw err
        }
      }

      await runWorkerLoop(
        rawQueue.map((f: GDriveImportItem) => ({ key: f.fileId, name: f.name, parentPath: f.parentPath, size: f.size })),
        downloadWithRefresh,
        masterKey,
      )
    } catch (err) {
      setImportPhase('idle')
      showToast({ icon: 'x', title: 'Import failed', description: err instanceof Error ? err.message : '', danger: true })
    }
  }

  // ── Pause / cancel ───────────────────────────────────────────────────────────

  function handlePauseResume() {
    pausedRef.current = !pausedRef.current
    if (!pausedRef.current) setImportPhase('importing')
  }

  function handleCancel() {
    cancelCtrlRef.current?.abort()
    pausedRef.current = false
    setImportPhase('idle')
  }

  // ── OAuth handlers ───────────────────────────────────────────────────────────

  async function handleConnectDropbox() {
    if (!appKey) return
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

  async function handleConnectGDrive() {
    if (!gdClientId) return
    setGdConnecting(true)
    try {
      const verifier = generateVerifier()
      const challenge = await generateChallenge(verifier)
      sessionStorage.setItem(GD_VERIFIER_KEY, verifier)
      const redirectUri = `${window.location.origin}/settings/import/google/callback`
      const params = new URLSearchParams({
        client_id: gdClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        access_type: 'offline',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
      })
      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    } catch (err) {
      setGdConnecting(false)
      showToast({ icon: 'x', title: 'Could not start OAuth', description: err instanceof Error ? err.message : '', danger: true })
    }
  }

  function handleDisconnectGDrive() {
    sessionStorage.removeItem(GD_TOKEN_KEY)
    sessionStorage.removeItem(GD_REFRESH_KEY)
    sessionStorage.removeItem(GD_EMAIL_KEY)
    setGdToken(null)
    showToast({ icon: 'check', title: 'Google Drive disconnected' })
    setImportPhase('idle')
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const isImporting  = importPhase === 'importing' || importPhase === 'paused'
  const progressPct  = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0
  const currentFile  = importQueue[importIdx]
  const eta          = formatEta(totalBytes - doneBytes, throughputBps)
  const speed        = formatSpeed(throughputBps)
  const anyConnected = !!(dbxToken || gdToken)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SettingsShell activeSection="import">
      <SettingsHeader
        title="Import"
        subtitle="Migrate your files from another cloud service. Files are encrypted during transfer — we never see the plaintext."
      />

      <div className="p-7 space-y-6">
        {/* ── Provider card grid (when not connected) ──
            Task 1543 finding 6: this grid used to be gated on
            `appKey || gdClientId` — with NEITHER env var configured in the
            production build (neither is wired as a Docker build ARG), the
            entire section silently vanished, leaving a live-looking "Import"
            page with no way to start an import and no messaging that the
            feature isn't available (unlike every other unfinished settings
            page, which shows an explicit "Coming soon" state). The grid now
            always renders; each provider independently falls back to its own
            honest `comingSoon` card when its env var isn't set, so a future
            real deployment of either integration keeps working unchanged. */}
        {!anyConnected && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-3">
              Connect a provider
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ProviderCard
                name="Dropbox"
                logo={<DropboxLogo />}
                status={dbxConnecting ? 'connecting' : 'disconnected'}
                onConnect={appKey ? () => void handleConnectDropbox() : undefined}
                comingSoon={!appKey}
                usDisclosure={appKey ? 'Connects to Dropbox (US service). Files are downloaded directly to your browser and encrypted before upload to Beebeeb. Dropbox does not receive your encryption keys.' : undefined}
              />
              <ProviderCard
                name="Google Drive"
                logo={<GoogleDriveLogo />}
                status={gdConnecting ? 'connecting' : 'disconnected'}
                onConnect={gdClientId ? () => void handleConnectGDrive() : undefined}
                comingSoon={!gdClientId}
                usDisclosure={gdClientId ? 'Connects to Google (US service). Files are downloaded directly to your browser and encrypted before upload to Beebeeb. Google does not receive your encryption keys.' : undefined}
              />
            </div>
          </div>
        )}

        {/* ── Import progress panel (shared across providers) ── */}
        {isImporting && (
          <div className="rounded-xl border border-line bg-paper overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-line bg-paper-2">
              <svg className="animate-spin h-4 w-4 text-amber shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <span className="text-[13px] font-semibold text-ink flex-1">
                {importPhase === 'paused'
                  ? 'Import paused'
                  : `Importing from ${activeProvider === 'google' ? 'Google Drive' : 'Dropbox'}…`}
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
                  <div className="h-full rounded-full bg-amber transition-all duration-500" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="text-[10.5px] text-ink-4 mt-1">{progressPct}% complete</div>
              </div>

              {currentFile && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-paper-2 border border-line">
                  <Icon name="file" size={13} className="text-ink-3 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-ink truncate">{currentFile.name}</div>
                    <div className="text-[11px] text-ink-3 truncate font-mono">{currentFile.path.slice(0, 60)}</div>
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

              {importQueue.filter(f => f.status === 'done').slice(-3).reverse().map(f => (
                <div key={f.path} className="flex items-center gap-2 text-[11.5px] text-ink-3">
                  <Icon name="check" size={11} className="text-green shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto font-mono shrink-0">{fmtBytes(f.size)}</span>
                </div>
              ))}

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
                {skippedDocs > 0 && ` · ${skippedDocs} Google Doc${skippedDocs !== 1 ? 's' : ''} skipped`}
                {` · ${fmtBytes(doneBytes)} transferred`}
              </div>
            </div>
            <BBButton size="sm" variant="ghost" onClick={() => { setImportPhase('idle'); setActiveProvider(null) }}>
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
                {queueCount > 0 ? `${queueCount} files found so far` : `Listing your ${activeProvider === 'google' ? 'Google Drive' : 'Dropbox'}…`}
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

        {/* ── Google Drive file tree (when connected and not importing) ── */}
        {gdToken && !isImporting && importPhase !== 'done' && (
          <GoogleDriveTree
            token={gdToken}
            onDisconnect={handleDisconnectGDrive}
            onStartImport={(sel, all, nodes) => void handleStartGDriveImport(sel, all, nodes)}
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
              'Your originals stay in the source — we never delete from the source',
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
