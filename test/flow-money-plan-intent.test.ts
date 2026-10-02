import { describe, expect, test } from 'bun:test'
import {
  parsePlanIntent,
  savePlanIntent,
  readPlanIntent,
  clearPlanIntent,
  postSignupDestination,
  PLAN_INTENT_KEY,
  PLAN_INTENT_TTL_MS,
} from '../src/lib/plan-intent'

/**
 * Flow-4 money flow — the plan + cycle picked on the marketing site must
 * survive /signup → /onboarding and open the plan chooser on that plan.
 * The real-stack proof is e2e/flow-money-signup-plan-intent.spec.ts; this
 * suite pins the pure decisions (src/lib/plan-intent.ts).
 */

function memStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  }
}

describe('parsePlanIntent', () => {
  test('accepts every plan the server can trial, with the chosen cycle', () => {
    expect(parsePlanIntent('basic', 'yearly')).toEqual({ plan: 'basic', cycle: 'yearly' })
    expect(parsePlanIntent('starter', 'monthly')).toEqual({ plan: 'starter', cycle: 'monthly' })
    expect(parsePlanIntent('PRO', 'Yearly')).toEqual({ plan: 'pro', cycle: 'yearly' })
    expect(parsePlanIntent('personal', null)).toEqual({ plan: 'personal', cycle: 'monthly' })
  })
  test('unknown or absent cycle falls back to monthly; "annual" means yearly', () => {
    expect(parsePlanIntent('basic', 'weekly')?.cycle).toBe('monthly')
    expect(parsePlanIntent('basic', undefined)?.cycle).toBe('monthly')
    expect(parsePlanIntent('basic', 'annual')?.cycle).toBe('yearly')
  })
  test('rejects free, Teams/business, blanks and junk', () => {
    for (const p of ['free', 'business', 'team', '', null, undefined, 'pro<script>']) {
      expect(parsePlanIntent(p as string | null | undefined, 'yearly')).toBeNull()
    }
  })
})

describe('plan intent storage', () => {
  test('round-trips and clears', () => {
    const s = memStore()
    savePlanIntent({ plan: 'basic', cycle: 'yearly' }, 1_000, s)
    expect(readPlanIntent(2_000, s)).toEqual({ plan: 'basic', cycle: 'yearly' })
    clearPlanIntent(s)
    expect(readPlanIntent(2_000, s)).toBeNull()
  })
  test('stale intent (past TTL) is ignored', () => {
    const s = memStore()
    savePlanIntent({ plan: 'pro', cycle: 'monthly' }, 0, s)
    expect(readPlanIntent(PLAN_INTENT_TTL_MS + 1, s)).toBeNull()
  })
  test('malformed or tampered records are ignored', () => {
    const s = memStore()
    s.setItem(PLAN_INTENT_KEY, 'not json')
    expect(readPlanIntent(1, s)).toBeNull()
    s.setItem(PLAN_INTENT_KEY, JSON.stringify({ plan: 'business', cycle: 'yearly', ts: 1 }))
    expect(readPlanIntent(2, s)).toBeNull()
    s.setItem(PLAN_INTENT_KEY, JSON.stringify({ plan: 'basic', cycle: 'yearly' }))
    expect(readPlanIntent(2, s)).toBeNull()
  })
  test('a throwing storage never throws out of the helpers', () => {
    const boom = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => savePlanIntent({ plan: 'basic', cycle: 'yearly' }, 1, boom)).not.toThrow()
    expect(readPlanIntent(1, boom)).toBeNull()
    expect(() => clearPlanIntent(boom)).not.toThrow()
  })
})

describe('postSignupDestination', () => {
  test('no intent → the drive', () => {
    expect(postSignupDestination(null)).toBe('/')
  })
  test('intent → change-plan view preselected on that plan + cycle', () => {
    expect(postSignupDestination({ plan: 'basic', cycle: 'yearly' })).toBe(
      '/billing?view=change&plan=basic&cycle=yearly',
    )
  })
})

/**
 * GuestRoute race (found gating PR #94 on a real stack): onboarding makes the
 * account (setMasterKey → isUnlocked) and then refreshUser() sets `user`, so
 * the GuestRoute wrapping /onboarding renders `<Navigate to="/">` in the same
 * window where onboarding navigates to the plan chooser. The last one wins,
 * and the user lands on the drive with the intent already cleared. Onboarding
 * therefore registers its destination BEFORE refreshUser(), and GuestRoute
 * resolves its redirect through guestRedirectTarget() so both navigations
 * agree (same pattern as task 1437's `?next=`).
 */
import {
  setPendingPostSignupDestination,
  pendingPostSignupDestination,
  clearPendingPostSignupDestination,
  guestRedirectTarget,
  PENDING_POST_SIGNUP_TTL_MS,
} from '../src/lib/plan-intent'

describe('pending post-signup destination (GuestRoute race)', () => {
  test('GuestRoute follows the destination onboarding registered, not "/"', () => {
    clearPendingPostSignupDestination()
    const now = 1_000_000
    setPendingPostSignupDestination('/billing?view=change&plan=basic&cycle=yearly', now)
    expect(guestRedirectTarget(null, now + 500)).toBe('/billing?view=change&plan=basic&cycle=yearly')
    clearPendingPostSignupDestination()
  })
  test('an explicit ?next= still wins; with nothing pending the fallback is "/"', () => {
    clearPendingPostSignupDestination()
    expect(guestRedirectTarget(null)).toBe('/')
    setPendingPostSignupDestination('/billing?view=change&plan=pro&cycle=monthly', 10)
    expect(guestRedirectTarget('/cli-auth?code=abc', 20)).toBe('/cli-auth?code=abc')
    clearPendingPostSignupDestination()
  })
  test('the pending destination expires and can be cleared', () => {
    clearPendingPostSignupDestination()
    setPendingPostSignupDestination('/billing?view=change&plan=basic&cycle=monthly', 0)
    expect(pendingPostSignupDestination(PENDING_POST_SIGNUP_TTL_MS + 1)).toBeNull()
    setPendingPostSignupDestination('/billing?view=change&plan=basic&cycle=monthly', 0)
    clearPendingPostSignupDestination()
    expect(pendingPostSignupDestination(1)).toBeNull()
  })
  test('only an internal path is ever honoured', () => {
    clearPendingPostSignupDestination()
    setPendingPostSignupDestination('https://evil.example/', 0)
    expect(pendingPostSignupDestination(1)).toBeNull()
    setPendingPostSignupDestination('//evil.example/x', 0)
    expect(pendingPostSignupDestination(1)).toBeNull()
    clearPendingPostSignupDestination()
  })
})
