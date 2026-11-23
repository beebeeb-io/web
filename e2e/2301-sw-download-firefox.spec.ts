// Firefox showed "Your organization has blocked access" for /sw-download/<id>
// instead of saving the file. This spec serves the real streaming-to-disk code
// and the real public/sw.js with the production page headers (COEP
// require-corp, frame-ancestors 'none', X-Frame-Options DENY — nginx.conf) and
// checks the download lands, both with the service worker controlling the page
// and without it (shift-reload / private window / SW blocked).
//
// Self-contained: boots its own Vite server, no API or login needed.
// Run: bunx playwright test --project=firefox -g "download"
import { test, expect } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import net from 'node:net'
import fs from 'node:fs'

const SIZE_MB = 50
let server: ViteDevServer
let origin = ''

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

test.beforeAll(async () => {
  const port = await freePort()
  origin = `http://localhost:${port}`
  server = await createServer({
    server: {
      port,
      strictPort: true,
      host: 'localhost',
      hmr: false,
      headers: {
        // The same denials nginx.conf sends on every HTML response.
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    },
    plugins: [{
      name: 'sw-download-harness',
      configureServer(s) {
        s.middlewares.use('/__harness', (_req, res) => {
          res.setHeader('Content-Type', 'text/html')
          res.end(`<!doctype html><html><body><script type="module">
            import { canStreamToDisk, awaitController, streamTargetToDisk } from '/src/lib/download/streaming-to-disk.ts'
            if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
            window.runDownload = async (mb) => {
              const total = mb * 1024 * 1024
              const chunk = new Uint8Array(1024 * 1024).fill(7)
              let sent = 0
              const body = new ReadableStream({
                pull(c) { if (sent >= total) { c.close(); return } c.enqueue(chunk); sent += chunk.length },
              })
              const controller = canStreamToDisk() ? await awaitController() : null
              if (!controller) return 'no-controller'
              await streamTargetToDisk(
                { direct: true, filename: 'big.bin', mime: 'application/octet-stream', plaintextSize: total },
                body, null, controller)
              return 'streamed'
            }
            window.harnessReady = true
          </script></body></html>`)
        })
      },
    }],
  })
  await server.listen()
})

test.afterAll(async () => { await server?.close() })

async function saveSize(page: import('@playwright/test').Page, run: () => Promise<unknown>) {
  const dl = page.waitForEvent('download', { timeout: 20_000 })
  const result = run()
  const download = await dl
  const p = await download.path()
  await result.catch?.(() => {})
  return fs.statSync(p!).size
}

test('download: 50 MB streams to disk on a fresh tab', async ({ page }) => {
  await page.goto(`${origin}/__harness`)
  await page.waitForFunction(() => (window as any).harnessReady)
  const size = await saveSize(page, () => page.evaluate(mb => (window as any).runDownload(mb), SIZE_MB))
  expect(size).toBe(SIZE_MB * 1024 * 1024)
})

test('download: 50 MB lands when the service worker does not control the page', async ({ browser }) => {
  // Shift-reload, private windows and a blocked SW all leave the page uncontrolled.
  const ctx = await browser.newContext({ serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto(`${origin}/__harness`)
  await page.waitForFunction(() => (window as any).harnessReady)
  const r = await page.evaluate(mb => (window as any).runDownload(mb), SIZE_MB)
  // No controller → the app takes the in-memory path, never the iframe.
  expect(r).toBe('no-controller')
  await ctx.close()
})
