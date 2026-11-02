// One initialisation for core's share-link grammar (`beebeeb-wasm`).
//
// The builder and the key decoder are synchronous — the share dialog renders a
// full link and the share view decodes a pasted key inside render — so the wasm
// module has to be in memory before they run. `main.tsx` awaits this once
// before the first render; importing any share-link module also kicks it off.

import init from 'beebeeb-wasm'

let wasmReady: Promise<void> | null = null

/** Load the wasm module once; every caller after the first reuses it. */
export function ensureShareLinkWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = init().then(
      () => undefined,
      (error: unknown) => {
        wasmReady = null
        throw error
      },
    )
  }
  return wasmReady
}

void ensureShareLinkWasm().catch(() => {
  /* a consumer that never renders a share link does not need it */
})
