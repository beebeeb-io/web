import { useState, useRef, useEffect, useCallback } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import {
  createShare,
  lookupUserByEmail,
  getUserPublicKey,
  createUserShare,
  type ShareInfo,
  type ShareOptions,
} from '../lib/api'
import {
  encryptFileKeyForSharing,
  toBase64,
  fromBase64,
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

type ShareMode = 'link' | 'user'
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
        onClick={() => onChange('user')}
        className={`flex items-center gap-1.5 px-3 pb-2 text-[13px] font-medium border-b-2 transition-colors ${
          mode === 'user'
            ? 'border-amber-deep text-amber-deep'
            : 'border-transparent text-ink-3 hover:text-ink-2'
        }`}
      >
        <Icon name="users" size={13} />
        User
      </button>
    </div>
  )
}

// ─── User share section ─────────────────────────────

function UserShareForm({
  fileId,
  onSuccess,
}: {
  fileId: string
  onSuccess: (email: string) => void
}) {
  const { getFileKey, getMasterKey } = useKeys()

  const [email, setEmail] = useState('')
  const [canDownload, setCanDownload] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleShare = useCallback(async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 1. Look up recipient by email
      const recipient = await lookupUserByEmail(trimmed)

      // 2. Fetch their X25519 public key
      const pubKeyResponse = await getUserPublicKey(recipient.user_id)
      const recipientPublicKey = fromBase64(pubKeyResponse.public_key)

      // 3. Get our master key and the file key
      const masterKey = getMasterKey()
      const fileKey = await getFileKey(fileId)

      // 4. Encrypt the file key for the recipient via X25519 key exchange
      const { encryptedFileKey, nonce } = await encryptFileKeyForSharing(
        masterKey,
        recipientPublicKey,
        fileId,
        fileKey,
      )

      // Zero the file key after use
      zeroize(fileKey)

      // 5. Send to server
      await createUserShare(
        fileId,
        recipient.user_id,
        toBase64(encryptedFileKey),
        toBase64(nonce),
        { can_download: canDownload },
      )

      onSuccess(trimmed)
    } catch (e) {
      if (e instanceof Error) {
        // Provide clearer messages for common cases
        if (e.message.includes('not found') || e.message.includes('404')) {
          setError('No Beebeeb account found for that email.')
        } else if (e.message.includes('public_key') || e.message.includes('public key')) {
          setError('That user has not set up encryption yet.')
        } else {
          setError(e.message)
        }
      } else {
        setError('Failed to share. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [email, canDownload, fileId, getFileKey, getMasterKey, onSuccess])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        e.preventDefault()
        handleShare()
      }
    },
    [handleShare, loading],
  )

  return (
    <div>
      {/* Email input */}
      <label className="block text-xs font-medium text-ink-2 mb-1.5">
        Recipient email
      </label>
      <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3 focus-within:border-line-2 transition-colors">
        <Icon name="mail" size={13} className="text-ink-3 shrink-0" />
        <input
          ref={inputRef}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder="colleague@example.com"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>

      {/* Permissions */}
      <div className="flex items-center text-[13px] mb-5">
        <Icon name="download" size={13} className="text-ink-3" />
        <span className="ml-2.5 flex-1">Can download</span>
        <Toggle on={canDownload} onChange={setCanDownload} />
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
        onClick={handleShare}
        disabled={loading}
      >
        <Icon name="shield" size={13} />
        {loading ? 'Encrypting...' : 'Share with user'}
      </BBButton>

      <div className="flex items-center gap-1.5 mt-3 text-[11.5px] text-ink-3">
        <Icon name="lock" size={11} className="text-amber-deep" />
        End-to-end encrypted. Only the recipient can decrypt.
      </div>
    </div>
  )
}

// ─── Success state for user share ────────────────────

function UserShareSuccess({
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
      <p className="text-sm font-medium text-ink mb-1">Shared successfully</p>
      <p className="text-xs text-ink-3 mb-4">
        <span className="font-mono text-ink-2">{email}</span> can now access
        this file.
      </p>
      <div className="flex items-center gap-1.5 justify-center text-[11.5px] text-ink-3 mb-4">
        <Icon name="shield" size={11} className="text-amber-deep" />
        File key encrypted via X25519 key exchange. We never see it.
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
  const [copied, setCopied] = useState<'link' | 'key' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userShareDone, setUserShareDone] = useState<string | null>(null)

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
      setUserShareDone(null)
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

  const copyToClipboard = useCallback(async (text: string, type: 'link' | 'key') => {
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
    ? `beebeeb.io/s/${shareResult.token}`
    : ''
  const fullShareUrl = shareResult && decryptionKey
    ? `https://${shareUrl}#key=${encodeURIComponent(decryptionKey)}`
    : ''

  const permToggles: [string, boolean, (v: boolean) => void, 'eye' | 'download' | 'file' | 'share'][] = [
    ['Can view', canView, setCanView, 'eye'],
    ['Can download', canDownload, setCanDownload, 'download'],
    ['Can edit', canEdit, setCanEdit, 'file'],
    ['Can re-share', canReshare, setCanReshare, 'share'],
  ]

  return (
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
              {/* Link section */}
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Link</label>
              <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-4">
                <Icon name="link" size={13} className="text-ink-3 shrink-0" />
                <input
                  value={shareUrl}
                  readOnly
                  className="flex-1 bg-transparent font-mono text-xs text-ink outline-none"
                />
                <BBButton
                  size="sm"
                  onClick={() => copyToClipboard(fullShareUrl, 'link')}
                  className="gap-1"
                >
                  <Icon name={copied === 'link' ? 'check' : 'copy'} size={11} />
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </BBButton>
              </div>

              {/* Decryption key section */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xs font-medium text-ink-2">Decryption key</span>
                <BBChip variant="amber">
                  <span className="text-[9.5px]">Send via a different channel</span>
                </BBChip>
              </div>
              <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-amber-bg border-amber-deep/30">
                <Icon name="key" size={13} className="text-amber-deep shrink-0" />
                <input
                  value={decryptionKey}
                  readOnly
                  className="flex-1 bg-transparent font-mono text-xs text-amber-deep font-medium outline-none"
                />
                <BBButton
                  size="sm"
                  onClick={() => copyToClipboard(decryptionKey, 'key')}
                  className="gap-1"
                >
                  <Icon name={copied === 'key' ? 'check' : 'copy'} size={11} />
                  {copied === 'key' ? 'Copied' : 'Copy'}
                </BBButton>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11.5px] text-ink-3">
                <Icon name="shield" size={11} className="text-amber-deep" />
                Zero-knowledge by default — we never see the key.
              </div>
            </>
          ) : mode === 'user' && userShareDone ? (
            /* User share success view */
            <UserShareSuccess
              email={userShareDone}
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
                /* User share form */
                <UserShareForm
                  fileId={fileId}
                  onSuccess={(email) => setUserShareDone(email)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
