import { useState, useEffect, useCallback } from 'react'
import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { getShare, downloadBundleItem, ApiError, type ShareView as ShareViewData, type ShareItem } from '../../lib/api'
import { unwrapBundleItemKey, initCrypto, readFileMetadata, ContentPin } from '../../lib/crypto'
import { decryptEncryptedBytes, inferChunkCountFromEncryptedSize, UNVERIFIED_FILE_COPY } from '../../lib/encrypted-download'
import { withNetworkRetry } from '../../lib/net-retry'
import { formatBytes } from '../../lib/format'

import { formatExpiry } from './share-meta'
import { KEY_BYTES } from './share-key-outcome'
import { UrlAnnotation, ZeroBanner } from './glassbox'
// ─── Bundle share recipient view (task 0417) ────────────────────────────────────

/** Share types this client release knows how to render. Anything else → the
 *  forward-compat "update Beebeeb" card. */
export const KNOWN_SHARE_TYPES = new Set(['file', 'bundle'])

/** One decrypted bundle item, ready to render + download. */
interface BundleRow {
  file_id: string
  position: number
  /** Decrypted display name, or null while decrypting / on failure. */
  name: string | null
  size: number
  chunk_count: number
  /** The item's FileKey (unwrapped from K_c), or null if K_c was wrong. */
  fileKey: Uint8Array | null
  /**
   * The item's content pin from its authenticated metadata (core's FILE
   * reader, task 1943), or null when that cannot be read (a legacy plaintext
   * name): the name still shows, but the content is not opened.
   */
  pin: ContentPin | null
}

/**
 * Decrypt one manifest item: unwrap its FileKey from K_c, then read its
 * metadata with core's FILE reader (name + content pin; names sealed under the
 * name subkey open too). A wrong K_c (AES-GCM auth failure) or a name that does
 * not open yields `{ fileKey: null, name: null }`: the row renders as an
 * undecryptable placeholder rather than crashing the list.
 */
async function decryptBundleItem(clientKey: Uint8Array, item: ShareItem): Promise<BundleRow> {
  let fileKey: Uint8Array | null = null
  let name: string | null = null
  let pin: ContentPin | null = null
  try {
    fileKey = await unwrapBundleItemKey(clientKey, item.wrapped_file_key)
    if (fileKey.length !== KEY_BYTES) {
      fileKey = null
    } else if (item.name_encrypted.startsWith('{')) {
      const meta = await readFileMetadata(fileKey, item.name_encrypted)
      name = meta.name
      pin = meta.pin
    } else {
      name = item.name_encrypted // legacy plaintext name: shown, but carries no pin
    }
  } catch {
    fileKey = null
    name = null
    pin = null
  }
  return {
    file_id: item.file_id,
    position: item.position,
    name,
    size: item.size,
    chunk_count: item.chunk_count,
    fileKey,
    pin,
  }
}

