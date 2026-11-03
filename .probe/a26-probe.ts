import { loadWasm } from '../test/helpers/wasm-crypto-mirror'
const wasm = loadWasm()
const master = new Uint8Array(32).fill(7)
const id = '11111111-1111-4111-8111-111111111111'
for (const name of ['Holiday', 'notes.pdf', '']) {
  try {
    const r = wasm.resolveOwnedKey(master, id, 2, null, name)
    console.log(JSON.stringify({ name, origin: r.origin, resolvedName: r.name, keyLen: r.key?.length }))
  } catch (e) {
    console.log(JSON.stringify({ name, error: String(e).slice(0, 240) }))
  }
}
// Also a genuinely sealed name for comparison.
const sealed = wasm.encryptMetadata ? 'x' : 'x'
