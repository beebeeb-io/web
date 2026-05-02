import { useState, useRef, useEffect, useCallback } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from './bb-button'
import { formatBytes } from '../lib/format'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { FeedbackDialog } from './feedback-dialog'
import {
  createShare,
  createInvite,
  approveInvite,
  revokeShare,
  type ShareInfo,
  type ShareOptions,
} from '../lib/api'
import {
  toBase64,
  fromBase64,
  zeroize,
  encryptFileKeyForSharing,
} from '../lib/crypto'
import {
  generateFolderKey,
  encryptFolderKeyForRecipient,
  encryptOwnerFolderKey,
  encryptAllChildrenKeys,
} from '../lib/folder-share-crypto'
import { useKeys } from '../lib/key-context'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  fileId: string
  fileName: string
  fileSize: number
  isFolder?: boolean
  /** Fires once a share link is successfully created. Used by the first-share onboarding tour. */
  onShareCreated?: (info: { fileId: string; shareUrl: string }) => void
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
  isFolder,
  onSuccess,
  onRateLimitFeedback,
}: {
  fileId: string
  isFolder?: boolean
  onSuccess: (email: string) => void
  onRateLimitFeedback: () => void
}) {
  const { getMasterKey, getFileKey } = useKeys()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const [progress, setProgress] = useState<string | null>(null)

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address.')
      return
    }

    setLoading(true)
    setError(null)
    setRateLimitInfo(null)
    setProgress(null)

    try {
      if (isFolder) {
        // Folder sharing flow — generate folder_key, encrypt children, create invite
        const masterKey = getMasterKey()
        const folderKey = await generateFolderKey()

        setProgress('Encrypting folder contents...')
        const folderKeys = await encryptAllChildrenKeys(
          masterKey, folderKey, fileId,
          (done, total) => setProgress(`Encrypting keys: ${done}/${total}`),
        )

        // Encrypt folder key for owner (self-storage)
        const encOwnerFK = await encryptOwnerFolderKey(masterKey, fileId, folderKey)

        setProgress('Creating invite...')
        const result = await createInvite(fileId, trimmed, {
          is_folder_share: true,
          encrypted_folder_key: '', // placeholder — filled after auto-claim
          encrypted_owner_folder_key: toBase64(encOwnerFK),
          folder_keys: folderKeys,
        })

        // Auto-approve with folder key encryption for recipient
        if (result.recipient_public_key && result.status === 'claimed') {
          try {
            const recipientPubKey = fromBase64(result.recipient_public_key)
            const encFolderKey = await encryptFolderKeyForRecipient(
              masterKey, recipientPubKey, fileId, folderKey,
            )
            // Update the invite with the encrypted folder key and approve
            const { patchInvite } = await import('../lib/api')
            await patchInvite(result.invite_id, {})
            // For folder shares, approval = setting encrypted_folder_key
            // We need a dedicated endpoint for this — for now, reuse approve with the folder key
            await approveInvite(result.invite_id, toBase64(encFolderKey))
          } catch {
            // Approval failed — invite is still claimed, sender can approve later
          }
        }

        zeroize(folderKey)
      } else {
        // Single file sharing flow
        const result = await createInvite(fileId, trimmed)

        if (result.recipient_public_key && result.status === 'claimed') {
          try {
            const masterKey = getMasterKey()
            const fileKey = await getFileKey(fileId)
            const recipientPubKey = fromBase64(result.recipient_public_key)

            const { encryptedFileKey, nonce } = await encryptFileKeyForSharing(
              masterKey,
              recipientPubKey,
              fileId,
              fileKey,
            )
            zeroize(fileKey)

            const combined = new Uint8Array(nonce.length + encryptedFileKey.length)
            combined.set(nonce, 0)
            combined.set(encryptedFileKey, nonce.length)

            await approveInvite(result.invite_id, toBase64(combined))
          } catch {
            // Approval failed — invite is still claimed, sender can approve later
          }
        }
      }

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
      setProgress(null)
    }
  }, [email, fileId, isFolder, onSuccess, getMasterKey, getFileKey])

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

      {progress && (
        <div className="mb-4 px-3 py-2 bg-amber-bg border border-amber/20 rounded-md text-xs text-ink-2 font-mono">
          {progress}
        </div>
      )}

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
        <span className="font-mono text-ink-2">{email}</span> will receive an email with instructions.
      </p>
      <p className="text-xs text-ink-3 mb-4">
        You'll be notified when they accept.
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

