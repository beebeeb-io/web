import { readError } from './api-read-error'
import { ApiError, getToken, readErrorResponse } from '@beebeeb/shared'
import type { JoinTransferResponse, TransferProof, TransferStatus } from '@beebeeb/shared'
import { API_URL } from './api-session'

// (moved to ./api-vault-escrow)
// ─── Abuse reports ──────────────────────────────

export async function reportShareLink(
  shareToken: string,
  reason: string,
): Promise<{ id: string }> {
  // Public endpoint — no auth header needed
  const res = await fetch(`${API_URL}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_token: shareToken, reason }),
  })

  if (!res.ok) {
    const { body, fallbackMessage } = await readErrorResponse(res)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
    )
  }

  return res.json() as Promise<{ id: string }>
}

/**
 * POST /api/v1/transfer/{session_id}/join — receiver joins a known session.
 * Used when the receiver has the session_id directly (e.g. from a scanned
 * constellation). For 6-digit code entry, use joinTransferByCode.
 */
export async function joinTransfer(
  sessionId: string,
  receiverPk: string,
): Promise<JoinTransferResponse> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_pk: receiverPk }),
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<JoinTransferResponse>
}

/**
 * POST /api/v1/transfer/join-by-code — receiver joins by the 6-digit
 * fallback code shown on the sender's screen. The server resolves the
 * code to an active session and returns the same shape as joinTransfer
 * with the resolved session_id added.
 */
export async function joinTransferByCode(
  code: string,
  receiverPk: string,
): Promise<JoinTransferResponse & { session_id: string }> {
  const res = await fetch(`${API_URL}/api/v1/transfer/join-by-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fallback_code: code, receiver_pk: receiverPk }),
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<JoinTransferResponse & { session_id: string }>
}

/**
 * GET /api/v1/transfer/{id}/status — receiver polls for sender approval +
 * upload completion. Authenticated with the per-session download_token.
 */
export async function getTransferStatus(
  sessionId: string,
  token: string,
): Promise<TransferStatus> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/status`, {
    method: 'GET',
    headers: { 'X-Transfer-Token': token },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<TransferStatus>
}

/**
 * GET /api/v1/transfer/{id}/blob — receiver downloads the encrypted blob.
 * Returns the raw bytes as a Blob (nonce-prefixed AES-GCM ciphertext).
 */
export async function downloadTransferBlob(
  sessionId: string,
  token: string,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/blob`, {
    method: 'GET',
    headers: { 'X-Transfer-Token': token },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.blob()
}

/**
 * POST /api/v1/transfer/{id}/ack — receiver confirms successful decrypt.
 * Triggers server-side blob deletion and marks the session complete.
 */
export async function ackTransfer(sessionId: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/ack`, {
    method: 'POST',
    headers: { 'X-Transfer-Token': token, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
}

/**
 * POST /api/v1/transfer/{id}/proof — create a tamper-evident transfer receipt.
 * Called by the sender after ACK. sha256Hash is computed client-side over the
 * decrypted file bytes. Bearer auth required.
 */
export async function createTransferProof(
  sessionId: string,
  params: {
    file_name: string
    file_size_bytes: number
    sha256_hash: string
    receiver_display_name?: string
  },
): Promise<TransferProof> {
  const token = getToken()
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/proof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    // task 0447 — authenticated proof creation; ship the cookie.
    credentials: 'include',
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<TransferProof>
}
