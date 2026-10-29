/**
 * Reading the answer of `POST /api/v1/auth/cli-authorize` (task 1734).
 *
 * Kept apart from `cli-auth-api.ts` so it can be unit-tested without the whole
 * API client. See `authorizeCliRelay` for why this one call reads its body
 * itself instead of going through the shared `request()`.
 */

import { ApiError } from '@beebeeb/shared'

/** Interpret the relay's response: ok + empty body (old server) or ok + JSON is success. */
export async function readRelayResponse(res: Response): Promise<void> {
  const text = await res.text()
  if (!res.ok) {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      /* a non-JSON error body: fall back to the status text below */
    }
    const message = (parsed.message ?? parsed.error ?? (text || res.statusText)) as string
    const code = typeof parsed.error === 'string' ? parsed.error : undefined
    throw new ApiError(message, res.status, code)
  }
  if (text === '') return
  JSON.parse(text) // a malformed 2xx body is an error, not a success
}
