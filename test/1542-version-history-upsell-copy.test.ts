import { describe, expect, test } from 'bun:test'
import { shouldShowVersionHistoryUpsell } from '../src/lib/version-history-copy'

/**
 * Task 1542, finding 4 — VersionHistory rendered an UpgradeNudge claiming
 * "Free keeps the current version only" / "Basic keeps 30 days of version
 * history per file" whenever the account had no subscription (or plan ===
 * 'free'). Server-side, `version_cleanup.rs`'s `apply_default_retention()`
 * applies the SAME default retention (30 days / 10 versions,
 * env-overridable) to every account with no `version_settings` row —
 * grep confirms zero plan/subscription checks anywhere in that file, and
 * `routes/versions.rs`'s `list_versions` checks only file ownership. So a
 * free/lapsed account gets a real, restorable prior version back from the
 * API while the UI simultaneously claimed it wouldn't — a claim falsified
 * by the same screen's own data. `shouldShowVersionHistoryUpsell()` is the
 * single, extracted decision point VersionHistory now calls; it returns
 * false until the server actually implements plan-based retention gating —
 * no React, no rendering (this repo's `bun test` harness has no
 * @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

describe('shouldShowVersionHistoryUpsell() — finding 4, false retention-gating claim', () => {
  test('never shows the upsell for a free-plan account (server applies the same retention to every plan)', () => {
    expect(shouldShowVersionHistoryUpsell('free')).toBe(false)
  })

  test('never shows the upsell for an account with no subscription row either', () => {
    expect(shouldShowVersionHistoryUpsell(undefined)).toBe(false)
  })

  test('never shows the upsell for a paid plan (it never claimed anything there anyway)', () => {
    expect(shouldShowVersionHistoryUpsell('pro')).toBe(false)
  })
})
