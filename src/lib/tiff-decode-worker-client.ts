// Lazily spawns the TIFF-decode worker (task 1574) and reuses it for the
// lifetime of the tab — same singleton-spawn pattern as
// `raw-preview-worker-client.ts` / `crypto.ts`'s `spawnWorker`.
import * as Comlink from 'comlink'
import type { TiffDecodeWorker } from '../workers/tiff-decode.worker'

let proxy: Comlink.Remote<TiffDecodeWorker> | null = null

function getProxy(): Comlink.Remote<TiffDecodeWorker> {
  if (!proxy) {
    const worker = new Worker(new URL('../workers/tiff-decode.worker.ts', import.meta.url), { type: 'module' })
    proxy = Comlink.wrap<TiffDecodeWorker>(worker)
  }
  return proxy
}

/**
 * Returns the decoded PNG blob, or `null` on failure — logging the worker's
 * own diagnostic reason to the console first (dedicated-worker
 * `console.error` calls are not visible outside the worker itself, so this
 * is the one place that failure reason becomes observable at all).
 */
export async function decodeTiffToPng(blob: Blob): Promise<Blob | null> {
  const result = await getProxy().decodeTiffToPng(blob)
  if (!result.blob) {
    console.error('[tiff-decode] failed:', result.error ?? '(no reason given)')
    return null
  }
  return result.blob
}
