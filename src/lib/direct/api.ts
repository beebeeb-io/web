import { ApiError, getToken, provenanceHeaders, expectedUserHeaders } from '@beebeeb/shared'
import { fireSessionExpired } from '../../../packages/shared/src/api/notifiers'
import type { DirectSession } from './session'

export function assertSession(s: DirectSession, signal: AbortSignal): void {
  signal.throwIfAborted()
  if (!s.current()) throw new DOMException('Session changed', 'AbortError')
}

export async function readBounded(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Direct response exceeds its bound')
      parts.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}

export async function directApi(s: DirectSession, path: string, call: string, signal: AbortSignal, body?: unknown) {
  assertSession(s, signal)
  const constants = s.wasm.directTransferConstants()
  const control = new AbortController()
  const combined = AbortSignal.any([signal, s.controller.signal, control.signal])
  const timer = setTimeout(() => control.abort(), call === 'discovery' ? constants.discovery_timeout_ms : constants.api_call_timeout_ms)
  const headers: Record<string, string> = { ...provenanceHeaders() }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; Object.assign(headers, expectedUserHeaders()) }
  if (call === 'download_grant') headers[constants.capabilities_header] = constants.cap_object_download_v1
  try {
    const response = await fetch(`${s.apiBase}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers, credentials: 'include', signal: combined,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    // Every response bound is core's; no caller picks its own ceiling.
    const bound = call === 'discovery' ? constants.max_discovery_body_bytes
      : call === 'download_grant' ? constants.max_grant_body_bytes : constants.max_chunk_body_bytes
    const bytes = await readBounded(response, bound)
    assertSession(s, signal)
    const outcome = s.wasm.classifyDirectAnswer(call, response.status, response.headers.get('Content-Type'), bytes, response.headers.get('Retry-After'))
    if (outcome.kind === 'terminal') {
      if (outcome.status === 401) fireSessionExpired()
      throw new ApiError('Download authorization refused', outcome.status)
    }
    return { status: response.status, bytes, outcome }
  } catch (error) {
    assertSession(s, signal)
    if (error instanceof ApiError) throw error
    return { status: 0, bytes: new Uint8Array(), outcome: s.wasm.classifyDirectAnswer(call, 0, undefined, new Uint8Array(), undefined) }
  } finally { clearTimeout(timer) }
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, Math.max(0, ms))
    signal.addEventListener('abort', abort, { once: true })
  })
}
