// ─── Encrypted download ────────────────────────────
// Downloads encrypted file data, decrypts chunks + filename, triggers browser download.

import {
  decryptChunk,
  decryptFilename,
  fromBase64,
} from './crypto'
import { getToken, ApiError } from './api'

const API_URL = 'http://localhost:3001'

// AES-256-GCM nonce is 12 bytes
const NONCE_LENGTH = 12

/**
 * Download and decrypt a file, then trigger a browser save dialog.
 *
 * @param fileId    The file's ID (used for key derivation)
 * @param fileKey   Per-file encryption key
 * @param nameEncryptedJson  The encrypted filename JSON from the API ({nonce, ciphertext} base64)
 * @param mimeType  Original MIME type for the download
 */
export async function encryptedDownload(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string,
): Promise<void> {
  // 1. Decrypt the filename
  let filename = 'download'
  try {
    const parsed = JSON.parse(nameEncryptedJson) as {
      nonce: string
      ciphertext: string
    }
    filename = await decryptFilename(
      fileKey,
      fromBase64(parsed.nonce),
      fromBase64(parsed.ciphertext),
    )
  } catch {
    // If decryption fails, fall back to a generic name
    filename = `file-${fileId}`
  }

  // 2. Download the encrypted blob from the API
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/files/${fileId}/download`, {
    headers,
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }

  const encryptedBlob = await res.arrayBuffer()
  const encryptedBytes = new Uint8Array(encryptedBlob)

  // 3. Decrypt
  // The blob is nonce (12 bytes) + ciphertext for each chunk, concatenated.
  // For single-chunk files, it's one nonce+ciphertext pair.
  // For multi-chunk, the server may return them sequentially.
  const decryptedParts: Uint8Array[] = []
  let offset = 0

  while (offset < encryptedBytes.length) {
    // Extract nonce
    const nonce = encryptedBytes.slice(offset, offset + NONCE_LENGTH)
    offset += NONCE_LENGTH

    // The remaining data until end (or next chunk boundary) is ciphertext.
    // Since we don't know chunk boundaries from the download, we try to
    // decrypt the rest. If it's a single chunk, this works directly.
    // For multi-chunk, the server should separate them or provide metadata.
    const ciphertext = encryptedBytes.slice(offset)
    try {
      const plaintext = await decryptChunk(fileKey, nonce, ciphertext)
      decryptedParts.push(plaintext)
      break // Successfully decrypted everything
    } catch {
      // If decryption of the full remaining fails, try chunk-sized blocks.
      // GCM tag is 16 bytes, so ciphertext = plaintext + 16.
      // Try 1MB + 16 bytes as chunk size.
      const CHUNK_CT_SIZE = 1024 * 1024 + 16
      if (ciphertext.length > CHUNK_CT_SIZE) {
        const chunkCt = encryptedBytes.slice(offset, offset + CHUNK_CT_SIZE)
        const plaintext = await decryptChunk(fileKey, nonce, chunkCt)
        decryptedParts.push(plaintext)
        offset += CHUNK_CT_SIZE
      } else {
        // Last chunk — decrypt whatever is left
        const plaintext = await decryptChunk(fileKey, nonce, ciphertext)
        decryptedParts.push(plaintext)
        break
      }
    }
  }

  // 4. Combine decrypted parts
  const totalSize = decryptedParts.reduce((sum, p) => sum + p.length, 0)
  const decrypted = new Uint8Array(totalSize)
  let writeOffset = 0
  for (const part of decryptedParts) {
    decrypted.set(part, writeOffset)
    writeOffset += part.length
  }

  // 5. Trigger browser download
  const blob = new Blob([decrypted], { type: mimeType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
