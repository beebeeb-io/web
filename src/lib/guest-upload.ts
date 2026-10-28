/**
 * Task 2237b — uploads through a folder link.
 *
 * Every file gets a fresh random content key (a guest cannot derive one), its
 * metadata is sealed under that key, and the key itself is wrapped under the
 * link's folder key (`wrapped_key`). Folders work the same way: the name is
 * sealed under the folder's own random name key, which is wrapped under the
 * folder key.
 *
 * Decisions L7 and L7a: every wrap is core's child wrap, bound to the shared
 * ROOT id, the new item's id and its kind. The guest therefore picks the id: a
 * UUIDv4 sent with the write (the upload's `metadata` part comes FIRST, before
 * any chunk), which the server stores exactly. A taken id is answered 409
 * `id_taken` with nothing stored, and the write is re-sealed under a fresh id.
 *
 * Uploads are sequential on purpose: one file in memory at a time, and the
 * per-link rate limit is respected.
 */
import {
  encryptChunk,
  planChunks,
  encryptFileMetadata,
  serializeEncryptedBlob,
} from './crypto'
import type { Proof } from './folder-link-types'
import { throwFolderResponseError } from './folder-link-public'
import { sealChildKey } from './folder-share-crypto'
import { API_URL } from './api'

export const MAX_GUEST_CHUNKS = 1024
export const MIN_GUEST_CHUNK_BYTES = 4 * 1024 * 1024

/** Legacy guest rows have no object version: downloads infer core's desktop plan. */
export async function planGuestChunks(sizeBytes: number): Promise<{ chunkSize: number; chunkCount: number }> {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('size must be a non-negative integer')
  const plan = await planChunks(sizeBytes, 'desktop')
  if (plan.chunk_count > MAX_GUEST_CHUNKS) throw new GuestUploadError('too_large')
  return { chunkSize: plan.chunk_size_bytes, chunkCount: plan.chunk_count }
}

export type GuestRejectReason =
  | 'quota'
  | 'cap'
  | 'paused'
  | 'rate'
  | 'too_large'
  | 'folder_gone'
  | 'level'
  | 'busy'
  | 'network'

export type GuestUploadState =
  | { name: 'queued' }
  | { name: 'uploading'; percent: number }
  | { name: 'added'; fileId: string }
  | { name: 'rejected'; reason: GuestRejectReason; message: string }

export function rejectMessage(reason: GuestRejectReason): string {
  switch (reason) {
    case 'quota':
      return 'This folder is out of space.'
    case 'cap':
      return 'That folder is full.'
    case 'paused':
      return 'Uploads to this link are paused right now.'
    case 'rate':
      return 'Too many uploads right now. Try again in a minute.'
    case 'too_large':
      return 'This file is too large to upload here.'
    case 'folder_gone':
      return 'This folder is no longer available.'
    case 'level':
      return "This link can't add files."
    case 'busy':
      return 'This folder is busy right now. Try again in a moment.'
    case 'network':
      return "The upload didn't finish. Check your connection and try again."
  }
}

export interface GuestUploadTask {
  file: File
  /** Path inside the shared folder, e.g. "Trip/2019/a.jpg"; null for a bare file. */
  relativePath: string | null
}

function siblingKey(parentId: string | null, name: string): string {
  return `${parentId ?? 'root'}:${name.toLowerCase()}`
}

/**
 * Applies the owner-style " (2)" suffix. `existing` is keyed by
 * `siblingKey(parentId, name)` and is updated by the caller as files land.
 */
