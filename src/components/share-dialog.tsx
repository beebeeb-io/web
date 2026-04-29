import { useState, useRef, useEffect, useCallback } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { FeedbackDialog } from './feedback-dialog'
import {
  createShare,
  createInvite,
  type ShareInfo,
  type ShareOptions,
} from '../lib/api'
import {
  toBase64,
  zeroize,
} from '../lib/crypto'
import { useKeys } from '../lib/key-context'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  fileId: string
  fileName: string
  fileSize: number
}

type ShareMode = 'link' | 'invite'
type ExpiryOption = { label: string; hours: number | null }
type MaxOpensOption = { label: string; value: number | null }

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Never', hours: null },
]

const MAX_OPENS_OPTIONS: MaxOpensOption[] = [
  { label: '1', value: 1 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: 'Unlimited', value: null },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full border-2 transition-colors ${
        on ? 'bg-amber border-amber-deep' : 'bg-paper-3 border-line-2'
      }`}
    >
      <span
        className={`pointer-events-none block h-[16px] w-[16px] rounded-full bg-white shadow-1 transition-transform ${
          on ? 'translate-x-[16px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function Dropdown<T extends { label: string }>({
  options,
  selected,
  onChange,
  icon,
}: {
  options: T[]
  selected: number
  onChange: (index: number) => void
  icon?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 text-[13px] text-ink transition-all hover:border-line-2"
      >
        {icon}
        <span className="flex-1 text-left">{options[selected].label}</span>
        <Icon name="chevron-down" size={12} className="text-ink-4" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-paper border border-line-2 rounded-lg shadow-2 z-30 overflow-hidden">
          {options.map((opt, i) => (
            <button
              key={opt.label}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                i === selected
                  ? 'bg-amber-bg text-amber-deep font-medium'
                  : 'text-ink hover:bg-paper-2'
              }`}
              onClick={() => {
                onChange(i)
                setOpen(false)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab selector ────────────────────────────────────

function TabBar({
  mode,
  onChange,
}: {
  mode: ShareMode
  onChange: (m: ShareMode) => void
}) {
  return (
    <div className="flex gap-0 border-b border-line mb-[18px]">
      <button
        type="button"
        onClick={() => onChange('link')}
        className={`flex items-center gap-1.5 px-3 pb-2 text-[13px] font-medium border-b-2 transition-colors ${
          mode === 'link'
            ? 'border-amber-deep text-amber-deep'
            : 'border-transparent text-ink-3 hover:text-ink-2'
        }`}
      >
        <Icon name="link" size={13} />
        Link
      </button>
      <button
        type="button"
        onClick={() => onChange('invite')}
        className={`flex items-center gap-1.5 px-3 pb-2 text-[13px] font-medium border-b-2 transition-colors ${
          mode === 'invite'
            ? 'border-amber-deep text-amber-deep'
            : 'border-transparent text-ink-3 hover:text-ink-2'
        }`}
      >
        <Icon name="mail" size={13} />
        Invite
      </button>
    </div>
  )
}

// ─── Rate limit error parsing ────────────────────────

interface RateLimitInfo {
  limit_type: 'hourly' | 'daily' | 'per_file'
  retry_after_seconds?: number
}

function parseRateLimitError(error: unknown): RateLimitInfo | null {
  if (!(error instanceof Error)) return null
  try {
    const match = error.message.match(/\{.*\}/)
    if (!match) return null
    const body = JSON.parse(match[0])
    if (body.limit_type) return body as RateLimitInfo
  } catch {
    if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit')) {
      return { limit_type: 'hourly' }
    }
  }
  return null
}

// ─── Invite section (blind sharing) ──────────────────

function InviteForm({
  fileId,
  onSuccess,
  onRateLimitFeedback,
}: {
  fileId: string
  onSuccess: (email: string) => void
  onRateLimitFeedback: () => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.')
      return
    }

    setLoading(true)
    setError(null)
    setRateLimitInfo(null)

    try {
      await createInvite(fileId, trimmed)
      onSuccess(trimmed)
    } catch (e) {
      const rateLimit = parseRateLimitError(e)
      if (rateLimit) {
        setRateLimitInfo(rateLimit)
      } else if (e instanceof Error) {
        setError(e.message)
      } else {
        setError('Failed to send invite. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [email, fileId, onSuccess])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        e.preventDefault()
        handleInvite()
      }
    },
    [handleInvite, loading],
  )

  const rateLimitMessage = rateLimitInfo ? (() => {
    switch (rateLimitInfo.limit_type) {
      case 'hourly': {
        const minutes = rateLimitInfo.retry_after_seconds
          ? Math.ceil(rateLimitInfo.retry_after_seconds / 60)
          : undefined
        return {
          text: `50 invites this hour — that's the limit. We do this to prevent spam.${minutes ? ` It resets in ${minutes}m.` : ''} If this is blocking real work, `,
          hasLink: true,
        }
      }
      case 'daily':
        return {
          text: '200 invites today — limit reached. We do this to prevent spam.',
          hasLink: false,
        }
      case 'per_file':
        return {
          text: "This file is shared with 20 people — that's the maximum.",
          hasLink: false,
        }
    }
  })() : null

  return (
    <div>
      {/* Email input */}
      <label className="block text-xs font-medium text-ink-2 mb-1.5">
        Recipient email
      </label>
      <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-4 focus-within:border-line-2 transition-colors">
        <Icon name="mail" size={13} className="text-ink-3 shrink-0" />
        <input
          ref={inputRef}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
            setRateLimitInfo(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder="colleague@example.com"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red/10 border border-red/20 rounded-md text-xs text-red">
          {error}
        </div>
      )}

      {rateLimitMessage && (
        <div className="mb-4 px-3 py-2 bg-amber-bg border border-amber/20 rounded-md text-xs text-ink-2">
          {rateLimitMessage.text}
          {rateLimitMessage.hasLink && (
            <button
              type="button"
              onClick={onRateLimitFeedback}
              className="text-amber-deep underline underline-offset-2 hover:text-amber transition-colors"
            >
              let us know
            </button>
          )}
          {rateLimitMessage.hasLink && '.'}
        </div>
      )}

      <BBButton
        variant="amber"
        size="lg"
        className="w-full justify-center gap-2"
        onClick={handleInvite}
        disabled={loading}
      >
        <Icon name="mail" size={13} />
        {loading ? 'Sending...' : 'Send invite'}
      </BBButton>

      <div className="flex items-center gap-1.5 mt-3 text-[11.5px] text-ink-3">
        <Icon name="shield" size={11} className="text-amber-deep" />
        They'll get an email with instructions. Key exchange happens when they accept.
      </div>
    </div>
  )
}

