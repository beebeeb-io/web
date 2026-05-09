// ─── Encrypted download ────────────────────────────
// Downloads encrypted file data, decrypts chunks + filename, triggers browser download.

import {
  CHUNK_SIZE,
  decryptChunk,
  decryptFileMetadata,
} from './crypto'
import { getToken, getApiUrl, ApiError } from './api'
import { dispatchDecrypted } from './decrypt-events'

// AES-256-GCM: 12-byte nonce, 16-byte auth tag
const NONCE_LENGTH = 12
const GCM_TAG_LENGTH = 16
const CHUNK_OVERHEAD = NONCE_LENGTH + GCM_TAG_LENGTH

function parseHeaderInt(value: string | null): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function inferChunkCountFromEncryptedSize(
  encryptedSize: number,
  plaintextSize: number,
): number {
  const overheadSize = encryptedSize - plaintextSize
  if (overheadSize <= 0 || overheadSize % CHUNK_OVERHEAD !== 0) {
    throw new Error('Encrypted file size does not match chunk metadata')
  }
  return overheadSize / CHUNK_OVERHEAD
}

export async function decryptEncryptedBytes(
  fileKey: Uint8Array,
  encryptedBytes: Uint8Array,
  chunkCount: number,
  sizeBytes: number,
  chunkSize = CHUNK_SIZE,
): Promise<Uint8Array> {
  // Detect whether sizeBytes is the plaintext size (legacy/correct) or the
  // encrypted total size (an older server bug stored encrypted blob bytes
  // in files.size_bytes). If encryptedBytes.length === sizeBytes, then
  // sizeBytes IS the encrypted total — subtract chunk overhead to recover
  // the plaintext size. Otherwise, treat sizeBytes as the plaintext size.
  const encryptedTotal = encryptedBytes.length
  const isEncryptedSizeStored = encryptedTotal === sizeBytes
  const effectivePlaintextSize = isEncryptedSizeStored
    ? sizeBytes - chunkCount * CHUNK_OVERHEAD
    : sizeBytes

  const decryptedParts: Uint8Array[] = []
  let offset = 0

  for (let i = 0; i < chunkCount; i++) {
    // Calculate the plaintext size for this chunk
    const isLastChunk = i === chunkCount - 1
    let plaintextSize: number
    if (chunkCount === 1) {
      plaintextSize = effectivePlaintextSize
    } else if (isLastChunk) {
      plaintextSize = effectivePlaintextSize - i * chunkSize
    } else {
      plaintextSize = chunkSize
    }

    // The encrypted chunk size: nonce + plaintext + GCM tag
    const encryptedChunkSize = NONCE_LENGTH + plaintextSize + GCM_TAG_LENGTH

    // Guard: make sure we have enough bytes
    if (offset + encryptedChunkSize > encryptedBytes.length) {
      throw new Error(
        `Chunk ${i}: expected ${encryptedChunkSize} bytes at offset ${offset}, ` +
        `but only ${encryptedBytes.length - offset} remain`,
      )
    }

    // Extract nonce and ciphertext
    const nonce = encryptedBytes.slice(offset, offset + NONCE_LENGTH)
    const ciphertext = encryptedBytes.slice(
      offset + NONCE_LENGTH,
      offset + encryptedChunkSize,
    )

    const plaintext = await decryptChunk(fileKey, nonce, ciphertext)
    decryptedParts.push(plaintext)

    offset += encryptedChunkSize
  }

  const totalSize = decryptedParts.reduce((sum, p) => sum + p.length, 0)
  const decrypted = new Uint8Array(totalSize)
  let writeOffset = 0
  for (const part of decryptedParts) {
    decrypted.set(part, writeOffset)
    writeOffset += part.length
  }

  return decrypted
}

/**
 * Download and decrypt a file, then trigger a browser save dialog.
 *
 * @param fileId              The file's UUID
 * @param fileKey             Per-file encryption key (32 bytes)
 * @param nameEncryptedJson   The encrypted filename JSON ({nonce, ciphertext} base64)
 * @param mimeType            Original MIME type for the download
 * @param chunkCount          Number of encrypted chunks stored on the server
 * @param sizeBytes           Original plaintext file size in bytes
 */
export async function encryptedDownload(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
): Promise<void> {
  // 1. Decrypt the filename (and MIME type if available in encrypted metadata)
  let filename = 'download'
  let inferredMime: string | null = null
  try {
    const meta = await decryptFileMetadata(fileKey, nameEncryptedJson)
    filename = meta.name
    inferredMime = meta.mimeType
  } catch {
    filename = `file-${fileId}`
  }
  // Prefer explicit mimeType arg (legacy files) over encrypted metadata
  const effectiveMime = mimeType || inferredMime || 'application/octet-stream'

  // 2. Download the encrypted blob from the API
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/download`, {
    headers,
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }

  const encryptedBlob = await res.arrayBuffer()
  const encryptedBytes = new Uint8Array(encryptedBlob)

  // 3. Split the concatenated stream into individual encrypted chunks and decrypt each.
  //
  // Each stored chunk is: nonce (12 bytes) + ciphertext (plaintext_len + 16-byte GCM tag).
  // For chunks 0..N-2, plaintext is the advertised chunk size.
  // For the last chunk (N-1), plaintext is sizeBytes - (N-1) * chunkSize.
  //
  // Use X-Chunk-Count header if available, otherwise fall back to the passed parameter.
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const headerChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size'))

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    headerChunkSize ?? CHUNK_SIZE,
  )

  // 5. Trigger browser download
  const blob = new Blob([decrypted as BlobPart], { type: effectiveMime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  dispatchDecrypted(fileId)
}

/**
 * Download and decrypt a shared file, returning the plaintext blob and filename.
 * Same as encryptedDownload but returns data instead of triggering a browser save.
 */
export async function decryptToBlob(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
): Promise<{ plaintext: Blob; filename: string }> {
  let filename = 'download'
  let inferredMime2: string | null = null
  try {
    const meta = await decryptFileMetadata(fileKey, nameEncryptedJson)
    filename = meta.name
    inferredMime2 = meta.mimeType
  } catch {
    filename = `file-${fileId}`
  }
  const blobMime = mimeType || inferredMime2 || 'application/octet-stream'

  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/download`, { headers })
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const encryptedBytes = new Uint8Array(await res.arrayBuffer())
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    effectiveChunkSize,
  )

  const plaintext = new Blob([decrypted as BlobPart], { type: blobMime })
  dispatchDecrypted(fileId)
  return { plaintext, filename }
}

/**
 * Download and decrypt a specific historical version of a file. Mirrors
 * decryptToBlob but hits the per-version endpoint. The version inherits
 * the parent file's mime_type — only the chunked content changes per
 * version, not the file key or filename.
 */
export async function decryptVersionToBlob(
  fileId: string,
  versionId: string,
  fileKey: Uint8Array,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(
    `${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`,
    { headers },
  )
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const encryptedBytes = new Uint8Array(await res.arrayBuffer())
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    effectiveChunkSize,
  )

  const plaintext = new Blob([decrypted as BlobPart], { type: mimeType || 'application/octet-stream' })
  dispatchDecrypted(fileId)
  return plaintext
}
