import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Task 2090: the legacy-provider-only win-back offer is retired. The server no longer
// serves winback-eligible / winback-claim, so the client must not call them.
const root = join(import.meta.dir, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('api client has no win-back calls', () => {
  expect(read('src/lib/api.ts')).not.toMatch(/win-?back/i)
})

test('billing page has no win-back offer and cancel goes to pause/confirm', () => {
  // The shell plus every module the billing split produced: no win-back anywhere.
  const dir = 'src/pages/billing'
  const s = [
    read('src/pages/billing.tsx'),
    ...readdirSync(join(root, dir)).map((f) => read(join(dir, f))),
  ].join('\n')
  expect(s).not.toMatch(/win-?back|Accept offer/i)
  expect(s).not.toContain("cancelStep === 'offer'")
  expect(read(join(dir, 'use-billing-actions.ts'))).toContain("setCancelStep(pauseSupported ? 'pause' : 'confirm')")
})
