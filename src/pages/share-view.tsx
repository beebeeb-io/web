import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { ReportDialog } from '../components/report-dialog'
import {
  getShare,
  verifySharePassphrase,
  downloadSharedFile,
  fetchShareCiphertextPreview,
  getToken,
  ApiError,
  type ShareView as ShareViewData,
} from '../lib/api'
import { decryptFilename, fromBase64, parseEncryptedBlob, unwrapKeyFromShare, initCrypto } from '../lib/crypto'
import { decryptEncryptedBytes, inferChunkCountFromEncryptedSize } from '../lib/encrypted-download'
import { formatBytes } from '../lib/format'

// ─── Meta tag helpers ─────────────────────────────────────────────────────────

/** Beebeeb lock icon as a data URI for og:image fallback. */
const OG_IMAGE_DATA_URI =
  'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%221200%22 height%3D%22630%22 viewBox%3D%220 0 1200 630%22%3E%3Crect width%3D%221200%22 height%3D%22630%22 fill%3D%22%23fdf8f0%22%2F%3E%3Crect x%3D%22480%22 y%3D%22160%22 width%3D%22240%22 height%3D%22240%22 rx%3D%2240%22 fill%3D%22%23f5b800%22 opacity%3D%220.15%22%2F%3E%3Cpath d%3D%22M600 240 a60 60 0 0 1 60 60v70a10 10 0 0 1-10 10H550a10 10 0 0 1-10-10v-70a60 60 0 0 1 60-60z%22 fill%3D%22none%22 stroke%3D%22%23f5b800%22 stroke-width%3D%228%22%2F%3E%3Crect x%3D%22564%22 y%3D%22310%22 width%3D%2272%22 height%3D%2250%22 rx%3D%228%22 fill%3D%22%23f5b800%22%2F%3E%3Ccircle cx%3D%22600%22 cy%3D%22336%22 r%3D%228%22 fill%3D%22%23fdf8f0%22%2F%3E%3Ctext x%3D%22600%22 y%3D%22470%22 text-anchor%3D%22middle%22 font-family%3D%22Inter%2C sans-serif%22 font-size%3D%2232%22 font-weight%3D%22600%22 fill%3D%22%234a3f2f%22%3EEnd-to-end encrypted%3C%2Ftext%3E%3Ctext x%3D%22600%22 y%3D%22520%22 text-anchor%3D%22middle%22 font-family%3D%22Inter%2C sans-serif%22 font-size%3D%2224%22 fill%3D%22%238a7a62%22%3EBeebeeb%3C%2Ftext%3E%3C%2Fsvg%3E'

function setMetaTag(property: string, content: string, attr: 'name' | 'property' = 'name'): void {
  const selector = `meta[${attr}="${property}"]`
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function removeMetaTag(property: string, attr: 'name' | 'property' = 'name'): void {
  const selector = `meta[${attr}="${property}"]`
  document.querySelector(selector)?.remove()
}

/**
 * Sets share-specific meta tags on mount and restores defaults on unmount.
 * sharerName is used to personalise the title when available.
 */
function useShareMetaTags(sharerName?: string) {
  useEffect(() => {
    const prevTitle = document.title
    const title = sharerName
      ? `${sharerName} shared a file with you — Beebeeb`
      : 'Shared file — Beebeeb'
    const description = 'End-to-end encrypted file. Only you can decrypt it.'

    document.title = title
    setMetaTag('description', description)
    setMetaTag('og:title', title, 'property')
    setMetaTag('og:description', description, 'property')
    setMetaTag('og:image', OG_IMAGE_DATA_URI, 'property')
    setMetaTag('og:type', 'website', 'property')
    setMetaTag('twitter:card', 'summary_large_image')
    setMetaTag('twitter:title', title)
    setMetaTag('twitter:description', description)

    return () => {
      document.title = prevTitle
      setMetaTag('description', 'End-to-end encrypted cloud storage. Made in Europe.')
      removeMetaTag('og:title', 'property')
      removeMetaTag('og:description', 'property')
      removeMetaTag('og:image', 'property')
      removeMetaTag('og:type', 'property')
      removeMetaTag('twitter:card')
      removeMetaTag('twitter:title')
      removeMetaTag('twitter:description')
    }
  }, [sharerName])
}


function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'Never'
  const exp = new Date(expiresAt)
  const now = Date.now()
  const diff = exp.getTime() - now
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) {
    const minutes = Math.floor(diff / (1000 * 60))
    return `${minutes}m remaining`
  }
  if (hours < 24) return `${hours}h remaining`
  const days = Math.floor(hours / 24)
  return `${days}d remaining`
}

