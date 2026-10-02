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
 *
 * WORKER-NEEDS-ITS-OWN-COEP GOTCHA (found by actually running the e2e spec
 * against the real engine, root-caused via a raw CDP `Network.loadingFailed`
 * capture — `blockedReason: "coep-frame-resource-needs-coep-header"` — not
 * theorized): making `/office/:fileId` cross-origin-isolated does not just
 * affect the office engine's own assets — it governs how the app's own
 * PRE-EXISTING crypto worker (`src/workers/crypto.worker.ts`, needed to
 * decrypt the very file being opened) may be constructed from that page.
 * Per the HTML spec, a dedicated Worker's global has its OWN embedder
 * policy, inherited from ITS OWN response headers — a same-origin script
 * and a plain `Cross-Origin-Resource-Policy` header are NOT enough; the
 * worker script's response must ALSO carry `Cross-Origin-Embedder-Policy`
 * itself, or a COEP:require-corp creator refuses to construct it at all.
 * (An earlier attempt at this fix added only CORP — confirmed insufficient
 * by re-running against the real engine and seeing the identical block.)
 * The failure mode is a silent hang: `net::ERR_BLOCKED_BY_RESPONSE` on the
 * worker script, WasmGuard never reports crypto ready, nothing below the
 * dev banner ever renders — no console exception, no error boundary, just
 * a 15s test timeout. Fix: every response OUTSIDE `/office/*` also gets
 * `Cross-Origin-Embedder-Policy: require-corp` (harmless for anything that
 * never becomes a Window/Worker global — COEP is only consulted for those)
 * plus `Cross-Origin-Resource-Policy: cross-origin` (the permissive value —
 * it only widens who may EMBED a response, so neither header weakens
 * zero-egress, which is about outbound requests). nginx.conf's top-level
 * header block carries the identical fix for prod, with the identical
 * citation.
 */
// Matches ONLY the assembled engine host page (public/office/<version>/
// bb-office-host.html, scripts/office-dev-assets.sh's own output) — the
// SAME regex shape as nginx.conf's `location ~* ^/office/[^/]+/.+\.html$`,
// kept in sync deliberately (see that location's own comment for why this
// one document's CSP must be strict `connect-src 'self'` while the outer
// `/office/:fileId` SPA route below still needs the app-wide allowlist).
const OFFICE_HOST_HTML_RE = /^\/office\/[^/]+\/.+\.html$/

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
          const path = req.url.split('?')[0]
          if (OFFICE_HOST_HTML_RE.test(path)) {
            res.setHeader(
              'Content-Security-Policy',
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob:; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
            )
          }
        } else {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
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
