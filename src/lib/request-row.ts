/**
 * Contract 2275 §15 (decision 2326 = A) — a request row, as core resolves it.
 *
 * Core's `resolveRequestRow` is the ONE entry point for a 2236 request row. It
 * opens BOTH seals a row can carry — the bound seal (HKDF info = the row's id
 * bytes) and the shipped empty-id seal — says which one it opened, and returns
 * a DECRYPT-ONLY content reader (`WasmRequestContentReader`). No raw content
 * key `C` reaches JS, so nothing in web can unwrap C, open the row's content
 * with a key of its own, or seal a name under C.
 *
 * Reading a request row therefore goes through this module:
 *   - `resolveRequestRowWith` adapts core's result (used by the worker and by
 *     tests over the committed wasm build);
 *   - `sealRequestRenameWith` is the ONLY rename path: core derives the
 *     string-convention key from the row's id and keeps the row's recorded
 *     pin. `resolveRequestRow` hands back no key, so a rename can never be
 *     sealed under the uploader-held `C` (A9).
 *   - `mintGuestItemIdWith` mints an F id (L12): a guest upload or folder
 *     create must use it, never a locally made UUID.
 *
 * This file has no dependency on the worker facade (`./crypto`); the resolver
 * that talks to the worker lives in `./request-row-resolver`.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   §15 — one resolver, both seals; the result names its seal.
 *   L12 — F ids are UUID v8 minted by core; guests use `mintGuestItemId`.
 *   L13/A9 — a request-row rename is always the string convention, never C.
 */
import type * as Wasm from 'beebeeb-wasm'
import type { DriveFile } from './api'
import type { DecryptSummary } from './content-crypto'

/** The fixed request-wrap context: the server mints the request id after the wrap, so every wrap uses empty. */
export const REQUEST_WRAP_CONTEXT = new Uint8Array(0)

/** Why a request row cannot be renamed here (an upper-repair name is read-only). */
export const RENAME_KEY_UNAVAILABLE = "This file's key isn't available, so it can't be renamed here."

/** §15: which seal core opened for this row. */
export type RequestSeal = 'bound' | 'unbound'

/** L13/A9: where a rename is sealed — always the string convention derived from the id. */
export interface RequestRenameTarget {
  origin: string
  /** The row's recorded chunk-format pin (`chunkFormat`), never a wire field. */
  pin: number
}

/** Core's answer for one request row, before any worker transport. */
export interface RequestRowResolution {
  /** The decrypt-only reader: `decryptor()` for sequential reads, `openFrame(...)` for seek/range. */
  content: Wasm.WasmRequestContentReader
  nameOrigin: string
  name: string | null
  mimeType: string | null
  chunkFormat: number
  seal: RequestSeal
  renameTarget: RequestRenameTarget | null
}

/** The core calls this module adapts (tests pass the committed wasm build). */
export type RequestRowWasm = Pick<
  typeof Wasm,
  'resolveRequestRow' | 'sealRequestRename' | 'mintGuestItemId'
>

/** True when a file must be read via the request-row path, not derive_file_key. */
export function isRequestUpload(
  file: Pick<DriveFile, 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'>,
): boolean {
  return Boolean(file.file_request_id && file.sender_ephemeral_pubkey && file.wrapped_content_key)
}

/** Everything core needs to resolve one request row (§15). */
export interface ResolveRequestRowWithArgs {
  masterKey: Uint8Array
  /** The row's id: it classes the row and binds the bound seal. */
  itemId: string
  /** The context the owner wrapped the request private key under: empty for every request so far. */
  requestWrapContext: Uint8Array
  wrappedRequestPrivate: Uint8Array
  wrapNonce: Uint8Array
  senderEphemeralPubkey: Uint8Array
  wrappedContentKey: Uint8Array
  nameEncrypted: string
}

/**
 * Resolve one request row through core. Both seals are opened by core; a row
 * core refuses stays refused (no client fallback re-opens it under C).
 */
export function resolveRequestRowWith(
  wasm: RequestRowWasm,
  args: ResolveRequestRowWithArgs,
): RequestRowResolution {
  const raw = wasm.resolveRequestRow(
    args.masterKey,
    args.itemId,
    args.requestWrapContext,
    args.wrappedRequestPrivate,
    args.wrapNonce,
    args.senderEphemeralPubkey,
    args.wrappedContentKey,
    args.nameEncrypted,
  ) as {
    content: Wasm.WasmRequestContentReader
    nameOrigin?: string
    name?: string | null
    mimeType?: string | null
    chunkFormat?: number
    seal?: RequestSeal
    renameTarget?: { origin?: string; pin?: number } | null
  }
  // 2326 review P3-4: fail closed. Core always reports both, and a guessed
  // chunkFormat 0 would read a v2 row with the v1 frame layout, while a guessed
  // 'unbound' would mislabel the seal. Only the rename target defaults: core
  // answers null explicitly for a read-only (upper-repair) row.
  if (typeof raw.chunkFormat !== 'number') {
    throw new Error('request row resolve: core returned no chunkFormat')
  }
  if (raw.seal !== 'bound' && raw.seal !== 'unbound') {
    throw new Error('request row resolve: core returned no seal')
  }
  return {
    content: raw.content,
    nameOrigin: raw.nameOrigin ?? 'request_content',
    name: raw.name ?? null,
    mimeType: raw.mimeType ?? null,
    chunkFormat: raw.chunkFormat,
    seal: raw.seal,
    renameTarget:
      raw.renameTarget && typeof raw.renameTarget.pin === 'number'
        ? { origin: raw.renameTarget.origin ?? 'derived', pin: raw.renameTarget.pin }
        : null,
  }
}

