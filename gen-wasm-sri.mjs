#!/usr/bin/env node
/**
 * gen-wasm-sri.mjs — post-build script that computes a SHA-384 subresource
 * integrity hash for the WASM binary emitted by `vite build` and writes a
 * small manifest to dist/wasm-sri.json.
 *
 * The manifest is fetched at runtime by crypto.worker.ts, which then uses
 * fetch(wasmUrl, { integrity }) so the browser enforces the hash before the
 * WASM module initialises.
 *
 * Run automatically as part of `bun run build`:
 *   tsc --noEmit && vite build && node gen-wasm-sri.mjs
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, 'dist', 'assets')

let files
try {
  files = await readdir(assetsDir)
} catch {
  console.error('[gen-wasm-sri] dist/assets/ not found — run vite build first.')
  process.exit(1)
}

const wasmFile = files.find(f => /^beebeeb_wasm_bg.*\.wasm$/.test(f))
if (!wasmFile) {
  console.error('[gen-wasm-sri] beebeeb_wasm_bg*.wasm not found in dist/assets/')
  console.error('[gen-wasm-sri] Found:', files.filter(f => f.endsWith('.wasm')))
  process.exit(1)
}

const wasmBytes = await readFile(join(assetsDir, wasmFile))
const hash = createHash('sha384').update(wasmBytes).digest('base64')
const integrity = `sha384-${hash}`

const manifest = {
  integrity,
  file: wasmFile,
  generated: new Date().toISOString(),
}

const outPath = join(__dirname, 'dist', 'wasm-sri.json')
await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`[gen-wasm-sri] ${wasmFile}`)
console.log(`[gen-wasm-sri] integrity: ${integrity}`)
console.log(`[gen-wasm-sri] → dist/wasm-sri.json`)
