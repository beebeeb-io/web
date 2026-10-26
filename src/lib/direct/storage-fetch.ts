import type { WasmSignedUrl } from 'beebeeb-wasm'
import type * as Wasm from 'beebeeb-wasm'
import { directWasm } from './wasm'

/** No exception containing the signed URL crosses this boundary. */
export async function storageGet(url: WasmSignedUrl, length: number, signal: AbortSignal, wasm?: typeof Wasm): Promise<{ status: number; body?: Uint8Array }> {
  const core = wasm ?? await directWasm()
  const constants = core.directTransferConstants()
  const control = new AbortController()
  const combined = AbortSignal.any([signal, control.signal])
  const total = setTimeout(() => control.abort(), core.storageGetTotalMs(length))
  let idle = setTimeout(() => control.abort(), constants.storage_connect_timeout_ms)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetch(url.raw(), {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      redirect: 'error', signal: combined,
    })
    clearTimeout(idle)
    if (res.status !== 200 || res.headers.get('Content-Length') !== String(length) || !res.body) {
      await res.body?.cancel().catch(() => {})
      return { status: 0 }
    }
    reader = res.body.getReader()
    const body = new Uint8Array(length)
    let offset = 0
    for (;;) {
      idle = setTimeout(() => control.abort(), constants.storage_get_idle_ms)
      const { done, value } = await reader.read()
      clearTimeout(idle)
      if (done) break
      if (offset + value.byteLength > length) return { status: 0 }
      body.set(value, offset); offset += value.byteLength
    }
    return offset === length ? { status: 200, body } : { status: 0 }
  } catch { return { status: 0 } }
  finally {
    clearTimeout(total); clearTimeout(idle)
    control.abort()
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
