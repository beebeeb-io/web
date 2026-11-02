import type { WasmSignedUrl } from 'beebeeb-wasm'
import type * as Wasm from 'beebeeb-wasm'
import { directWasm } from './wasm'

/** What the storage GET delivered: core classifies the head and the counted bytes. */
export interface StorageAnswer {
  /** HTTP status; `0` means there was no HTTP answer at all. */
  status: number
  contentLength: number | null
  /** Bytes actually counted; `0` when the head was refused and the body was not read. */
  received: number
  body?: Uint8Array
}

/** No exception containing the signed URL crosses this boundary. */
export async function storageGet(url: WasmSignedUrl, length: number, signal: AbortSignal, wasm?: typeof Wasm): Promise<StorageAnswer> {
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
    const declared = res.headers.get('Content-Length')
    const contentLength = declared === null ? null : Number(declared)
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel().catch(() => {})
      return { status: res.status, contentLength, received: 0 }
    }
    if (contentLength !== length) {
      await res.body.cancel().catch(() => {})
      return { status: res.status, contentLength, received: 0 }
    }
    reader = res.body.getReader()
    const body = new Uint8Array(length)
    let received = 0
    for (;;) {
      idle = setTimeout(() => control.abort(), constants.storage_get_idle_ms)
      const { done, value } = await reader.read()
      clearTimeout(idle)
      if (done) break
      // Stop counting as soon as the body passes the grant: the extra bytes are never kept.
      if (received + value.byteLength > length) { received += value.byteLength; break }
      body.set(value, received); received += value.byteLength
    }
    return received === length
      ? { status: 200, contentLength, received, body }
      : { status: 200, contentLength, received }
  } catch { return { status: 0, contentLength: null, received: 0 } }
  finally {
    clearTimeout(total); clearTimeout(idle)
    control.abort()
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
