/**
 * The request-row resolver (§15, decision 2326 = A).
 *
 * Every request row is read through here. The resolver fetches the owner's
 * `GET /file-requests` list (memoised, reloaded once when a newer request is
 * missing), hands the row's envelope fields to core's ONE resolver, and turns
 * core's decrypt-only reader into a `RequestContentSource`. Nothing in this
 * file unwraps the request private key or opens the content seal: core does
 * both, and no raw content key reaches the page.
 *
 * Renames go through `sealRename`, which refuses a row core marked read-only
 * (an upper-repair name) and otherwise calls core's `sealRequestRename` under
 * the string convention, never under `C`.
 */
import { listFileRequests, type DriveFile, type FileRequest } from './api'
import {
  decryptorDispose,
  decryptorFinish,
  decryptorPushFrame,
  fromBase64,
  requestReaderDecryptor,
  requestReaderFree,
  requestReaderOpenFrame,
  resolveRequestRowWorker,
  sealRequestRenameWorker,
} from './crypto'
import { FILE_REQUEST_EMPTY_ID } from './crypto/file-requests'
import {
  createRequestContentSource,
  RENAME_KEY_UNAVAILABLE,
  isRequestUpload,
  rawRequestContentSource,
  resolveRequestRowWith,
  sealRequestRenameWith,
  type RequestContentSource,
  type RequestRenameTarget,
  type RequestSeal,
  type RequestRowWasm,
  type ResolveRequestRowWithArgs,
} from './request-row'

/** A request row after resolution: core's metadata plus a decrypt-only source. */
export interface ResolvedRequestRow {
  name: string | null
  mimeType: string | null
  nameOrigin: string
  chunkFormat: number
  seal: RequestSeal
  renameTarget: RequestRenameTarget | null
  /** The row's content, read-only. Never a key. */
  content: RequestContentSource
}

/** The row fields resolution needs; a listed row carries all of them. */
type RequestFile = Pick<
  DriveFile,
  'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'
>

/** What the resolver needs from core; the worker engine and the local engine both implement it. */
export interface RequestRowEngine {
  listRequests(): Promise<FileRequest[]>
  resolve(args: ResolveRequestRowWithArgs): Promise<ResolvedRequestRow>
  sealRename(args: {
    masterKey: Uint8Array
    itemId: string
    pin: number
    filename: string
    mimeType: string | null
  }): Promise<string>
}

export interface RequestRowResolver {
  /** Core's answer for one row, cached per id until a rename or `clear()`. */
  resolveRow(file: RequestFile, masterKey: Uint8Array): Promise<ResolvedRequestRow>
  /** L13/A9: the sealed new name; refuses a read-only (upper-repair) row. */
  sealRename(file: RequestFile, newName: string, masterKey: Uint8Array): Promise<string>
  /** Drop the memoised request list, the resolved rows and their readers. */
  clear(): void
}

/** The production engine: the crypto worker holds core and the reader handles. */
const workerEngine: RequestRowEngine = {
  async listRequests() {
    const { file_requests } = await listFileRequests()
    return file_requests
  },
  async resolve(args) {
    const resolved = await resolveRequestRowWorker(args)
    const content = createRequestContentSource({
      fileId: resolved.fileId,
      chunkFormat: resolved.chunkFormat,
      name: resolved.name,
      mimeType: resolved.mimeType,
      async startStream() {
        const handle = await requestReaderDecryptor(resolved.handle)
        return {
          pushFrame: (frame) => decryptorPushFrame(handle, frame),
          finish: () => decryptorFinish(handle),
          dispose: () => decryptorDispose(handle),
        }
      },
      async openFrame(versionId, index, isLast, format, frame) {
        return requestReaderOpenFrame(resolved.handle, versionId, index, isLast, format, frame)
      },
      async close() {
        await requestReaderFree(resolved.handle)
      },
    })
    return {
      name: resolved.name,
      mimeType: resolved.mimeType,
      nameOrigin: resolved.nameOrigin,
      chunkFormat: resolved.chunkFormat,
      seal: resolved.seal,
      renameTarget: resolved.renameTarget,
      content,
    }
  },
  async sealRename(args) {
    return sealRequestRenameWorker(args.masterKey, args.itemId, args.pin, args.filename, args.mimeType)
  },
}

