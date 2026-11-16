// Local-only config for the Play-store screenshot job (NOT committed): serves the web app on :5188
// and proxies /api to the shared dev API on :3001, presenting the allowed dev Origin to its CSRF check.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default defineConfig((env) => {
  const b = typeof base === 'function' ? (base as any)(env) : base
  return mergeConfig(b, {
    server: {
      port: 5188,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          configure: (proxy: any) => {
            proxy.on('proxyReq', (proxyReq: any) => {
              if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', 'http://localhost:5173')
              if (proxyReq.getHeader('referer')) proxyReq.setHeader('referer', 'http://localhost:5173/')
            })
          },
        },
      },
    },
  })
})
