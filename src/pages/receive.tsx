/**
 * Constellation peer transfer — web receiver.
 *
 * Lightweight unauthenticated page at /receive that lets anyone (with or
 * without a Beebeeb account) receive a file from a Beebeeb sender.
 *
 * Flow:
 *   1. Receiver enters the 6-digit code shown on the sender's screen
 *      (or arrives with ?code=XXXXXX prefilled).
 *   2. POST /transfer/join-by-code with a generated receiver_pk →
 *      session_id + sender_pk + download_token.
 *   3. Derive 4 SAS words from session_id + keys; user verbally verifies
 *      against the sender's screen.
 *   4. Poll /transfer/{id}/status until the sender approves + uploads.
 *   5. GET /transfer/{id}/blob → Blob → "Save to device" triggers a
 *      browser download.
 *   6. POST /transfer/{id}/ack so the server drops the blob.
 *   7. Transfer Receipt is shown with SHA-256 fingerprint of the file.
 *
 * v1: bytes are saved as-is (encrypted with the transfer_key). When WASM
 * exposes HKDF + AES-GCM here we'll decrypt before saving.
 *
 * Save to vault: if the receiver is logged in with an unlocked vault,
 * a "Save to my Beebeeb" button is shown. On click the blob is re-encrypted
 * with the user's master key and uploaded via the standard chunked upload path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import {
  ackTransfer,
  downloadTransferBlob,
  getTransferStatus,
  joinTransferByCode,
} from '../lib/api'
import { deriveSasWords } from '../lib/sas-words'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { encryptedUpload } from '../lib/encrypted-upload'

type Phase =
  | 'idle'        // code input shown
  | 'joining'     // POST /join in flight
  | 'verifying'   // SAS shown; waiting for sender approval
  | 'receiving'   // sender approved; downloading
  | 'received'    // bytes in memory; offering "Save to device"
  | 'cancelled'
  | 'error'

const POLL_INTERVAL_MS = 2_000

/** 32 cryptographically random bytes via Web Crypto. */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/** Base64-encode a byte array. */
function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

/**
 * Compute SHA-256 of a Blob. Returns lowercase hex string.
 * Uses Web Crypto API — available in all modern browsers.
 */
async function sha256Hex(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuf)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function friendlyError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong. Please try again.'
}

type VaultSavePhase = 'idle' | 'saving' | 'saved' | 'error'

interface ProofData {
  fileName: string
  fileSizeBytes: number
  sha256Hash: string
  sessionId: string
  timestamp: string
}

