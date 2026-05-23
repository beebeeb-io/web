import { getToken, getApiUrl, uploadThumbnail } from './api'

const THUMB_SIZE = 768
const MAX_THUMB_BYTES = 50 * 1024
const THUMB_VARIANTS = [
  { size: THUMB_SIZE, quality: 0.82 },
  { size: THUMB_SIZE, quality: 0.74 },
  { size: THUMB_SIZE, quality: 0.66 },
  { size: THUMB_SIZE, quality: 0.58 },
  { size: THUMB_SIZE, quality: 0.5 },
] as const
const THUMB_FORMAT = 'image/webp'
const CACHE_NAME = 'beebeeb-thumbnails-v2'
const MAX_CACHE_ENTRIES = 10000
const MAX_MEMORY_THUMBS = 200

/**
 * Minimal LRU keyed by fileId → object-URL string. Capped at MAX_MEMORY_THUMBS;
 * on eviction the underlying blob's object URL is revoked so it can be garbage
 * collected. The Cache API persistence layer remains the source of truth for
 * re-hydration on the next session.
 *
 * Implementation: Map preserves insertion order, so we re-insert on read to
 * move the entry to "most recently used", and pop the oldest key when over cap.
 */
class ThumbnailLRU {
  private readonly map = new Map<string, string>()
  constructor(private readonly limit: number) {}

  get(key: string): string | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    // Refresh recency: delete + re-insert moves to tail.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, value: string): void {
    // If the key already has a different URL, revoke the old one before overwriting.
    const prev = this.map.get(key)
    if (prev !== undefined && prev !== value) {
      this.map.delete(key)
      try { URL.revokeObjectURL(prev) } catch { /* noop */ }
    }
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey === undefined) break
      const oldestValue = this.map.get(oldestKey)
      this.map.delete(oldestKey)
      if (oldestValue !== undefined) {
        try { URL.revokeObjectURL(oldestValue) } catch { /* noop */ }
      }
    }
  }
}

const thumbnailCache = new ThumbnailLRU(MAX_MEMORY_THUMBS)

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

export function isImageType(mimeType: string | null | undefined): boolean {
  return !!mimeType && IMAGE_TYPES.has(mimeType)
}

export async function generateThumbnail(file: File): Promise<Blob | null> {
  if (!isImageType(file.type)) return null

  try {
    const bitmap = await createImageBitmap(file)
    try {
      let fallback: Blob | null = null
      for (const variant of THUMB_VARIANTS) {
        const scale = Math.min(variant.size / bitmap.width, variant.size / bitmap.height, 1)
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))

        const canvas = new OffscreenCanvas(w, h)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        ctx.drawImage(bitmap, 0, 0, w, h)
        const blob = await canvas.convertToBlob({ type: THUMB_FORMAT, quality: variant.quality })
        fallback = blob
        if (blob.size <= MAX_THUMB_BYTES) return blob
      }
      return fallback
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

export async function encryptAndUploadThumbnail(
  fileId: string,
  thumbnailBlob: Blob,
  fileKey: Uint8Array,
): Promise<void> {
  const plainBytes = new Uint8Array(await thumbnailBlob.arrayBuffer())

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    fileKey.buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    plainBytes.buffer as ArrayBuffer,
  )

  const encrypted = new Uint8Array(12 + ciphertext.byteLength)
  encrypted.set(nonce, 0)
  encrypted.set(new Uint8Array(ciphertext), 12)

  await uploadThumbnail(fileId, new Blob([encrypted]))
}

async function getCachedBlob(fileId: string): Promise<string | null> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const resp = await cache.match(`/thumb/${fileId}`)
    if (!resp) return null
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    thumbnailCache.set(fileId, url)
    return url
  } catch {
    return null
  }
}

async function putCachedBlob(fileId: string, data: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const keys = await cache.keys()
    if (keys.length >= MAX_CACHE_ENTRIES) {
      const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES + 100)
      await Promise.all(toDelete.map((k) => cache.delete(k)))
    }
    await cache.put(
      `/thumb/${fileId}`,
      new Response(data, { headers: { 'Content-Type': THUMB_FORMAT } }),
    )
  } catch {
    // Cache write is best-effort
  }
}

export async function fetchAndDecryptThumbnail(
  fileId: string,
  fileKey: Uint8Array,
): Promise<string | null> {
  if (thumbnailCache.has(fileId)) return thumbnailCache.get(fileId)!

  const cached = await getCachedBlob(fileId)
  if (cached) return cached

  try {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/thumbnail`, {
      headers,
    })
    if (!res.ok) return null

    const encrypted = new Uint8Array(await res.arrayBuffer())
    if (encrypted.length < 13) return null

    const nonce = encrypted.slice(0, 12)
    const ciphertext = encrypted.slice(12)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      fileKey.buffer as ArrayBuffer,
      'AES-GCM',
      false,
      ['decrypt'],
    )

    const plainBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
      cryptoKey,
      ciphertext.buffer as ArrayBuffer,
    )

    await putCachedBlob(fileId, plainBytes)

    const blob = new Blob([plainBytes], { type: THUMB_FORMAT })
    const url = URL.createObjectURL(blob)
    thumbnailCache.set(fileId, url)
    return url
  } catch {
    return null
  }
}
