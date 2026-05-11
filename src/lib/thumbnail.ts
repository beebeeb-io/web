import { getToken, getApiUrl, uploadThumbnail } from './api'

const THUMB_SIZE = 256

// ─── Module-level thumbnail cache ───────────────────
// Shared across all components (Photos page, file-list, etc.) so a thumbnail
// fetched in one view is not re-fetched when the same file appears in another.
// Values are object URLs created via URL.createObjectURL — they stay valid for
// the lifetime of the document and are never revoked (thumbnails are small JPEG
// blobs; the total memory footprint is bounded by the number of distinct files).
const thumbnailCache = new Map<string, string>() // fileId → object URL
const THUMB_QUALITY = 0.7

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

    return await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY })
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

export async function fetchAndDecryptThumbnail(
  fileId: string,
  fileKey: Uint8Array,
): Promise<string | null> {
  if (thumbnailCache.has(fileId)) return thumbnailCache.get(fileId)!
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

    const blob = new Blob([plainBytes], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    thumbnailCache.set(fileId, url)
    return url
  } catch {
    return null
  }
}
