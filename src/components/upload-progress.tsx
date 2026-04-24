import { Icon } from './icons'

export interface UploadItem {
  id: string
  name: string
  size: number
  progress: number
  stage: 'Queued' | 'Encrypting' | 'Uploading' | 'Done' | 'Error'
}

interface UploadProgressProps {
  items: UploadItem[]
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function UploadProgress({ items, onClose }: UploadProgressProps) {
  if (items.length === 0) return null

  const totalBytes = items.reduce((s, i) => s + i.size, 0)
  const uploadedBytes = items.reduce((s, i) => s + i.size * (i.progress / 100), 0)

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[420px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-line flex items-center">
        <span className="text-[13px] font-semibold">
          Uploading {items.length} file{items.length > 1 ? 's' : ''}
        </span>
        <span className="font-mono text-[11px] text-ink-3 ml-auto mr-3">
          {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
        </span>
        <button
          onClick={onClose}
          className="p-0.5 text-ink-3 hover:text-ink transition-colors"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* File list */}
      <div className="px-5 py-3.5 flex flex-col gap-3 max-h-[280px] overflow-y-auto">
        {items.map((item) => (
          <div key={item.id}>
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-[18px] h-[18px] shrink-0 rounded-[5px] border border-line flex items-center justify-center"
                style={{
                  background: item.stage === 'Done' ? 'oklch(0.94 0.06 155)' : 'var(--color-paper-2)',
                }}
              >
                {item.stage === 'Done' ? (
                  <Icon name="check" size={11} style={{ color: 'oklch(0.45 0.12 155)' }} />
                ) : (
                  <Icon name="file" size={10} className="text-ink-3" />
                )}
              </div>
              <span className="text-[12.5px] font-medium truncate">{item.name}</span>
              <span className="font-mono text-[10.5px] text-ink-4 shrink-0">
                {formatBytes(item.size)}
              </span>
              <span
                className="font-mono text-[10.5px] font-medium ml-auto shrink-0"
                style={{
                  color:
                    item.stage === 'Done'
                      ? 'oklch(0.45 0.12 155)'
                      : item.stage === 'Queued'
                        ? 'var(--color-ink-4)'
                        : 'var(--color-amber-deep)',
                }}
              >
                {item.stage} · {item.progress}%
              </span>
            </div>
            <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${item.progress}%`,
                  background: item.stage === 'Done' ? 'oklch(0.45 0.12 155)' : 'var(--color-amber)',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Info banner */}
      <div className="mx-5 mb-4 px-3 py-2.5 bg-amber-bg border border-line rounded-md flex items-center gap-2.5">
        <Icon name="key" size={14} className="text-amber-deep shrink-0" />
        <span className="text-xs" style={{ color: 'oklch(0.35 0.06 72)' }}>
          Keys stay on your device — never on our servers.
        </span>
      </div>
    </div>
  )
}
