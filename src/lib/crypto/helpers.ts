// Shared crypto primitives: chunking, base64, zeroize, and X25519 agreement.
import { withProxy } from './service'

// ─── Helpers ────────────────────────────────────────

/**
 * Legacy 4 MB constant — kept only for the `chunkFile` helper below (used by
 * some older callers). New upload code should use `planChunks()` instead.
 */
export const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB

/** Split a file into 4MB chunks. */
export async function chunkFile(file: File): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  let offset = 0
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE)
    const buffer = await slice.arrayBuffer()
    chunks.push(new Uint8Array(buffer))
    offset += CHUNK_SIZE
  }
  return chunks
}

/** Encode bytes to base64 (for sending in JSON). */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 back to bytes. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Zero out a Uint8Array (for clearing key material). */
export function zeroize(buffer: Uint8Array): void {
  buffer.fill(0)
}

export async function x25519SharedSecret(
  myPrivate: Uint8Array,
  theirPublic: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.x25519SharedSecret(myPrivate, theirPublic))
}

/** Derive a per-file share key from a shared secret and file ID bytes. */
