import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  outputDir: '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-3/pw-out',
  use: { baseURL: 'http://localhost:5333', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true, actionTimeout: 30_000, navigationTimeout: 60_000 },
})
