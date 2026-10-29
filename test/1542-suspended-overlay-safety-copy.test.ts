import { describe, expect, test } from 'bun:test'
import { suspendedAccountSafetyMessage } from '../src/lib/suspended-overlay-copy'

/**
 * Task 1542, finding 1 — BillingSuspendedOverlay used to compute a hard
 * "deletion date" 90 days after `past_due_since` and render "your files
 * will be permanently deleted on {date}" for billing_state === 'suspended'.
 * The server removed the automatic d90 delete sweep in task 1062 (WP-D,
 * decision 3) — billing_lifecycle.rs:370-376 states there is NO automatic
 * escalation past the freeze (no auto-suspend, no auto-terminate, no
 * auto-delete); a permanently abandoned account is now a MANUAL admin
 * action only. `suspendedAccountSafetyMessage()` is the extracted, pure
 * copy the overlay now renders instead of fabricating a date from
 * client-side arithmetic — no React, no rendering (this repo's `bun test`
 * harness has no @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

describe('suspendedAccountSafetyMessage() — finding 1, no fabricated auto-deletion date', () => {
  test('never mentions a specific deletion date or claims automatic deletion', () => {
    const message = suspendedAccountSafetyMessage()
    expect(message.toLowerCase()).not.toContain('will be permanently deleted on')
    expect(message.toLowerCase()).not.toContain('deleted on')
  })

  test('states the real, honest policy: nothing is deleted automatically', () => {
    const message = suspendedAccountSafetyMessage()
    expect(message).toContain('Nothing is deleted automatically')
  })

  test('is a static message independent of any past_due_since input (no date arithmetic to fabricate)', () => {
    expect(suspendedAccountSafetyMessage()).toBe(suspendedAccountSafetyMessage())
  })
})
