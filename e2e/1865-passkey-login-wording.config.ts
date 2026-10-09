import { defineConfig } from '@playwright/test'
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5865'
export default defineConfig({
  testDir: '.',
  testMatch: /1865-passkey-login-wording\.spec\.ts$/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: { baseURL: WEB_URL, headless: true },
  webServer: {
    command: `bunx vite --port ${new URL(WEB_URL).port} --strictPort`,
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
