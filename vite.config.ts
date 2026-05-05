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
})
