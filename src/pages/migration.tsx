import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBLogo } from '../components/bb-logo'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { BBCheckbox } from '../components/bb-checkbox'
import { Icon } from '../components/icons'

// ── Types ────────────────────────────────────────────────────────────────────

type Source = 'google-drive' | 'dropbox' | 'icloud'

interface FolderNode {
  name: string
  size: string
  sizeBytes: number
  files: number
  children?: FolderNode[]
}

type WizardStep = 'source' | 'connect' | 'select' | 'importing' | 'complete'

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'connect', label: 'Connect' },
  { key: 'select', label: 'Select' },
  { key: 'importing', label: 'Encrypt + upload' },
  { key: 'complete', label: 'Done' },
]

// ── Mock data ────────────────────────────────────────────────────────────────

const SOURCES: Record<Source, { name: string; gradient: string; letter: string; desc: string; estimate: string }> = {
  'google-drive': {
    name: 'Google Drive',
    gradient: 'linear-gradient(135deg, #4285F4, #34A853)',
    letter: 'G',
    desc: 'Documents, Sheets, Slides, and all stored files. Shared drives included.',
    estimate: '14 min avg for 100 GB',
  },
  dropbox: {
    name: 'Dropbox',
    gradient: 'linear-gradient(135deg, #0061FF, #0041A8)',
    letter: 'D',
    desc: 'Personal files, shared folders, and Paper documents.',
    estimate: '18 min avg for 100 GB',
  },
  icloud: {
    name: 'iCloud Drive',
    gradient: 'linear-gradient(135deg, #52B0FF, #1A73E8)',
    letter: 'i',
    desc: 'iCloud Drive files, desktop & documents sync, and shared folders.',
    estimate: '20 min avg for 100 GB',
  },
}

const MOCK_FOLDERS: FolderNode[] = [
  {
    name: 'Documents',
    size: '8.2 GB',
    sizeBytes: 8_200_000_000,
    files: 184,
    children: [
      { name: 'Contracts', size: '2.1 GB', sizeBytes: 2_100_000_000, files: 34 },
      { name: 'Invoices', size: '1.4 GB', sizeBytes: 1_400_000_000, files: 78 },
      { name: 'Reports', size: '4.7 GB', sizeBytes: 4_700_000_000, files: 72 },
    ],
  },
  {
    name: 'Photos',
    size: '6.1 GB',
    sizeBytes: 6_100_000_000,
    files: 96,
    children: [
      { name: '2024', size: '3.8 GB', sizeBytes: 3_800_000_000, files: 62 },
      { name: '2025', size: '2.3 GB', sizeBytes: 2_300_000_000, files: 34 },
    ],
  },
  {
    name: 'Videos',
    size: '3.2 GB',
    sizeBytes: 3_200_000_000,
    files: 22,
  },
  {
    name: 'Projects',
    size: '0.9 GB',
    sizeBytes: 900_000_000,
    files: 40,
    children: [
      { name: 'Client work', size: '0.5 GB', sizeBytes: 500_000_000, files: 22 },
      { name: 'Internal', size: '0.4 GB', sizeBytes: 400_000_000, files: 18 },
    ],
  },
]

const MOCK_FILE_TYPES = [
  { label: 'Documents', total: 184, color: 'bg-ink' },
  { label: 'Photos', total: 96, color: 'bg-blue-500' },
  { label: 'Videos', total: 22, color: 'bg-purple-500' },
  { label: 'Other', total: 40, color: 'bg-ink-3' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAllPaths(nodes: FolderNode[], prefix = ''): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const p = prefix ? `${prefix}/${n.name}` : n.name
    out.push(p)
    if (n.children) out.push(...getAllPaths(n.children, p))
  }
  return out
}

