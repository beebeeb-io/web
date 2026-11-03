// Generates, encrypts, uploads, and decrypts file thumbnails.
import { provenanceHeaders } from '@beebeeb/shared'
import { getToken, getApiUrl, uploadThumbnail, uploadThumbnailLarge } from './api'
import { getOfflineCacheScope, isCurrentOfflineCacheScope } from './offline-cache'
import {
  ensureThumbnailWasm,
  fitWithin,
  thumbnailBudgetFor,
  thumbnailFormatFor,
  thumbnailMime,
  thumbnailPolicyFor,
  type ThumbnailVariant,
} from './thumbnail-policy'

// Stored ciphertext carries no format of its own (the encoder lives outside the
// wire), and the browser is always the `web` platform, so decrypted thumbnails
// keep the WebP type the encoder produces here.
const THUMB_FORMAT = 'image/webp'
const CACHE_NAME = 'beebeeb-thumbnails-encrypted-v3'
const LEGACY_CACHE_NAME = 'beebeeb-thumbnails-v2'
let thumbnailEpoch = 0
const MAX_CACHE_ENTRIES = 10000
const MAX_MEMORY_THUMBS = 200

/**
 * Minimal LRU keyed by fileId → object-URL string. Capped at MAX_MEMORY_THUMBS;
 * on eviction the underlying blob's object URL is revoked so it can be garbage
 * collected. The Cache API persistence layer remains the source of truth for
 * re-hydration on the next unlocked session (ciphertext only).
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

  clear(): void {
    for (const url of this.map.values()) {
      try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }
    this.map.clear()
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
const largeThumbnailUrls = new ThumbnailLRU(MAX_MEMORY_THUMBS)

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

async function encodeThumbnailVariant(
  file: File,
  variant: ThumbnailVariant,
): Promise<Blob | null> {
  if (!isImageType(file.type)) return null

  try {
    await ensureThumbnailWasm()
    const policy = thumbnailPolicyFor(variant)
    const mime = thumbnailMime(thumbnailFormatFor(variant, 'web'))

    const bitmap = await createImageBitmap(file)
    try {
      let best: Blob | null = null
      for (const step of policy.steps) {
        const size = fitWithin(bitmap.width, bitmap.height, step.maxDimension)
        if (!size) return null

        const canvas = new OffscreenCanvas(size.width, size.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        ctx.drawImage(bitmap, 0, 0, size.width, size.height)
        const blob = await canvas.convertToBlob({ type: mime, quality: step.quality / 100 })
        best = blob
        const verdict = thumbnailBudgetFor(variant, blob.size)
        if (verdict === 'target') return blob
      }
      return best
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

export async function generateThumbnail(file: File): Promise<Blob | null> {
  return encodeThumbnailVariant(file, 'medium')
}

/**
 * Encrypt already-encoded thumbnail bytes with AES-256-GCM. Wire format:
 * nonce(12) || ciphertext (includes the 16-byte GCM tag) — no AAD, raw
 * 32-byte `fileKey` (no KDF). Exported (K3) so a KAT test can exercise the
 * real production encrypt path directly instead of reimplementing it.
 */
export async function encryptThumbnailBlob(
  thumbnailBlob: Blob,
  fileKey: Uint8Array,
): Promise<Uint8Array> {
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
  return encrypted
}

/**
 * Decrypt a thumbnail blob previously produced by `encryptThumbnailBlob`.
 * `encrypted` is the wire format above: nonce(12) || ciphertext. Extracted
 * (K3) from the near-identical logic that used to be duplicated inline in
 * `fetchAndDecryptThumbnail` and `fetchAndDecryptLargeThumbnail` — both now
 * call this so the two sizes can never drift, and a KAT test can exercise
 * the real production decrypt path directly.
 */
export async function decryptThumbnailBlob(
  encrypted: Uint8Array,
  fileKey: Uint8Array,
): Promise<ArrayBuffer> {
  const nonce = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    fileKey.buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['decrypt'],
  )

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer,
  )
}

export async function encryptAndUploadThumbnail(
  fileId: string,
  thumbnailBlob: Blob,
  fileKey: Uint8Array,
): Promise<void> {
  const encrypted = await encryptThumbnailBlob(thumbnailBlob, fileKey)
  await uploadThumbnail(fileId, new Blob([encrypted.buffer as ArrayBuffer]))
}