// ─── Success state for invite ────────────────────────

function InviteSuccess({
  email,
  onDone,
}: {
  email: string
  onDone: () => void
}) {
  return (
    <div className="text-center py-2">
      <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-green/10 flex items-center justify-center">
        <Icon name="check" size={18} className="text-green" />
      </div>
      <p className="text-sm font-medium text-ink mb-1">Invite sent</p>
      <p className="text-xs text-ink-3 mb-1">
        Invite sent to <span className="font-mono text-ink-2">{email}</span>.
      </p>
      <p className="text-xs text-ink-3 mb-4">
        They'll receive an email with instructions. You'll be notified when they accept.
      </p>
      <div className="flex items-center gap-1.5 justify-center text-[11.5px] text-ink-3 mb-4">
        <Icon name="shield" size={11} className="text-amber-deep" />
        End-to-end encrypted. Key exchange happens on accept.
      </div>
      <BBButton size="md" onClick={onDone} className="mx-auto">
        Done
      </BBButton>
    </div>
  )
}

// ─── Main dialog ─────────────────────────────────────

export function ShareDialog({ open, onClose, fileId, fileName, fileSize }: ShareDialogProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const [mode, setMode] = useState<ShareMode>('link')
  const [expiryIdx, setExpiryIdx] = useState(1) // default: 24 hours
  const [maxOpensIdx, setMaxOpensIdx] = useState(1) // default: 3
  const [canView, setCanView] = useState(true)
  const [canDownload, setCanDownload] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [canReshare, setCanReshare] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shareResult, setShareResult] = useState<ShareInfo | null>(null)
  const [decryptionKey, setDecryptionKey] = useState<string>('')
  const [copied, setCopied] = useState<'full-link' | 'split-link' | 'split-key' | null>(null)
  const [shareMode, setShareMode] = useState<'full' | 'split'>('full')
  const [error, setError] = useState<string | null>(null)
  const [inviteDone, setInviteDone] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMode('link')
      setExpiryIdx(1)
      setMaxOpensIdx(1)
      setCanView(true)
      setCanDownload(true)
      setCanEdit(false)
      setCanReshare(false)
      setShareResult(null)
      setDecryptionKey('')
      setError(null)
      setLoading(false)
      setInviteDone(null)
      setFeedbackOpen(false)
    }
  }, [open])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (!isUnlocked) {
      setError('Vault is locked. Log in again to share files.')
      setLoading(false)
      return
    }

    const options: ShareOptions = {
      expires_in_hours: EXPIRY_OPTIONS[expiryIdx].hours,
      max_opens: MAX_OPENS_OPTIONS[maxOpensIdx].value,
      can_download: canDownload,
    }

    try {
      // Derive the real file key for the decryption key
      const fileKey = await getFileKey(fileId)
      const keyB64 = toBase64(fileKey)
      zeroize(fileKey)

      const result = await createShare(fileId, options)
      setShareResult(result)
      setDecryptionKey(keyB64)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }, [fileId, expiryIdx, maxOpensIdx, canDownload, isUnlocked, getFileKey])

  const copyToClipboard = useCallback(async (text: string, type: 'full-link' | 'split-link' | 'split-key') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Fallback for older browsers
    }
  }, [])

  if (!open) return null

  // The share URL includes the decryption key as a URL fragment (#key=...).
  // Fragments are never sent to the server, preserving zero-knowledge.
  const shareUrl = shareResult
    ? `${window.location.origin}/s/${shareResult.token}`
    : ''
  const fullShareUrl = shareResult && decryptionKey
    ? `${shareUrl}#key=${encodeURIComponent(decryptionKey)}`
    : ''

  const permToggles: [string, boolean, (v: boolean) => void, 'eye' | 'download' | 'file' | 'share'][] = [
    ['Can view', canView, setCanView, 'eye'],
    ['Can download', canDownload, setCanDownload, 'download'],
    ['Can edit', canEdit, setCanEdit, 'file'],
    ['Can re-share', canReshare, setCanReshare, 'share'],
  ]

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-ink/20" />

        {/* Dialog */}
        <div
          ref={dialogRef}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[500px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
        >
          {/* Header */}
          <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
            <Icon name="share" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Send securely</span>
            <BBChip>
              {fileName} · {formatBytes(fileSize)}
            </BBChip>
            <button
              onClick={onClose}
              className="ml-auto text-ink-3 hover:text-ink transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="p-[22px]">
            {/* Link share result view */}
            {mode === 'link' && shareResult ? (
              <>
                {/* Share mode toggle */}
                <div className="flex gap-1 mb-3 p-0.5 bg-paper-2 rounded-md border border-line">
                  <button
                    type="button"
                    onClick={() => { setShareMode('full'); setCopied(null) }}
                    className={`flex-1 text-xs py-1.5 rounded transition-all ${shareMode === 'full' ? 'bg-paper shadow-1 text-ink font-medium' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    Full link
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShareMode('split'); setCopied(null) }}
                    className={`flex-1 text-xs py-1.5 rounded transition-all ${shareMode === 'split' ? 'bg-paper shadow-1 text-ink font-medium' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    Link + key (extra secure)
                  </button>
                </div>

                {shareMode === 'full' ? (
                  <>
                    <label className="block text-xs font-medium text-ink-2 mb-1.5">Share link</label>
                    <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3">
                      <Icon name="link" size={13} className="text-ink-3 shrink-0" />
                      <input
                        value={fullShareUrl}
                        readOnly
                        className="flex-1 bg-transparent font-mono text-xs text-ink outline-none truncate"
                      />
                    </div>
                    <BBButton
                      variant="amber"
                      size="lg"
                      className="w-full justify-center gap-2"
                      onClick={() => copyToClipboard(fullShareUrl, 'full-link')}
                    >
                      <Icon name={copied === 'full-link' ? 'check' : 'copy'} size={14} />
                      {copied === 'full-link' ? 'Copied' : 'Copy link'}
                    </BBButton>
                    <div className="flex items-center gap-1.5 mt-3 text-[11.5px] text-ink-3">
                      <Icon name="shield" size={11} className="text-amber-deep" />
                      Key is embedded in the link. One click to share.
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-medium text-ink-2 mb-1.5">Share link</label>
                    <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3">
                      <Icon name="link" size={13} className="text-ink-3 shrink-0" />
                      <input
                        value={shareUrl}
                        readOnly
                        className="flex-1 bg-transparent font-mono text-xs text-ink outline-none truncate"
                      />
                      <BBButton size="sm" onClick={() => copyToClipboard(shareUrl, 'split-link')} className="shrink-0 gap-1">
                        <Icon name={copied === 'split-link' ? 'check' : 'copy'} size={11} />
                        {copied === 'split-link' ? 'Copied' : 'Copy'}
                      </BBButton>
                    </div>

                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-medium text-ink-2">Decryption key</span>
                      <BBChip variant="amber">Send via a different channel</BBChip>
                    </div>
                    <div className="flex items-center gap-2 border rounded-md px-3 py-2 mb-3"
                      style={{ background: 'oklch(0.97 0.03 84)', borderColor: 'oklch(0.86 0.07 90)' }}>
                      <Icon name="key" size={13} className="text-amber-deep shrink-0" />
                      <input
                        value={decryptionKey}
                        readOnly
                        className="flex-1 bg-transparent font-mono text-xs outline-none truncate"
                        style={{ color: 'oklch(0.35 0.1 72)', fontWeight: 500 }}
                      />
                      <BBButton size="sm" onClick={() => copyToClipboard(decryptionKey, 'split-key')} className="shrink-0 gap-1">
                        <Icon name={copied === 'split-key' ? 'check' : 'copy'} size={11} />
                        {copied === 'split-key' ? 'Copied' : 'Copy'}
                      </BBButton>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                      <Icon name="shield" size={11} className="text-amber-deep" />
                      Zero-knowledge by default — we never see the key.
                    </div>
                  </>
                )}
              </>
            ) : mode === 'invite' && inviteDone ? (
              /* Invite success view */
              <InviteSuccess
                email={inviteDone}
                onDone={onClose}
              />
            ) : (
              <>
                {/* Tab bar — only show before a result */}
                <TabBar mode={mode} onChange={setMode} />

                {mode === 'link' ? (
                  <>
                    {/* Expiry + Max opens dropdowns */}
                    <div className="grid grid-cols-2 gap-3 mb-[18px]">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1.5">Expires</label>
                        <Dropdown
                          options={EXPIRY_OPTIONS}
                          selected={expiryIdx}
                          onChange={setExpiryIdx}
                          icon={<Icon name="clock" size={13} className="text-ink-3" />}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1.5">Max opens</label>
                        <Dropdown
                          options={MAX_OPENS_OPTIONS}
                          selected={maxOpensIdx}
                          onChange={setMaxOpensIdx}
                        />
                      </div>
                    </div>

                    {/* Permissions */}
                    <label className="block text-xs font-medium text-ink-2 mb-2.5">Permissions</label>
                    <div className="flex flex-col gap-2.5 mb-5">
                      {permToggles.map(([label, on, setter, iconName]) => (
                        <div key={label} className="flex items-center text-[13px]">
                          <Icon name={iconName} size={13} className="text-ink-3" />
                          <span className="ml-2.5 flex-1">{label}</span>
                          <Toggle on={on} onChange={setter} />
                        </div>
                      ))}
                    </div>

                    {error && (
                      <div className="mb-4 px-3 py-2 bg-red/10 border border-red/20 rounded-md text-xs text-red">
                        {error}
                      </div>
                    )}

                    <BBButton
                      variant="amber"
                      size="lg"
                      className="w-full justify-center gap-2"
                      onClick={handleGenerate}
                      disabled={loading}
                    >
                      <Icon name="lock" size={13} />
                      {loading ? 'Generating...' : 'Generate encrypted link'}
                    </BBButton>
                  </>
                ) : (
                  /* Invite form */
                  <InviteForm
                    fileId={fileId}
                    onSuccess={(email) => setInviteDone(email)}
                    onRateLimitFeedback={() => setFeedbackOpen(true)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        defaultCategory="Sharing limits"
      />
    </>
  )
}
