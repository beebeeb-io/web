/**
 * /file-requests — E2EE File Requests (authenticated)
 *
 * Owner creates a request link.  Anyone with the link can upload directly
 * into the owner's vault — the file is encrypted in the uploader's browser
 * with the owner's ephemeral public key before it reaches the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import {
  createFileRequest,
  listFileRequests,
  type FileRequest,
} from '../lib/api'
import { useToast } from '../components/toast'

// ─── Expiry options ─────────────────────────────────────────────────────────

const EXPIRY_OPTIONS = [
  { label: '7 days', secs: 7 * 24 * 3600 },
  { label: '30 days', secs: 30 * 24 * 3600 },
  { label: 'No expiry', secs: null },
] as const

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a random X25519-style public key placeholder (32 bytes, base64url). */
async function generateEphemeralKeyPair(): Promise<{ publicKeyB64: string; privateKeyB64: string }> {
  // Use ECDH P-256 (Web Crypto) as a stand-in for X25519.
  // The real production flow would use X25519 via the WASM core; for now
  // we generate an ECDH P-256 key pair and export the public key as raw bytes.
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const pubRaw = await crypto.subtle.exportKey('raw', pair.publicKey)
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const b64url = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }
  return {
    publicKeyB64: b64url(pubRaw),
    privateKeyB64: JSON.stringify(privJwk),
  }
}

function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'No expiry'
  const exp = new Date(expiresAt)
  const diff = exp.getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) {
    const hours = Math.floor(diff / (1000 * 60 * 60))
    return `${hours}h remaining`
  }
  return `${days}d remaining`
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [value])

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-paper-3 border border-line text-[12px] text-ink-2 hover:text-ink hover:bg-paper-3/80 transition-colors cursor-pointer"
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      {copied ? 'Copied' : 'Copy link'}
    </button>
  )
}

function RequestRow({ req }: { req: FileRequest }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-line last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-ink truncate">{req.title}</span>
          <span className="text-[11px] text-ink-4 font-mono shrink-0">
            {req.files_received}/{req.max_files} files
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-3 font-mono truncate">{req.request_url}</span>
          <span className="text-[11px] text-ink-4 shrink-0">· {formatExpiry(req.expires_at)}</span>
        </div>
      </div>
      <CopyButton value={req.request_url} />
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function FileRequestPage() {
  const { showToast } = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expiryIdx, setExpiryIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)

  const [requests, setRequests] = useState<FileRequest[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const privateKeyRef = useRef<string | null>(null)

  // Load existing requests
  useEffect(() => {
    listFileRequests()
      .then(r => setRequests(r.file_requests))
      .catch(() => {})
      .finally(() => setLoadingList(false))
  }, [])

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setNewLink(null)
    try {
      const { publicKeyB64, privateKeyB64 } = await generateEphemeralKeyPair()
      privateKeyRef.current = privateKeyB64

      const expiry = EXPIRY_OPTIONS[expiryIdx]
      const req = await createFileRequest({
        title: title.trim(),
        description: description.trim() || undefined,
        ephemeral_public_key: publicKeyB64,
        expires_in_secs: expiry.secs ?? undefined,
        max_files: 10,
      })

      setNewLink(req.request_url)
      setRequests(prev => [req, ...prev])
      setTitle('')
      setDescription('')
      showToast({ icon: 'check', title: 'File request created.' })
    } catch (err) {
      showToast({ icon: 'x', title: err instanceof Error ? err.message : 'Failed to create request.', danger: true })
    } finally {
      setSubmitting(false)
    }
  }, [title, description, expiryIdx, showToast])

  return (
    <DriveLayout>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-[22px] font-semibold text-ink mb-1">File requests</h1>
            <p className="text-[13px] text-ink-2 leading-relaxed">
              Share a link — anyone can upload a file directly into your vault.
              Files are encrypted in their browser before they reach the server.
            </p>
          </div>

          {/* Create form */}
          <div className="rounded-xl border border-line bg-paper p-5 mb-6">
            <h2 className="text-[14px] font-semibold text-ink mb-4">New request</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-ink-2 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Send me your signed contract"
                  maxLength={200}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-line bg-paper-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-amber/40 focus:border-amber"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-2 mb-1">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What kind of file do you need?"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-line bg-paper-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-amber/40 focus:border-amber resize-none"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-2 mb-1">Expiry</label>
                <div className="flex gap-2">
                  {EXPIRY_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setExpiryIdx(i)}
                      className={`px-3 py-1.5 rounded-md text-[12px] border transition-colors cursor-pointer ${
                        expiryIdx === i
                          ? 'bg-amber text-white border-amber font-medium'
                          : 'bg-paper-2 text-ink-2 border-line hover:border-amber/40'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  <Icon name="lock" size={11} className="text-amber-deep" />
                  <span>Files encrypted in uploader's browser</span>
                </div>
                <BBButton type="submit" disabled={submitting || !title.trim()}>
                  {submitting ? 'Creating…' : 'Create request'}
                </BBButton>
              </div>
            </form>

            {/* New link display */}
            {newLink && (
              <div className="mt-4 rounded-lg border border-amber/30 bg-amber-bg p-3">
                <div className="text-[12px] font-medium text-ink mb-1.5">Share this link</div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-[11px] text-amber-deep truncate">{newLink}</span>
                  <CopyButton value={newLink} />
                </div>
              </div>
            )}
          </div>

          {/* Existing requests list */}
          <div className="rounded-xl border border-line bg-paper">
            <div className="px-5 py-3 border-b border-line">
              <h2 className="text-[13px] font-semibold text-ink">Your file requests</h2>
            </div>
            <div className="px-5">
              {loadingList ? (
                <div className="py-6 flex justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-amber" />
                </div>
              ) : requests.length === 0 ? (
                <div className="py-8 text-center">
                  <Icon name="link" size={28} className="text-ink-4 mx-auto mb-2" />
                  <p className="text-[13px] text-ink-3">No file requests yet.</p>
                </div>
              ) : (
                requests.map(r => <RequestRow key={r.id} req={r} />)
              )}
            </div>
          </div>

        </div>
      </div>
    </DriveLayout>
  )
}
