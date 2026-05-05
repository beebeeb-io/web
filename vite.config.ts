import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
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
  resolve: {
    // fflate ships a browser-specific ESM build (esm/browser.js) that
    // only includes gzip utilities — zipSync, Zip, etc. are absent.
    // Force Vite to use the full ESM index instead.
    alias: {
      fflate: 'fflate/esm/index.mjs',
    },
  },
})
