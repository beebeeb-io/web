import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import pkg from './package.json' with { type: 'json' }

/**
 * Inject a `<link rel="preload" as="fetch" type="application/wasm" crossorigin>`
 * tag into index.html for the hashed beebeeb-wasm binary emitted by Vite. The
 * browser starts fetching the WASM in parallel with JS parse, so by the time
 * `crypto.worker.ts` calls `fetch(wasmUrl, { integrity })` the bytes are
 * already in the HTTP cache. Integrity verification still runs at runtime —
 * preload only warms the cache, it does not bypass SRI.
 */
function preloadWasmPlugin(): Plugin {
  return {
    name: 'beebeeb-preload-wasm',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const wasmAsset = Object.keys(ctx.bundle ?? {}).find((name) =>
          /^assets\/beebeeb_wasm_bg.*\.wasm$/.test(name),
        )
        if (!wasmAsset) return html
        const tag = `<link rel="preload" as="fetch" type="application/wasm" crossorigin href="/${wasmAsset}">`
        return html.replace('</head>', `    ${tag}\n  </head>`)
      },
    },
  }
}

/**
 * The meta CSP in index.html is written for production (only api.beebeeb.io
 * is allowed in connect-src). In dev the API lives on http://localhost:3001
 * and the Vite client uses ws://localhost:5173, both of which the prod CSP
 * blocks. This plugin rewrites the meta tag in dev so fetch/WebSocket calls
 * to localhost work. Prod builds are unchanged.
 */
function devCspPlugin(): Plugin {
  return {
    name: 'beebeeb-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(connect-src [^;]*?)(;)/,
        '$1 http://localhost:3001 ws://localhost:3001 ws://localhost:5173 http://localhost:5173$2',
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), preloadWasmPlugin(), devCspPlugin()],
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    fs: { allow: ['.', '/wasm-pkg', '../core'] },
  },
})
