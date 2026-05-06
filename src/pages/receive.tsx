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
 *
 * v1: bytes are saved as-is (encrypted with the transfer_key). When WASM
 * exposes HKDF + AES-GCM here we'll decrypt before saving.
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

function friendlyError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong. Please try again.'
}

export function Receive() {
  const [searchParams] = useSearchParams()
  const initialCode = (searchParams.get('code') ?? '').replace(/\D/g, '').slice(0, 6)

  const [phase, setPhase] = useState<Phase>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState(initialCode)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [senderPk, setSenderPk] = useState<string | null>(null)
  const [receiverPk, setReceiverPk] = useState<string | null>(null)
  const [downloadToken, setDownloadToken] = useState<string | null>(null)

  const [savedBlob, setSavedBlob] = useState<Blob | null>(null)
  const [savedFilename, setSavedFilename] = useState<string>('beebeeb-transfer')

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
        setSavedFilename(`beebeeb-transfer-${suffix}.enc`)

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

function Received({
  filename,
  size,
  onSave,
}: {
  filename: string
  size: number
  onSave: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber/15 border border-amber/30 flex items-center justify-center mb-5">
        <Icon name="check" size={26} className="text-amber" />
      </div>
      <h1 className="text-2xl font-semibold text-white mb-2">Done</h1>
      <p className="text-sm text-white/60 mb-8 leading-relaxed">
        File received. Server copy is being deleted.
      </p>

      <div className="w-full bg-white/[0.04] border border-white/10 rounded-lg p-4 mb-6 flex items-center gap-3 text-left">
        <div className="w-10 h-12 border border-white/15 rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
          <Icon name="file" size={18} className="text-white/60" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{filename}</div>
          <div className="text-xs text-white/50 mt-0.5">{formatBytes(size)}</div>
        </div>
      </div>

      <BBButton
        variant="amber"
        size="lg"
        className="w-full justify-center gap-2"
        onClick={onSave}
      >
        <Icon name="download" size={14} />
        Save to device
      </BBButton>
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