export function ShareDialog({ open, onClose, fileId, fileName, fileSize, isFolder, onShareCreated }: ShareDialogProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const [mode, setMode] = useState<ShareMode>('link')
  const [expiryIdx, setExpiryIdx] = useState(1) // default: 24 hours
  const [maxOpensIdx, setMaxOpensIdx] = useState(1) // default: 3
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shareResult, setShareResult] = useState<ShareInfo | null>(null)
  const [decryptionKey, setDecryptionKey] = useState<string>('')
  const [copied, setCopied] = useState<'full-link' | 'split-link' | 'split-key' | null>(null)
  const [shareMode, setShareMode] = useState<'full' | 'split'>('full')
  const [error, setError] = useState<string | null>(null)
  const [inviteDone, setInviteDone] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMode('link')
      setExpiryIdx(1)
      setMaxOpensIdx(1)
      setPassphrase('')
      setShowPassphrase(false)
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

    const trimmedPassphrase = passphrase.trim()
    if (trimmedPassphrase && trimmedPassphrase.length < 4) {
      setError('Passphrase must be at least 4 characters.')
      setLoading(false)
      return
    }

    const options: ShareOptions = {
      expires_in_hours: EXPIRY_OPTIONS[expiryIdx].hours,
      max_opens: MAX_OPENS_OPTIONS[maxOpensIdx].value,
      ...(trimmedPassphrase ? { passphrase: trimmedPassphrase } : {}),
    }

    try {
      // Derive the real file key for the decryption key
      const fileKey = await getFileKey(fileId)
      const keyB64 = toBase64(fileKey)
      zeroize(fileKey)

      const result = await createShare(fileId, options)
      setShareResult(result)
      setDecryptionKey(keyB64)
      if (onShareCreated) {
        const url = `${window.location.origin}/s/${result.token}#key=${encodeURIComponent(keyB64)}`
        onShareCreated({ fileId, shareUrl: url })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }, [fileId, expiryIdx, maxOpensIdx, passphrase, isUnlocked, getFileKey, onShareCreated])

  const copyToClipboard = useCallback(async (text: string, type: 'full-link' | 'split-link' | 'split-key') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Fallback: select text from a temporary textarea
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
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
          ref={focusTrapRef}
          role="dialog"
          aria-modal="true"
          aria-label="Send securely"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[500px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
        >
          {/* Header */}
          <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
            <Icon name="share" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Send securely</span>
            <BBChip className="max-w-[220px] truncate shrink">
              {fileName} · {formatBytes(fileSize)}
            </BBChip>
            <button
              onClick={onClose}
              aria-label="Close"
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

                {/* Settings summary + edit affordance */}
                <div className="flex items-start gap-3 mb-3 text-[11.5px] text-ink-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                    <span className="flex items-center gap-1">
                      <Icon name="clock" size={11} />
                      {EXPIRY_OPTIONS[expiryIdx].hours
                        ? `Expires in ${EXPIRY_OPTIONS[expiryIdx].label.toLowerCase()}`
                        : 'No expiry'}
                    </span>
                    <span className="w-px h-3 bg-line-2" />
                    <span>
                      {MAX_OPENS_OPTIONS[maxOpensIdx].value
                        ? `${MAX_OPENS_OPTIONS[maxOpensIdx].value} opens max`
                        : 'Unlimited opens'}
                    </span>
                    {shareResult.has_passphrase && (
                      <>
                        <span className="w-px h-3 bg-line-2" />
                        <span className="flex items-center gap-1">
                          <Icon name="lock" size={11} />
                          Passphrase required
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await revokeShare(shareResult.id)
                      } catch { /* server may be unreachable; revert UI anyway */ }
                      setShareResult(null)
                      setDecryptionKey('')
                      setCopied(null)
                      setError(null)
                    }}
                    className="shrink-0 flex items-center gap-1 text-ink-2 hover:text-ink underline-offset-2 hover:underline transition-colors"
                  >
                    <Icon name="settings" size={11} />
                    Edit settings
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
                        onFocus={(e) => e.target.select()}
                        className="flex-1 bg-transparent font-mono text-xs text-ink outline-none truncate select-all"
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
                        onFocus={(e) => e.target.select()}
                        className="flex-1 bg-transparent font-mono text-xs text-ink outline-none truncate select-all"
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
                    <div className="flex items-center gap-2 border border-amber-deep/40 bg-amber-bg rounded-md px-3 py-2 mb-3">
                      <Icon name="key" size={13} className="text-amber-deep shrink-0" />
                      <input
                        value={decryptionKey}
                        readOnly
                        onFocus={(e) => e.target.select()}
                        className="flex-1 bg-transparent font-mono text-xs font-medium text-amber-deep outline-none truncate select-all"
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
                    <div className="grid grid-cols-2 gap-3 mb-[14px]">
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

                    {/* Optional passphrase */}
                    <div className="mb-[18px]">
                      <label htmlFor="share-passphrase" className="block text-xs font-medium text-ink-2 mb-1.5">
                        Passphrase <span className="text-ink-3 font-normal">(optional)</span>
                      </label>
                      <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 transition-all hover:border-line-2 focus-within:border-line-2">
                        <Icon name="lock" size={13} className="text-ink-3 shrink-0" />
                        <input
                          id="share-passphrase"
                          type={showPassphrase ? 'text' : 'password'}
                          value={passphrase}
                          onChange={(e) => { setPassphrase(e.currentTarget.value); setError(null) }}
                          placeholder="Add a passphrase recipients must enter"
                          autoComplete="off"
                          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
                        />
                        {passphrase && (
                          <button
                            type="button"
                            onClick={() => setShowPassphrase((v) => !v)}
                            className="text-ink-3 hover:text-ink-2 transition-colors shrink-0"
                            aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                          >
                            <Icon name={showPassphrase ? 'eye-off' : 'eye'} size={13} />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-3 mt-1">
                        Recipients enter this before the file decrypts. Share it out-of-band.
                      </p>
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
                    isFolder={isFolder}
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
