/**
 * Error panel — sidebar component showing failed files with retry button.
 * Populated from getLifecycleRunFiles filtered to status='failed'.
 */

import { useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { formatBytes } from '../../../lib/format'
import { retryFile, type RunFileEntry } from '../../../lib/api'

interface ErrorPanelProps {
  poolId: string
  runId: string
  files: RunFileEntry[]
  onRetried: () => void
}

export function ErrorPanel({ poolId, runId, files, onRetried }: ErrorPanelProps) {
  const failedFiles = files.filter((f) => f.status === 'failed')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleRetry(fileId: string) {
    setRetrying(fileId)
    setErrors((e) => { const n = { ...e }; delete n[fileId]; return n })
    try {
      await retryFile(poolId, runId, fileId)
      onRetried()
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [fileId]: err instanceof Error ? err.message : 'Retry failed',
      }))
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="rounded-lg border border-line bg-paper overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <span className="text-[12px] font-semibold text-ink flex-1">Failed files</span>
        <span
          className="font-mono text-[10px]"
          style={{ color: failedFiles.length > 0 ? 'var(--color-red)' : 'var(--color-ink-4)' }}
        >
          {failedFiles.length}
        </span>
      </div>

      {failedFiles.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-[11px] text-ink-4">No failed files.</p>
        </div>
      ) : (
        <div className="divide-y divide-line max-h-[360px] overflow-y-auto">
          {failedFiles.map((f) => (
            <div key={f.file_id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-mono text-[10px] text-ink-3 truncate flex-1 min-w-0">
                  {f.file_id.slice(0, 12)}…
                </span>
                <span className="font-mono text-[10px] text-ink-4 shrink-0">
                  {formatBytes(f.size_bytes)}
                </span>
              </div>
              {f.error && (
                <p className="text-[10px] text-red mb-1.5 leading-relaxed">{f.error}</p>
              )}
              {errors[f.file_id] && (
                <p className="text-[10px] text-red mb-1.5">{errors[f.file_id]}</p>
              )}
              <BBButton
                size="sm"
                variant="ghost"
                disabled={retrying === f.file_id}
                onClick={() => handleRetry(f.file_id)}
              >
                {retrying === f.file_id ? (
                  <><span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />Retrying…</>
                ) : 'Retry'}
              </BBButton>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
