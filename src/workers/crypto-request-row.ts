/**
 * §15 (2326 = A): request-row content readers, as the crypto worker exposes
 * them. A reader core produced stays in the worker behind a handle; the page
 * only ever asks for a fresh decryptor or opens one frame at an index.
 *
 * Extracted from crypto.worker.ts to stay under the file-size ratchet; the
 * worker spreads these in, so the Comlink surface is unchanged.
 */
import * as Comlink from 'comlink'
import type { ContentOps } from '../lib/content-crypto'

export interface RequestRowWorkerOps {
  requestReaderDecryptor(readerHandle: number): Promise<number>
  requestReaderOpenFrame(
    readerHandle: number,
    versionId: Uint8Array,
    index: number,
    isLast: boolean,
    format: number,
    frame: Uint8Array,
  ): Promise<Uint8Array>
  requestReaderFree(readerHandle: number): Promise<void>
}

export function requestRowWorkerOps(content: () => Promise<ContentOps>): RequestRowWorkerOps {
  return {
    /** A fresh sequential decryptor over a request row's reader (chunk 0). */
    async requestReaderDecryptor(readerHandle) {
      return (await content()).requestReaderDecryptor(readerHandle)
    },

    /** Open ONE frame of a request row at its own index (seek / range). */
    async requestReaderOpenFrame(readerHandle, versionId, index, isLast, format, frame) {
      const plaintext = (await content()).requestReaderOpenFrame(
        readerHandle,
        versionId,
        index,
        isLast,
        format,
        frame,
      )
      return Comlink.transfer(plaintext, [plaintext.buffer])
    },

    /** Free a request reader. Idempotent. */
    async requestReaderFree(readerHandle) {
      ;(await content()).requestReaderFree(readerHandle)
    },
  }
}
