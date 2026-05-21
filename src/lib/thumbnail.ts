import { getToken, getApiUrl, uploadThumbnail } from './api'

const THUMB_SIZE = 200
const THUMB_QUALITY = 0.5
const THUMB_FORMAT = 'image/webp'
const CACHE_NAME = 'beebeeb-thumbnails'
const MAX_CACHE_ENTRIES = 10000

const thumbnailCache = new Map<string, string>()

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
    const scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height, 1)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)

    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    return await canvas.convertToBlob({ type: THUMB_FORMAT, quality: THUMB_QUALITY })
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