export function Receive() {
  const [searchParams] = useSearchParams()
  const initialCode = (searchParams.get('code') ?? '').replace(/\D/g, '').slice(0, 6)

  const { user } = useAuth()
  const { isUnlocked, getFileKey } = useKeys()

  const [phase, setPhase] = useState<Phase>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState(initialCode)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [senderPk, setSenderPk] = useState<string | null>(null)
  const [receiverPk, setReceiverPk] = useState<string | null>(null)
  const [downloadToken, setDownloadToken] = useState<string | null>(null)

  const [savedBlob, setSavedBlob] = useState<Blob | null>(null)
  const [savedFilename, setSavedFilename] = useState<string>('beebeeb-transfer')
  const [proofData, setProofData] = useState<ProofData | null>(null)

  const [vaultSavePhase, setVaultSavePhase] = useState<VaultSavePhase>('idle')
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null)

  // Mirrors sessionId for the polling timer; lets the closure observe the
  // current session without rebinding every state change.
  const activeSessionRef = useRef<string | null>(null)

  const handleSubmitCode = useCallback(async () => {
    const code = codeInput.replace(/\D/g, '')
    if (code.length !== 6) return
    setPhase('joining')
    setErrorText(null)
    try {
      const pkBytes = randomBytes(32)
      const pkB64 = bytesToBase64(pkBytes)
      const res = await joinTransferByCode(code, pkB64)
      setSessionId(res.session_id)
      setSenderPk(res.sender_pk)
      setReceiverPk(pkB64)
      setDownloadToken(res.download_token)
      activeSessionRef.current = res.session_id
      setPhase('verifying')
    } catch (err) {
      setErrorText(friendlyError(err))
      setPhase('error')
    }
  }, [codeInput])

  // Auto-submit when the page loads with a valid code in the URL.
  useEffect(() => {
    if (initialCode.length === 6 && phase === 'idle') {
      void handleSubmitCode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll status while waiting for sender approval + upload.
  useEffect(() => {
    if (phase !== 'verifying' || !sessionId || !downloadToken) return
    let stopped = false
    const tick = async () => {
      if (stopped || activeSessionRef.current !== sessionId) return
      try {
        const status = await getTransferStatus(sessionId, downloadToken)
        if (stopped) return
        if (status.status === 'cancelled' || status.status === 'expired') {
          setPhase('cancelled')
          return
        }
        if (status.status === 'ready' || (status.blob_size != null && status.blob_size > 0)) {
          setPhase('receiving')
        }
      } catch {
        // Ignore transient network errors; next tick will retry.
      }
    }
    const id = setInterval(tick, POLL_INTERVAL_MS)
    void tick()
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [phase, sessionId, downloadToken])

  // Download once the sender's blob is ready.
  useEffect(() => {
    if (phase !== 'receiving' || !sessionId || !downloadToken) return
    let cancelled = false
    ;(async () => {
      try {
        const blob = await downloadTransferBlob(sessionId, downloadToken)
        if (cancelled) return
        setSavedBlob(blob)
        // v1: filename hint is encrypted server-side and we don't yet have
        // the transfer_key to decrypt it. Use a generic name with a short
        // random suffix so multiple downloads don't collide.
        const suffix = Array.from(randomBytes(4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        const filename = `beebeeb-transfer-${suffix}.enc`
        setSavedFilename(filename)

        // Compute SHA-256 of the received bytes for the transfer receipt.
        const hash = await sha256Hex(blob)
        const timestamp = new Date().toISOString()
        setProofData({
          fileName: filename.replace(/\.enc$/, ''),
          fileSizeBytes: blob.size,
          sha256Hash: hash,
          sessionId,
          timestamp,
        })

        // ACK so the server drops the blob. Best-effort — server's expiry
        // sweep cleans up after 24h regardless.
        ackTransfer(sessionId, downloadToken).catch(() => {})
        activeSessionRef.current = null
        setPhase('received')
      } catch (err) {
        if (cancelled) return
        setErrorText(friendlyError(err))
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [phase, sessionId, downloadToken])

  const handleSave = useCallback(() => {
    if (!savedBlob) return
    const url = URL.createObjectURL(savedBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = savedFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [savedBlob, savedFilename])

  const handleSaveToVault = useCallback(async () => {
    if (!savedBlob || !user || !isUnlocked) return
    setVaultSavePhase('saving')
    setVaultSaveError(null)
    try {
      const fileId = crypto.randomUUID()
      const fileKey = await getFileKey(fileId)
      // Use savedFilename but strip the .enc suffix added by the v1 transfer
      // path — the user's vault should show a friendlier name.
      const cleanName = savedFilename.replace(/\.enc$/, '')
      const file = new File([savedBlob], cleanName, {
        type: savedBlob.type || 'application/octet-stream',
      })
      await encryptedUpload(file, fileId, fileKey, undefined, undefined, undefined, undefined, undefined, getFileKey)
      setVaultSavePhase('saved')
    } catch (err) {
      setVaultSaveError(
        err instanceof Error ? err.message : 'Upload failed. Please try again.',
      )
      setVaultSavePhase('error')
    }
  }, [savedBlob, savedFilename, user, isUnlocked, getFileKey])

  const sasWords = useMemo(() => {
    if (!sessionId || !senderPk || !receiverPk) return null
    return deriveSasWords(sessionId, senderPk, receiverPk)
  }, [sessionId, senderPk, receiverPk])

  return (
    <div className="min-h-screen flex flex-col bg-[#0C0C0D] text-white">
      {/* Header */}
      <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <BBLogo size={16} />
        <span className="text-[11px] text-white/50 tracking-wide uppercase">
          Receive
        </span>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col items-center justify-start px-5 pt-10 pb-8">
        <div className="w-full max-w-[384px]">
          {phase === 'idle' && (
            <CodeEntry
              code={codeInput}
              onChange={setCodeInput}
              onSubmit={handleSubmitCode}
            />
          )}

          {phase === 'joining' && (
            <CenterStatus title="Connecting…" />
          )}

          {phase === 'verifying' && sasWords && (
            <SasVerify words={sasWords} />
          )}

          {phase === 'receiving' && (
            <CenterStatus title="Receiving file…" subtitle="Don't close this tab." />
          )}

          {phase === 'received' && (
            <Received
              filename={savedFilename}
              size={savedBlob?.size ?? 0}
              onSave={handleSave}
              isLoggedIn={!!user && isUnlocked}
              vaultSavePhase={vaultSavePhase}
              vaultSaveError={vaultSaveError}
              onSaveToVault={() => { void handleSaveToVault() }}
              proof={proofData}
            />
          )}

          {phase === 'cancelled' && (
            <ErrorState
              title="Transfer cancelled"
              message="The other side ended this transfer."
              onReset={() => {
                setPhase('idle')
                setSessionId(null)
                setSenderPk(null)
                setReceiverPk(null)
                setDownloadToken(null)
              }}
            />
          )}

          {phase === 'error' && (
            <ErrorState
              title="Something went wrong"
              message={errorText ?? 'Please try again.'}
              onReset={() => {
                setPhase('idle')
                setErrorText(null)
              }}
            />
          )}
        </div>
      </main>

      {/* Footer — relay disclosure + onboarding CTA */}
      <footer className="px-5 pb-8 pt-4 text-center">
        <p className="text-[11px] text-white/40 mb-6 flex items-center justify-center gap-1.5">
          <Icon name="shield" size={11} className="text-amber" />
          Encrypted relay via Falkenstein. File deleted after pickup.
        </p>
        <a
          href="https://beebeeb.io"
          className="inline-flex items-center gap-2 text-sm text-white/80 hover:text-white transition-colors"
        >
          <span className="font-semibold">Get Beebeeb</span>
          <span className="text-white/50">— encrypted cloud storage</span>
          <Icon name="chevron-right" size={12} className="text-white/50" />
        </a>
      </footer>
    </div>
  )
}

// ─── Sub-views ──────────────────────────────────────

function CodeEntry({
  code,
  onChange,
  onSubmit,
}: {
  code: string
  onChange: (s: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-2xl font-semibold text-white mb-2">Receive a file</h1>
      <p className="text-sm text-white/60 mb-8 leading-relaxed">
        Enter the 6-digit code shown on the sender's device.
      </p>

      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        value={code}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && code.length === 6) onSubmit()
        }}
        placeholder="000000"
        aria-label="Six-digit transfer code"
        className="w-full font-mono text-center text-amber bg-transparent border-b border-white/15 focus:border-amber outline-none transition-colors py-3 mb-8"
        style={{ fontSize: '40px', letterSpacing: '12px', paddingLeft: '12px' }}
      />

      <BBButton
        variant="amber"
        size="lg"
        className="w-full justify-center"
        onClick={onSubmit}
        disabled={code.length !== 6}
      >
        Continue
      </BBButton>
    </div>
  )
}

function SasVerify({ words }: { words: string[] }) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-2xl font-semibold text-white mb-2">Verify with sender</h1>
      <p className="text-sm text-white/60 mb-8 leading-relaxed">
        These four words must match exactly on both screens.
      </p>

      <div className="w-full bg-white/[0.04] border border-amber/30 rounded-xl p-6 mb-6">
        <div
          className="font-mono font-bold text-amber text-center break-words"
          style={{ fontSize: '22px', letterSpacing: '1px', lineHeight: '1.6' }}
        >
          {words.join('  ')}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-white/60">
        <Spinner />
        <span>Waiting for sender to approve…</span>
      </div>
    </div>
  )
}

function CenterStatus({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center pt-12">
      <Spinner large />
      <h1 className="text-lg font-semibold text-white mt-6 mb-1">{title}</h1>
      {subtitle && <p className="text-sm text-white/60">{subtitle}</p>}
    </div>
  )
}

// ─── Transfer Receipt card ───────────────────────────────────────────────────

function TransferReceipt({ proof }: { proof: ProofData }) {
  const [copied, setCopied] = useState(false)
  const [receiptExpanded, setReceiptExpanded] = useState(false)

  const proofJson = JSON.stringify({
    session_id: proof.sessionId,
    file_name: proof.fileName,
    file_size_bytes: proof.fileSizeBytes,
    sha256_hash: proof.sha256Hash,
    timestamp: proof.timestamp,
  }, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(proofJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available — ignore
    }
  }

  const handleDownloadText = () => {
    const blob = new Blob([proofJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beebeeb-receipt-${proof.sessionId.slice(0, 8)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handlePrint = () => {
    // Open a minimal print window with the receipt
    const localTime = new Date(proof.timestamp).toLocaleString()
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Beebeeb Transfer Receipt</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #fff; color: #111; padding: 48px; max-width: 600px; margin: auto; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #666; margin-bottom: 28px; }
    .grid { display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; }
    .label { font-size: 12px; color: #888; font-weight: 500; padding-top: 1px; }
    .value { font-size: 13px; color: #111; word-break: break-all; }
    .mono { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12px; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
    .footer { font-size: 11px; color: #aaa; margin-top: 28px; }
  </style>
</head>
<body>
  <h1>Transfer Receipt</h1>
  <p class="sub">Beebeeb Constellation — verifiable transfer proof</p>
  <div class="grid">
    <span class="label">File name</span>
    <span class="value">${escapeHtml(proof.fileName)}</span>
    <span class="label">Size</span>
    <span class="value">${formatBytes(proof.fileSizeBytes)}</span>
    <span class="label">Timestamp</span>
    <span class="value">${escapeHtml(localTime)} (${escapeHtml(proof.timestamp)})</span>
    <span class="label">Session ID</span>
    <span class="value mono">${escapeHtml(proof.sessionId)}</span>
    <span class="label">SHA-256</span>
    <span class="value mono">${escapeHtml(proof.sha256Hash)}</span>
  </div>
  <hr />
  <p class="footer">This receipt was generated by Beebeeb (beebeeb.io). The SHA-256 hash is computed
  client-side from the received file bytes and can be verified independently with any standard tool.</p>
</body>
</html>`
    const w = window.open('', '_blank', 'width=700,height=600')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const shortHash = `${proof.sha256Hash.slice(0, 16)}…`

  return (
    <div className="mt-6 w-full">
      <button
        onClick={() => setReceiptExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left px-4 py-3 bg-white/[0.04] border border-white/10 rounded-lg hover:bg-white/[0.06] transition-colors"
        aria-expanded={receiptExpanded}
      >
        <div className="flex items-center gap-2.5">
          <Icon name="shield" size={14} className="text-amber shrink-0" />
          <span className="text-sm font-medium text-white">Transfer receipt</span>
          <span className="text-xs text-white/40 font-mono">{shortHash}</span>
        </div>
        <Icon
          name="chevron-down"
          size={14}
          className={`text-white/40 shrink-0 transition-transform ${receiptExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {receiptExpanded && (
        <div className="mt-1 border border-white/10 border-t-0 rounded-b-lg overflow-hidden">
          {/* Receipt rows */}
          <div className="px-4 pt-4 pb-2 space-y-3">
            <ReceiptRow label="File name" value={proof.fileName} />
            <ReceiptRow label="Size" value={formatBytes(proof.fileSizeBytes)} />
            <ReceiptRow
              label="Timestamp"
              value={new Date(proof.timestamp).toLocaleString()}
              sub={proof.timestamp}
            />
            <ReceiptRow
              label="Session ID"
              value={proof.sessionId}
              mono
            />
            <ReceiptRow
              label="SHA-256"
              value={proof.sha256Hash}
              mono
            />
          </div>

          {/* Action row */}
          <div className="px-4 pb-4 pt-2 flex gap-2">
            <button
              onClick={() => { void handleCopy() }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 transition-colors"
            >
              <Icon name={copied ? 'check' : 'copy'} size={12} className={copied ? 'text-amber' : ''} />
              {copied ? 'Copied' : 'Copy proof'}
            </button>
            <button
              onClick={handleDownloadText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 transition-colors"
            >
              <Icon name="download" size={12} />
              Download JSON
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 transition-colors"
            >
              <Icon name="file" size={12} />
              Export PDF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReceiptRow({
  label,
  value,
  sub,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
      <span className="text-[11px] text-white/40 pt-0.5 font-medium uppercase tracking-wide">
        {label}
      </span>
      <div>
        <span
          className={`text-xs break-all text-white/80 ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </span>
        {sub && (
          <div className="text-[10px] font-mono text-white/30 mt-0.5 break-all">{sub}</div>
        )}
      </div>
    </div>
  )
}

// ─── Received view ───────────────────────────────────────────────────────────

function Received({
  filename,
  size,
  onSave,
  isLoggedIn,
  vaultSavePhase,
  vaultSaveError,
  onSaveToVault,
  proof,
}: {
  filename: string
  size: number
  onSave: () => void
  isLoggedIn: boolean
  vaultSavePhase: VaultSavePhase
  vaultSaveError: string | null
  onSaveToVault: () => void
  proof: ProofData | null
}) {
  // Strip the .enc suffix for display — it's a v1 transfer artifact.
  const displayName = filename.replace(/\.enc$/, '')

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber/15 border border-amber/30 flex items-center justify-center mb-5">
        <Icon name="check" size={26} className="text-amber" />
      </div>
      <h1 className="text-2xl font-semibold text-white mb-2">Transfer complete</h1>
      <p className="text-sm text-white/60 mb-8 leading-relaxed">
        File received. Server copy is being deleted.
      </p>

      <div className="w-full bg-white/[0.04] border border-white/10 rounded-lg p-4 mb-6 flex items-center gap-3 text-left">
        <div className="w-10 h-12 border border-white/15 rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
          <Icon name="file" size={18} className="text-white/60" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{displayName}</div>
          <div className="text-xs text-white/50 mt-0.5">{formatBytes(size)}</div>
        </div>
      </div>

      {/* Primary action: save to device */}
      <BBButton
        variant="amber"
        size="lg"
        className="w-full justify-center gap-2 mb-3"
        onClick={onSave}
      >
        <Icon name="download" size={14} />
        Save to device
      </BBButton>

      {/* Save to vault — shown only when logged in with unlocked vault */}
      {isLoggedIn && vaultSavePhase !== 'saved' && (
        <BBButton
          variant="default"
          size="lg"
          className="w-full justify-center gap-2 bg-amber/10 text-amber border-amber/25 hover:bg-amber/20"
          onClick={onSaveToVault}
          disabled={vaultSavePhase === 'saving'}
        >
          {vaultSavePhase === 'saving' ? (
            <>
              <Spinner />
              Saving to vault…
            </>
          ) : (
            <>
              <Icon name="cloud" size={14} />
              Save to my Beebeeb
            </>
          )}
        </BBButton>
      )}

      {/* Vault save success */}
      {isLoggedIn && vaultSavePhase === 'saved' && (
        <div className="w-full flex flex-col items-center gap-2 mt-1">
          <div className="flex items-center gap-2 text-sm text-amber">
            <Icon name="check" size={14} />
            <span>Saved to your vault</span>
          </div>
          <a
            href="/drive"
            className="text-xs text-white/50 hover:text-white/80 transition-colors underline underline-offset-2"
          >
            Open Drive
          </a>
        </div>
      )}

      {/* Vault save error */}
      {vaultSavePhase === 'error' && vaultSaveError && (
        <p className="mt-2 text-xs text-red-400 text-center">{vaultSaveError}</p>
      )}

      {/* Not logged in — prompt to sign up */}
      {!isLoggedIn && (
        <a
          href="/signup?intent=save-constellation-file"
          className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:border-white/20 transition-colors"
        >
          <Icon name="cloud" size={14} />
          Create free account to save this file
        </a>
      )}

      {/* Transfer receipt — collapsible, shows SHA-256 fingerprint */}
      {proof && <TransferReceipt proof={proof} />}
    </div>
  )
}

function ErrorState({
  title,
  message,
  onReset,
}: {
  title: string
  message: string
  onReset: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-5">
        <Icon name="x" size={24} className="text-white/70" />
      </div>
      <h1 className="text-xl font-semibold text-white mb-2">{title}</h1>
      <p className="text-sm text-white/60 mb-8 leading-relaxed">{message}</p>
      <BBButton
        variant="default"
        size="md"
        className="w-full justify-center bg-white/[0.06] text-white border-white/15 hover:bg-white/10"
        onClick={onReset}
      >
        Try again
      </BBButton>
    </div>
  )
}

function Spinner({ large = false }: { large?: boolean }) {
  const cls = large ? 'h-8 w-8' : 'h-4 w-4'
  return (
    <svg className={`animate-spin ${cls} text-amber`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