/**
 * The in-process engine over a wasm module (tests and offline tools). Same
 * adapters production uses; only the worker hop is absent.
 */
export function createLocalRequestRowEngine(
  wasm: RequestRowWasm,
  listRequests: () => Promise<FileRequest[]>,
): RequestRowEngine {
  return {
    listRequests,
    async resolve(args) {
      const row = resolveRequestRowWith(wasm, args)
      return {
        name: row.name,
        mimeType: row.mimeType,
        nameOrigin: row.nameOrigin,
        chunkFormat: row.chunkFormat,
        seal: row.seal,
        renameTarget: row.renameTarget,
        content: rawRequestContentSource(row),
      }
    },
    async sealRename(args) {
      return sealRequestRenameWith(wasm, {
        masterKey: args.masterKey,
        itemId: args.itemId,
        pin: args.pin,
        filename: args.filename,
        mimeType: args.mimeType,
      })
    },
  }
}

export function createRequestRowResolverWith(engine: RequestRowEngine): RequestRowResolver {
  let requestsPromise: Promise<Map<string, FileRequest>> | null = null
  const rows = new Map<string, ResolvedRequestRow>()

  const loadRequests = (force: boolean): Promise<Map<string, FileRequest>> => {
    if (force || !requestsPromise) {
      requestsPromise = engine
        .listRequests()
        .then((requests) => new Map(requests.map((request) => [request.id, request])))
    }
    return requestsPromise
  }

  /** The owning request row, reloading once when a newer request is missing. */
  const requestFor = async (
    requestId: string,
  ): Promise<FileRequest & { wrapped_private_key: string; wrap_nonce: string }> => {
    let byId = await loadRequests(false)
    let request = byId.get(requestId)
    if (!request) {
      // The request may have been created after our first load — reload once.
      byId = await loadRequests(true)
      request = byId.get(requestId)
    }
    if (!request?.wrapped_private_key || !request.wrap_nonce) {
      throw new Error('owning file request (or its wrapped key) not found — cannot decrypt')
    }
    return { ...request, wrapped_private_key: request.wrapped_private_key, wrap_nonce: request.wrap_nonce }
  }

  const resolveRow = async (file: RequestFile, masterKey: Uint8Array): Promise<ResolvedRequestRow> => {
    if (!isRequestUpload(file)) throw new Error('resolveRow called on a non-request file')
    const cached = rows.get(file.id)
    if (cached) return cached
    const request = await requestFor(file.file_request_id!)
    const row = await engine.resolve({
      masterKey,
      itemId: file.id,
      // §15: every request so far wrapped its private key under the empty
      // context; core refuses a shipped row under any other context.
      requestWrapContext: FILE_REQUEST_EMPTY_ID,
      wrappedRequestPrivate: fromBase64(request.wrapped_private_key),
      wrapNonce: fromBase64(request.wrap_nonce),
      senderEphemeralPubkey: fromBase64(file.sender_ephemeral_pubkey!),
      wrappedContentKey: fromBase64(file.wrapped_content_key!),
      nameEncrypted: file.name_encrypted,
    })
    rows.set(file.id, row)
    return row
  }

  return {
    resolveRow,

    async sealRename(file, newName, masterKey) {
      const row = await resolveRow(file, masterKey)
      // §15: an upper-repair name has no rename target and is READ-ONLY.
      if (!row.renameTarget) throw new Error(RENAME_KEY_UNAVAILABLE)
      const sealed = await engine.sealRename({
        masterKey,
        itemId: file.id,
        pin: row.renameTarget.pin,
        filename: newName,
        mimeType: row.mimeType,
      })
      // The cached row's name is now stale; re-resolve on next read.
      rows.delete(file.id)
      return sealed
    },

    clear() {
      for (const row of rows.values()) void row.content.close()
      rows.clear()
      requestsPromise = null
    },
  }
}

/** Production: the crypto worker engine. */
export function createRequestRowResolver(): RequestRowResolver {
  return createRequestRowResolverWith(workerEngine)
}

export type { RequestContentSource, RequestSeal, RequestRenameTarget }
