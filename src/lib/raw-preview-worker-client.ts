// Lazily spawns the RAW-preview extraction worker (task 1574) and reuses it
// for the lifetime of the tab — same singleton-spawn pattern as
// `crypto.ts`'s `spawnWorker`, minus the memory-cap restart logic (this
// worker does no long-lived WASM allocation; ordinary JS heap it can GC
// between calls).
import * as Comlink from 'comlink'
import type { RawPreviewWorker, RawWorkerResult } from '../workers/raw-preview.worker'

let proxy: Comlink.Remote<RawPreviewWorker> | null = null

function getProxy(): Comlink.Remote<RawPreviewWorker> {
  if (!proxy) {
    const worker = new Worker(new URL('../workers/raw-preview.worker.ts', import.meta.url), { type: 'module' })
    proxy = Comlink.wrap<RawPreviewWorker>(worker)
  }
  return proxy
}

export async function extractRawPreview(blob: Blob): Promise<RawWorkerResult> {
  return getProxy().extractRawPreview(blob)
}
