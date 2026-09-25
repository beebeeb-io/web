import { describe, expect, test } from 'bun:test'
import {
  shouldShowPilotKeyField,
  buildOnboardingState,
  pilotKeyBlocksSubmit,
} from '../src/lib/signup-pilot-gate'

/**
 * Task 1520 — the /signup pilot-key decision.
 *
 * Beebeeb launched phase 2 (BB_REQUIRE_PILOT_KEY=0 on both prod nodes,
 * proven: a keyless register-start passes the gate) but signup.tsx still
 * hard-coded a mandatory "Pilot access key" field, so nobody could sign up
 * through the web client. These decision functions (src/lib/signup-pilot-gate.ts)
 * are what signup.tsx now calls; this suite exercises them directly — no
 * React, no rendering (this repo's `bun test` harness has no
 * @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

describe('shouldShowPilotKeyField() — the field decision', () => {
  test('no navState (fresh visit to /signup) -> field hidden', () => {
    expect(shouldShowPilotKeyField(null)).toBe(false)
    expect(shouldShowPilotKeyField(undefined)).toBe(false)
  })

  test('navState with only email (e.g. back-navigation from onboarding) -> field hidden', () => {
    expect(shouldShowPilotKeyField({ email: 'a@beebeeb.io' })).toBe(false)
  })

  test('navState.pilotKeyError set (bounced back from a real 403 pilot_key_required) -> field shown', () => {
    expect(
      shouldShowPilotKeyField({
        email: 'a@beebeeb.io',
        pilotKey: 'wrong-key',
        pilotKeyError: 'A pilot access key is required to sign up.',
      }),
    ).toBe(true)
  })

  test('an empty-string pilotKeyError is falsy -> field hidden (no error to show)', () => {
    expect(shouldShowPilotKeyField({ email: 'a@beebeeb.io', pilotKeyError: '' })).toBe(false)
  })
})

describe('buildOnboardingState() — what /signup hands to /onboarding', () => {
  test('no pilot key entered -> state carries ONLY email, no pilotKey field at all', () => {
    const state = buildOnboardingState('a@beebeeb.io', '')
    expect(state).toEqual({ email: 'a@beebeeb.io' })
    expect('pilotKey' in state).toBe(false)
  })

  test('whitespace-only pilot key -> treated as none entered', () => {
    const state = buildOnboardingState('a@beebeeb.io', '   ')
    expect(state).toEqual({ email: 'a@beebeeb.io' })
    expect('pilotKey' in state).toBe(false)
  })

  test('a real pilot key entered -> trimmed and carried forward', () => {
    const state = buildOnboardingState('a@beebeeb.io', '  test-pilot-key  ')
    expect(state).toEqual({ email: 'a@beebeeb.io', pilotKey: 'test-pilot-key' })
  })
})

describe('pilotKeyBlocksSubmit() — the Continue-button / submit-handler gate', () => {
  test('field hidden (default, gate off) -> never blocks submit, even with no key typed', () => {
    expect(pilotKeyBlocksSubmit({ showPilotKeyField: false, pilotKey: '' })).toBe(false)
  })

  test('field shown, no key typed -> blocks submit', () => {
    expect(pilotKeyBlocksSubmit({ showPilotKeyField: true, pilotKey: '' })).toBe(true)
    expect(pilotKeyBlocksSubmit({ showPilotKeyField: true, pilotKey: '   ' })).toBe(true)
  })

  test('field shown, key typed -> does not block submit', () => {
    expect(pilotKeyBlocksSubmit({ showPilotKeyField: true, pilotKey: 'a-key' })).toBe(false)
  })
})