export function BundleShareView({
  token,
  data,
  clientKey,
}: {
  token: string
  data: ShareViewData
  clientKey: Uint8Array | null
}) {
  const [rows, setRows] = useState<BundleRow[]>([])
  const [decrypting, setDecrypting] = useState(true)
  const [nextCursor, setNextCursor] = useState<number | null>(data.next_cursor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  // file_id currently downloading, or '__all__' for the Download-all action.
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const itemCount = data.item_count ?? data.items?.length ?? 0

  // Decrypt the first page on mount (and whenever the key/items change).
  useEffect(() => {
    let cancelled = false
    async function run() {
      setDecrypting(true)
      if (!clientKey || !data.items) {
        if (!cancelled) { setRows([]); setDecrypting(false) }
        return
      }
      await initCrypto()
      const decoded = await Promise.all(data.items.map((it) => decryptBundleItem(clientKey, it)))
      if (!cancelled) {
        setRows(decoded.sort((a, b) => a.position - b.position))
        setNextCursor(data.next_cursor ?? null)
        setDecrypting(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [clientKey, data.items, data.next_cursor])

  // Fetch + decrypt the next manifest page (keyset pagination by position).
  const loadMore = useCallback(async () => {
    if (nextCursor == null || !clientKey || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getShare(token, { cursor: nextCursor })
      await initCrypto()
      const more = await Promise.all((page.items ?? []).map((it) => decryptBundleItem(clientKey, it)))
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.file_id))
        const merged = [...prev, ...more.filter((r) => !seen.has(r.file_id))]
        return merged.sort((a, b) => a.position - b.position)
      })
      setNextCursor(page.next_cursor ?? null)
    } catch {
      /* leave the list as-is; the user can retry */
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, clientKey, loadingMore, token])

  /** Decrypt one bundle item's content and trigger a browser download. */
  const downloadRow = useCallback(async (row: BundleRow): Promise<boolean> => {
    if (!row.fileKey) {
      setDownloadError(`Couldn’t open “${row.name ?? 'this file'}” — the key in the link doesn’t match it.`)
      return false
    }
    if (row.pin === null) {
      setDownloadError(UNVERIFIED_FILE_COPY)
      return false
    }
    try {
      await initCrypto()
      const { blob, chunkCount: hdrCount, chunkSize: hdrSize, originalSize: hdrOriginal } =
        await withNetworkRetry(() => downloadBundleItem(token, row.file_id))
      const encrypted = new Uint8Array(await blob.arrayBuffer())
      const originalSize = hdrOriginal ?? row.size
      const chunkCount = hdrCount
        ?? row.chunk_count
        ?? inferChunkCountFromEncryptedSize(encrypted.length, originalSize)
      const plaintext = await decryptEncryptedBytes(
        row.fileKey, { fileId: row.file_id, pin: row.pin }, encrypted, chunkCount, originalSize, hdrSize ?? undefined,
      )
      const url = URL.createObjectURL(new Blob([plaintext as BlobPart]))
      const a = document.createElement('a')
      a.href = url
      a.download = row.name ?? 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (err) {
      if (import.meta.env.DEV) console.error('[share-view] bundle item download failed:', err)
      setDownloadError(err instanceof ApiError && err.message
        ? err.message
        : `Couldn’t download “${row.name ?? 'this file'}”. Try again.`)
      return false
    }
  }, [token])

  const handleDownloadOne = useCallback(async (row: BundleRow) => {
    setDownloadError(null)
    setDownloadingId(row.file_id)
    try { await downloadRow(row) } finally { setDownloadingId(null) }
  }, [downloadRow])

  const handleDownloadAll = useCallback(async () => {
    setDownloadError(null)
    setDownloadingId('__all__')
    try {
      // Make sure every page is loaded first, then download each decryptable
      // item sequentially (browsers throttle parallel programmatic downloads).
      while (nextCursor != null) {
        // eslint-disable-next-line no-await-in-loop
        await loadMore()
      }
      for (const row of rows) {
        if (!row.fileKey) continue
        // eslint-disable-next-line no-await-in-loop
        await downloadRow(row)
      }
    } finally {
      setDownloadingId(null)
    }
  }, [rows, nextCursor, loadMore, downloadRow])

  const anyDownloading = downloadingId !== null
  const downloadableCount = rows.filter((r) => r.fileKey).length

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden py-8">
      <div className="relative w-full max-w-[30rem] mx-4">
        <div className="text-center mb-4">
          <BBLogo size={16} />
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber/30 bg-amber-bg text-[11.5px] font-medium text-amber-deep">
            <Icon name="lock" size={11} className="shrink-0" />
            Beebeeb — End-to-end encrypted
          </div>
        </div>

        {clientKey && <ZeroBanner />}

        <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
            <Icon name="share" size={14} className="text-ink" />
            <span className="text-sm font-semibold">Shared files</span>
            <BBChip variant="amber">
              <span className="flex items-center gap-1 text-[9.5px]">
                <Icon name="lock" size={9} /> E2EE
              </span>
            </BBChip>
            <span className="ml-auto font-mono text-[11.5px] text-ink-3">
              {itemCount} {itemCount === 1 ? 'file' : 'files'}
            </span>
          </div>

          <div className="p-6">
            {/* Expiry */}
            {data.expires_at !== undefined && (
              <div className="flex items-center text-[12px] gap-3 mb-4">
                <span className="text-ink-3 w-[80px] shrink-0">Expires</span>
                <span className="text-ink-2">{formatExpiry(data.expires_at)}</span>
              </div>
            )}

            {/* No usable key → prompt (the manifest still lists item count). */}
            {!clientKey && (
              <div className="border border-line-2 rounded-lg bg-paper-2 p-4 mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name="lock" size={14} className="text-amber-deep" />
                  <span className="text-sm font-medium text-ink">These files are encrypted</span>
                </div>
                <p className="text-xs text-ink-3">
                  The decryption key is missing from this link. Re-copy the whole link — everything including the part after <span className="font-mono text-[11px] text-amber-deep">#key=</span>.
                </p>
              </div>
            )}

            {/* Item list */}
            {clientKey && (
              <div className="flex flex-col gap-2 mb-4">
                {decrypting && rows.length === 0 ? (
                  <div className="flex items-center gap-2 text-[12px] text-ink-3 py-4 justify-center">
                    <svg className="animate-spin h-4 w-4 text-amber" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Decrypting file list…
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-[12px] text-ink-3 py-4 text-center">
                    This share has no available files. They may have been moved or deleted.
                  </p>
                ) : (
                  rows.map((row) => {
                    const undecryptable = !row.fileKey
                    const isThis = downloadingId === row.file_id
                    return (
                      <div
                        key={row.file_id}
                        className="flex items-center gap-3 border border-line rounded-lg bg-paper-2 px-3 py-2.5"
                      >
                        <div className={`w-8 h-9 border rounded flex items-center justify-center shrink-0 ${
                          undecryptable ? 'bg-amber-bg border-amber-deep/30' : 'bg-paper border-line'
                        }`}>
                          <Icon name={undecryptable ? 'lock' : 'file'} size={14} className={undecryptable ? 'text-amber-deep' : 'text-ink-3'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-ink truncate">
                            {row.name ?? (undecryptable ? 'Encrypted file' : 'Decrypting…')}
                          </div>
                          <div className="font-mono text-[11px] text-ink-3">{formatBytes(row.size)}</div>
                        </div>
                        <BBButton
                          size="sm"
                          variant="amber"
                          className="shrink-0 gap-1"
                          disabled={undecryptable || anyDownloading}
                          onClick={() => handleDownloadOne(row)}
                        >
                          <Icon name={isThis ? 'lock' : 'download'} size={12} />
                          {isThis ? 'Downloading…' : 'Download'}
                        </BBButton>
                      </div>
                    )
                  })
                )}

                {/* Load-more for paginated bundles */}
                {nextCursor != null && (
                  <BBButton
                    size="sm"
                    className="self-center mt-1 gap-1"
                    disabled={loadingMore || anyDownloading}
                    onClick={loadMore}
                  >
                    {loadingMore ? 'Loading…' : 'Show more files'}
                  </BBButton>
                )}
              </div>
            )}

            {/* Download all */}
            {clientKey && downloadableCount > 1 && (
              <BBButton
                variant="amber"
                size="lg"
                className="w-full justify-center gap-2"
                disabled={anyDownloading}
                onClick={handleDownloadAll}
              >
                <Icon name="download" size={14} />
                {downloadingId === '__all__' ? 'Downloading all…' : `Download all (${downloadableCount})`}
              </BBButton>
            )}

            {downloadError && (
              <div className="mt-3 px-3 py-2 bg-red/10 border border-red/30 rounded-md text-xs text-red text-center">
                {downloadError}
              </div>
            )}

            {clientKey && <UrlAnnotation />}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-paper-2 border-t border-line">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Icon name="shield" size={11} className="text-amber-deep" />
              End-to-end encrypted with Beebeeb
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
