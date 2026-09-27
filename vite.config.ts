import { defineConfig, loadEnv, type Plugin } from 'vite'
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
function devCspPlugin(apiUrl: string): Plugin {
  // Allow the configured dev/e2e API origin (default :3001, but :3003 etc. for
  // an isolated e2e backend) plus its websocket scheme and the Vite HMR socket.
  const wsApi = apiUrl.replace(/^http/, 'ws')
  const allow = `${apiUrl} ${wsApi} ws://localhost:5173 http://localhost:5173`
  return {
    name: 'beebeeb-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/(connect-src [^;]*?)(;)/, `$1 ${allow}$2`)
    },
  }
}

/**
 * Route-scoped Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy for
 * the office editor (task 1567) in `bun dev` — the same isolation nginx.conf
 * applies in prod, under `/office/*` only. LibreOffice-WASM's pthread build
 * needs `crossOriginIsolated === true` for SharedArrayBuffer
 * (repos/office/docs/PHASE2-RESULTS.md); applying it site-wide would isolate
 * every OTHER route too, breaking any future cross-origin embed elsewhere in
 * the app. Registered directly on `server.middlewares` (not returned from
 * `configureServer`'s post-hook) so it runs BEFORE Vite's own static-file
 * middleware serves the `public/office/...` bytes — headers set on the
 * response object here are still present when that later middleware calls
 * `res.end()`.
 *
 * This SAME prefix also covers the office editor's own SPA route,
 * `/office/:fileId` (office-editor-page.tsx, task 1567) — client-rendered,
 * served through Vite's history-fallback like any other app route, but under
 * `/office/`, so it inherits these headers automatically. That is load-
 * bearing, not incidental: a nested iframe only becomes `crossOriginIsolated`
 * when its ENTIRE ancestor chain, including the top-level document, also
 * carries COOP+COEP — verified empirically against a real Chromium build
 * while building this (a plain iframe nested in the ordinary Drive page
 * measured `crossOriginIsolated === false` inside the iframe every time).
 * `/office/:fileId` is deliberately this route's own isolated top-level
 * document; every other app route stays uninstrumented, per PLAN.md.
 */
function officeIsolationHeadersPlugin(): Plugin {
  return {
    name: 'beebeeb-office-isolation-headers',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/office/')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
        }
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = env.VITE_API_URL || 'http://localhost:3001'
  return {
    plugins: [react(), tailwindcss(), wasm(), preloadWasmPlugin(), devCspPlugin(apiUrl), officeIsolationHeadersPlugin()],
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
  }
})