// ─── Glassbox sub-components ──────────────────────────────────────────────────

/** The amber "Decrypted in your browser" banner with collapsible explanation. */
function ZeroBanner() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-amber/30 bg-amber-bg overflow-hidden mb-4">
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Amber left accent */}
        <div className="w-0.5 self-stretch bg-amber-deep rounded-full shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="lock" size={12} className="text-amber-deep shrink-0" />
            <span className="text-[13px] font-semibold text-ink">Decrypted in your browser</span>
          </div>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Beebeeb cannot read this file. The decryption key is in the URL fragment
            {' '}<span className="font-mono text-[11px] text-amber-deep">#key=…</span>{' '}
            which never reaches our servers.
          </p>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="mt-2 flex items-center gap-1 text-[11.5px] text-amber-deep font-medium hover:underline underline-offset-2 cursor-pointer"
          >
            How does this work?
            <Icon
              name="chevron-down"
              size={10}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-amber/20 px-4 py-3 bg-amber-bg/60">
          <ol className="space-y-2.5">
            {[
              {
                n: '1',
                title: 'A random key was generated',
                body: 'When the file was shared, a random 256-bit key was created locally in the sender\'s browser. It never left their device in plaintext.',
              },
              {
                n: '2',
                title: 'The key encrypted the file',
                body: 'AES-256-GCM encrypted each chunk of the file client-side, running in WebAssembly. The server only ever received ciphertext.',
              },
              {
                n: '3',
                title: 'The key lives in the URL fragment',
                body: 'Browsers never send the #fragment to servers. When you opened this link, the key stayed local — we served you the ciphertext, your browser decrypted it.',
              },
            ].map(step => (
              <li key={step.n} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-amber-deep/20 text-amber-deep text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {step.n}
                </span>
                <div>
                  <div className="text-[12px] font-semibold text-ink">{step.title}</div>
                  <div className="text-[11.5px] text-ink-3 leading-relaxed mt-0.5">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/** Renders the URL with the #key=... fragment highlighted in amber. */
function UrlAnnotation() {
  const fullUrl = window.location.href
  const hashIdx = fullUrl.indexOf('#')
  if (hashIdx === -1) return null

  const base = fullUrl.slice(0, hashIdx)
  const fragment = fullUrl.slice(hashIdx) // includes the '#'

  // Extract just the key value for display truncation
  const params = new URLSearchParams(fragment.slice(1))
  const keyVal = params.get('key') ?? ''
  const keyDisplay =
    keyVal.length > 16
      ? `${keyVal.slice(0, 8)}…${keyVal.slice(-4)}`
      : keyVal

  const fragmentDisplay = `#key=${keyDisplay}`

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="text-[10.5px] font-mono text-ink-3 break-all leading-relaxed bg-paper-2 rounded-lg border border-line px-3 py-2.5">
        <span className="text-ink-4">{base}</span>
        <span
          className="text-amber-deep font-semibold"
          title={fragment}
        >
          {fragmentDisplay}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1.5 ml-[calc(1rem+1px)] text-[10.5px] text-ink-4">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" className="shrink-0">
          <path d="M4 0v10M1 8l3 4 3-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>this part never reaches our servers</span>
      </div>
    </div>
  )
}

/** Converts a Uint8Array to a formatted two-column hex dump string. */
function toHexDump(bytes: Uint8Array, limit = 64): string {
  const rows: string[] = []
  const capped = bytes.slice(0, limit)
  for (let i = 0; i < capped.length; i += 8) {
    const chunk = capped.slice(i, i + 8)
    rows.push(Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' '))
  }
  return rows.join('\n')
}

/** The "Show what the server sees" expandable panel. */
function ServerViewPanel({
  token,
  passphrase,
  decryptedName,
}: {
  token: string
  passphrase?: string
  decryptedName: string | null
}) {
  const [open, setOpen] = useState(false)
  const [ciphertext, setCiphertext] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    if (!open || ciphertext || loading) return
    setLoading(true)
    setFetchError(false)
    fetchShareCiphertextPreview(token, passphrase)
      .then(bytes => setCiphertext(bytes))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [open, ciphertext, loading, token, passphrase])

  const hexDump = ciphertext ? toHexDump(ciphertext, 64) : null

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors cursor-pointer"
      >
        <Icon
          name="chevron-down"
          size={10}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
        Show what the server sees
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-line overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-paper-2 border-b border-line">
            <div className="w-2.5 h-2.5 rounded-full bg-red/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green/60" />
            <span className="ml-1 text-[10px] font-mono text-ink-4">beebeeb-server · share/{token.slice(0, 8)}…</span>
          </div>

          <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-line">
            {/* Left: server's view — raw ciphertext */}
            <div className="flex-1 p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 mb-2">
                What the server stored
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-[11px] text-ink-4 py-2">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Fetching ciphertext…
                </div>
              ) : fetchError ? (
                <p className="text-[11px] text-ink-4 italic">Could not fetch</p>
              ) : hexDump ? (
                <>
                  <pre className="font-mono text-[10px] text-ink-3 leading-relaxed whitespace-pre overflow-x-auto bg-paper-3 rounded-md p-2">
                    {hexDump}
                  </pre>
                  <p className="text-[10px] text-ink-4 mt-1.5 italic">
                    First 64 bytes of AES-256-GCM ciphertext
                  </p>
                </>
              ) : null}
            </div>

            {/* Right: your view — decrypted */}
            <div className="flex-1 p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 mb-2">
                What you see
              </div>
              <div className="flex items-center gap-2 bg-paper-3 rounded-md px-3 py-2.5">
                <Icon name="file" size={14} className="text-ink-3 shrink-0" />
                <span className="text-[12px] font-medium text-ink truncate">
                  {decryptedName ?? 'Decrypting…'}
                </span>
              </div>
              <p className="text-[10px] text-ink-4 mt-1.5 italic">
                Your browser ran AES-256-GCM in WebAssembly
              </p>
            </div>
          </div>

          {/* Footer explanation */}
          <div className="px-3.5 py-2.5 bg-paper-2 border-t border-line text-[11px] text-ink-3 leading-relaxed">
            The math between these two columns is{' '}
            <span className="font-mono text-[10.5px] text-ink-2">AES-256-GCM</span> decryption,
            running entirely in your browser's WebAssembly engine. Beebeeb never holds the key.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Acquisition CTA ─────────────────────────────────────────────────────────

