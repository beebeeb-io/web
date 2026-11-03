// Loads and decrypts thumbnails for visible file rows.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useKeys } from '../../lib/key-context'
import { fetchAndDecryptThumbnail } from '../../lib/thumbnail'

export interface FileThumbnails {
  thumbnails: Record<string, string>
  /** Ref callback for a row's icon slot; the observer starts loading on view. */
  setThumbRef(fileId: string, el: HTMLElement | null): void
}

/**
 * Lazily decrypts drive thumbnails as their rows scroll into view (moved out of
 * `FileList` by W-P2-4). One IntersectionObserver serves every row.
 */
export function useFileThumbnails(isUnlocked: boolean): FileThumbnails {
  const { getFileKey } = useKeys()
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const loadingThumbs = useRef(new Set<string>())
  const thumbnailsRef = useRef(thumbnails)
  useEffect(() => { thumbnailsRef.current = thumbnails }, [thumbnails])

  const loadThumbnailRef = useRef<((fileId: string) => void) | null>(null)

  const loadThumbnail = useCallback(async (fileId: string) => {
    if (thumbnailsRef.current[fileId] || loadingThumbs.current.has(fileId)) return
    loadingThumbs.current.add(fileId)
    try {
      const fileKey = await getFileKey(fileId)
      const url = await fetchAndDecryptThumbnail(fileId, fileKey)
      if (url) setThumbnails((prev) => ({ ...prev, [fileId]: url }))
    } catch { /* ignore */ }
  }, [getFileKey])

  useEffect(() => {
    loadThumbnailRef.current = loadThumbnail
  }, [loadThumbnail])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const thumbNodeRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!isUnlocked) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const fileId = (entry.target as HTMLElement).dataset.fileId
            if (fileId) loadThumbnailRef.current?.(fileId)
          }
        }
      },
      { threshold: 0.1, rootMargin: '100px' },
    )
    observerRef.current = observer
    for (const el of thumbNodeRefs.current.values()) {
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isUnlocked])

  const setThumbRef = useCallback((fileId: string, el: HTMLElement | null) => {
    if (el) {
      thumbNodeRefs.current.set(fileId, el)
      observerRef.current?.observe(el)
    } else {
      const existing = thumbNodeRefs.current.get(fileId)
      if (existing) observerRef.current?.unobserve(existing)
      thumbNodeRefs.current.delete(fileId)
    }
  }, [])

  return { thumbnails, setThumbRef }
}
