// Streaming-to-disk machinery for encrypted downloads.
//
// Extracted from src/lib/encrypted-download.ts so the browser streaming
// save path (service-worker registration, transferable streams, and the
// decrypt-as-you-go writer) can be maintained independently.

import { pipeDecryptedChunks } from '../encrypted-download'
import type { DownloadTarget, EncryptedDownloadOptions } from '../encrypted-download'

/** True when we believe the streaming path is safe to use. */
export function canStreamToDisk(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (typeof ReadableStream === 'undefined') return false
  if (typeof TransformStream === 'undefined') return false
  // ReadableStream must be transferable via postMessage. Detect heuristically:
  // browsers that support it expose a structured-clone-safe transfer when the
  // ReadableStream is listed in the `transfer` array. We can't probe without
  // actually trying, so we run a tiny self-test once and cache the result.
  return _transferableStreamProbe()
}

let _streamSupportCached: boolean | null = null
function _transferableStreamProbe(): boolean {
  if (_streamSupportCached !== null) return _streamSupportCached
  try {
    const rs = new ReadableStream()
    // structuredClone with transfer is the cleanest probe and avoids a
    // round-trip to the SW.
    structuredClone(rs, { transfer: [rs] })
    _streamSupportCached = true
  } catch {
    _streamSupportCached = false
  }
  return _streamSupportCached
}

/** Resolve to the controlling service worker, waiting briefly if needed. */
export async function awaitController(timeoutMs = 1500): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller
  // The SW may be installing on first visit; give it a moment to take control.
  return new Promise<ServiceWorker | null>(resolve => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(navigator.serviceWorker.controller)
    }, timeoutMs)
    const onChange = () => {
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(navigator.serviceWorker.controller)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
  })
}

/**
 * Trigger a same-origin navigation to `url` in an invisible iframe so the
 * browser's download manager picks up the response without leaving the page.
 */
function triggerHiddenDownload(url: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  // Most browsers reject the navigation once Content-Disposition is parsed,
  // freeing the iframe. We still remove it after a delay as a safety net.
  setTimeout(() => {
    try { iframe.remove() } catch {}
  }, 30_000)
  return iframe
}

interface StreamingDownloadHandles {
  writer: WritableStreamDefaultWriter<Uint8Array>
  abort(reason?: unknown): Promise<void>
  close(): Promise<void>
}

/**
 * Register a streaming download with the service worker and open the
 * download URL. Returns a writer the caller can pipe decrypted bytes into.
 */
async function startStreamingDownload(
  id: string,
  filename: string,
  mimeType: string,
  totalSize: number | null,
  controller: ServiceWorker,
): Promise<StreamingDownloadHandles> {
  const ts = new TransformStream<Uint8Array, Uint8Array>()
  const readable = ts.readable
  const writer = ts.writable.getWriter()

  // Wait for the SW to ack registration before we trigger the download URL.
  await new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d !== 'object' || d.id !== id) return
      if (d.type === 'download-registered') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve()
      } else if (d.type === 'download-error') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        reject(new Error(typeof d.error === 'string' ? d.error : 'SW download error'))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    try {
      controller.postMessage(
        {
          type: 'register-download',
          id,
          filename,
          mimeType,
          totalSize,
          stream: readable,
        },
        // Transfer the readable side to the SW.
        [readable as unknown as Transferable],
      )
    } catch (err) {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      reject(err)
    }
    // Safety timeout — SW should ack within a few ms.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve()
    }, 2_000)
  })

  // Now navigate to the SW-served URL.
  triggerHiddenDownload(`/sw-download/${id}`)

  return {
    writer,
    async abort(reason?: unknown) {
      try { await writer.abort(reason) } catch {}
      try { controller.postMessage({ type: 'abort-download', id }) } catch {}
    },
    async close() {
      try { await writer.close() } catch {}
    },
  }
}

/** Decrypt while the body arrives; each part goes straight to the SW-backed save. */
export async function streamTargetToDisk(
  target: DownloadTarget,
  body: ReadableStream<Uint8Array>,
  fileKey: Uint8Array,
  controller: ServiceWorker,
  opts?: EncryptedDownloadOptions,
): Promise<void> {
  let handles: StreamingDownloadHandles | null = null
  try {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    handles = await startStreamingDownload(id, target.filename, target.mime, target.plaintextSize, controller)
    const writer = handles.writer

    const onAbortHandler = () => {
      void handles?.abort(opts?.signal?.reason ?? 'aborted')
    }
    if (opts?.signal) opts.signal.addEventListener('abort', onAbortHandler, { once: true })

    try {
      if (target.direct) {
        let written = 0
        await body.pipeTo(new WritableStream<Uint8Array>({
          async write(chunk) {
            await writer.write(chunk)
            written += chunk.length
            opts?.onProgress?.(written, target.plaintextSize)
          },
        }), { signal: opts?.signal })
      } else await pipeDecryptedChunks(
        body,
        fileKey,
        target.meta.content,
        target.chunkCount,
        target.plaintextSize,
        target.chunkSize,
        opts?.signal,
        async chunk => { await writer.write(chunk) },
        opts?.onProgress
          ? (written: number) => opts.onProgress!(written, target.plaintextSize)
          : undefined,
        opts?.masterKey,
      )
      await handles.close()
    } finally {
      if (opts?.signal) opts.signal.removeEventListener('abort', onAbortHandler)
    }
  } catch (err) {
    // Stream path failed (registration, transfer, network, abort, ...).
    // Tear down the partial download and propagate the error so callers
    // see the same contract regardless of which path was taken.
    try { await handles?.abort(err) } catch {}
    await body.cancel().catch(() => {})
    throw err
  }
}
