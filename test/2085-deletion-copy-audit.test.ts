/**
 * Task 2085: every "deleted N days later" / "permanently deleted" claim must match
 * the server. Source of truth: billing_lifecycle.rs + signup_plan.rs
 * (LAPSE_RETENTION_DAYS_NEVER_PAID = 14, EVER_PAID/GIFT = 60) and the site Terms 7.10.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('2085 deletion copy matches the server', () => {
  test('cancelling a card trial says 14 days (never paid), not 60, and that uploads stop at once', () => {
    const billing = read('src/pages/billing.tsx')
    expect(billing).not.toContain('permanently deleted 60 days later')
    expect(billing).not.toContain('You keep {meta.label} until')
    expect(billing).toContain('cardTrialCancelCopy(')
  })

  test('cardTrialCancelCopy states the 14-day retention and the immediate upload pause', async () => {
    const { cardTrialCancelCopy } = await import('../src/lib/no-card-trial')
    const copy = cardTrialCancelCopy('1 December 2026')
    expect(copy).toContain('14 days')
    expect(copy).not.toContain('60')
    expect(copy).toContain('1 December 2026')
    expect(copy.toLowerCase()).toContain('uploads')
    expect(copy).toContain('download')
  })

  test('the empty-trash copy does not claim a key-destruction order the server has no path for', () => {
    expect(read('src/components/empty-states/empty-trash.tsx')).not.toContain('vault keys')
  })

  test('the dead unrouted security page (false 180-day contact copy) is gone', () => {
    expect(existsSync(join(root, 'src/pages/security.tsx'))).toBe(false)
  })
})
