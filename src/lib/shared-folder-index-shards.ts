/**
 * Task 2237b — transport for a shared folder's encrypted search-index shards.
 *
 * The server stores opaque ciphertext pages addressed by `(folder_id, bucket,
 * page)` and never parses them. Two fronts reach the same rows: the link
 * routes (proof header, no account) and the owner routes (account session).
 *
 * Every write states the version it believes it replaces; `if_version=0` means
 * "this page must not exist yet". A 409 carries the current version so the
 * caller can retry deliberately instead of clobbering another device.
 */
import { getApiUrl, getToken } from './api'
import type { Proof } from './folder-link-types'

/** One entry in the server's shard manifest. */
export interface ShardRef {
  bucket: number
  page: number
  version: number
}

/** A shard coordinate without a version. */
export interface ShardCoord {
  bucket: number
  page: number
}

export interface SharedEncryptedShard {
  bucket: number
  page: number
  blob: Uint8Array
}

/** Mirrors the server's accepted body size and core's ≤128 KiB page bound. */
export const MAX_SHARD_BLOB_BYTES = 163_840

export const SHARD_BUCKETS = 64
export const SHARD_PAGES_PER_BUCKET = 16

/**
 * A write lost the version race. `currentVersion` is the server's version for
 * the page, taken from the 409 body.
 */
export class IndexVersionConflictError extends Error {
  readonly currentVersion: number

  constructor(currentVersion: number) {
    super('index_version_conflict')
    this.name = 'IndexVersionConflictError'
    this.currentVersion = currentVersion
  }
}

export type IndexTransport = {
  listShards(): Promise<ShardRef[]>
  getShard(coord: ShardCoord): Promise<Uint8Array | null>
  putShard(
    shard: SharedEncryptedShard,
    ifVersion: number,
  ): Promise<{ bucket: number; page: number; version: number }>
  deleteShard(coord: ShardCoord, ifVersion: number): Promise<void>
}

function checkCoords(coord: ShardCoord): void {
  if (!Number.isInteger(coord.bucket) || coord.bucket < 0 || coord.bucket >= SHARD_BUCKETS) {
    throw new Error(`bucket must be in 0..${SHARD_BUCKETS}`)
  }
  if (!Number.isInteger(coord.page) || coord.page < 0 || coord.page >= SHARD_PAGES_PER_BUCKET) {
    throw new Error(`page must be in 0..${SHARD_PAGES_PER_BUCKET}`)
  }
}

async function conflictVersion(response: Response): Promise<number | null> {
  if (response.status !== 409) return null
  try {
    const body = (await response.json()) as { current_version?: unknown }
    const version = body.current_version
    return typeof version === 'number' && Number.isFinite(version) ? version : null
  } catch {
    return null
  }
}

function makeTransport(
  baseUrl: string,
  headers: () => Record<string, string>,
  credentials: RequestCredentials,
): IndexTransport {
  const shardUrl = (coord: ShardCoord, ifVersion?: number) =>
    `${baseUrl}/${coord.bucket}/${coord.page}${
      typeof ifVersion === 'number' ? `?if_version=${ifVersion}` : ''
    }`

  return {
    async listShards() {
      const response = await fetch(baseUrl, { headers: headers(), credentials })
      if (!response.ok) throw new Error(`shard manifest fetch failed: ${response.status}`)
      const body = (await response.json()) as { shards?: ShardRef[] }
      return Array.isArray(body.shards) ? body.shards : []
    },

    async getShard(coord) {
      checkCoords(coord)
      const response = await fetch(shardUrl(coord), { headers: headers(), credentials })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`shard ${coord.bucket}/${coord.page} fetch failed: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async putShard(shard, ifVersion) {
      checkCoords(shard)
      if (shard.blob.length === 0) throw new Error('shard blob must not be empty')
      if (shard.blob.length > MAX_SHARD_BLOB_BYTES) {
        throw new Error(
          `shard ${shard.bucket}/${shard.page} blob ${shard.blob.length}B exceeds the ${MAX_SHARD_BLOB_BYTES}B cap`,
        )
      }
      const response = await fetch(shardUrl(shard, ifVersion), {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/octet-stream' },
        credentials,
        // Copy out of any larger backing buffer so only this page's bytes go.
        body: shard.blob.slice().buffer as ArrayBuffer,
      })
      if (response.status === 409) {
        const current = await conflictVersion(response)
        throw new IndexVersionConflictError(current ?? -1)
      }
      if (!response.ok) {
        throw new Error(`shard ${shard.bucket}/${shard.page} PUT failed: ${response.status}`)
      }
      return (await response.json()) as { bucket: number; page: number; version: number }
    },

    async deleteShard(coord, ifVersion) {
      checkCoords(coord)
      const response = await fetch(shardUrl(coord, ifVersion), {
        method: 'DELETE',
        headers: headers(),
        credentials,
      })
      if (response.status === 409) {
        const current = await conflictVersion(response)
        throw new IndexVersionConflictError(current ?? -1)
      }
      if (!response.ok && response.status !== 404) {
        throw new Error(`shard ${coord.bucket}/${coord.page} DELETE failed: ${response.status}`)
      }
    },
  }
}

/** A link holder: the proof header, no account, no cookies. */
export function publicIndexTransport(token: string, proof: Proof | null): IndexTransport {
  return makeTransport(
    `${getApiUrl()}/api/v1/f/${encodeURIComponent(token)}/search-index/shards`,
    () => {
      const headers: Record<string, string> = {}
      if (proof) headers['x-folder-link-proof'] = proof.proof
      return headers
    },
    'omit',
  )
}

/** The folder's owner: the account session. */
export function ownerIndexTransport(folderId: string): IndexTransport {
  return makeTransport(
    `${getApiUrl()}/api/v1/shared-folders/${encodeURIComponent(folderId)}/search-index/shards`,
    () => {
      const headers: Record<string, string> = {}
      const token = getToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      return headers
    },
    'include',
  )
}
