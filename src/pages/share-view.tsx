import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { BBLogo } from '../components/bb-logo'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import { ReportDialog } from '../components/report-dialog'
import {
  getShare,
  verifySharePassphrase,
  downloadSharedFile,
  type ShareView as ShareViewData,
} from '../lib/api'
import { decryptFilename, decryptChunk, fromBase64, initCrypto } from '../lib/crypto'
import { formatBytes } from '../lib/format'


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

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>()
  const [shareData, setShareData] = useState<ShareViewData | null>(null)
  const [decryptedName, setDecryptedName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  // Tracks whether we have a usable key (from fragment or manual entry)
  const [keyAvailable, setKeyAvailable] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

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

  // Extract the file key from the URL fragment (#key=...)
  function getKeyFromFragment(): Uint8Array | null {
    const hash = window.location.hash
    if (!hash) return null
    const params = new URLSearchParams(hash.slice(1))
    const keyB64 = params.get('key')
    if (!keyB64) return null
    try {
      return fromBase64(decodeURIComponent(keyB64))
    } catch {
      return null
    }
  }

  // Check for key in fragment on mount
  useEffect(() => {
    if (getKeyFromFragment()) {
      setKeyAvailable(true)
    }
  }, [])

  useEffect(() => {
    if (!token) return
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

  // Decrypt the filename using the key from the URL fragment
  useEffect(() => {
    if (!shareData?.name_encrypted) return
    const fileKey = getKeyFromFragment()
    if (!fileKey) return
    let cancelled = false
    async function decrypt() {
      try {
        await initCrypto()
        const parsed = JSON.parse(shareData!.name_encrypted!) as {
          nonce: string
          ciphertext: string
        }
        const name = await decryptFilename(
          fileKey!,
          fromBase64(parsed.nonce),
          fromBase64(parsed.ciphertext),
        )
        if (!cancelled) setDecryptedName(name)
      } catch {
        // Can't decrypt -- will show encrypted placeholder
      }
    }
    decrypt()
    return () => { cancelled = true }
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
      setVerifyError(e instanceof Error ? e.message : 'Invalid passphrase')
    } finally {
      setVerifying(false)
    }
  }, [token, passphrase])

  const hasKey = keyAvailable

  const handleDownload = useCallback(async () => {
    if (!token || !shareData) return
    const key = getKeyFromFragment()
    if (!key) {
      setDownloadError('Decryption key missing. Make sure you have the full share link including the #key= fragment.')
      return
    }
    setDownloading(true)
    setDownloadError(null)
    try {
      const blob = await downloadSharedFile(token)
      const encrypted = new Uint8Array(await blob.arrayBuffer())

      // Decrypt: each chunk is nonce(12) + ciphertext
      const NONCE_LEN = 12
      const nonce = encrypted.slice(0, NONCE_LEN)
      const ciphertext = encrypted.slice(NONCE_LEN)
      const plaintext = await decryptChunk(key, nonce, ciphertext)

      const decryptedBlob = new Blob([plaintext as BlobPart], { type: shareData.mime_type || 'application/octet-stream' })
      const url = URL.createObjectURL(decryptedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = decryptedName ?? 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError('Decryption failed. The share link may have an incorrect key.')
    } finally {
      setDownloading(false)
    }
  }, [token, shareData, decryptedName])

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="text-center">
            <BBLogo size={16} />
            <div className="mt-8 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
              <div className="p-8 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red/10 flex items-center justify-center">
                  <Icon name="clock" size={24} className="text-red" />
                </div>
                <h2 className="text-lg font-semibold text-ink mb-2">
                  {shareData.error === 'expired' ? 'This link has expired' : 'Link unavailable'}
                </h2>
                <p className="text-sm text-ink-3">
                  {shareData.message}
                </p>
              </div>
              <div className="px-8 py-4 bg-paper-2 border-t border-line">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                  <Icon name="shield" size={11} className="text-amber-deep" />
                  End-to-end encrypted with Beebeeb
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

  // Passphrase required
  if (shareData?.requires_passphrase) {
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
              <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3 focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
                <Icon name="key" size={14} className="text-ink-3 shrink-0" />
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerify()
                  }}
                  placeholder="Enter passphrase"
                  className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
                  autoFocus
                />
              </div>
              {verifyError && (
                <p className="text-xs text-red mb-3">{verifyError}</p>
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
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
      {honeycombBg}
      <div className="relative w-full max-w-[28rem] mx-4">
        <div className="text-center mb-8">
          <BBLogo size={16} />
        </div>
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
                <p className="text-xs text-ink-3 mt-1">
                  {shareData?.size_bytes != null ? formatBytes(shareData.size_bytes) : ''}
                  {hasKey && decryptedName && shareData?.mime_type
                    ? ` · ${shareData.mime_type}`
                    : !hasKey || !decryptedName
                      ? shareData?.size_bytes != null ? ' · Encrypted' : 'Encrypted'
                      : ''}
                </p>
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
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-paper-2 border-t border-line">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Icon name="shield" size={11} className="text-amber-deep" />
              End-to-end encrypted with Beebeeb
            </div>
            <div className="flex items-center justify-center mt-1.5">
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
      </div>
    </div>
  )
}