/**
 * Subtle sign-up nudge shown below the share card to unauthenticated visitors.
 * The file is the star — this is a quiet footnote, not a modal.
 */
function AcquisitionCTA({
  sharerName,
  signupUrl,
}: {
  sharerName?: string
  signupUrl: string
}) {
  return (
    <div className="mt-6 text-center px-4">
      <p className="text-[12.5px] text-ink-4 mb-1">Liked how this worked?</p>
      <p className="text-[13px] text-ink-3 mb-4 leading-relaxed max-w-[320px] mx-auto">
        {sharerName
          ? <><span className="text-ink-2 font-medium">{sharerName}</span> sent you this with end-to-end encryption — nobody else could read it.</>
          : 'This file was shared with end-to-end encryption — only you can read it.'}
        {' '}Get the same for your own files.
      </p>
      <a
        href={signupUrl}
        className="inline-flex items-center gap-2 px-5 py-2 bg-amber text-ink text-[13px] font-semibold rounded-lg hover:brightness-105 transition-all no-underline"
      >
        Sign up free — 5 GB
      </a>
      <p className="text-[11px] text-ink-4 mt-2.5">
        No credit card. No tracking. Just encrypted storage.
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>()
  const [shareData, setShareData] = useState<ShareViewData | null>(null)
  const [decryptedName, setDecryptedName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  // Tracks whether we have a usable key (from fragment or manual entry)
  const [keyAvailable, setKeyAvailable] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // Derive sharer display name for meta tags
  const sharerDisplay = shareData?.shared_by
    ? shareData.shared_by.includes('@')
      ? shareData.shared_by.split('@')[0]
      : shareData.shared_by
    : undefined
  useShareMetaTags(sharerDisplay)

  /** Check if raw name looks like encrypted JSON (not a human-readable filename). */
  function isEncryptedName(raw: string | null | undefined): boolean {
    if (!raw) return false
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && ('nonce' in parsed || 'ciphertext' in parsed)
    } catch {
      return false
    }
  }

  /** Get the display name: decrypted if available, "Encrypted file" if raw is encrypted JSON, raw otherwise. */
  function displayName(): string {
    if (decryptedName) return decryptedName
    if (isEncryptedName(shareData?.name_encrypted)) return 'Encrypted file'
    return shareData?.name_encrypted ?? 'Unknown file'
  }

  // Extract the raw key bytes from the URL fragment (#key=...).
  // For standard shares: this IS the file key.
  // For double-encrypted shares: this is K_c; call resolveFileKey() to unwrap.
  function getKeyFromFragment(): Uint8Array | null {
    const hash = window.location.hash
    if (!hash) return null
    const params = new URLSearchParams(hash.slice(1))
    const keyB64 = params.get('key')
    if (!keyB64) return null
    try {
      // Accept both standard base64 and base64url (double-encrypted links use url-safe)
      const normalized = decodeURIComponent(keyB64).replace(/-/g, '+').replace(/_/g, '/')
      return fromBase64(normalized)
    } catch {
      return null
    }
  }

  /**
   * Resolve the actual file decryption key.
   * - Standard share: key from fragment IS the file key → returns it directly.
   * - Double-encrypted share: key from fragment is K_c → unwrap wrapped_file_key.
   */
  async function resolveFileKey(shareData: ShareViewData | null): Promise<Uint8Array | null> {
    const keyFromFragment = getKeyFromFragment()
    if (!keyFromFragment) return null

    if (!shareData?.double_encrypted) {
      // Standard: fragment = file key
      return keyFromFragment
    }

    // Double-encrypted: fragment = K_c, need to unwrap wrapped_file_key
    if (!shareData.wrapped_file_key) {
      if (import.meta.env.DEV) console.error('[share-view] double_encrypted=true but no wrapped_file_key in response')
      return null
    }
    try {
      await initCrypto()
      const wrappedBytes = fromBase64(shareData.wrapped_file_key)
      return await unwrapKeyFromShare(keyFromFragment, wrappedBytes)
    } catch {
      return null
    }
  }

  // Re-evaluate the key fragment whenever the token changes (navigating between
  // share links in the same tab should not carry over a previous share's key).
  useEffect(() => {
    setKeyAvailable(!!getKeyFromFragment())
  }, [token])

  useEffect(() => {
    if (!token) return
    // Reset all share-specific state immediately so we never show stale data
    // from a previous share (e.g. a passphrase form from share A briefly
    // appearing while share B — which is open — is loading).
    setShareData(null)
    setDecryptedName(null)
    setError(null)
    setPassphrase('')
    setVerifyError(null)
    setDownloadError(null)
    setUnlockError(null)
    setLoading(true)
    getShare(token)
      .then((data) => {
        setShareData(data)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load share')
        setLoading(false)
      })
  }, [token])

  // Decrypt the filename using the resolved file key.
  // For double-encrypted shares, resolveFileKey() unwraps the wrapped_file_key first.
  useEffect(() => {
    if (!shareData?.name_encrypted) return
    let cancelled = false
    async function decrypt() {
      try {
        await initCrypto()
        const fileKey = await resolveFileKey(shareData)
        if (!fileKey || cancelled) return
        const { nonce, ciphertext: ct } = parseEncryptedBlob(shareData!.name_encrypted!)
        const name = await decryptFilename(fileKey, nonce, ct)
        if (!cancelled) setDecryptedName(name)
      } catch {
        // Can't decrypt -- will show encrypted placeholder
      }
    }
    decrypt()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareData, keyAvailable])

  /** Handle manual key entry to unlock the file. */
  const handleUnlock = useCallback(async () => {
    const trimmed = manualKey.trim()
    if (!trimmed) return

    setUnlockError(null)

    try {
      // Validate the key can be decoded
      fromBase64(trimmed)
    } catch {
      setUnlockError('Invalid key format. Check that you pasted the full key.')
      return
    }

    // Set the key as a URL fragment so getKeyFromFragment() picks it up
    window.location.hash = '#key=' + encodeURIComponent(trimmed)
    setKeyAvailable(true)
  }, [manualKey])

  const handleVerify = useCallback(async () => {
    if (!token || !passphrase.trim()) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const data = await verifySharePassphrase(token, passphrase)
      setShareData(data)
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Incorrect password — try again')
      setShaking(true)
      setTimeout(() => setShaking(false), 450)
    } finally {
      setVerifying(false)
    }
  }, [token, passphrase])

  const hasKey = keyAvailable

  const handleDownload = useCallback(async () => {
    if (!token || !shareData) return

    // Resolve the file key — handles both standard and double-encrypted shares
    const fileKey = await resolveFileKey(shareData)
    if (!fileKey) {
      setDownloadError(
        shareData.double_encrypted
          ? 'Decryption key missing or invalid. The full share URL (including #key=…) is required.'
          : 'Decryption key missing. Make sure you have the full share link including the #key= fragment.',
      )
      return
    }

    setDownloading(true)
    setDownloadError(null)
    try {
      // Ensure WASM crypto worker is ready before we try to decrypt — the
      // filename-decrypt useEffect may have failed silently, leaving the
      // worker uninitialized when the user clicks Download.
      await initCrypto()

      const {
        blob,
        chunkCount: headerChunkCount,
        chunkSize: headerChunkSize,
        originalSize: headerOriginalSize,
      } =
        await downloadSharedFile(token, passphrase || undefined)
      const encrypted = new Uint8Array(await blob.arrayBuffer())

      // Prefer the server-provided original size (X-Original-Size header) over
      // the share metadata, which can occasionally be stale or missing.
      const originalSize = headerOriginalSize ?? shareData.size_bytes
      if (originalSize == null) {
        throw new Error('Missing file size metadata')
      }

      // Use the server-provided chunk count from the X-Chunk-Count header
      // when available — it's authoritative. Fall back to share metadata,
      // then to size-based inference as a last resort.
      const chunkCount = headerChunkCount
        ?? shareData.chunk_count
        ?? inferChunkCountFromEncryptedSize(encrypted.length, originalSize)
      const plaintext = await decryptEncryptedBytes(
        fileKey,
        encrypted,
        chunkCount,
        originalSize,
        headerChunkSize ?? undefined,
      )

      const decryptedBlob = new Blob([plaintext as BlobPart], { type: shareData.mime_type || 'application/octet-stream' })
      const url = URL.createObjectURL(decryptedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = decryptedName ?? 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      // Log the real error so devtools surfaces WASM init failures, size
      // calculation errors, or anything else hiding behind the generic
      // user-facing message below.
      if (import.meta.env.DEV) console.error('[share-view] download failed:', err)
      // Distinguish server errors (ApiError with a real message) from local
      // decryption failures, so users see actionable text instead of a
      // misleading "incorrect key" hint when the server rejected the request.
      if (err instanceof ApiError && err.message) {
        setDownloadError(err.message)
      } else {
        setDownloadError('Decryption failed. The share link may have an incorrect key.')
      }
    } finally {
      setDownloading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, shareData, decryptedName, passphrase, keyAvailable])

  // Honeycomb background pattern
  const honeycombBg = (
    <div
      className="absolute inset-0 opacity-[0.04]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66Z' fill='none' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E")`,
        backgroundSize: '56px 100px',
      }}
    />
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  // Expired or max opens reached
  if (shareData?.error) {
    const isExpired = shareData.error === 'expired'
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="text-center">
            <BBLogo size={16} />

            {/* E2EE badge */}
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber/30 bg-amber-bg text-[11.5px] font-medium text-amber-deep">
              <Icon name="lock" size={11} className="shrink-0" />
              Beebeeb — End-to-end encrypted
            </div>

            <div className="mt-6 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
              <div className="p-8 text-center">
                <div className={`w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center ${
                  isExpired ? 'bg-amber-bg' : 'bg-red/10'
                }`}>
                  <Icon
                    name={isExpired ? 'clock' : 'shield'}
                    size={26}
                    className={isExpired ? 'text-amber-deep' : 'text-red'}
                  />
                </div>
                <h2 className="text-[17px] font-semibold text-ink mb-2">
                  {isExpired ? 'This link has expired' : 'Link unavailable'}
                </h2>
                <p className="text-[13px] text-ink-3 leading-relaxed">
                  {isExpired
                    ? 'The sender set a time limit on this share. Ask them to send a new link.'
                    : (shareData.message ?? 'This share link is no longer accessible.')}
                </p>
                <a
                  href="https://app.beebeeb.io/signup"
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2 bg-amber text-ink text-[13px] font-semibold rounded-lg hover:brightness-105 transition-all no-underline"
                >
                  Get Beebeeb — free 5 GB
                </a>
              </div>
              <div className="px-8 py-3.5 bg-paper-2 border-t border-line">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                  <Icon name="shield" size={11} className="text-amber-deep" />
                  End-to-end encrypted · Stored in Europe
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // General error
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="text-center">
            <BBLogo size={16} />
            <div className="mt-8 bg-paper border border-line-2 rounded-xl shadow-3 p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red/10 flex items-center justify-center">
                <Icon name="x" size={24} className="text-red" />
              </div>
              <h2 className="text-lg font-semibold text-ink mb-2">Share not found</h2>
              <p className="text-sm text-ink-3">{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Passphrase required — explicit boolean check so open shares (where the
  // server omits this field entirely) never accidentally trigger the form.
  if (shareData?.requires_passphrase === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="text-center mb-8">
            <BBLogo size={16} />
          </div>
          <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
              <Icon name="lock" size={14} className="text-amber-deep" />
              <span className="text-sm font-semibold">Password protected</span>
            </div>
            <div className="p-6">
              <p className="text-sm text-ink-3 mb-4">
                This file is protected with a passphrase. Enter it below to access the file.
              </p>
              <div className={`flex items-center gap-2 border rounded-md bg-paper px-3 py-2 mb-3 focus-within:ring-2 focus-within:ring-amber/30 transition-colors ${verifyError ? 'border-red/60 focus-within:border-red/60' : 'border-line focus-within:border-amber-deep'} ${shaking ? 'shake' : ''}`}>
                <Icon name="key" size={14} className="text-ink-3 shrink-0" />
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => { setPassphrase(e.target.value); setVerifyError(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerify()
                  }}
                  placeholder="Enter password"
                  aria-label="Share password"
                  className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
                  autoFocus
                />
              </div>
              {verifyError && (
                <p className="text-xs text-red mb-3 flex items-center gap-1">
                  <span>Incorrect password — try again</span>
                </p>
              )}
              <BBButton
                variant="amber"
                size="md"
                className="w-full justify-center gap-2"
                onClick={handleVerify}
                disabled={verifying || !passphrase.trim()}
              >
                <Icon name="lock" size={13} />
                {verifying ? 'Verifying...' : 'Unlock file'}
              </BBButton>
            </div>
            <div className="px-6 py-3 bg-paper-2 border-t border-line">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                <Icon name="shield" size={11} className="text-amber-deep" />
                End-to-end encrypted with Beebeeb
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // File info view
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden py-8">
      {honeycombBg}
      <div className="relative w-full max-w-[28rem] mx-4">
        <div className="text-center mb-4">
          <BBLogo size={16} />
          {/* Prominent E2EE badge below logo */}
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber/30 bg-amber-bg text-[11.5px] font-medium text-amber-deep">
            <Icon name="lock" size={11} className="shrink-0" />
            Beebeeb — End-to-end encrypted
          </div>
        </div>

        {/* ── Glassbox: zero-knowledge banner — only shown when key is present ── */}
        {hasKey && <ZeroBanner />}

        {/* ── Main file card ── */}
        <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
            <Icon name="share" size={14} className="text-ink" />
            <span className="text-sm font-semibold">Shared file</span>
            <BBChip variant="amber">
              <span className="flex items-center gap-1 text-[9.5px]">
                <Icon name="lock" size={9} /> E2EE
              </span>
            </BBChip>
            {shareData?.double_encrypted && (
              <BBChip variant="amber">
                <span className="flex items-center gap-1 text-[9.5px]">
                  <Icon name="shield" size={9} /> Double encrypted
                </span>
              </BBChip>
            )}
          </div>

          {/* File info */}
          <div className="p-6">
            <div className="flex items-start gap-3 mb-5">
              <div className={`w-11 h-[52px] border rounded-md flex items-center justify-center shrink-0 ${
                hasKey && decryptedName
                  ? 'bg-paper-2 border-line'
                  : 'bg-amber-bg border-amber-deep/30'
              }`}>
                <Icon
                  name={hasKey && decryptedName ? 'file' : 'lock'}
                  size={18}
                  className={hasKey && decryptedName ? 'text-ink-3' : 'text-amber-deep'}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold text-ink leading-snug break-all">
                  {displayName()}
                </h2>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {shareData?.size_bytes != null && (
                    <span className="font-mono text-[11.5px] text-ink-3 bg-paper-2 border border-line rounded px-1.5 py-0.5">
                      {formatBytes(shareData.size_bytes)}
                    </span>
                  )}
                  {hasKey && decryptedName && shareData?.mime_type && (
                    <span className="font-mono text-[11.5px] text-ink-3 bg-paper-2 border border-line rounded px-1.5 py-0.5">
                      {shareData.mime_type}
                    </span>
                  )}
                  {(!hasKey || !decryptedName) && (
                    <span className="flex items-center gap-1 text-[11.5px] text-amber-deep font-medium">
                      <Icon name="lock" size={10} className="shrink-0" />
                      Encrypted
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="flex flex-col gap-2 mb-5">
              {shareData?.shared_by && (
                <div className="flex items-center text-[12px] gap-3">
                  <span className="text-ink-3 w-[80px] shrink-0">Shared by</span>
                  <span className="text-ink-2">{shareData.shared_by}</span>
                </div>
              )}
              {shareData?.expires_at !== undefined && (
                <div className="flex items-center text-[12px] gap-3">
                  <span className="text-ink-3 w-[80px] shrink-0">Expires</span>
                  <span className="text-ink-2">{formatExpiry(shareData.expires_at)}</span>
                </div>
              )}
              {shareData?.open_count != null && shareData?.max_opens != null && (
                <div className="flex items-center text-[12px] gap-3">
                  <span className="text-ink-3 w-[80px] shrink-0">Opens</span>
                  <span className="text-ink-2">{shareData.open_count} / {shareData.max_opens}</span>
                </div>
              )}
            </div>

            {/* Download button — only when decryption key is in the URL */}
            {hasKey && (
              <BBButton
                variant="amber"
                size="lg"
                className="w-full justify-center gap-2"
                onClick={handleDownload}
                disabled={downloading}
              >
                <Icon name="download" size={14} />
                {downloading ? 'Decrypting...' : 'Download and decrypt'}
              </BBButton>
            )}

            {/* Key entry form — when no key is present */}
            {!hasKey && (
              <div className="border border-line-2 rounded-lg bg-paper-2 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="lock" size={14} className="text-amber-deep" />
                  <span className="text-sm font-medium text-ink">This file is encrypted</span>
                </div>
                <p className="text-xs text-ink-3 mb-3">
                  Enter the decryption key to access this file.
                </p>
                <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3 focus-within:border-amber-deep focus-within:ring-2 focus-within:ring-amber/30 transition-colors">
                  <Icon name="key" size={13} className="text-ink-3 shrink-0" />
                  <input
                    type="text"
                    value={manualKey}
                    onChange={(e) => {
                      setManualKey(e.target.value)
                      setUnlockError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUnlock()
                    }}
                    placeholder="Paste decryption key"
                    className="flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-4"
                    autoFocus
                  />
                </div>
                {unlockError && (
                  <p className="text-xs text-red mb-3">{unlockError}</p>
                )}
                <BBButton
                  variant="amber"
                  size="md"
                  className="w-full justify-center gap-2"
                  onClick={handleUnlock}
                  disabled={!manualKey.trim()}
                >
                  <Icon name="lock" size={13} />
                  Unlock file
                </BBButton>
              </div>
            )}

            {downloadError && (
              <div className="mt-3 px-3 py-2 bg-red/10 border border-red/30 rounded-md text-xs text-red text-center">
                {downloadError}
              </div>
            )}

            {/* ── Glassbox: URL annotation + server view — only when key present ── */}
            {hasKey && token && (
              <>
                <UrlAnnotation />
                <ServerViewPanel
                  token={token}
                  passphrase={passphrase || undefined}
                  decryptedName={decryptedName}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-paper-2 border-t border-line">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Icon name="shield" size={11} className="text-amber-deep" />
              End-to-end encrypted with Beebeeb
            </div>
            {/* Learn more + Report */}
            <div className="flex items-center justify-center gap-3 mt-1.5">
              <a
                href="https://beebeeb.io/security"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors underline-offset-2 hover:underline"
              >
                Learn more about our encryption →
              </a>
              <span className="text-ink-4">·</span>
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors underline-offset-2 hover:underline"
              >
                Report this link
              </button>
            </div>
          </div>
        </div>

        {token && (
          <ReportDialog
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            shareToken={token}
          />
        )}

        {/* Acquisition CTA — only for unauthenticated visitors */}
        {!getToken() && (() => {
          const sharerId = shareData?.sharer_id
          const sharerDisplay = shareData?.shared_by
            ? shareData.shared_by.includes('@')
              ? shareData.shared_by.split('@')[0]  // use name-part of email
              : shareData.shared_by
            : undefined
          const params = new URLSearchParams({ ref: 'share' })
          if (sharerId) params.set('sharer', sharerId)
          const signupUrl = `https://app.beebeeb.io/signup?${params.toString()}`
          return (
            <AcquisitionCTA
              sharerName={sharerDisplay}
              signupUrl={signupUrl}
            />
          )
        })()}
      </div>
    </div>
  )
}
