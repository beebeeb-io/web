import { defineConfig } from '@playwright/test'

/**
 * Standalone config for the 1884 client error-reporting proof. Fully mocked:
 * the DSN host is intercepted with page.route (no real egress), the API is an
 * unroutable address. Start Vite yourself on an own port:
 *   VITE_API_URL=http://127.0.0.1:1 \
 *   VITE_ERROR_REPORTING_DSN=https://pub1884e2e@errors.beebeeb.io/1 \
 *   bunx vite --port 5231 --strictPort &
 *   E2E_WEB_URL=http://localhost:5231 \
 *     bunx playwright test --config=e2e/1884-error-reporting.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /1884-error-reporting\.spec\.ts$/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:5231',
    headless: true,
    screenshot: 'only-on-failure',
  },
})
