import type * as Wasm from 'beebeeb-wasm'
import { getApiUrl, getAuthStamp, isCurrentAuthStamp } from '@beebeeb/shared'
import { directWasm } from './wasm'

export interface DirectSession {
  wasm: typeof Wasm
  apiBase: string
  cache: Wasm.WasmDirectDiscoveryCache
  health: Wasm.WasmDirectHealth
  controller: AbortController
  current(): boolean
  discoveryPending?: Promise<unknown>
}
let session: DirectSession | undefined

export function resetDirectSession(): void {
  if (!session) return
  session.controller.abort()
  // In-flight drivers own references to health/cache until their finally blocks finish.
  session = undefined
}

export async function getDirectSession(): Promise<DirectSession> {
  if (session && (!session.current() || session.apiBase !== getApiUrl())) resetDirectSession()
  if (session) return session
  const stamp = getAuthStamp()
  const apiBase = getApiUrl()
  const wasm = await directWasm()
  if (!isCurrentAuthStamp(stamp) || apiBase !== getApiUrl()) throw new DOMException('Session changed', 'AbortError')
  if (session) return session
  const controller = new AbortController()
  session = {
    wasm, apiBase, controller,
    cache: new wasm.WasmDirectDiscoveryCache(), health: new wasm.WasmDirectHealth(),
    current: () => !controller.signal.aborted && isCurrentAuthStamp(stamp) && getApiUrl() === apiBase,
  }
  return session
}
