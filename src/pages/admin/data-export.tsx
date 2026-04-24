import { useState } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

interface ExportOption {
  label: string
  sub: string
  defaultOn: boolean
}

const exportOptions: ExportOption[] = [
  { label: 'Files (encrypted, original format on decrypt)', sub: '2,834 items', defaultOn: true },
  { label: 'Folder structure + metadata', sub: 'JSON manifest', defaultOn: true },
  { label: 'Version history', sub: 'last 30 days', defaultOn: true },
  { label: 'Shared links (as inactive records)', sub: '14 links', defaultOn: false },
  { label: 'Activity log', sub: 'signed CSV', defaultOn: true },
]

export function DataExport() {
  const [checked, setChecked] = useState(exportOptions.map(o => o.defaultOn))
  const [exporting, setExporting] = useState(false)

  function toggle(idx: number) {
    setChecked(prev => prev.map((v, i) => (i === idx ? !v : v)))
  }

  function handleExport() {
    setExporting(true)
    // Simulate export -- in production this calls the backend
    setTimeout(() => setExporting(false), 3000)
  }

  return (
    <AdminShell activeSection="data-export">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="download" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Pack my vault</h2>
        <BBChip variant="green" className="ml-auto">GDPR Art. 20</BBChip>
      </div>

      {/* Body */}
      <div className="p-6">
        <p className="text-[13px] text-ink-2 leading-relaxed mb-5">
          Export everything as a signed archive. Files stay encrypted with your keys --- the archive is portable and we can't read it either.
        </p>

        <div className="p-4 rounded-xl bg-paper-2 border border-line mb-5">
          <div className="flex items-center gap-2.5 text-[12.5px]">
            <Icon name="folder" size={13} className="text-amber-deep" />
            <span className="font-semibold">vault-export-{new Date().toISOString().slice(0, 10)}.tar.zst</span>
            <span className="ml-auto font-mono text-ink-3">~19.4 GB</span>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {exportOptions.map((o, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggle(i)}
                className="flex items-center gap-2.5 cursor-pointer text-left"
              >
                <span
                  className={`w-4 h-4 rounded-[4px] shrink-0 flex items-center justify-center border transition-colors ${
                    checked[i]
                      ? 'bg-amber border-amber-deep text-white'
                      : 'bg-paper border-line-2 text-transparent'
                  }`}
                >
                  <Icon name="check" size={10} />
                </span>
                <span className="text-[12.5px] flex-1">{o.label}</span>
                <span className="text-[10px] text-ink-3">{o.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 bg-amber-bg border border-amber-deep rounded-lg text-[11.5px] text-ink-2 leading-relaxed mb-5">
          <strong>You'll need your recovery phrase</strong> to decrypt the archive later. Without it, the files cannot be read --- not even by us.
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-ink-3">
            {exporting ? 'Preparing archive...' : 'Archive ready in ~8 min · we\'ll email you'}
          </span>
          <BBButton variant="amber" className="ml-auto" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Start export'}
          </BBButton>
        </div>
      </div>
    </AdminShell>
  )
}
