import { defineConfig } from '@playwright/test'
import { config as dotenv } from 'dotenv'

/**
 * Playwright E2E test configuration for Beebeeb web client.
 *
 * Prerequisites:
 *   1. Start Postgres:  docker compose -f ../../docker-compose.yml up -d postgres
 *   2. Start the API:   cd ../server && cargo run -p beebeeb-api
 *   3. Start the web:   bun dev
 *
 * Then run:  bunx playwright test
 *
 * For the full test suite (auth, drive, share, upload tests), copy
 * .env.test.example → .env.test and fill in your test account credentials.
 */
// Load .env.test if present — holds BB_TEST_USER_* credentials.
// Fails silently if the file doesn't exist (credentials-free tests still run).
dotenv({ path: '.env.test', override: false })
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
