/**
 * /file-requests — File-request owner management (auth required).
 *
 * File requests are the inverse of sharing: a self-contained link anyone can
 * use to upload file(s) INTO the owner's encrypted vault, no account needed.
 * The owner creates a request here, gets a link, and shares it. Uploaded files
 * land in a chosen folder and only the owner can decrypt them.
 *
 * Crypto (per-request sealed keypair, all via beebeeb-core WASM):
 *   - On create: generate an X25519 keypair (R_pub, R_priv); wrap R_priv under
 *     the master key; POST only the wrapped private key. R_pub never touches the
 *     server — it rides in the link fragment `…/r/<token>#<R_pub>`.
 *   - "Copy link" later: unwrap R_priv (master key) → derive R_pub → rebuild the
 *     link. Zero pubkey is stored server-side.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DriveLayout } from '../components/drive-layout'
import { BBButton, Icon } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { useToast } from '../components/toast'
import {
  listFiles,
  listFileRequests,
  createFileRequest,
  closeFileRequest,
  type FileRequest,
} from '../lib/api'
import {
  generateRequestKeypair,
  wrapRequestPrivate,
  unwrapRequestPrivate,
  derivePublicFromPrivate,
  decryptFileMetadata,
  toBase64,
  toBase64url,
  fromBase64,
  zeroize,
} from '../lib/crypto'
import { formatBytes } from '../lib/format'

// ─── Small helpers ──────────────────────────────────────────────────────────

type RequestStatus = 'open' | 'closed' | 'expired'

function statusOf(r: FileRequest): RequestStatus {
  if (r.closed) return 'closed'
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return 'expired'
  return 'open'
}

function buildLink(token: string, rPub: Uint8Array): string {
  return `${window.location.origin}/r/${token}#${toBase64url(rPub)}`
}

const EXPIRY_OPTIONS: { label: string; secs: number | null }[] = [
  { label: 'Never', secs: null },
  { label: '1 day', secs: 86400 },
  { label: '7 days', secs: 7 * 86400 },
  { label: '30 days', secs: 30 * 86400 },
]

const SIZE_OPTIONS: { label: string; bytes: number | null }[] = [
  { label: 'No limit', bytes: null },
  { label: '100 MB', bytes: 100 * 1024 * 1024 },
  { label: '500 MB', bytes: 500 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 * 1024 * 1024 },
  { label: '5 GB', bytes: 5 * 1024 * 1024 * 1024 },
]

// ─── Inline folder picker (drill-down; selected target = current folder) ─────

interface Crumb { id: string | null; name: string }

function FolderPicker({
  value,
  onChange,
}: {
  value: Crumb[]
  onChange: (path: Crumb[]) => void
}) {
  const { getFileKey, isUnlocked } = useKeys()
  const [subfolders, setSubfolders] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const current = value[value.length - 1]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listFiles(current.id ?? undefined, false)
      .then(async (files) => {
        const folders = files.filter((f) => f.is_folder)
        const named = await Promise.all(
          folders.map(async (f) => {
            let name = f.name_encrypted
            if (isUnlocked) {
              try {
                const key = await getFileKey(f.id)
                name = (await decryptFileMetadata(key, f.name_encrypted)).name
              } catch { /* keep raw */ }
            }
            return { id: f.id, name }
          }),
        )
        if (!cancelled) setSubfolders(named)
      })
      .catch(() => { if (!cancelled) setSubfolders([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [current.id, getFileKey, isUnlocked])

  return (
    <div className="rounded-lg border border-line bg-paper">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-line text-[12px]">
        {value.map((c, i) => {
          const isLast = i === value.length - 1
          return (
            <span key={`${c.id ?? 'root'}-${i}`} className="flex items-center gap-1">
              {i > 0 && <Icon name="chevron-right" size={11} className="text-ink-4" />}
              {isLast ? (
                <span className="font-semibold text-ink">{c.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onChange(value.slice(0, i + 1))}
                  className="text-amber-deep font-medium hover:underline cursor-pointer"
                >
                  {c.name}
                </button>
              )}
            </span>
          )
        })}
      </div>
      {/* Subfolder list */}
      <div className="max-h-40 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-center text-[12px] text-ink-3">Loading…</div>
        ) : subfolders.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-ink-4">No subfolders here</div>
        ) : (
          subfolders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange([...value, { id: f.id, name: f.name }])}
              className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-paper-2 transition-colors cursor-pointer"
            >
              <Icon name="folder" size={13} className="text-ink-3" />
              <span className="text-[12px] text-ink truncate">{f.name}</span>
              <Icon name="chevron-right" size={11} className="text-ink-4 ml-auto" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Status pill ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RequestStatus }) {
  const map: Record<RequestStatus, { label: string; cls: string }> = {
    open: { label: 'Open', cls: 'bg-green/10 text-green' },
    closed: { label: 'Closed', cls: 'bg-paper-3 text-ink-3' },
    expired: { label: 'Expired', cls: 'bg-paper-3 text-ink-3' },
  }
  const { label, cls } = map[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function FileRequestPage() {
  const { getMasterKey, isUnlocked } = useKeys()
  const { showToast } = useToast()

  const [requests, setRequests] = useState<FileRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [folderPath, setFolderPath] = useState<Crumb[]>([{ id: null, name: 'My files' }])
  const [maxFiles, setMaxFiles] = useState(1)
  const [maxBytes, setMaxBytes] = useState<number | null>(null)
  const [expirySecs, setExpirySecs] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [justCreatedLink, setJustCreatedLink] = useState<string | null>(null)

  const [closingId, setClosingId] = useState<string | null>(null)
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null)

  const targetFolderId = folderPath[folderPath.length - 1]?.id ?? null

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { file_requests } = await listFileRequests()
      setRequests(file_requests)
    } catch (e) {
      console.error('[file-requests] list failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const copyLinkToClipboard = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      showToast({ icon: 'check', title: 'Link copied to clipboard' })
    } catch {
      showToast({ icon: 'link', title: 'Could not copy automatically', description: 'Select the link and copy it manually.', danger: true })
    }
  }, [showToast])

  const resetForm = useCallback(() => {
    setTitle('')
    setDescription('')
    setFolderPath([{ id: null, name: 'My files' }])
    setMaxFiles(1)
    setMaxBytes(null)
    setExpirySecs(null)
    setCreateError(null)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      setCreateError('Give your request a title so people know what to send.')
      return
    }
    if (!isUnlocked) {
      setCreateError('Your vault is locked. Unlock it to create a request.')
      return
    }
    setCreating(true)
    setCreateError(null)
    setJustCreatedLink(null)

    const keypair = await generateRequestKeypair()
    try {
      const masterKey = getMasterKey()
      const { wrapped, nonce } = await wrapRequestPrivate(masterKey, keypair.privateKey)
      const result = await createFileRequest({
        title: title.trim(),
        description: description.trim() || undefined,
        target_folder_id: targetFolderId ?? undefined,
        max_files: maxFiles,
        max_total_bytes: maxBytes ?? undefined,
        expires_in_secs: expirySecs ?? undefined,
        wrapped_private_key: toBase64(wrapped),
        wrap_nonce: toBase64(nonce),
      })
      const link = buildLink(result.token, keypair.publicKey)
      setJustCreatedLink(link)
      await copyLinkToClipboard(link)
      resetForm()
      setShowForm(false)
      await refresh()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create the request. Please try again.')
    } finally {
      zeroize(keypair.privateKey)
      setCreating(false)
    }
  }, [title, description, targetFolderId, maxFiles, maxBytes, expirySecs, isUnlocked, getMasterKey, copyLinkToClipboard, resetForm, refresh])

  /** Rebuild R_pub from the stored wrapped private key and copy the link. */
  const handleCopyExisting = useCallback(async (r: FileRequest) => {
    if (!r.token || !r.wrapped_private_key || !r.wrap_nonce) {
      showToast({ icon: 'shield', title: 'Missing key material', description: 'This request cannot have its link rebuilt.', danger: true })
      return
    }
    if (!isUnlocked) {
      showToast({ icon: 'lock', title: 'Vault locked', description: 'Unlock your vault to rebuild the link.', danger: true })
      return
    }
    let rPriv: Uint8Array | null = null
    try {
      const masterKey = getMasterKey()
      rPriv = await unwrapRequestPrivate(masterKey, fromBase64(r.wrapped_private_key), fromBase64(r.wrap_nonce))
      const rPub = await derivePublicFromPrivate(rPriv)
      await copyLinkToClipboard(buildLink(r.token, rPub))
    } catch (e) {
      console.error('[file-requests] rebuild link failed', e)
      showToast({ icon: 'link', title: 'Could not rebuild the link', danger: true })
    } finally {
      if (rPriv) zeroize(rPriv)
    }
  }, [isUnlocked, getMasterKey, copyLinkToClipboard, showToast])

  const handleClose = useCallback(async (id: string) => {
    setClosingId(id)
    try {
      await closeFileRequest(id)
      showToast({ icon: 'check', title: 'Request closed', description: 'No new uploads will be accepted. Received files are kept.' })
      setConfirmCloseId(null)
      await refresh()
    } catch (e) {
      showToast({ icon: 'shield', title: 'Could not close the request', description: e instanceof Error ? e.message : undefined, danger: true })
    } finally {
      setClosingId(null)
    }
  }, [refresh, showToast])

  const openCount = useMemo(() => requests.filter((r) => statusOf(r) === 'open').length, [requests])

  return (
    <DriveLayout>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-start gap-3 mb-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber/25 bg-amber-bg">
              <Icon name="link" size={18} className="text-amber-deep" />
            </div>
            <div className="flex-1">
              <h1 className="text-[22px] font-semibold text-ink">File requests</h1>
              <p className="text-[13px] leading-relaxed text-ink-2 mt-1">
                Create a link anyone can use to send files straight into your vault — no account
                needed. Files are encrypted in their browser and sealed so only you can open them.
              </p>
            </div>
            {!showForm && (
              <BBButton onClick={() => { setShowForm(true); setJustCreatedLink(null) }}>
                New request
              </BBButton>
            )}
          </div>

          {/* Just-created link banner */}
          {justCreatedLink && (
            <div className="mb-6 rounded-xl border border-amber/30 bg-amber-bg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Icon name="check" size={13} className="text-amber-deep" />
                <span className="text-[12px] font-semibold text-ink">Request created — link copied</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-md bg-paper border border-line px-2.5 py-1.5 text-[11px] font-mono text-ink-2">
                  {justCreatedLink}
                </code>
                <BBButton size="sm" onClick={() => copyLinkToClipboard(justCreatedLink)}>Copy</BBButton>
              </div>
              <p className="text-[11px] text-ink-3 mt-2">
                Keep the whole link intact — the part after <span className="font-mono">#</span> is the
                encryption key and is never sent to our servers.
              </p>
            </div>
          )}

          {/* Create form */}
          {showForm && (
            <div className="mb-6 rounded-xl border border-line-2 bg-paper shadow-2 p-5">
              <h2 className="text-[15px] font-semibold text-ink mb-4">New file request</h2>

              <label className="block mb-3">
                <span className="text-[12px] font-medium text-ink-2">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Send me your signed contract"
                  maxLength={200}
                  className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                />
              </label>

              <label className="block mb-3">
                <span className="text-[12px] font-medium text-ink-2">Description <span className="text-ink-4">(optional)</span></span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short note shown on the upload page"
                  maxLength={2000}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none resize-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                />
              </label>

              <div className="mb-3">
                <span className="text-[12px] font-medium text-ink-2">Where files land</span>
                <div className="mt-1">
                  <FolderPicker value={folderPath} onChange={setFolderPath} />
                </div>
                <p className="text-[11px] text-ink-4 mt-1">
                  Uploads land in <span className="font-medium text-ink-3">{folderPath[folderPath.length - 1].name}</span>.
                  Open a subfolder above to change it.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <label className="block">
                  <span className="text-[12px] font-medium text-ink-2">Max files</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxFiles}
                    onChange={(e) => setMaxFiles(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                    className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-ink-2">Total size</span>
                  <select
                    value={maxBytes ?? ''}
                    onChange={(e) => setMaxBytes(e.target.value === '' ? null : Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                  >
                    {SIZE_OPTIONS.map((o) => (
                      <option key={o.label} value={o.bytes ?? ''}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-ink-2">Expires</span>
                  <select
                    value={expirySecs ?? ''}
                    onChange={(e) => setExpirySecs(e.target.value === '' ? null : Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.label} value={o.secs ?? ''}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {createError && (
                <div className="mb-3 rounded-lg bg-red/5 border border-red/20 px-3 py-2 text-[12px] text-red">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="text-[12px] text-ink-3 hover:text-ink px-3 py-2 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <BBButton onClick={handleCreate} disabled={creating}>
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Creating…
                    </span>
                  ) : 'Create & copy link'}
                </BBButton>
              </div>
            </div>
          )}

          {/* Requests list */}
          {loading ? (
            <div className="py-12 text-center text-[13px] text-ink-3">Loading your requests…</div>
          ) : requests.length === 0 ? (
            !showForm && (
              <div className="rounded-xl border border-dashed border-line-2 bg-paper-2 p-10 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-paper-3 flex items-center justify-center">
                  <Icon name="link" size={20} className="text-ink-3" />
                </div>
                <p className="text-[14px] font-medium text-ink">No file requests yet</p>
                <p className="text-[12px] text-ink-3 mt-1 mb-4">
                  Create one to start collecting files from anyone — securely.
                </p>
                <BBButton onClick={() => setShowForm(true)}>New request</BBButton>
              </div>
            )
          ) : (
            <div className="space-y-3">
              {openCount > 0 && (
                <p className="text-[11px] text-ink-4 font-mono">{openCount} open · {requests.length} total</p>
              )}
              {requests.map((r) => {
                const status = statusOf(r)
                const confirming = confirmCloseId === r.id
                return (
                  <div key={r.id} className="rounded-xl border border-line-2 bg-paper p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[14px] font-semibold text-ink truncate">{r.title}</h3>
                          <StatusPill status={status} />
                        </div>
                        {r.description && (
                          <p className="text-[12px] text-ink-3 mt-0.5 line-clamp-2">{r.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-3 font-mono">
                          <span>{r.files_received} / {r.max_files} files</span>
                          <span>
                            {formatBytes(r.total_bytes_received)}
                            {r.max_total_bytes != null && ` / ${formatBytes(r.max_total_bytes)}`} received
                          </span>
                          {r.expires_at && (
                            <span>
                              {status === 'expired' ? 'expired ' : 'expires '}
                              {new Date(r.expires_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
                      {status === 'open' && (
                        <button
                          type="button"
                          onClick={() => handleCopyExisting(r)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-deep hover:underline cursor-pointer"
                        >
                          <Icon name="link" size={12} />
                          Copy link
                        </button>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {status === 'open' && !confirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmCloseId(r.id)}
                            className="text-[12px] text-ink-3 hover:text-red transition-colors cursor-pointer"
                          >
                            Close
                          </button>
                        )}
                        {confirming && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-ink-3">
                              Close this request? Received files are kept.
                            </span>
                            <button
                              type="button"
                              onClick={() => setConfirmCloseId(null)}
                              className="text-[12px] text-ink-3 hover:text-ink cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClose(r.id)}
                              disabled={closingId === r.id}
                              className="text-[12px] font-medium text-red hover:underline cursor-pointer"
                            >
                              {closingId === r.id ? 'Closing…' : 'Close request'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </DriveLayout>
  )
}
