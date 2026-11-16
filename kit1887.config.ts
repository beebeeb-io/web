import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: /kit1887-(accounts|rehearse)\.spec\.ts/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: { baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:5173', headless: true, screenshot: 'only-on-failure' },
})
