import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E test configuration for Beebeeb web client.
 *
 * Prerequisites:
 *   1. Start Postgres:  docker compose -f ../../docker-compose.yml up -d postgres
 *   2. Start the API:   cd ../server && cargo run -p beebeeb-api
 *   3. Start the web:   bun dev
 *
 * Then run:  bunx playwright test
 */
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
