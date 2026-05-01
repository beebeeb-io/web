import { useState, useEffect, useRef } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'
import { useToast } from '../../components/toast'
import { getToken, getApiUrl } from '../../lib/api'

interface DpaStatus {
  exists: boolean
  size_bytes?: number
  last_modified?: string
}

export function Compliance() {
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dpaStatus, setDpaStatus] = useState<DpaStatus | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    void checkDpaStatus()
  }, [])

  async function checkDpaStatus() {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/legal/dpa`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      })
      if (res.ok) {
        const sizeHeader = res.headers.get('content-length')
        const modified = res.headers.get('last-modified')
        setDpaStatus({
          exists: true,
          size_bytes: sizeHeader ? parseInt(sizeHeader, 10) : undefined,
          last_modified: modified ?? undefined,
        })
      } else {
        setDpaStatus({ exists: false })
      }
    } catch {
      setDpaStatus({ exists: false })
    }
  }

  async function handleUpload(file: File) {
    if (!file.type.includes('pdf')) {
      showToast({ icon: 'x', title: 'Invalid file', description: 'Only PDF files are accepted', danger: true })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ icon: 'x', title: 'File too large', description: 'Maximum file size is 10 MB', danger: true })
      return
    }
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${getApiUrl()}/api/v1/admin/legal/dpa`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        body,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>
        throw new Error((data.message ?? data.error ?? res.statusText) as string)
      }
      showToast({ icon: 'check', title: 'DPA uploaded', description: 'The new DPA is now live.' })
      await checkDpaStatus()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Could not upload DPA',
        danger: true,
      })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatModified(raw: string): string {
    try {
      return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    } catch {
      return raw
    }
  }

  return (
    <AdminShell activeSection="compliance">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="shield" size={15} />
        <span className="text-sm font-semibold text-ink">Compliance</span>
      </div>

      <div className="px-5 py-6 space-y-6">
        {/* Legal documents section */}
        <div className="border border-line rounded-xl overflow-hidden bg-paper">
          <div className="px-5 py-3.5 border-b border-line bg-paper-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Legal documents
            </div>
          </div>

          {/* DPA row */}
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-amber-bg border border-line flex items-center justify-center shrink-0">
              <Icon name="file-text" size={14} className="text-amber-deep" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink">Data Processing Agreement (DPA)</div>
              <div className="text-[11.5px] text-ink-3 mt-0.5">
                {dpaStatus === null
                  ? 'Checking...'
                  : dpaStatus.exists
                    ? (
                      <span>
                        {dpaStatus.last_modified
                          ? `Updated ${formatModified(dpaStatus.last_modified)}`
                          : 'Available'}
                        {dpaStatus.size_bytes !== undefined && (
                          <span className="font-mono ml-2 text-ink-4">
                            {formatBytes(dpaStatus.size_bytes)}
                          </span>
                        )}
                      </span>
                    )
                    : 'Not yet uploaded'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {dpaStatus?.exists && (
                <>
                  <BBChip variant="green">Live</BBChip>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(`${getApiUrl()}/api/v1/legal/dpa`, '_blank')}
                  >
                    <Icon name="eye" size={11} className="mr-1" />
                    Preview
                  </BBButton>
                </>
              )}
              <BBButton
                size="sm"
                variant={dpaStatus?.exists ? 'ghost' : 'amber'}
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="arrow-up" size={11} className="mr-1" />
                {uploading ? 'Uploading...' : dpaStatus?.exists ? 'Replace' : 'Upload'}
              </BBButton>
            </div>
          </div>

          {!dpaStatus?.exists && (
            <div className="px-5 pb-4">
              <div className="text-[11.5px] text-ink-4 bg-paper-2 border border-line rounded-lg px-3.5 py-2.5">
                Upload a signed DPA PDF (max 10 MB). Once uploaded, users can download it from the billing page.
              </div>
            </div>
          )}
        </div>

        {/* Placeholder for future compliance features */}
        <div className="border border-line-2 border-dashed rounded-xl px-5 py-8 text-center">
          <div className="text-[13px] text-ink-3 mb-1">GDPR readiness checklist and audit documentation</div>
          <div className="text-[11px] text-ink-4">Coming in the Business plan launch.</div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleUpload(file)
        }}
      />
    </AdminShell>
  )
}
