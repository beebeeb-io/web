// The share-link route that resolves and renders a share.
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { ReportDialog } from '../components/report-dialog'
import { formatExpiry, useShareMetaTags } from './share-view/share-meta'
import { ServerViewPanel, UrlAnnotation, ZeroBanner } from './share-view/glassbox'
import { AcquisitionCTA } from './share-view/acquisition-cta'
import { keyErrorMessage, KEY_BYTES, type KeyOutcome, type KeyErrorKind } from './share-view/share-key-outcome'
import { UnknownShareTypeCard } from './share-view/unknown-share-type'
import { KNOWN_SHARE_TYPES } from './share-view/bundle-share-view'
import { BundleShareView } from './share-view/bundle-share-view'
import {
  getShare,
  verifySharePassphrase,
  downloadSharedFile,
  ApiError,
  type ShareView as ShareViewData,
} from '../lib/api'
import { useAuth, isAuthenticated } from '../lib/auth-context'
import { fromBase64, toBase64url, unwrapKeyFromShare, initCrypto, readFileMetadata, readNameMetadata, PIN_V2, type ContentPin } from '../lib/crypto'
import { decryptEncryptedBytes, inferChunkCountFromEncryptedSize, UNVERIFIED_FILE_COPY } from '../lib/encrypted-download'
import { withNetworkRetry } from '../lib/net-retry'
import { formatBytes } from '../lib/format'
import { parseShareKey, extractShareKeyToken, decodeShareKeyToken } from '../lib/share-key'
// Task 2238 — the honest page for a folder link minted before this task.
import {
  LEGACY_FOLDER_LINK_COPY,
  isFolderDownloadRefusal,
  isFolderTarget,
} from '../lib/legacy-folder-link'

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>()
  // Task 1471 — the acquisition CTA below used to gate on `!getToken()` (the
  // legacy `bb_session` localStorage slot), which reads a real signed-in
  // Beebeeb user viewing their own shared link as logged out (same bug as
  // pricing.tsx's `isLoggedIn`). Derive from the auth context instead; while
  // it's still loading, show neither state rather than flash the CTA at a
  // visitor who is about to be recognized as signed in.
  const { user: authUser, loading: authLoading } = useAuth()
  const [shareData, setShareData] = useState<ShareViewData | null>(null)
  const [decryptedName, setDecryptedName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Distinct heading for the load-error card — set from the typed server codes
  // (share_revoked / share_expired / not-found) so each reads honestly (0708).
  const [errorTitle, setErrorTitle] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  // Tracks whether we have a usable key (from fragment or manual entry).
  // Lazily initialised from the fragment (task 1531) — getKeyFromFragment is a
  // hoisted function declaration below, so it's callable here despite the
  // textual order — so the key-entry form never flashes for a split second on
  // first paint when a key IS present in the URL (it used to start `false`
  // unconditionally and only flip true once the effect below ran).
  const [keyAvailable, setKeyAvailable] = useState(() => !!getKeyFromFragment())
  // Precise key-resolution failure (null = no hard error). Surfaced instead of
  // the generic locked UI so the recipient knows what's actually wrong (0709).
  const [keyError, setKeyError] = useState<KeyErrorKind | null>(null)
  // Task 2238 — this `file` share points at a folder: a link minted before
  // folder links existed. Irreparably broken (one wrapper key, no item list),
  // so the page says so instead of failing a download. Set from the server
  // metadata when present, else from the download refusal itself.
  const [legacyFolderLink, setLegacyFolderLink] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // Recipients are anonymous — we never display the share creator's name.
  // See task 0452.
  useShareMetaTags()

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
  // For double-encrypted shares: this is K_c; call resolveFileKeyOutcome() to unwrap.
  function getKeyFromFragment(): Uint8Array | null {
    const hash = window.location.hash
    if (!hash) return null
    // Shared with handleUnlock() below (src/lib/share-key.ts, task 1531) — the
    // manual form used to call fromBase64() directly, which throws on the
    // '-'/'_' that a base64url key (how every key is minted, toBase64url())
    // contains ~75% of the time. Deliberately not URLSearchParams: it decodes
    // '+' as a space, which would corrupt a standard-base64 key.
    const token = extractShareKeyToken(hash)
    if (!token) return null
    try {
      // Length is NOT asserted here — resolveFileKeyOutcome() below needs to
      // tell "a key, but the wrong length" (malformed-key) apart from "no key
      // at all" (no-key), which requires seeing a decoded-but-short array.
      return decodeShareKeyToken(token)
    } catch {
      return null
    }
  }

  /**
   * Resolve the actual file decryption key, discriminating every failure mode.
   * - legacy (pre-0538) share: the fragment IS the file key (32 bytes).
   * - double-encrypted share: the fragment is K_c → unwrap wrapped_file_key.
   *
   * The previous code silently returned the fragment as the file key whenever
   * `double_encrypted` was falsy — so a modern share whose flag was dropped fed
   * K_c in as the file key and decryption failed under a generic message. We now
   * treat a flag/wrapped_file_key disagreement as a hard `damaged-link`, never a
   * silent wrong-key guess, and assert every resolved key is exactly 32 bytes.
   */
  async function resolveFileKeyOutcome(shareData: ShareViewData | null): Promise<KeyOutcome> {
    const fragment = getKeyFromFragment()
    if (!fragment) return { kind: 'no-key' }
    if (fragment.length !== KEY_BYTES) return { kind: 'malformed-key' }

    const isDouble = shareData?.double_encrypted === true
    const hasWrapped = !!shareData?.wrapped_file_key

    // Inconsistent metadata ⇒ the share record/link is damaged. Do NOT fall back
    // to treating K_c as the file key (the old silent bug).
    if (isDouble !== hasWrapped) return { kind: 'damaged-link' }

    // Legacy share: the fragment is the file key directly.
    if (!isDouble) return { kind: 'ok', key: fragment }

    // Double-encrypted: unwrap wrapped_file_key with K_c (the fragment).
    try {
      await initCrypto()
    } catch {
      return { kind: 'crypto-unavailable' }
    }
    try {
      const wrappedBytes = fromBase64(shareData!.wrapped_file_key!)
      const fileKey = await unwrapKeyFromShare(fragment, wrappedBytes)
      // A wrong K_c fails AES-GCM auth (caught below); a successful unwrap that
      // is not 32 bytes means a corrupt wrapped_file_key — treat as wrong-key.
      if (fileKey.length !== KEY_BYTES) return { kind: 'wrong-key' }
      return { kind: 'ok', key: fileKey }
    } catch {
      return { kind: 'wrong-key' }
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
    setErrorTitle(null)
    setPassphrase('')
    setVerifyError(null)
    setDownloadError(null)
    setLegacyFolderLink(false)
    setUnlockError(null)
    setKeyError(null)
    // Defensive (0709 cross-pollination from mobile 0710): also clear the
    // manually-entered key and any open report dialog so nothing from share A
    // carries into share B on an SPA route change. (The decryption key itself is
    // read live from the URL fragment and the decrypted blob is revoked
    // immediately in handleDownload — neither is ever held in per-share state.)
    setManualKey('')
    setReportOpen(false)
    setLoading(true)
    getShare(token)
      .then((data) => {
        setShareData(data)
        // Task 2238: a `file` share whose target is a folder (a link minted
        // before folder links existed) cannot download anything. Detect it from
        // the metadata when the server reports `is_folder`, so the recipient
        // reads the truth immediately rather than after a failed download.
        if (isFolderTarget(data)) setLegacyFolderLink(true)
        setLoading(false)
      })
      .catch((e) => {
        // Typed server codes (0708): expired → 410, revoked → 403, not-found → 404.
        // Split them so the recipient reads the truth, not a generic failure.
        if (e instanceof ApiError && (e.status === 410 || e.message === 'share_expired')) {
          setErrorTitle('This link has expired')
          setError('The sender set a time limit on this share. Ask them for a new link.')
        } else if (e instanceof ApiError && (e.status === 403 || e.message === 'share_revoked')) {
          setErrorTitle('This link was revoked')
          setError('The sender turned off this share link. Ask them for a new one.')
        } else if (e instanceof ApiError && e.status === 404) {
          setErrorTitle('Share not found')
          setError('This link could not be found. Check that you copied the whole link.')
        } else {
          setErrorTitle('Share not found')
          setError(e instanceof Error ? e.message : 'Failed to load share')
        }
        setLoading(false)
      })
  }, [token])

  // Decrypt the filename using the resolved file key.
  // For double-encrypted shares, resolveFileKeyOutcome() unwraps the wrapped_file_key first.
  useEffect(() => {
    if (!shareData?.name_encrypted) return
    let cancelled = false
    async function decrypt() {
      try {
        const nameEnc = shareData!.name_encrypted!

        // Legacy plaintext name (stored before encryption was added)
        if (!nameEnc.startsWith('{')) {
          if (!cancelled) setDecryptedName(nameEnc)
          return
        }

        await initCrypto()
        const outcome = await resolveFileKeyOutcome(shareData)
        if (cancelled) return
        // Hard key errors are surfaced by the dedicated effect below; here we
        // simply leave the name as the encrypted placeholder.
        if (outcome.kind !== 'ok') return
        const fileKey = outcome.key
        // Core's display reader: the name subkey first (names sealed since core
        // 1908), then the legacy raw key; a JSON {name, mime_type} or a bare
        // legacy filename inside (task 1943).
        const { name: displayName } = await readNameMetadata(fileKey, nameEnc)
        if (!cancelled) setDecryptedName(displayName)
      } catch {
        // Can't decrypt -- will show encrypted placeholder
      }
    }
    decrypt()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareData, keyAvailable])

  // Surface a precise key-resolution error as soon as the share metadata is
  // known and a #key= fragment is present — so a damaged / wrong / truncated
  // link shows actionable copy instead of the generic locked state.
  useEffect(() => {
    if (!shareData || shareData.error || shareData.requires_passphrase || !keyAvailable) {
      setKeyError(null)
      return
    }
    let cancelled = false
    resolveFileKeyOutcome(shareData).then((outcome) => {
      if (cancelled) return
      setKeyError(outcome.kind === 'ok' || outcome.kind === 'no-key' ? null : outcome.kind)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareData, keyAvailable])

  /**
   * Handle manual key entry to unlock the file. Accepts everything
   * getKeyFromFragment() does — base64url or standard base64, padded or not,
   * a bare key, a `#key=…` value, or a whole pasted share link — via the
   * SAME parser (src/lib/share-key.ts, task 1531). Pre-1531 this called
   * fromBase64() directly, which threw on the '-'/'_' every base64url key
   * (how every key is minted) has a ~75% chance of containing.
   */
  const handleUnlock = useCallback(async () => {
    const trimmed = manualKey.trim()
    if (!trimmed) return

    setUnlockError(null)

    let keyBytes: Uint8Array
    try {
      keyBytes = parseShareKey(trimmed)
    } catch {
      setUnlockError('Invalid key format. Check that you pasted the full key.')
      return
    }

    // Always re-emit as canonical base64url — whatever form the user pasted
    // (standard base64, a bare fragment, or a whole URL), the fragment
    // getKeyFromFragment() reads back must be a clean `#key=<base64url>`.
    window.location.hash = '#key=' + encodeURIComponent(toBase64url(keyBytes))
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

    // Resolve the file key — distinct, honest message per failure (no silent
    // generic "Decryption failed"). Surfaces the same precise error card.
    const outcome = await resolveFileKeyOutcome(shareData)
    if (outcome.kind !== 'ok') {
      if (outcome.kind === 'no-key') {
        setDownloadError('Add the decryption key from the share link to open this file.')
      } else {
        // The dedicated key-error card renders the precise message — don't also
        // duplicate it in the small download-error box.
        setKeyError(outcome.kind)
      }
      return
    }
    const fileKey = outcome.key

    setDownloading(true)
    setDownloadError(null)
    try {
      // Ensure WASM crypto worker is ready before we try to decrypt — the
      // filename-decrypt useEffect may have failed silently, leaving the
      // worker uninitialized when the user clicks Download.
      await initCrypto()

      // The content pin from the file's authenticated metadata (core's FILE
      // reader, task 1943). Unreadable: refuse before downloading anything.
      let pin: ContentPin
      try {
        pin = (await readFileMetadata(fileKey, shareData.name_encrypted ?? '')).pin
      } catch {
        setDownloadError(UNVERIFIED_FILE_COPY)
        return
      }
      // The single-file share view does not carry the file id, which every v2
      // frame binds. Every file that exists today is v1 (pin 0), whose frames
      // do not use it; a v2-pinned file cannot be opened from this link until
      // the server sends `file_id` (task 1943 follow-up). Say so honestly
      // instead of failing on a tag mismatch.
      if (pin === PIN_V2) {
        setDownloadError('This file uses a newer encryption format that this link cannot open yet.')
        return
      }

      const {
        blob,
        chunkCount: headerChunkCount,
        chunkSize: headerChunkSize,
        originalSize: headerOriginalSize,
      } =
        // Ride out transient network blips (fetch-throws → ApiError status 0);
        // HTTP errors (expired/revoked/passphrase) bubble immediately, not retried.
        await withNetworkRetry(() => downloadSharedFile(token, passphrase || undefined))
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
        { fileId: '', pin },
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
      // Task 2238: a folder link from before folder links existed. The server
      // refuses the download itself ("cannot download a folder") — show the
      // explanation, never the raw refusal. Servers that report `is_folder` in
      // the metadata already flipped this on load; this covers the rest.
      if (isFolderDownloadRefusal(err)) {
        setLegacyFolderLink(true)
        return
      }
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
                  Try Beebeeb free for 14 days
                </a>
              </div>
              <div className="px-8 py-3.5 bg-paper-2 border-t border-line">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                  <Icon name="shield" size={11} className="text-amber-deep" />
                  End-to-end encrypted · Stored in the EU
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
              <h2 className="text-lg font-semibold text-ink mb-2">{errorTitle ?? 'Share not found'}</h2>
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

  // ── Unknown share_type guard (task 0417 §5) — MUST come before any single-
  //    file rendering. A share_type this client doesn't implement (a future
  //    type added server-side) renders an honest upgrade card, never a
  //    misrendered single-file view. `undefined`/'file' → single-file (legacy).
  if (shareData?.share_type && !KNOWN_SHARE_TYPES.has(shareData.share_type)) {
    return <UnknownShareTypeCard shareType={shareData.share_type} />
  }

  // ── Bundle branch (task 0417): ordered multi-file manifest ──────────────────
  if (shareData?.share_type === 'bundle' && token) {
    // K_c is the bundle's single fragment key; a truncated/absent fragment → no
    // key (the view prompts the recipient to re-copy the whole link).
    const fragment = getKeyFromFragment()
    const bundleKey = fragment && fragment.length === KEY_BYTES ? fragment : null
    return <BundleShareView token={token} data={shareData} clientKey={bundleKey} />
  }

  // ── Legacy folder link (task 2238) — a `file` share whose target is a folder.
  //    Irreparably broken; say what is true instead of failing a download. ────
  if (legacyFolderLink && token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden py-8">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="text-center mb-4">
            <BBLogo size={16} />
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber/30 bg-amber-bg text-[11.5px] font-medium text-amber-deep">
              <Icon name="lock" size={11} className="shrink-0" />
              Beebeeb — End-to-end encrypted
            </div>
          </div>
          <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
              <Icon name="share" size={14} className="text-ink" />
              <span className="text-sm font-semibold">Shared folder</span>
            </div>
            <div className="p-6" role="status">
              <div className="flex items-start gap-3">
                <div className="w-11 h-[52px] border rounded-md flex items-center justify-center shrink-0 bg-amber-bg border-amber-deep/30">
                  <Icon name="lock" size={18} className="text-amber-deep" />
                </div>
                <p className="text-[13px] text-ink leading-relaxed">{LEGACY_FOLDER_LINK_COPY}</p>
              </div>
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
        {hasKey && !keyError && <ZeroBanner />}

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
            {/* Recipients are anonymous — we deliberately do not show "Shared
                by …" here. The creator's identity is never exposed to
                unauthenticated viewers. See task 0452. */}
            <div className="flex flex-col gap-2 mb-5">
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

            {/* Precise key-resolution error — the link is damaged / truncated /
                wrong-key, or crypto failed to load. Honest, actionable copy
                instead of the generic locked state (0709). */}
            {keyError && (() => {
              const msg = keyErrorMessage(keyError)
              return (
                <div className="border border-red/30 bg-red/5 rounded-lg p-4" role="alert">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon name="shield" size={14} className="text-red shrink-0" />
                    <span className="text-sm font-semibold text-ink">{msg.title}</span>
                  </div>
                  <p className="text-xs text-ink-2 leading-relaxed">{msg.body}</p>
                </div>
              )
            })()}

            {/* Download button — only when a usable decryption key is in the URL */}
            {hasKey && !keyError && (
              <BBButton
                variant="amber"
                size="lg"
                className="w-full justify-center gap-2"
                onClick={handleDownload}
                disabled={downloading}
              >
                <Icon name="download" size={14} />
                {downloading ? 'Downloading…' : 'Download and decrypt'}
              </BBButton>
            )}

            {/* Key entry form — when no key is present */}
            {!hasKey && !keyError && (
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
            {hasKey && !keyError && token && (
              <>
                <UrlAnnotation />
                <ServerViewPanel
                  token={token}
                  passphrase={passphrase || undefined}
                  decryptedName={decryptedName}
                  nameEncrypted={shareData?.name_encrypted}
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

        {/* Acquisition CTA — only for unauthenticated visitors.
            We do NOT pass a sharer name: the server no longer returns one,
            and we deliberately keep the recipient anonymous. See task 0452. */}
        {!authLoading && !isAuthenticated(authUser) && (() => {
          const sharerId = shareData?.sharer_id
          const params = new URLSearchParams({ ref: 'share' })
          if (sharerId) params.set('sharer', sharerId)
          const signupUrl = `https://app.beebeeb.io/signup?${params.toString()}`
          return (
            <AcquisitionCTA signupUrl={signupUrl} />
          )
        })()}
      </div>
    </div>
  )
}