export async function generateLargeThumbnail(file: File): Promise<Blob | null> {
  return encodeThumbnailVariant(file, 'large')
}

export async function encryptAndUploadLargeThumbnail(
  fileId: string,
  thumbnailBlob: Blob,
  fileKey: Uint8Array,
): Promise<void> {
  const encrypted = await encryptThumbnailBlob(thumbnailBlob, fileKey)
  await uploadThumbnailLarge(fileId, new Blob([encrypted.buffer as ArrayBuffer]))
}

export async function fetchAndDecryptLargeThumbnail(
  fileId: string,
  fileKey: Uint8Array,
): Promise<string | null> {
  const epoch = thumbnailEpoch
  const scope = getOfflineCacheScope()
  if (!isCurrentOfflineCacheScope(scope)) return null
  try {
    const token = getToken()
    const headers: Record<string, string> = { ...provenanceHeaders() }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/thumbnail/large`, {
      headers,
      credentials: 'include',
    })
    if (!res.ok) return null

    const encrypted = new Uint8Array(await res.arrayBuffer())
    if (encrypted.length < 13) return null

    const plainBytes = await decryptThumbnailBlob(encrypted, fileKey)

    if (epoch !== thumbnailEpoch || !isCurrentOfflineCacheScope(scope)) {
      new Uint8Array(plainBytes).fill(0)
      return null
    }
    const blob = new Blob([plainBytes], { type: THUMB_FORMAT })
    new Uint8Array(plainBytes).fill(0)
    const url = URL.createObjectURL(blob)
    largeThumbnailUrls.set(url, url)
    return url
  } catch {
    return null
  }
}

async function getCachedCiphertext(fileId: string): Promise<Uint8Array | null> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const resp = await cache.match(`/thumb/${fileId}`)
    if (!resp) return null
    return new Uint8Array(await resp.arrayBuffer())
  } catch {
    return null
  }
}

async function putCachedCiphertext(fileId: string, data: Uint8Array): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const keys = await cache.keys()
    if (keys.length >= MAX_CACHE_ENTRIES) {
      const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES + 100)
      await Promise.all(toDelete.map((k) => cache.delete(k)))
    }
    await cache.put(
      `/thumb/${fileId}`,
      new Response(data.buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/octet-stream' } }),
    )
  } catch {
    // Cache write is best-effort
  }
}

export async function fetchAndDecryptThumbnail(
  fileId: string,
  fileKey: Uint8Array,
): Promise<string | null> {
  const epoch = thumbnailEpoch
  const scope = getOfflineCacheScope()
  if (!isCurrentOfflineCacheScope(scope)) return null
  const memoryKey = `${scope.stamp.userId}:${fileId}`
  if (thumbnailCache.has(memoryKey)) return thumbnailCache.get(memoryKey)!

  try {
    // Migration is best-effort, but never READ from the old plaintext cache.
    try { await caches.delete(LEGACY_CACHE_NAME) } catch { /* Storage unavailable. */ }
    let encrypted = await getCachedCiphertext(fileId)
    if (!encrypted) {
      const token = getToken()
      const headers: Record<string, string> = { ...provenanceHeaders() }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/thumbnail`, {
        headers, credentials: 'include',
      })
      if (!res.ok) return null
      encrypted = new Uint8Array(await res.arrayBuffer())
    }
    if (encrypted.length < 13) return null
    const plainBytes = await decryptThumbnailBlob(encrypted, fileKey)
    // Only ciphertext crosses the persistent-storage boundary.
    await putCachedCiphertext(fileId, encrypted)
    if (epoch !== thumbnailEpoch || !isCurrentOfflineCacheScope(scope)) {
      new Uint8Array(plainBytes).fill(0)
      return null
    }
    const blob = new Blob([plainBytes], { type: THUMB_FORMAT })
    new Uint8Array(plainBytes).fill(0)
    const url = URL.createObjectURL(blob)
    thumbnailCache.set(memoryKey, url)
    return url
  } catch {
    return null
  }
}

export async function clearThumbnailCache(): Promise<void> {
  thumbnailEpoch++
  thumbnailCache.clear()
  largeThumbnailUrls.clear()
  try { await caches.delete(LEGACY_CACHE_NAME) } catch { /* Storage unavailable. */ }
}
