/**
 * Task 2237b — the anonymous folder-link client.
 *
 * Every guest-visible route is here. Two rules this module owns:
 *  - the proof header is attached ONLY through `proofHeaders`, and
 *  - a 404 from any route becomes `FolderNotAvailableError`, so callers branch
 *    on the class instead of on a message string.
 */
import { API_URL, ApiError } from './api'
import type {
  Proof,
  PublicFolderItem,
  PublicFolderPage,
  PublicFolderRoot,
  PublicFolderVerify,
} from './folder-link-types'

export class FolderNotAvailableError extends ApiError {
  constructor(message = 'This link is not available.') {
    super(message, 404)
    this.name = 'FolderNotAvailableError'
  }
}

/** A 200 whose body does not carry the fields the page needs. */
export class FolderShapeError extends ApiError {
  constructor(message = 'The link response was not in the expected shape.') {
    super(message, 502)
    this.name = 'FolderShapeError'
  }
}

const PROOF_KEY_PREFIX = 'beebeeb.folderLink.proof.'
export const FOLDER_LINK_PAGE_LIMIT = 200
export const FOLDER_LINK_MAX_LIMIT = 500

export function readProof(token: string): Proof | null {
  try {
    const raw = sessionStorage.getItem(PROOF_KEY_PREFIX + token)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Proof>
    if (
      typeof parsed.proof !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt < Date.now()
    ) {
      return null
    }
    return { token, proof: parsed.proof, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

export function storeProof(token: string, proof: string, proofExpiresAt: string): Proof {
  const expiresAt = Date.parse(proofExpiresAt)
  const value: Proof = { token, proof, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 }
  try {
    sessionStorage.setItem(PROOF_KEY_PREFIX + token, JSON.stringify({ proof, expiresAt: value.expiresAt }))
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still works.
  }
  return value
}

export function clearProof(token: string): void {
  try {
    sessionStorage.removeItem(PROOF_KEY_PREFIX + token)
  } catch {
    // ignore
  }
}

function proofHeaders(proof: Proof | null | undefined): Record<string, string> {
  return proof ? { 'x-folder-link-proof': proof.proof } : {}
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: string | undefined
  let message = response.statusText || 'Request failed'
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string') code = body.error
    if (typeof body.message === 'string') message = body.message
  } catch {
    // Non-JSON body: keep the status text.
  }
  if (response.status === 404) return new FolderNotAvailableError(message)
  return new ApiError(message, response.status, code)
}

async function guestJson<T>(
  token: string,
  path: string,
  init: RequestInit & { proof?: Proof | null } = {},
): Promise<T> {
  const { proof, ...rest } = init
  const response = await fetch(`${API_URL}/api/v1/f/${encodeURIComponent(token)}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...proofHeaders(proof),
      ...(rest.headers as Record<string, string> | undefined),
    },
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

export async function resolveFolderLink(
  token: string,
  proof?: Proof | null,
): Promise<{ kind: 'ok'; root: PublicFolderRoot } | { kind: 'passphrase_required' }> {
  const body = await guestJson<PublicFolderRoot & { passphrase_required?: boolean }>(
    token,
    '',
    { proof },
  )
  if (body.passphrase_required === true) return { kind: 'passphrase_required' }
  if (typeof body.wrapped_folder_key !== 'string' || body.wrapped_folder_key.length === 0) {
    throw new FolderShapeError()
  }
  return { kind: 'ok', root: body }
}

export async function verifyFolderLinkPassphrase(
  token: string,
  passphrase: string,
): Promise<PublicFolderVerify> {
  return guestJson<PublicFolderVerify>(token, '/verify', {
    method: 'POST',
    body: JSON.stringify({ passphrase }),
  })
}

export async function listFolderItems(
  token: string,
  params: { parentId: string | null; cursor?: string | null; limit?: number },
  proof?: Proof | null,
): Promise<PublicFolderPage> {
  const limit = params.limit ?? FOLDER_LINK_PAGE_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > FOLDER_LINK_MAX_LIMIT) {
    throw new ApiError(
      `limit must be between 1 and ${FOLDER_LINK_MAX_LIMIT}`,
      400,
      'invalid_limit',
    )
  }
  const query = new URLSearchParams()
  query.set('parent_id', params.parentId ?? '')
  query.set('limit', String(limit))
  if (params.cursor) query.set('cursor', params.cursor)
  return guestJson<PublicFolderPage>(token, `/items?${query.toString()}`, { proof })
}

/** Page through a folder until `maxItems` or the last page. */
export async function fetchAllFolderItems(
  token: string,
  parentId: string | null,
  proof: Proof | null,
  maxItems: number,
): Promise<PublicFolderItem[]> {
  const items: PublicFolderItem[] = []
  let cursor: string | null = null
  do {
    const page = await listFolderItems(
      token,
      { parentId, cursor, limit: FOLDER_LINK_PAGE_LIMIT },
      proof,
    )
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor && items.length < maxItems)
  return items.slice(0, maxItems)
}

export async function fetchFolderItemBytes(
  token: string,
  itemId: string,
  proof: Proof | null,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(
    `${API_URL}/api/v1/f/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/download`,
    { headers: proofHeaders(proof), signal },
  )
  if (!response.ok) throw await toApiError(response)
  if (!response.body) throw new FolderShapeError('The download response had no body.')
  return response.body
}

export async function fetchFolderThumbnail(
  token: string,
  itemId: string,
  proof: Proof | null,
  variant: 'small' | 'large' = 'small',
): Promise<Uint8Array | null> {
  const response = await fetch(
    `${API_URL}/api/v1/f/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/thumbnail?variant=${variant}`,
    { headers: proofHeaders(proof) },
  )
  if (response.status === 404) return null
  if (!response.ok) throw await toApiError(response)
  return new Uint8Array(await response.arrayBuffer())
}

export async function createGuestFolder(
  token: string,
  body: {
    parent_id: string | null
    name_encrypted: string
    wrapped_name_key: string
    actor_name_encrypted?: string | null
  },
  proof: Proof | null,
): Promise<{ id: string; parent_id: string | null; name_encrypted: string }> {
  return guestJson(token, '/folders', { method: 'POST', body: JSON.stringify(body), proof })
}

export async function patchGuestItem(
  token: string,
  itemId: string,
  body: {
    name_encrypted?: string
    parent_id?: string | null
    actor_name_encrypted?: string | null
  },
  proof: Proof | null,
): Promise<{ id: string; name_encrypted: string; parent_id: string | null; updated_at: string }> {
  return guestJson(token, `/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    proof,
  })
}

export async function deleteGuestItem(
  token: string,
  itemId: string,
  actorNameEncrypted: string | null,
  proof: Proof | null,
): Promise<{ trashed: number }> {
  return guestJson(token, `/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_name_encrypted: actorNameEncrypted }),
    proof,
  })
}
