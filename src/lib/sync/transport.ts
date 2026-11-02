// ─── Sync transport ─────────────────────────────────
// The sync client's only door to the network: one bounded request per call, so
// coverage recovery can never hang indefinitely and every caller reports the
// same error kinds (a timeout is an `Error`, exactly as before).

import {
  getApiUrl,
  getSnapshot,
  getStreamToken,
  getSyncOps,
  getSyncOpsSinceUserSeq,
  submitSyncOps,
} from '../api'
import type {
  StreamTokenResponse,
  SubmittedSyncOp,
  SyncOp,
  SyncOpsResult,
  SyncSnapshot,
  UserSeqSyncOpsPage,
} from '../api'

/**
 * A gap-fill request that never answers must not stall coverage (task 1700):
 * every op-log and catch-up request is bounded by this.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 10_000
/** Bound on a full-snapshot fetch: a hung request must never stall coverage. */
export const SNAPSHOT_TIMEOUT_MS = 10_000

/** Bound a sync request so coverage recovery can never hang indefinitely. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sync request timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * The sync protocol's HTTP calls. Holds no state but the default request
 * bound; every other collaborator asks this class, never the api module, so a
 * test can substitute one seam.
 */
export class SyncTransport {
  private readonly defaultTimeoutMs: number

  constructor(options: { defaultTimeoutMs?: number } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? SYNC_REQUEST_TIMEOUT_MS
  }

  /** A full snapshot: the tree, authoritative up to its `seq_id`. */
  snapshot(timeoutMs = SNAPSHOT_TIMEOUT_MS): Promise<SyncSnapshot> {
    return withTimeout(getSnapshot(), timeoutMs)
  }

  /** The op tail after a global cursor, at most one server page. */
  opsSince(seq: number, timeoutMs = this.defaultTimeoutMs): Promise<SyncOp[]> {
    return withTimeout(getSyncOps(seq), timeoutMs)
  }

  /** This user's ops after a `user_seq` cursor, plus the head it read. */
  opsSinceUserSeq(sinceUserSeq: number, timeoutMs = this.defaultTimeoutMs): Promise<UserSeqSyncOpsPage> {
    return withTimeout(getSyncOpsSinceUserSeq(sinceUserSeq), timeoutMs)
  }

  /** Submit ops. Not time-bounded: the caller keeps its optimistic state. */
  submit(ops: SubmittedSyncOp[]): Promise<SyncOpsResult> {
    return submitSyncOps(ops)
  }

  /** A fresh token for the stream (it expires, so it is fetched per connect). */
  async streamToken(): Promise<string> {
    const response: StreamTokenResponse = await getStreamToken()
    return response.stream_token
  }

  /** The stream endpoint for a token. */
  streamUrl(token: string): string {
    return `${getApiUrl()}/api/v1/sync/stream?token=${encodeURIComponent(token)}`
  }
}
