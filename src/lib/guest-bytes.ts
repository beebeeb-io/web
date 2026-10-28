/**
 * Task 2237b — guest plaintext bytes.
 *
 * Previews are in-memory, so they are capped well below what a download can
 * stream. The cap is checked before the network is touched. "Download all"
 * streams each file into the zip through `streamGuestPlaintext`.
 */
import { CHUNK_SIZE } from './crypto'
import { openFileMetadata, pipeDecryptedChunks } from './encrypted-download'
import { fetchFolderItemBytes } from './folder-link-public'
import type { Proof, PublicFolderItem } from './folder-link-types'

/** 25 MiB. */
export const GUEST_PREVIEW_MAX_BYTES = 26_214_400

export class GuestPreviewTooLargeError extends Error {
  constructor() {
    super('This file is too large to preview here.')
    this.name = 'GuestPreviewTooLargeError'
  }
}

interface GuestBytesArgs {
  token: string
  item: PublicFolderItem
  fileKey: Uint8Array
  proof: Proof | null
  signal?: AbortSignal
  /** Server chunk size; the default client size unless a test says otherwise. */
  chunkSize?: number
}

/**
 * Decrypt a guest file chunk by chunk into `onChunk`. The frame size comes
 * from the server's `X-Chunk-Size` (desktop, CLI and mobile uploads use larger
 * chunks than the web default, and big files scale them further); the
 * caller's `chunkSize` and the client default are only fallbacks for a server
 * that sends no header.
 */
export async function streamGuestPlaintext(
  args: GuestBytesArgs,
  onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<{ mimeType: string | null }> {
  const meta = await openFileMetadata(args.item.id, args.fileKey, args.item.name_encrypted)
  const { stream, chunkSize } = await fetchFolderItemBytes(
    args.token,
    args.item.id,
    args.proof,
    args.signal,
  )
  await pipeDecryptedChunks(
    stream,
    args.fileKey,
    meta.content,
    args.item.chunk_count,
    args.item.size_bytes,
    chunkSize ?? args.chunkSize ?? CHUNK_SIZE,
    args.signal,
    onChunk,
    undefined,
  )
  return { mimeType: meta.mimeType ?? null }
}

async function readGuestBlob(args: GuestBytesArgs): Promise<Blob> {
  const chunks: Uint8Array[] = []
  const { mimeType } = await streamGuestPlaintext(args, async (chunk) => {
    chunks.push(chunk)
  })
  return new Blob(chunks as BlobPart[], { type: mimeType ?? 'application/octet-stream' })
}

export async function fetchGuestPlaintextBlob(args: GuestBytesArgs): Promise<Blob> {
  if (args.item.size_bytes > GUEST_PREVIEW_MAX_BYTES) throw new GuestPreviewTooLargeError()
  return readGuestBlob(args)
}

/** User-initiated download: the same pipeline without the in-memory preview cap. */
export async function fetchGuestDownloadBlob(args: GuestBytesArgs): Promise<Blob> {
  return readGuestBlob(args)
}
