import { useState, useRef, useEffect, useCallback } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { createShare, type ShareInfo, type ShareOptions } from '../lib/api'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  fileId: string
  fileName: string
  fileSize: number
}

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

export function ShareDialog({ open, onClose, fileId, fileName, fileSize }: ShareDialogProps) {
  const [expiryIdx, setExpiryIdx] = useState(1) // default: 24 hours
  const [maxOpensIdx, setMaxOpensIdx] = useState(1) // default: 3
  const [canView, setCanView] = useState(true)
  const [canDownload, setCanDownload] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [canReshare, setCanReshare] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shareResult, setShareResult] = useState<ShareInfo | null>(null)
  const [copied, setCopied] = useState<'link' | 'key' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setExpiryIdx(1)
      setMaxOpensIdx(1)
      setCanView(true)
      setCanDownload(true)
      setCanEdit(false)
      setCanReshare(false)
      setShareResult(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)

    const options: ShareOptions = {
      expires_in_hours: EXPIRY_OPTIONS[expiryIdx].hours,
      max_opens: MAX_OPENS_OPTIONS[maxOpensIdx].value,
      can_download: canDownload,
    }

    try {
      const result = await createShare(fileId, options)
      setShareResult(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }, [fileId, expiryIdx, maxOpensIdx, canDownload])

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

  const shareUrl = shareResult
    ? `beebeeb.io/s/${shareResult.token}`
    : ''

  // Placeholder decryption key (for E2EE demo)
  const decryptionKey = 'k-a1b4-c7de-f204-9911-bb88'

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
          {shareResult ? (
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
                  onClick={() => copyToClipboard(`https://${shareUrl}`, 'link')}
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
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}
