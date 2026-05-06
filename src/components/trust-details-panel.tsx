import { useEffect, useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { formatBytes } from '../lib/format'
import { EncryptionProof } from './encryption-proof'

export interface TrustFile {
  id: string
  name: string
  sizeBytes: number
  createdAt: string
  city?: string
  region?: string
  provider?: string
  cipher?: string
}

interface TrustDetailsPanelProps {
  open: boolean
  onClose: () => void
  file: TrustFile | null
  /** Optional: original File object to compare against ciphertext in the proof view */
  originalFile?: File | null
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TrustDetailsPanel({
  open,
  onClose,
  file,
  originalFile,
}: TrustDetailsPanelProps) {
  const [showProof, setShowProof] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showProof) setShowProof(false)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, showProof])

  useEffect(() => {
    if (!open) setShowProof(false)
  }, [open])

  if (!open || !file) return null

  const city = file.city ?? 'Falkenstein'
  const region = file.region ?? 'Europe'
  const provider = file.provider ?? 'Hetzner'
  const cipher = file.cipher ?? 'AES-256-GCM'

  async function handleDownloadCiphertext() {
    if (!file) return
    setDownloading(true)
    try {
      const { downloadFile } = await import('../lib/api')
      const blob = await downloadFile(file.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${file.name}.beebeeb.enc`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setDownloading(false)
    }
  }

  const details: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Algorithm', value: cipher, mono: true },
    { label: 'Key source', value: 'Derived from file ID' },
    { label: 'Encrypted at', value: formatTimestamp(file.createdAt) },
    { label: 'Encrypted by', value: 'This browser' },
    { label: 'Stored in', value: `${region} · ${city}` },
    { label: 'Provider', value: provider },
    { label: 'File size', value: formatBytes(file.sizeBytes), mono: true },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trust-details-title"
    >
      <div className="absolute inset-0 bg-ink/20" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[460px] h-full bg-paper border-l border-line-2 shadow-3 flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-bg border border-amber/40 flex items-center justify-center shrink-0 text-amber-deep">
              <Icon name="lock" size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div id="trust-details-title" className="text-[13px] font-semibold text-ink leading-tight">
                Encryption details
              </div>
              <div className="text-[11.5px] text-ink-3 truncate mt-0.5">
                {file.name}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-ink-3 hover:text-ink transition-colors shrink-0 mt-0.5"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {showProof ? (
            <EncryptionProof
              file={file}
              originalFile={originalFile ?? null}
              onBack={() => setShowProof(false)}
            />
          ) : (
            <>
              {/* Details grid */}
              <div className="px-xl py-lg border-b border-line">
                <div className="flex flex-col gap-[9px]">
                  {details.map((d) => (
                    <div key={d.label} className="flex text-[12px] gap-3">
                      <span className="text-ink-3 w-[110px] shrink-0">{d.label}</span>
                      <span
                        className={`text-ink-2 flex-1 break-words ${d.mono ? 'font-mono tabular-nums' : ''}`}
                      >
                        {d.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Honest copy */}
              <div className="px-xl py-lg border-b border-line">
                <p className="text-[13px] text-ink-2 leading-snug">
                  Key never left your device.
                </p>
                <p className="text-[13px] text-ink-2 leading-snug mt-1.5">
                  We store ciphertext. We can&rsquo;t read it.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!showProof && (
          <div className="px-xl py-md border-t border-line flex gap-2">
            <BBButton
              size="sm"
              variant="amber"
              className="flex-1 justify-center gap-1.5"
              onClick={() => setShowProof(true)}
            >
              <Icon name="shield" size={11} /> Prove it
            </BBButton>
            <BBButton
              size="sm"
              variant="default"
              className="flex-1 justify-center gap-1.5"
              onClick={handleDownloadCiphertext}
              disabled={downloading}
            >
              <Icon name="download" size={11} />
              {downloading ? 'Downloading...' : 'Download raw ciphertext'}
            </BBButton>
          </div>
        )}
      </div>
    </div>
  )
}
