/**
 * Dev-only harness for the office loading skeleton (task 1567). Registered
 * behind `import.meta.env.DEV` only (see app.tsx) — Storybook-free, per the
 * brief: a throwaway route to eyeball the "instant first page" states
 * without needing a real encrypted file, a real thumbnail, or a real 257 MB
 * bundle download.
 *
 * Not linked from anywhere in the app chrome. Visit /dev/office-preview
 * directly while running `bun dev`.
 */

import { useEffect, useState } from 'react'
import { OfficeLoadingSkeleton, type OfficeSkeletonStage } from '../components/office/office-loading-skeleton'

// A tiny inline SVG data URL standing in for a real decrypted thumbnail —
// no network fetch, no dependency on a real file/thumbnail existing.
const FAKE_THUMBNAIL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520">
      <rect width="400" height="520" fill="#fdfcfb"/>
      <rect x="32" y="40" width="336" height="24" fill="#e5e1da"/>
      <rect x="32" y="84" width="280" height="14" fill="#e5e1da"/>
      <rect x="32" y="108" width="300" height="14" fill="#e5e1da"/>
      <rect x="32" y="132" width="220" height="14" fill="#e5e1da"/>
    </svg>`,
  )

const TOTAL_BYTES = 257 * 1024 * 1024

export function DevOfficePreview() {
  const [stage, setStage] = useState<OfficeSkeletonStage>('preparing')
  const [loadedBytes, setLoadedBytes] = useState(0)
  const [withThumbnail, setWithThumbnail] = useState(true)

  // Simulates the loader's onProgress callback advancing over ~6 seconds,
  // then flips to 'ready' — enough to eyeball every visual state without
  // waiting for a real 257 MB download.
  useEffect(() => {
    if (stage !== 'preparing') return
    setLoadedBytes(0)
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const next = Math.min(TOTAL_BYTES, (elapsed / 6000) * TOTAL_BYTES)
      setLoadedBytes(next)
      if (next >= TOTAL_BYTES) {
        clearInterval(id)
        setStage('ready')
      }
    }, 100)
    return () => clearInterval(id)
  }, [stage])

  return (
    <div className="flex h-screen w-full flex-col bg-paper">
      <div className="flex items-center gap-3 border-b border-line bg-paper-2 px-4 py-2 text-[12px] font-mono text-ink-3">
        <span>dev/office-preview</span>
        <span className="text-line-2">·</span>
        <button
          className="underline hover:text-ink-2"
          onClick={() => setStage('preparing')}
        >
          replay
        </button>
        <button
          className="underline hover:text-ink-2"
          onClick={() => setStage('error')}
        >
          simulate error
        </button>
        <button
          className="underline hover:text-ink-2"
          onClick={() => setWithThumbnail((v) => !v)}
        >
          {withThumbnail ? 'no thumbnail' : 'with thumbnail'}
        </button>
      </div>
      <div className="relative flex-1">
        <OfficeLoadingSkeleton
          thumbnailUrl={withThumbnail ? FAKE_THUMBNAIL : null}
          filename="Q3 board deck.pptx"
          stage={stage}
          progress={stage === 'preparing' ? { loadedBytes, totalBytes: TOTAL_BYTES } : null}
          onCancel={() => setStage('error')}
          errorMessage="We couldn't prepare the editor on this device."
          onRetry={() => setStage('preparing')}
        >
          {stage === 'ready' && (
            <div className="flex h-full w-full items-center justify-center text-[13px] text-ink-3">
              (live editor canvas would mount here)
            </div>
          )}
        </OfficeLoadingSkeleton>
      </div>
    </div>
  )
}
