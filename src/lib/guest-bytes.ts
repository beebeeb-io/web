/**
 * Task 2237b — guest plaintext bytes.
 *
 * Previews are in-memory, so they are capped well below what a download can
 * stream. The cap is checked before the network is touched.
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

async function readGuestBlob(args: GuestBytesArgs): Promise<Blob> {
  const meta = await openFileMetadata(args.item.id, args.fileKey, args.item.name_encrypted)
  const stream = await fetchFolderItemBytes(
    args.token,
    args.item.id,
    args.proof,
    args.signal,
  )
  const chunks: Uint8Array[] = []
  await pipeDecryptedChunks(
    stream,
    args.fileKey,
    meta.content,
    args.item.chunk_count,
    args.item.size_bytes,
    args.chunkSize ?? CHUNK_SIZE,
    args.signal,
    async (chunk) => {
      chunks.push(chunk)
    },
    undefined,
  )
  return new Blob(chunks as BlobPart[], {
    type: meta.mimeType ?? 'application/octet-stream',
  })
}

export async function fetchGuestPlaintextBlob(args: GuestBytesArgs): Promise<Blob> {
  if (args.item.size_bytes > GUEST_PREVIEW_MAX_BYTES) throw new GuestPreviewTooLargeError()
  return readGuestBlob(args)
}

/** User-initiated download: the same pipeline without the in-memory preview cap. */
export async function fetchGuestDownloadBlob(args: GuestBytesArgs): Promise<Blob> {
  return readGuestBlob(args)
}
