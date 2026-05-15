import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/format'

export interface StorageBreakdownProps {
  usageBytes: number
  quotaBytes: number
  planName: string
  /**
   * Optional: DriveFile-style objects for breakdown by file type.
   * Uses is_media (server flag), mime_type, and decryptedNames (if provided)
   * to categorize files. ZK uploads have null mime_type — is_media and
   * extension-based fallback ensure correct categorization.
   */
  files?: Array<{ id?: string; size_bytes: number; mime_type: string | null; is_folder: boolean; is_media?: boolean }>
  /** Map of file ID to decrypted filename. When provided, the component uses
   *  the file extension for finer-grained categorization (Images vs Videos vs
   *  Documents). Without this, files with null mime_type and is_media=true are
   *  categorized as "Images" (the common case). */
  decryptedNames?: Record<string, string>
  showUpgrade?: boolean
  onUpgrade?: () => void
}


type CategoryKey = 'Images' | 'Videos' | 'Documents' | 'Other'

// Extension sets for categorization when mime_type is null (ZK uploads)
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'bmp', 'tiff', 'tif', 'avif', 'svg', 'ico',
])
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v',
])
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'txt', 'rtf', 'csv', 'md',
])

/** Categorize a single file using mime_type, is_media flag, and optional
 *  decrypted filename. Falls back through each signal in priority order. */
function categorizeFile(
  mime: string | null,
  isMedia: boolean | undefined,
  decryptedName: string | undefined,
): CategoryKey {
  // 1. If we have a decrypted filename, use the extension for precise categorization
  if (decryptedName) {
    const ext = decryptedName.split('.').pop()?.toLowerCase() ?? ''
    if (IMAGE_EXTENSIONS.has(ext)) return 'Images'
    if (VIDEO_EXTENSIONS.has(ext)) return 'Videos'
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'Documents'
  }

  // 2. If mime_type is available (legacy uploads), use it
  if (mime) {
    if (mime.startsWith('image/')) return 'Images'
    if (mime.startsWith('video/')) return 'Videos'
    if (
      mime.startsWith('text/') ||
      mime === 'application/pdf' ||
      mime.includes('word') ||
      mime.includes('excel') ||
      mime.includes('spreadsheet') ||
      mime.includes('presentation') ||
      mime.includes('powerpoint') ||
      mime.includes('opendocument')
    ) return 'Documents'
    return 'Other'
  }

  // 3. ZK uploads with no decrypted name — use is_media flag for a basic split.
  //    Most media files are images, so default media to "Images".
  if (isMedia) return 'Images'

  return 'Other'
}

function categorizeDriveFiles(
  files: Array<{ id?: string; size_bytes: number; mime_type: string | null; is_folder: boolean; is_media?: boolean }>,
  decryptedNames?: Record<string, string>,
): Record<CategoryKey, number> {
  const totals: Record<CategoryKey, number> = { Images: 0, Videos: 0, Documents: 0, Other: 0 }

  for (const f of files) {
    if (f.is_folder) continue
    const name = f.id ? decryptedNames?.[f.id] : undefined
    const category = categorizeFile(f.mime_type, f.is_media, name)
    totals[category] += f.size_bytes
  }
  return totals
}

// Category bar colors using design-system Tailwind classes
// (rendered as inline className strings — Tailwind must see these statically)
const CATEGORY_CONFIG: Record<CategoryKey, { label: string; barClass: string; dotClass: string }> = {
  Images:    { label: 'Images',    barClass: 'bg-amber',    dotClass: 'bg-amber' },
  Videos:    { label: 'Videos',    barClass: 'bg-ink-2',    dotClass: 'bg-ink-2' },
  Documents: { label: 'Documents', barClass: 'bg-green',    dotClass: 'bg-green' },
  Other:     { label: 'Other',     barClass: 'bg-ink-3',    dotClass: 'bg-ink-3' },
}

const CATEGORY_ORDER: CategoryKey[] = ['Images', 'Videos', 'Documents', 'Other']

export function StorageBreakdown({
  usageBytes,
  quotaBytes,
  planName,
  files,
  decryptedNames,
  showUpgrade = false,
  onUpgrade,
}: StorageBreakdownProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80)
    return () => clearTimeout(t)
  }, [])

  if (quotaBytes <= 0) return null

  const pct = Math.min(100, (usageBytes / quotaBytes) * 100)
  const isHigh = pct > 90
  const barColor = isHigh ? 'var(--color-red)' : 'var(--color-amber)'
  const availableBytes = Math.max(0, quotaBytes - usageBytes)

  // Build breakdown rows only when files are available and there is actual usage
  const breakdown = files ? categorizeDriveFiles(files, decryptedNames) : null
  const breakdownEntries = breakdown
    ? CATEGORY_ORDER.filter((key) => breakdown[key] > 0).map((key) => ({
        key,
        bytes: breakdown[key],
        pct: quotaBytes > 0 ? (breakdown[key] / quotaBytes) * 100 : 0,
        ...CATEGORY_CONFIG[key],
      }))
    : []

  return (
    <div className="w-full space-y-4">
      {/* Overall progress bar */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold text-ink">
            {formatBytes(usageBytes)} of {formatBytes(quotaBytes)} used
          </span>
          <span className="text-[11px] font-mono text-ink-4 capitalize">{planName}</span>
        </div>
        <div className="relative h-2.5 w-full rounded-full bg-paper-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: mounted ? `${pct}%` : '0%', background: barColor }}
          />
        </div>
      </div>

      {/* File-type breakdown */}
      {breakdownEntries.length > 0 && (
        <div className="space-y-2.5">
          {breakdownEntries.map(({ key, bytes, pct: rowPct, label, barClass, dotClass }) => (
            <div key={key} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 w-24 shrink-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                <span className="text-[12.5px] text-ink-2">{label}</span>
              </div>
              <div className="flex-1 h-1.5 rounded-full bg-paper-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${barClass}`}
                  style={{ width: mounted ? `${rowPct}%` : '0%' }}
                />
              </div>
              <span className="text-[12px] font-mono text-ink-3 w-16 text-right shrink-0">
                {formatBytes(bytes)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Available space */}
      <div className="text-[13px] text-ink-2">
        <span className="font-mono font-semibold text-ink">{formatBytes(availableBytes)}</span>
        {' '}available
      </div>

      {/* Plan badge + upgrade CTA */}
      {showUpgrade && (
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-paper-2 border border-line">
            <span className="w-2 h-2 rounded-full bg-amber-deep shrink-0" />
            <span className="text-[12.5px] font-medium text-ink capitalize">{planName}</span>
          </div>
          {onUpgrade ? (
            <button
              onClick={onUpgrade}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all"
            >
              Upgrade
            </button>
          ) : (
            <a
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all no-underline"
            >
              Upgrade
            </a>
          )}
        </div>
      )}
    </div>
  )
}
