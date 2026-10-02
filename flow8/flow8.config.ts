import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://localhost:5381', headless: true, screenshot: 'only-on-failure', trace: 'off' },
  outputDir: '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-8/pw-out',
})
