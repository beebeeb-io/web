// Standalone Playwright config for task 2512 (no shared setup or storage state).
import { defineConfig } from '@playwright/test'

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const WEB_PORT = new URL(WEB_URL).port || '5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: '.',
  testMatch: /2512-follow-server-bundle\.spec\.ts$/,
  timeout: 150_000,
  retries: 0,
  workers: 1,
  use: { baseURL: WEB_URL, headless: true, screenshot: 'only-on-failure' },
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: `VITE_API_URL=${API_URL} bunx vite --port ${WEB_PORT} --strictPort`,
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