export async function resolveGuestName(
  parentId: string | null,
  desired: string,
  existing: Map<string, string>,
): Promise<string> {
  if (!existing.has(siblingKey(parentId, desired))) return desired
  const dot = desired.lastIndexOf('.')
  const stem = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  for (let counter = 2; counter < 10_000; counter += 1) {
    const candidate = `${stem} (${counter})${ext}`
    if (!existing.has(siblingKey(parentId, candidate))) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

function proofHeaders(proof: Proof | null): Record<string, string> {
  return proof ? { 'x-folder-link-proof': proof.proof } : {}
}

function rejectFor(status: number, code: string | undefined): GuestRejectReason {
  if (status === 403) return 'level'
  if (status === 404 || status === 410) return 'folder_gone'
  if (status === 413) return 'quota'
  if (status === 429) return 'rate'
  if (status === 409) {
    if (code === 'link_paused') return 'paused'
    // Another write to the owner's shared folders held the lock; nothing was
    // stored. It is not a full folder.
    if (code === 'share_busy') return 'busy'
    // Only reached once every fresh id was taken too.
    if (code === 'id_taken') return 'network'
    return 'cap'
  }
  return 'network'
}

/** Fresh ids tried after `409 id_taken` (a UUIDv4 collision: in practice never). */
export const GUEST_ID_RETRIES = 2
/** Waits before retrying a `409 share_busy` write; nothing was stored. */
export const SHARE_BUSY_WAITS_MS: readonly number[] = [250, 750, 1500]

/** Test seam: how a busy retry waits. */
export const guestWriteTiming = {
  wait: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Send one guest write under a fresh client id, re-sealing on `id_taken` and
 * waiting out `share_busy`. `send` seals everything bound to the id it gets.
 */
async function sendGuestWrite(
  token: string,
  send: (id: string) => Promise<Response>,
): Promise<{ id: string; response: Response }> {
  let idRetries = 0
  let busyWaits = 0
  for (;;) {
    const id = crypto.randomUUID()
    const response = await send(id)
    if (response.ok) return { id, response }
    if (response.status === 401) await throwFolderResponseError(token, response)
    const code = await responseCode(response)
    if (response.status === 409 && code === 'id_taken' && idRetries < GUEST_ID_RETRIES) {
      idRetries += 1
      continue
    }
    if (response.status === 409 && code === 'share_busy' && busyWaits < SHARE_BUSY_WAITS_MS.length) {
      await guestWriteTiming.wait(SHARE_BUSY_WAITS_MS[busyWaits])
      busyWaits += 1
      continue
    }
    throw new GuestUploadError(rejectFor(response.status, code))
  }
}

async function responseCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : undefined
  } catch {
    return undefined
  }
}

/**
 * Create one folder under `parentId`. Every descendant of a shared folder is
 * keyed under the ROOT's folder key, so that key is what is returned for its
 * children. `rootId` is the shared folder's id (the L7 binding).
 */
export async function uploadGuestFolder(
  token: string,
  rootId: string,
  folderKey: Uint8Array,
  proof: Proof | null,
  parentId: string | null,
  name: string,
  actorNameEncrypted: string | null,
): Promise<{ id: string; folderKey: Uint8Array }> {
  const nameKey = crypto.getRandomValues(new Uint8Array(32))
  try {
    const meta = await encryptFileMetadata(nameKey, name, null)
    const nameEncrypted = serializeEncryptedBlob(meta.nonce, meta.ciphertext)
    const { id, response } = await sendGuestWrite(token, async (id) => {
      const body: Record<string, unknown> = {
        id,
        parent_id: parentId,
        name_encrypted: nameEncrypted,
        wrapped_name_key: await sealChildKey(folderKey, { rootId, itemId: id, isFolder: true }, nameKey),
        // Contract 2237 §1: a guest's wraps are always L7.
        format: 'l7',
      }
      if (actorNameEncrypted !== null) body.actor_name_encrypted = actorNameEncrypted
      return fetch(`${API_URL}/api/v1/f/${encodeURIComponent(token)}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...proofHeaders(proof) },
        body: JSON.stringify(body),
      })
    })
    const created = (await response.json()) as { id?: unknown }
    // The wrap is bound to `id`; any other id would be unreadable.
    if (created.id !== id) throw new GuestUploadError('network')
    return { id, folderKey }
  } finally {
    nameKey.fill(0)
  }
}

export class GuestUploadError extends Error {
  readonly reason: GuestRejectReason

  constructor(reason: GuestRejectReason) {
    super(rejectMessage(reason))
    this.name = 'GuestUploadError'
    this.reason = reason
  }
}

export async function uploadGuestFiles(args: {
  token: string
  /** The shared folder's id: every wrap is bound to it (L7). */
  rootId: string
  folderKey: Uint8Array
  proof: Proof | null
  parentId: string | null
  tasks: GuestUploadTask[]
  siblingNames: Map<string, string>
  actorNameEncrypted: string | null
  onEvent: (task: {
    relativePath: string | null
    name: string
    state: GuestUploadState
  }) => void
  signal?: AbortSignal
}): Promise<{ added: number; rejected: number }> {
  const directories = new Map<string, { id: string; key: Uint8Array }>()

  const ensureDirectory = async (path: string): Promise<{ id: string | null; key: Uint8Array }> => {
    if (path === '') return { id: args.parentId, key: args.folderKey }
    const known = directories.get(path)
    if (known) return known
    const slash = path.lastIndexOf('/')
    const parentPath = slash >= 0 ? path.slice(0, slash) : ''
    const name = path.slice(slash + 1)
    const parent = await ensureDirectory(parentPath)
    const resolved = await resolveGuestName(parent.id, name, args.siblingNames)
    const created = await uploadGuestFolder(
      args.token,
      args.rootId,
      parent.key,
      args.proof,
      parent.id,
      resolved,
      args.actorNameEncrypted,
    )
    args.siblingNames.set(siblingKey(parent.id, resolved), created.id)
    directories.set(path, { id: created.id, key: created.folderKey })
    return { id: created.id, key: created.folderKey }
  }

  let added = 0
  let rejected = 0

  for (const task of args.tasks) {
    if (args.signal?.aborted) {
      args.onEvent({
        relativePath: task.relativePath,
        name: task.file.name,
        state: { name: 'rejected', reason: 'network', message: rejectMessage('network') },
      })
      rejected += 1
      continue
    }

    const relative = task.relativePath ?? task.file.name
    const slash = relative.lastIndexOf('/')
    const dirPath = slash >= 0 ? relative.slice(0, slash) : ''
    const desired = slash >= 0 ? relative.slice(slash + 1) : relative
    const report = (state: GuestUploadState) =>
      args.onEvent({ relativePath: task.relativePath, name: desired, state })

    try {
      const parent = await ensureDirectory(dirPath)
      const name = await resolveGuestName(parent.id, desired, args.siblingNames)
      const plan = await planGuestChunks(task.file.size)
      report({ name: 'uploading', percent: 0 })

      const fileKey = crypto.getRandomValues(new Uint8Array(32))
      let fileId: string
      try {
        const meta = await encryptFileMetadata(fileKey, name, task.file.type || null)
        const nameEncrypted = serializeEncryptedBlob(meta.nonce, meta.ciphertext)

        const frames: Blob[] = []
        for (let index = 0; index < plan.chunkCount; index += 1) {
          if (args.signal?.aborted) throw new GuestUploadError('network')
          const start = index * plan.chunkSize
          const end = Math.min(start + plan.chunkSize, task.file.size)
          const plaintext = new Uint8Array(await task.file.slice(start, end).arrayBuffer())
          const encrypted = await encryptChunk(fileKey, plaintext)
          const frame = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
          frame.set(encrypted.nonce, 0)
          frame.set(encrypted.ciphertext, encrypted.nonce.length)
          frames.push(new Blob([frame as BlobPart], { type: 'application/octet-stream' }))
          report({
            name: 'uploading',
            percent: Math.floor(((index + 1) / plan.chunkCount) * 100),
          })
        }

        const { id, response } = await sendGuestWrite(args.token, async (id) => {
          const metadata: Record<string, unknown> = {
            id,
            parent_id: parent.id,
            name_encrypted: nameEncrypted,
            // L7: bound to (root, this file's id, file).
            wrapped_key: await sealChildKey(parent.key, { rootId: args.rootId, itemId: id, isFolder: false }, fileKey),
            // Contract 2237 §1: a guest's wraps are always L7.
            format: 'l7',
          }
          if (args.actorNameEncrypted !== null) {
            metadata.actor_name_encrypted = args.actorNameEncrypted
          }
          // L7a: the metadata part comes FIRST, so the server claims the id
          // before it reads a single chunk.
          const form = new FormData()
          form.append('metadata', JSON.stringify(metadata))
          frames.forEach((frame, index) => form.append(`chunk_${index}`, frame))
          return fetch(`${API_URL}/api/v1/f/${encodeURIComponent(args.token)}/upload`, {
            method: 'POST',
            headers: proofHeaders(args.proof),
            body: form,
            signal: args.signal,
          })
        })
        const result = (await response.json()) as { file_id?: unknown }
        // The wrap is bound to `id`; a file stored under any other id is unreadable.
        if (result.file_id !== id) throw new GuestUploadError('network')
        fileId = id
      } finally {
        fileKey.fill(0)
      }

      args.siblingNames.set(siblingKey(parent.id, name), fileId)
      added += 1
      report({ name: 'added', fileId })
    } catch (error) {
      const reason =
        error instanceof GuestUploadError
          ? error.reason
          : (error as { name?: string })?.name === 'AbortError'
            ? 'network'
            : 'network'
      rejected += 1
      report({ name: 'rejected', reason, message: rejectMessage(reason) })
    }
  }

  return { added, rejected }
}
