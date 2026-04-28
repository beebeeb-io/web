import { getToken, getApiUrl } from './api'
// crypto imports unused -- search index uses Web Crypto API directly

export interface SearchIndexEntry {
  name: string
  path: string
  type: string
  size: number
  parent: string | null
  starred: boolean
  created: string
  modified: string
  tags: string[]
}

export interface SearchIndex {
  version: number
  updated_at: string
  files: Record<string, SearchIndexEntry>
}

const INDEX_KEY_INFO = 'beebeeb-search-index'

async function deriveIndexKey(masterKey: Uint8Array): Promise<Uint8Array> {
  const { subtle } = globalThis.crypto
  const baseKey = await subtle.importKey('raw', masterKey.buffer as ArrayBuffer, 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(INDEX_KEY_INFO) },
    baseKey,
    256,
  )
  return new Uint8Array(bits)
}

async function encryptIndex(index: SearchIndex, masterKey: Uint8Array): Promise<Uint8Array> {
  const indexKey = await deriveIndexKey(masterKey)
  const json = JSON.stringify(index)
  const plaintext = new TextEncoder().encode(json)

  const { subtle } = globalThis.crypto
  const key = await subtle.importKey('raw', indexKey.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt'])
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)

  const result = new Uint8Array(12 + ciphertext.byteLength)
  result.set(nonce, 0)
  result.set(new Uint8Array(ciphertext), 12)
  return result
}

async function decryptIndex(data: Uint8Array, masterKey: Uint8Array): Promise<SearchIndex> {
  const indexKey = await deriveIndexKey(masterKey)
  const nonce = data.slice(0, 12)
  const ciphertext = data.slice(12)

  const { subtle } = globalThis.crypto
  const key = await subtle.importKey('raw', indexKey.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt'])
  const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext)

  const json = new TextDecoder().decode(plaintext)
  return JSON.parse(json) as SearchIndex
}

export async function fetchIndex(masterKey: Uint8Array): Promise<SearchIndex | null> {
  const token = getToken()
  if (!token) return null

  const res = await fetch(`${getApiUrl()}/api/v1/index`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (res.status === 404) return null
  if (!res.ok) return null

  const blob = new Uint8Array(await res.arrayBuffer())
  return decryptIndex(blob, masterKey)
}

export async function saveIndex(index: SearchIndex, masterKey: Uint8Array, etag?: string): Promise<string | null> {
  const token = getToken()
  if (!token) return null

  const encrypted = await encryptIndex(index, masterKey)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
  }
  if (etag) headers['If-Match'] = etag

  const res = await fetch(`${getApiUrl()}/api/v1/index`, {
    method: 'PUT',
    headers,
    body: encrypted.buffer as ArrayBuffer,
  })

  if (!res.ok) return null
  return res.headers.get('ETag')
}

export function createEmptyIndex(): SearchIndex {
  return { version: 1, updated_at: new Date().toISOString(), files: {} }
}

export function updateIndexEntry(
  index: SearchIndex,
  fileId: string,
  entry: SearchIndexEntry,
): SearchIndex {
  return {
    ...index,
    updated_at: new Date().toISOString(),
    files: { ...index.files, [fileId]: entry },
  }
}

export function removeIndexEntry(index: SearchIndex, fileId: string): SearchIndex {
  const { [fileId]: _, ...rest } = index.files
  return { ...index, updated_at: new Date().toISOString(), files: rest }
}

export interface SearchResult {
  id: string
  entry: SearchIndexEntry
  score: number
}

export function searchIndex(index: SearchIndex, query: string): SearchResult[] {
  if (!query.trim()) return []

  const lower = query.toLowerCase()
  const terms = lower.split(/\s+/)

  return Object.entries(index.files)
    .map(([id, entry]) => {
      let score = 0
      const name = entry.name.toLowerCase()
      const path = entry.path.toLowerCase()

      for (const term of terms) {
        if (name === term) score += 10
        else if (name.startsWith(term)) score += 5
        else if (name.includes(term)) score += 3
        else if (path.includes(term)) score += 1
        else if (entry.tags.some((t) => t.toLowerCase().includes(term))) score += 2
      }

      return { id, entry, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}
