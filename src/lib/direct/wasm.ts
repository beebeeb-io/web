import type * as Wasm from 'beebeeb-wasm'
let loading: Promise<typeof Wasm> | undefined
/** This instance holds transport state only. Keys and decryption stay in the crypto worker. */
export function directWasm(): Promise<typeof Wasm> {
  return loading ??= (async () => {
    const mod = await import('beebeeb-wasm')
    const { default: url } = await import('beebeeb-wasm/beebeeb_wasm_bg.wasm?url')
    if (import.meta.env.PROD) {
      const manifest = await fetch('/wasm-sri.json')
      if (!manifest.ok) throw new Error('WASM integrity manifest unavailable')
      const { integrity } = await manifest.json() as { integrity?: string }
      if (!integrity) throw new Error('WASM integrity hash unavailable')
      const res = await fetch(url, { integrity, credentials: 'same-origin' })
      if (!res.ok) throw new Error('WASM unavailable')
      await mod.default({ module_or_path: await res.arrayBuffer() })
    } else await mod.default({ module_or_path: url })
    return mod
  })().catch(() => { loading = undefined; throw new Error('Direct transport initialization failed') })
}
