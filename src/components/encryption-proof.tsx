import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { BBButton } from './bb-button'
import { downloadFile } from '../lib/api'
import type { TrustFile } from './trust-details-panel'

interface EncryptionProofProps {
  file: TrustFile
  /** Original plaintext File the user uploaded — when available, shown on the left */
  originalFile?: File | null
  onBack: () => void
}

const PREVIEW_BYTES = 512

function hexDump(bytes: Uint8Array | null): string[] {
  if (!bytes || bytes.length === 0) return []
  const lines: string[] = []
  const cols = 16
  for (let off = 0; off < bytes.length; off += cols) {
    const row = bytes.slice(off, off + cols)
    const hex = Array.from(row)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    const padded = hex.padEnd(cols * 3 - 1, ' ')
    const ascii = Array.from(row)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('')
    const offset = off.toString(16).padStart(6, '0')
    lines.push(`${offset}  ${padded}  ${ascii}`)
  }
  return lines
}

export function EncryptionProof({ file, originalFile, onBack }: EncryptionProofProps) {
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null)
  const [serverBytes, setServerBytes] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [orig, server] = await Promise.all([
          originalFile
            ? originalFile.slice(0, PREVIEW_BYTES).arrayBuffer().then((b) => new Uint8Array(b))
            : Promise.resolve<Uint8Array | null>(null),
          downloadFile(file.id).then((blob) =>
            blob.slice(0, PREVIEW_BYTES).arrayBuffer().then((b) => new Uint8Array(b))
          ),
        ])
        if (cancelled) return
        setOriginalBytes(orig)
        setServerBytes(server)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load ciphertext')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [file.id, originalFile])

  return (
    <div className="px-xl py-lg flex flex-col h-full">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[11.5px] text-ink-3 hover:text-ink transition-colors mb-3 self-start cursor-pointer"
      >
        <span className="inline-flex rotate-180">
          <Icon name="chevron-right" size={11} />
        </span>
        Back to details
      </button>

      <h2 className="text-[13px] font-semibold text-ink mb-1">Prove it</h2>
      <p className="text-[11.5px] text-ink-3 leading-snug mb-3">
        First {PREVIEW_BYTES} bytes — what you uploaded versus what our server stores.
      </p>

      {error && (
        <div className="px-3 py-2 mb-3 rounded-md bg-red/10 border border-red/30 text-red text-[11.5px]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 flex-1 min-h-0">
        <HexPanel
          title={originalFile ? 'What you uploaded' : 'What you uploaded'}
          subtitle={
            originalFile
              ? `Plaintext · first ${Math.min(PREVIEW_BYTES, originalBytes?.length ?? 0)} bytes`
              : 'Plaintext not available — re-upload to compare'
          }
          bytes={originalBytes}
          loading={loading && !!originalFile}
          empty={!originalFile && !loading}
          accent="ink"
        />
        <HexPanel
          title="What our server stores"
          subtitle={`Ciphertext · first ${Math.min(PREVIEW_BYTES, serverBytes?.length ?? 0)} bytes`}
          bytes={serverBytes}
          loading={loading}
          accent="amber"
        />
      </div>

      <div className="mt-3 pt-3 border-t border-line">
        <p className="text-[11.5px] text-ink-2 leading-snug">
          These bytes are what our servers see. Without your key, this is noise.
        </p>
        <div className="flex gap-2 mt-3">
          <BBButton
            size="sm"
            variant="default"
            className="gap-1.5"
            onClick={async () => {
              const blob = await downloadFile(file.id)
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${file.name}.beebeeb.enc`
              document.body.appendChild(a)
              a.click()
              a.remove()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            <Icon name="download" size={11} /> Download raw ciphertext
          </BBButton>
        </div>
      </div>
    </div>
  )
}

interface HexPanelProps {
  title: string
  subtitle: string
  bytes: Uint8Array | null
  loading: boolean
  empty?: boolean
  accent: 'ink' | 'amber'
}

function HexPanel({ title, subtitle, bytes, loading, empty, accent }: HexPanelProps) {
  const lines = hexDump(bytes)

  return (
    <div className="flex flex-col rounded-md border border-line bg-paper-2 overflow-hidden">
      <div className="px-3 py-2 border-b border-line flex items-center gap-2">
        <span
          className={`inline-flex w-1.5 h-1.5 rounded-full ${
            accent === 'amber' ? 'bg-amber' : 'bg-ink-3'
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-medium text-ink truncate">{title}</div>
          <div className="text-[10px] text-ink-3 font-mono truncate">{subtitle}</div>
        </div>
      </div>
      <div className="px-3 py-2 max-h-[200px] overflow-auto bg-paper">
        {loading ? (
          <div className="text-[10.5px] text-ink-3 font-mono">Loading...</div>
        ) : empty ? (
          <div className="text-[10.5px] text-ink-3 italic">
            Not available in this session.
          </div>
        ) : lines.length === 0 ? (
          <div className="text-[10.5px] text-ink-3 font-mono">(empty)</div>
        ) : (
          <pre
            className="text-[10.5px] leading-[1.45] font-mono text-ink-2 whitespace-pre"
            style={{ tabSize: 2 }}
          >
            {lines.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}
