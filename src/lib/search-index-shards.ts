// ─── Sharded search-index storage client (B4, task 0871) ──────────────────
//
// Talks to the zero-knowledge sharded endpoints at `/api/v1/search-index`
// (server module `routes/search_index_shards.rs`). The server stores opaque
// ciphertext `BYTEA` addressed by `(user_id, bucket, page)` and serves it back
// verbatim — it NEVER deserializes a shard blob, so no token or file name is
// ever visible to it. Every PUT bumps a per-shard `version` for LWW manifest
// diffing.
//
// This module is transport only: it carries the opaque encrypted shard blobs
// produced by core's `WasmSearchIndex` (see `search-index-core.ts`). All crypto
// runs in core; nothing here parses a blob.

import { getToken, getApiUrl } from './api'

/** One entry in the server's shard manifest (`GET /shards`). */
export interface ShardRef {
  bucket: number
  page: number
  version: number
}

/** A shard coordinate without a version (for PUT/GET/DELETE addressing). */
export interface ShardCoord {
  bucket: number
  page: number
}

/** An encrypted shard page as core produces / consumes it. */
export interface EncryptedShard {
  bucket: number
  page: number
  /** Opaque `nonce||ciphertext||tag` blob — core-encrypted, never parsed here. */
  blob: Uint8Array
}

/**
 * The server accepts blobs up to ~160 KB (`MAX_SHARD_BLOB_BYTES`); core bounds
 * an encrypted page at ≤128 KB, so a single PUT always fits. Mirrored here so a
 * caller can reject an over-cap blob before the round-trip.
 */
export const MAX_SHARD_BLOB_BYTES = 160 * 1024

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  // Auth via cookie (post-migration) or bearer (legacy localStorage); the
  // server's AuthUser extractor accepts either. Same pattern as search-index.ts.
  const headers: Record<string, string> = { ...extra }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/**
 * `GET /shards` — the manifest the client diffs against `searchIndexSyncPlan`.
 * Returns every shard's `(bucket, page, version)` for this user (empty array
 * for a user who has never synced a shard — the rebuild-on-empty signal).
 */
export async function fetchShardManifest(): Promise<ShardRef[]> {
  const res = await fetch(`${getApiUrl()}/api/v1/search-index/shards`, {
    headers: authHeaders(),
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`shard manifest fetch failed: ${res.status}`)
  }
  const body = (await res.json()) as { shards?: ShardRef[] }
  return Array.isArray(body.shards) ? body.shards : []
}

/**
 * `GET /shards/{bucket}/{page}` — the opaque blob bytes, or `null` on 404
 * (the shard was deleted/never written).
 */
export async function getShard(bucket: number, page: number): Promise<Uint8Array | null> {
  const res = await fetch(`${getApiUrl()}/api/v1/search-index/shards/${bucket}/${page}`, {
    headers: authHeaders(),
    credentials: 'include',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`shard ${bucket}/${page} fetch failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Fetch every shard named in `coords` (each `{bucket, page}`) and return the
 * ones that still exist as `EncryptedShard`s, ready for
 * `WasmSearchIndex.fromEncryptedShards`. A 404'd coord is silently skipped
 * (the manifest can race a concurrent delete); the index just rebuilds it.
 */
export async function getShards(coords: ShardCoord[]): Promise<EncryptedShard[]> {
  const out: EncryptedShard[] = []
  // Bounded concurrency keeps the initial full-manifest pull from opening 64+
  // sockets at once on a cold load.
  const CONCURRENCY = 8
  for (let i = 0; i < coords.length; i += CONCURRENCY) {
    const slice = coords.slice(i, i + CONCURRENCY)
    const blobs = await Promise.all(
      slice.map(async (c) => {
        const blob = await getShard(c.bucket, c.page).catch(() => null)
        return blob ? ({ bucket: c.bucket, page: c.page, blob } satisfies EncryptedShard) : null
      }),
    )
    for (const b of blobs) if (b) out.push(b)
  }
  return out
}

/**
 * `PUT /shards/{bucket}/{page}` — upsert the opaque blob; the server bumps the
 * per-shard `version` (LWW) and returns the new `{bucket, page, version}`.
 * The body is raw `application/octet-stream` — never JSON.
 */
export async function putShard(shard: EncryptedShard): Promise<ShardRef> {
  if (shard.blob.length === 0) throw new Error('shard blob must not be empty')
  if (shard.blob.length > MAX_SHARD_BLOB_BYTES) {
    throw new Error(`shard ${shard.bucket}/${shard.page} blob ${shard.blob.length}B exceeds cap`)
  }
  const res = await fetch(
    `${getApiUrl()}/api/v1/search-index/shards/${shard.bucket}/${shard.page}`,
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
      // Copy into a fresh ArrayBuffer-backed view so a Uint8Array that is a
      // subarray over a larger buffer (core often returns views) sends only its
      // own bytes, not the whole backing buffer.
      body: shard.blob.slice().buffer as ArrayBuffer,
      credentials: 'include',
    },
  )
  if (!res.ok) throw new Error(`shard ${shard.bucket}/${shard.page} PUT failed: ${res.status}`)
  return (await res.json()) as ShardRef
}

/**
 * PUT every shard in `shards`. Best-effort: a single failed PUT rejects (the
 * caller treats the index as a best-effort cache and retries on the next sync),
 * but writes are issued with bounded concurrency so a 64-shard rebuild doesn't
 * burst the connection pool.
 */
export async function putShards(shards: EncryptedShard[]): Promise<void> {
  const CONCURRENCY = 6
  for (let i = 0; i < shards.length; i += CONCURRENCY) {
    const slice = shards.slice(i, i + CONCURRENCY)
    await Promise.all(slice.map((s) => putShard(s)))
  }
}

/**
 * `DELETE /shards/{bucket}/{page}` — remove a shard whose bucket emptied.
 * Idempotent (the server 204s whether or not a row existed).
 */
export async function deleteShard(bucket: number, page: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/v1/search-index/shards/${bucket}/${page}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'include',
  })
  // 204 expected; 404 is fine too (already gone).
  if (!res.ok && res.status !== 404) {
    throw new Error(`shard ${bucket}/${page} DELETE failed: ${res.status}`)
  }
}