export interface SealRequestRenameWithArgs {
  masterKey: Uint8Array
  itemId: string
  /** `renameTarget.pin` from `resolveRequestRowWith` — never a field from the wire. */
  pin: number
  filename: string
  mimeType?: string | null
}

/**
 * L13/A9: seal a request row's new name under the section-15 string-convention
 * key, keeping the row's recorded pin. The only rename path a request row has.
 */
export function sealRequestRenameWith(
  wasm: RequestRowWasm,
  args: SealRequestRenameWithArgs,
): string {
  return wasm.sealRequestRename(
    args.masterKey,
    args.itemId,
    args.pin,
    args.filename,
    args.mimeType ?? null,
  )
}

/** L12: mint a guest (F-class) item id from core. Needs no master key. */
export function mintGuestItemIdWith(wasm: Pick<typeof Wasm, 'mintGuestItemId'>): string {
  return wasm.mintGuestItemId()
}

// ─── Reading the content of a request row ───────────────────────────────────

/**
 * The decryptor a `RequestContentSource` hands out. Structurally the same as a
 * `StreamingDecryptor`; the worker-backed source returns the real proxy.
 */
export interface RequestDecryptor {
  pushFrame(frame: Uint8Array): Promise<Uint8Array>
  finish(): Promise<DecryptSummary>
  dispose(): Promise<void>
}

/**
 * A request row's content, as a read-only source. There is no key: sequential
 * reads take `startStream()`, seek/range reads take `openFrame(...)` with the
 * authenticated version id and format the caller already has.
 */
export interface RequestContentSource {
  readonly fileId: string
  /** The row's recorded pin: 0 = unrecorded, 2 = v2. */
  readonly chunkFormat: number
  /** The name core decrypted for this row (null when it could not be read). */
  readonly name: string | null
  readonly mimeType: string | null
  /** A FRESH sequential decryptor at chunk 0. Call again after any error. */
  startStream(): Promise<RequestDecryptor>
  /** Open ONE frame at `index`; `format`/`versionId` must come from authenticated data. */
  openFrame(
    versionId: Uint8Array,
    index: number,
    isLast: boolean,
    format: number,
    frame: Uint8Array,
  ): Promise<Uint8Array>
  /** Release the reader (best effort, idempotent). */
  close(): Promise<void>
}

/** Any file key a download path accepts: raw bytes, or a request row's reader. */
export type ContentKey = Uint8Array | RequestContentSource

export function isRequestContentSource(key: ContentKey): key is RequestContentSource {
  return !(key instanceof Uint8Array)
}

/**
 * The raw bytes of an ordinary file key. A request row has no bytes to hand
 * out — callers that need bytes (sharing, thumbnails, notes) must not be
 * reached with one, so this refuses instead of guessing.
 */
export function contentKeyBytes(key: ContentKey): Uint8Array {
  if (key instanceof Uint8Array) return key
  throw new Error('request-row content has no raw key: read it through its request-content source')
}

export interface RequestContentSourceSpec {
  fileId: string
  chunkFormat: number
  name: string | null
  mimeType: string | null
  startStream(): Promise<RequestDecryptor>
  openFrame(
    versionId: Uint8Array,
    index: number,
    isLast: boolean,
    format: number,
    frame: Uint8Array,
  ): Promise<Uint8Array>
  close(): Promise<void>
}

export function createRequestContentSource(spec: RequestContentSourceSpec): RequestContentSource {
  let closed = false
  const source: RequestContentSource = {
    fileId: spec.fileId,
    chunkFormat: spec.chunkFormat,
    name: spec.name,
    mimeType: spec.mimeType,
    startStream() {
      if (closed) throw new Error('request-content source already closed')
      return spec.startStream()
    },
    openFrame(versionId, index, isLast, format, frame) {
      if (closed) throw new Error('request-content source already closed')
      return spec.openFrame(versionId, index, isLast, format, frame)
    },
    async close() {
      if (closed) return
      closed = true
      await spec.close()
    },
  }
  return source
}

/**
 * The in-process source over a raw wasm reader (tests, and any caller that
 * already holds the wasm instance). Production wraps a worker handle instead.
 */
export function rawRequestContentSource(row: RequestRowResolution): RequestContentSource {
  return createRequestContentSource({
    fileId: row.content.fileId,
    chunkFormat: row.content.chunkFormat,
    name: row.name,
    mimeType: row.mimeType,
    async startStream() {
      const d = row.content.decryptor()
      return {
        pushFrame: async (frame) => d.pushFrame(frame) as Uint8Array,
        finish: async () => d.finish() as unknown as DecryptSummary,
        dispose: async () => {
          try {
            d.free()
          } catch {
            // already consumed
          }
        },
      }
    },
    async openFrame(versionId, index, isLast, format, frame) {
      return row.content.openFrame(versionId, index, isLast, format, frame) as Uint8Array
    },
    async close() {
      try {
        row.content.free()
      } catch {
        // already freed
      }
    },
  })
}