function computeSelection(folders: FolderNode[], selected: Set<string>, prefix = '') {
  let totalFolders = 0
  let totalFiles = 0
  let totalBytes = 0
  for (const n of folders) {
    const p = prefix ? `${prefix}/${n.name}` : n.name
    if (selected.has(p)) {
      totalFolders++
      totalFiles += n.files
      totalBytes += n.sizeBytes
    }
    if (n.children) {
      const sub = computeSelection(n.children, selected, p)
      totalFolders += sub.totalFolders
      totalFiles += sub.totalFiles
      totalBytes += sub.totalBytes
    }
  }
  return { totalFolders, totalFiles, totalBytes }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

// ── Step rail ────────────────────────────────────────────────────────────────

function StepRail({ current }: { current: WizardStep }) {
  const idx = STEPS.findIndex((s) => s.key === current)
  return (
    <div className="px-xl py-md border-b border-line flex items-center gap-lg bg-paper-2">
      {STEPS.map((s, i) => {
        const done = i < idx
        const live = i === idx
        return (
          <div key={s.key} className="contents">
            <div className="flex items-center gap-sm">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold border ${
                  done
                    ? 'bg-ink border-ink text-paper'
                    : live
                      ? 'bg-amber border-ink text-ink'
                      : 'bg-transparent border-line-2 text-ink'
                }`}
              >
                {done ? (
                  <Icon name="check" size={10} strokeWidth={2.5} />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[11.5px] ${
                  live ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-ink-3'
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px ${done ? 'bg-ink' : 'bg-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Choose source ────────────────────────────────────────────────────

function StepSource({ onSelect }: { onSelect: (s: Source) => void }) {
  return (
    <div className="p-7">
      <h2 className="text-lg font-semibold text-ink mb-1">Where are your files?</h2>
      <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
        Pick the cloud service you want to migrate from. Your files will be re-encrypted on this device before upload.
      </p>

      <div className="grid grid-cols-3 gap-3.5">
        {(Object.entries(SOURCES) as [Source, (typeof SOURCES)[Source]][]).map(
          ([key, src]) => (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className="text-left border border-line rounded-lg p-4 hover:border-line-2 hover:shadow-1 transition-all cursor-pointer group"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-base font-bold mb-3"
                style={{ background: src.gradient }}
              >
                {src.letter}
              </div>
              <div className="text-sm font-semibold text-ink mb-1">{src.name}</div>
              <div className="text-[11.5px] text-ink-3 leading-relaxed mb-2.5">
                {src.desc}
              </div>
              <div className="font-mono text-[11px] text-ink-4">{src.estimate}</div>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// ── Step 2: Connect ──────────────────────────────────────────────────────────

function StepConnect({
  source,
  onConnected,
  onBack,
}: {
  source: Source
  onConnected: () => void
  onBack: () => void
}) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const src = SOURCES[source]

  function handleConnect() {
    setConnecting(true)
    // Mock OAuth
    setTimeout(() => {
      setConnecting(false)
      setConnected(true)
    }, 1500)
  }

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-base font-bold"
          style={{ background: src.gradient }}
        >
          {src.letter}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">Connect to {src.name}</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            We need read-only access to list your files. Nothing is modified.
          </p>
        </div>
      </div>

      {!connected ? (
        <div className="border border-line rounded-lg p-6 text-center">
          <Icon name="cloud" size={28} className="text-ink-3 mx-auto mb-3" />
          <p className="text-sm text-ink-2 mb-4">
            Sign in with your {src.name} account to continue.
          </p>
          <BBButton
            variant="amber"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting...' : `Connect to ${src.name}`}
          </BBButton>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3.5 bg-green/10 border border-green/30 rounded-lg text-sm">
            <Icon name="check" size={14} className="text-green shrink-0" />
            <span className="flex-1">Connected as user@example.com</span>
            <BBChip variant="green">Connected</BBChip>
          </div>

          {/* Mock folder browser */}
          <div className="border border-line rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Browsing {src.name}
            </div>
            {MOCK_FOLDERS.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-b-0"
              >
                <Icon name="folder" size={14} className="text-ink-3 shrink-0" />
                <span className="text-[13px] text-ink flex-1">{f.name}</span>
                <span className="font-mono text-[11px] text-ink-4">
                  {f.files} files
                </span>
                <span className="font-mono text-[11px] text-ink-4">{f.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-2.5">
        <BBButton variant="ghost" onClick={onBack}>
          Back
        </BBButton>
        <span className="ml-auto">
          <BBButton
            variant="amber"
            disabled={!connected}
            onClick={onConnected}
          >
            Choose folders
          </BBButton>
        </span>
      </div>
    </div>
  )
}

// ── Step 3: Select folders ───────────────────────────────────────────────────

function FolderTree({
  nodes,
  selected,
  onToggle,
  prefix = '',
  depth = 0,
}: {
  nodes: FolderNode[]
  selected: Set<string>
  onToggle: (path: string) => void
  prefix?: string
  depth?: number
}) {
  return (
    <>
      {nodes.map((n) => {
        const path = prefix ? `${prefix}/${n.name}` : n.name
        const checked = selected.has(path)
        return (
          <div key={path}>
            <div
              className="flex items-center gap-2.5 py-1.5 hover:bg-paper-2 rounded-md px-2 -mx-2"
              style={{ paddingLeft: depth * 20 + 8 }}
            >
              <BBCheckbox checked={checked} onChange={() => onToggle(path)} />
              <Icon
                name={n.children ? 'folder' : 'file'}
                size={13}
                className="text-ink-3 shrink-0"
              />
              <span className="text-[13px] text-ink flex-1">{n.name}</span>
              <span className="font-mono text-[11px] text-ink-4">
                {n.files} files
              </span>
              <span className="font-mono text-[11px] text-ink-4 w-16 text-right">
                {n.size}
              </span>
            </div>
            {n.children && (
              <FolderTree
                nodes={n.children}
                selected={selected}
                onToggle={onToggle}
                prefix={path}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

function StepSelect({
  source,
  onStart,
  onBack,
}: {
  source: Source
  onStart: (selected: Set<string>) => void
  onBack: () => void
}) {
  const allPaths = getAllPaths(MOCK_FOLDERS)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allPaths))

  function togglePath(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(allPaths))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  const { totalFolders, totalFiles, totalBytes } = computeSelection(
    MOCK_FOLDERS,
    selected,
  )
  const src = SOURCES[source]

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-base font-bold"
          style={{ background: src.gradient }}
        >
          {src.letter}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Select folders to import
          </h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            Uncheck anything you want to leave behind.
          </p>
        </div>
      </div>

      <div className="flex gap-2 mt-4 mb-3">
        <BBButton size="sm" variant="ghost" onClick={selectAll}>
          Select all
        </BBButton>
        <BBButton size="sm" variant="ghost" onClick={deselectAll}>
          Deselect all
        </BBButton>
      </div>

      <div className="border border-line rounded-lg p-3 max-h-72 overflow-auto">
        <FolderTree
          nodes={MOCK_FOLDERS}
          selected={selected}
          onToggle={togglePath}
        />
      </div>

      {/* Summary */}
      <div className="mt-3.5 flex items-center gap-3 px-4 py-2.5 bg-paper-2 border border-line rounded-lg">
        <Icon name="folder" size={13} className="text-ink-3" />
        <span className="text-[12.5px] text-ink-2">
          <strong className="text-ink font-semibold">{totalFolders} folders</strong>,{' '}
          <strong className="text-ink font-semibold">{totalFiles} files</strong>,{' '}
          <strong className="font-mono text-ink font-semibold">
            {formatBytes(totalBytes)}
          </strong>
        </span>
      </div>

      <div className="mt-6 flex gap-2.5">
        <BBButton variant="ghost" onClick={onBack}>
          Back
        </BBButton>
        <span className="ml-auto">
          <BBButton
            variant="amber"
            disabled={selected.size === 0}
            onClick={() => onStart(selected)}
          >
            Start import
          </BBButton>
        </span>
      </div>
    </div>
  )
}

// ── Step 4: Importing ────────────────────────────────────────────────────────

type ImportPhase = 'downloading' | 'encrypting' | 'uploading'

function StepImporting({
  source,
  totalFiles,
  totalBytes,
  onComplete,
  onCancel,
}: {
  source: Source
  totalFiles: number
  totalBytes: number
  onComplete: () => void
  onCancel: () => void
}) {
  const src = SOURCES[source]
  const [filesDone, setFilesDone] = useState(0)
  const [phase, setPhase] = useState<ImportPhase>('downloading')
  const [cancelled, setCancelled] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentFileName = [
    'port-contract-draft-03.pdf',
    'invoice-2025-004.pdf',
    'team-photo-retreat.jpg',
    'q2-financials.xlsx',
    'board-deck-apr.pdf',
    'product-roadmap.md',
    'logo-final-v2.png',
    'onboarding-video.mp4',
  ][filesDone % 8]

  const progress = totalFiles > 0 ? filesDone / totalFiles : 0
  const bytesTransferred = Math.round(totalBytes * progress)
  const remainingMin = Math.max(1, Math.round((1 - progress) * 14))

  // File type breakdown
  const typeBreakdown = MOCK_FILE_TYPES.map((t) => ({
    ...t,
    done: Math.min(t.total, Math.round(t.total * progress * 1.2)),
  }))

  const tick = useCallback(() => {
    setFilesDone((prev) => {
      const next = prev + 1
      // Cycle phases
      if (next % 3 === 0) setPhase('encrypting')
      else if (next % 3 === 1) setPhase('uploading')
      else setPhase('downloading')

      if (next >= totalFiles) {
        return totalFiles
      }
      return next
    })
  }, [totalFiles])

  useEffect(() => {
    if (cancelled) return
    timerRef.current = setInterval(tick, 400)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [tick, cancelled])

  useEffect(() => {
    if (filesDone >= totalFiles && totalFiles > 0) {
      if (timerRef.current) clearInterval(timerRef.current)
      const t = setTimeout(onComplete, 1200)
      return () => clearTimeout(t)
    }
  }, [filesDone, totalFiles, onComplete])

  function handleCancel() {
    setCancelled(true)
    if (timerRef.current) clearInterval(timerRef.current)
    onCancel()
  }

  const phaseLabel: Record<ImportPhase, string> = {
    downloading: `Downloading from ${src.name}`,
    encrypting: 'Encrypting',
    uploading: 'Uploading to vault',
  }

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-base font-bold"
          style={{ background: src.gradient }}
        >
          {src.letter}
        </div>
        <div>
          <div className="text-[17px] font-semibold tracking-tight">
            Moving you in from {src.name}
          </div>
          <div className="font-mono text-[11px] text-ink-3 mt-0.5">
            user@example.com · {totalFiles} files · {formatBytes(totalBytes)}
          </div>
        </div>
        <BBChip variant="green" className="ml-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-green mr-1.5 inline-block" />
          Connected
        </BBChip>
      </div>

      {/* Progress card */}
      <div className="mt-5 p-5 bg-amber-bg border border-amber-deep rounded-xl">
        <div className="flex items-baseline gap-2.5">
          <div className="text-lg font-semibold">Encrypting & uploading</div>
          <span className="font-mono text-xs text-ink-2 ml-auto">
            {filesDone} / {totalFiles} files · {formatBytes(bytesTransferred)} /{' '}
            {formatBytes(totalBytes)}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-paper-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-deep rounded-full transition-all duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="flex gap-5 mt-3.5 items-center">
          <div>
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-3">
              Currently
            </div>
            <div className="font-mono text-[11.5px] text-ink-2 mt-0.5">
              {phaseLabel[phase]} — {currentFileName}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-3">
              Est. remaining
            </div>
            <div className="font-mono text-[11.5px] text-ink-2 mt-0.5">
              ~ {remainingMin} min
            </div>
          </div>
        </div>
      </div>

      {/* File type breakdown */}
      <div className="mt-5">
        <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
          By file type
        </div>
        {typeBreakdown.map((t) => (
          <div
            key={t.label}
            className="grid items-center gap-3.5 mb-2"
            style={{ gridTemplateColumns: '120px 1fr 120px' }}
          >
            <div className="text-xs">{t.label}</div>
            <div className="h-1.5 bg-paper-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${t.color}`}
                style={{
                  width: `${t.total > 0 ? (t.done / t.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="font-mono text-[11px] text-ink-3 text-right">
              {t.done} / {t.total}
            </div>
          </div>
        ))}
      </div>

      {/* Security note */}
      <div className="mt-5 p-3.5 bg-paper-2 border border-line rounded-lg flex gap-3 items-start">
        <Icon
          name="shield"
          size={14}
          className="text-amber-deep shrink-0 mt-0.5"
        />
        <div>
          <div className="text-xs font-semibold">
            Your files never touch our servers unencrypted
          </div>
          <div className="text-[11px] text-ink-3 mt-1 leading-relaxed">
            All files are re-encrypted on your device before upload. Originals
            stay in {src.name} until you say delete.
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2.5">
        <BBButton variant="ghost" onClick={handleCancel}>
          Cancel
        </BBButton>
      </div>
    </div>
  )
}

// ── Step 5: Complete ─────────────────────────────────────────────────────────

function StepComplete({
  totalFiles,
  totalBytes,
}: {
  totalFiles: number
  totalBytes: number
}) {
  const navigate = useNavigate()

  return (
    <div className="p-7 text-center">
      <div className="w-14 h-14 rounded-full bg-green/10 flex items-center justify-center mx-auto mb-4">
        <Icon name="check" size={24} className="text-green" />
      </div>
      <h2 className="text-xl font-semibold text-ink mb-1.5">Import complete</h2>
      <p className="text-sm text-ink-2 mb-1">
        <strong className="font-semibold">{totalFiles} files</strong> imported,{' '}
        <strong className="font-mono font-semibold">
          {formatBytes(totalBytes)}
        </strong>{' '}
        encrypted
      </p>
      <p className="text-[12px] text-ink-3 mb-6">
        Every file was encrypted on this device before it reached our servers.
      </p>

      <BBButton variant="amber" onClick={() => navigate('/')}>
        Go to your vault
      </BBButton>
    </div>
  )
}

// ── Wizard container ─────────────────────────────────────────────────────────

export function Migration() {
  const [step, setStep] = useState<WizardStep>('source')
  const [source, setSource] = useState<Source | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // Compute totals from selection
  const { totalFiles, totalBytes } = computeSelection(
    MOCK_FOLDERS,
    selectedPaths,
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div className="w-full max-w-3xl bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Logo header */}
        <div className="px-xl py-md border-b border-line flex items-center gap-3">
          <BBLogo size={13} />
          <span className="text-xs text-ink-3 ml-auto">Migration wizard</span>
        </div>

        {/* Step rail */}
        <StepRail current={step} />

        {/* Step content */}
        {step === 'source' && (
          <StepSource
            onSelect={(s) => {
              setSource(s)
              setStep('connect')
            }}
          />
        )}

        {step === 'connect' && source && (
          <StepConnect
            source={source}
            onConnected={() => setStep('select')}
            onBack={() => setStep('source')}
          />
        )}

        {step === 'select' && source && (
          <StepSelect
            source={source}
            onStart={(paths) => {
              setSelectedPaths(paths)
              setStep('importing')
            }}
            onBack={() => setStep('connect')}
          />
        )}

        {step === 'importing' && source && (
          <StepImporting
            source={source}
            totalFiles={totalFiles > 0 ? totalFiles : 342}
            totalBytes={totalBytes > 0 ? totalBytes : 18_400_000_000}
            onComplete={() => setStep('complete')}
            onCancel={() => setStep('select')}
          />
        )}

        {step === 'complete' && (
          <StepComplete
            totalFiles={totalFiles > 0 ? totalFiles : 342}
            totalBytes={totalBytes > 0 ? totalBytes : 18_400_000_000}
          />
        )}
      </div>
    </div>
  )
}
