import { describe, expect, test } from 'bun:test'
import {
  COUPON_HOLD_KEY,
  claimedCopy,
  clearHeldCoupon,
  codeFromInput,
  couponPath,
  heldCouponRedirect,
  holdsNoPlan,
  holdCoupon,
  isCouponPath,
  normalizeCouponCode,
  parsePitch,
  pitchHeadline,
  pitchTerms,
  readHeldCoupon,
  refusalCopy,
  shouldAutoClaim,
  storageLabel,
} from '../src/lib/coupon'
import { lapsedBannerCopy, lapsedHeading, uploadBlockedNotice } from '../src/lib/account-state'
import { userFriendlyError } from '../src/lib/user-friendly-error'
import { readFileSync } from 'node:fs'
import { ApiError } from '@beebeeb/shared'
import { sanitizeRedirect } from '../src/lib/safe-redirect'

function fakeStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const PITCH = {
  valid: true,
  plan: 'pro',
  plan_label: 'Pro',
  storage_bytes: 1_000_000_000_000,
  duration_months: 3,
  price_cents: 0,
  currency: 'EUR',
  expires_at: null,
  read_only_days: 60,
}

describe('coupon code handling', () => {
  test('normalises case, spaces and the grouped form', () => {
    expect(normalizeCouponCode(' k7m2-qx9t-4hd3 ')).toBe('K7M2-QX9T-4HD3')
    expect(normalizeCouponCode('K7M2 QX9T 4HD3')).toBe('K7M2QX9T4HD3')
  })
  test('rejects what cannot be a code', () => {
    for (const bad of [null, undefined, '', 'ab', "a'; drop", 'x'.repeat(65), 'has/slash', '../etc']) {
      expect(normalizeCouponCode(bad as string | null | undefined)).toBeNull()
    }
  })
  test('the Settings field takes a whole pasted link', () => {
    expect(codeFromInput('https://app.beebeeb.io/c/K7M2-QX9T-4HD3')).toBe('K7M2-QX9T-4HD3')
    expect(codeFromInput('https://app.beebeeb.io/c/K7M2-QX9T-4HD3?utm=x')).toBe('K7M2-QX9T-4HD3')
    expect(codeFromInput('  welcome-press ')).toBe('WELCOME-PRESS')
    expect(codeFromInput('https://evil.example/not-a-coupon')).toBeNull()
  })
  test('path helpers', () => {
    expect(couponPath('K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3')
    expect(isCouponPath('/c/K7M2-QX9T-4HD3')).toBe(true)
    expect(isCouponPath('/c/ab')).toBe(false)
    expect(isCouponPath('/c/K7M2/extra')).toBe(false)
    expect(isCouponPath('/cx/K7M2-QX9T')).toBe(false)
  })
})

describe('the held coupon bridges signup', () => {
  test('hold, read, clear', () => {
    const s = fakeStore()
    expect(readHeldCoupon(s)).toBeNull()
    holdCoupon('k7m2-qx9t-4hd3', s)
    expect(s.data.get(COUPON_HOLD_KEY)).toBe('K7M2-QX9T-4HD3')
    expect(readHeldCoupon(s)).toBe('K7M2-QX9T-4HD3')
    clearHeldCoupon(s)
    expect(readHeldCoupon(s)).toBeNull()
  })
  test('garbage is never held, and a throwing store is survived', () => {
    const s = fakeStore()
    holdCoupon("a'; drop", s)
    expect(s.data.size).toBe(0)
    const boom = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => holdCoupon('K7M2-QX9T-4HD3', boom)).not.toThrow()
    expect(readHeldCoupon(boom)).toBeNull()
    expect(() => clearHeldCoupon(boom)).not.toThrow()
  })
  test('only an account with no plan and a held coupon is sent to claim it', () => {
    expect(heldCouponRedirect('needs_plan', 'none', 'K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3?from=signup')
    // 1816: an allowance account is `ok` in the document but holds no plan: it claims too.
    expect(heldCouponRedirect('ok', 'none', 'K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3?from=signup')
    expect(heldCouponRedirect('ok', null, 'K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3?from=signup')
    expect(heldCouponRedirect('ok', 'free', 'K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3?from=signup')
    expect(heldCouponRedirect('lapsed', 'none', 'K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3?from=signup')
    expect(heldCouponRedirect('needs_plan', 'none', null)).toBeNull()
    // A paid or trialing plan is never replaced, held coupon or not.
    for (const plan of ['basic', 'pro', 'starter']) expect(heldCouponRedirect('ok', plan, 'K7M2-QX9T-4HD3')).toBeNull()
  })
  test('holdsNoPlan', () => {
    expect(holdsNoPlan('ok', 'pro')).toBe(false)
    expect(holdsNoPlan('ok', 'none')).toBe(true)
    expect(holdsNoPlan('needs_plan', 'pro')).toBe(true)
  })
})

describe('post-login redirect honours a coupon link and nothing else new', () => {
  test('accepts /c/<code>', () => {
    expect(sanitizeRedirect('/c/K7M2-QX9T-4HD3')).toBe('/c/K7M2-QX9T-4HD3')
  })
  test.each([
    '/c/',
    '/c/ab',
    '/c/K7M2-QX9T/../admin',
    '/c/K7M2-QX9T-4HD3/extra',
    '//c/K7M2-QX9T-4HD3',
    '/c/K7M2-QX9T-4HD3\\evil',
    '/cc/K7M2-QX9T-4HD3',
  ])('rejects %s', (v) => {
    expect(sanitizeRedirect(v)).toBeNull()
  })
})

describe('the pitch', () => {
  test('parses a usable pitch and refuses everything else', () => {
    expect(parsePitch(PITCH)).toMatchObject({ plan_label: 'Pro', duration_months: 3 })
    expect(parsePitch({ valid: false })).toBeNull()
    expect(parsePitch(null)).toBeNull()
    expect(parsePitch({ ...PITCH, duration_months: 0 })).toBeNull()
    expect(parsePitch({ ...PITCH, plan: undefined })).toBeNull()
  })
  test('headline says the plan, the time and that it is free', () => {
    expect(pitchHeadline({ plan_label: 'Pro', duration_months: 3 })).toBe('Pro for 3 months, free')
    expect(pitchHeadline({ plan_label: 'Basic', duration_months: 1 })).toBe('Basic for 1 month, free')
  })
  test('storage is decimal SI', () => {
    expect(storageLabel(1_000_000_000_000)).toBe('1 TB')
    expect(storageLabel(1_500_000_000_000)).toBe('1.5 TB')
    expect(storageLabel(200_000_000_000)).toBe('200 GB')
  })
  test('the terms state what the server enforces, and make no claim it does not', () => {
    const terms = pitchTerms(parsePitch(PITCH)!)
    const text = terms.map((t) => t.text).join(' ')
    expect(terms.map((t) => t.id)).toEqual(['get', 'for', 'cost', 'after'])
    expect(text).toContain('Pro, 1 TB')
    expect(text).toContain('3 months')
    expect(text).toContain('do not ask for a card')
    expect(text).toContain('read-only')
    expect(text).toContain('60 days')
    expect(text).toContain('Nothing renews by itself')
    expect(text).toContain('14, 7 and 1 days')
    // Honest copy: no "bank-grade", no emoji, no US-style hype.
    expect(text).not.toMatch(/bank-grade|!|\p{Extended_Pictographic}/u)
  })
  test('an expiry adds a line', () => {
    const terms = pitchTerms({ ...parsePitch(PITCH)!, expires_at: '2026-12-31T23:59:59Z' })
    expect(terms.at(-1)?.id).toBe('valid')
    expect(terms.at(-1)?.text).toContain('2026')
  })
})

describe('refusals', () => {
  test('each typed code has its own honest answer', () => {
    expect(refusalCopy('coupon_not_applicable', 409)).toMatchObject({ title: 'You already have a plan', action: 'drive' })
    expect(refusalCopy('coupon_already_used', 409).action).toBe('choose_plan')
    expect(refusalCopy('coupon_unavailable', 410).title).toContain('does not work any more')
    expect(refusalCopy('email_unverified', 403).action).toBe('verify_email')
  })
  test('unknown failures and rate limits are retryable and change nothing', () => {
    expect(refusalCopy(undefined, 500).action).toBe('retry')
    expect(refusalCopy('rate_limit_exceeded', 429).title).toBe('Too many attempts')
    expect(refusalCopy(undefined, undefined).body).toContain('Nothing was changed')
  })
  test('the unavailable answer never says why (it is one answer on the wire)', () => {
    const body = refusalCopy('coupon_unavailable', 410).body
    expect(body).toContain('may have')
  })
})

describe('claimed', () => {
  test('says free, until when, and that no card is on file', () => {
    const c = claimedCopy({ plan_label: 'Pro', duration_months: 1, ends_at: '2027-01-03T10:00:00Z', already_redeemed: false })
    expect(c.title).toBe('Pro is yours')
    expect(c.body).toContain('Free for 1 month')
    expect(c.body).toContain('2027')
    expect(c.body).toContain('No card is on file')
    expect(claimedCopy({ plan_label: 'Pro', duration_months: 1, ends_at: '2027-01-03T10:00:00Z', already_redeemed: true }).title).toBe(
      'You already have Pro',
    )
  })
})

// ── Round 2: security review P2.7, Codex threads, the gift copy gaps ─────────

describe('?from=signup never claims by itself (security review P2.7)', () => {
  const CODE = 'K7M2-QX9T-4HD3'
  test('only a code THIS tab held, on the page of that code, is claimed without a click', () => {
    expect(shouldAutoClaim(true, CODE, CODE)).toBe(true)
    // a link someone sent, query string appended: nothing was held
    expect(shouldAutoClaim(true, null, CODE)).toBe(false)
    // a different coupon was held
    expect(shouldAutoClaim(true, 'OTHER-CODE-123', CODE)).toBe(false)
    // no query string
    expect(shouldAutoClaim(false, CODE, CODE)).toBe(false)
    expect(shouldAutoClaim(true, CODE, null)).toBe(false)
  })
  test('the page uses that rule, not the query string alone', () => {
    const page = readFileSync(new URL('../src/pages/coupon.tsx', import.meta.url), 'utf8')
    expect(page).toContain('shouldAutoClaim(fromSignup, readHeldCoupon(), code)')
    expect(page).not.toMatch(/if \(!fromSignup \|\| !user/)
  })
})

describe('a held coupon never follows a person into another account', () => {
  const auth = readFileSync(new URL('../src/lib/auth-context.tsx', import.meta.url), 'utf8')
  function body(start: string): string {
    const from = auth.indexOf(start)
    expect(from).toBeGreaterThan(-1)
    const next = auth.indexOf('useCallback', from + start.length)
    return auth.slice(from, next === -1 ? undefined : next)
  }
  test('signing in, finishing 2FA and signing out clear the hold', () => {
    expect(body('const login = useCallback')).toContain('clearHeldCoupon()')
    expect(body('const verify2fa = useCallback')).toContain('clearHeldCoupon()')
    expect(body('const logout = useCallback')).toContain('clearHeldCoupon()')
  })
  test('so does another tab signing out', () => {
    const handler = auth.slice(auth.indexOf('const onMessage'), auth.indexOf("channel.addEventListener('message'"))
    expect(handler).toMatch(/type === 'logout'\) \{[^}]*clearHeldCoupon\(\)/s)
  })
  test('a signup is not a sign-in: the signup page never clears the hold', () => {
    const signup = readFileSync(new URL('../src/pages/signup.tsx', import.meta.url), 'utf8')
    expect(signup).not.toContain('clearHeldCoupon')
  })
})

describe('"Try again" on a failed lookup looks the coupon up again (Codex)', () => {
  const page = readFileSync(new URL('../src/pages/coupon.tsx', import.meta.url), 'utf8')
  test('with no pitch it re-runs the lookup; with a pitch it retries the claim', () => {
    expect(page).toContain('view.pitch ? void claim(view.pitch) : setLookupTry((n) => n + 1)')
    expect(page).toContain('}, [code, lookupTry])')
  })
})

describe('the end of a free coupon period is never called a trial', () => {
  test('the lapsed banner and heading follow lapse_kind', () => {
    expect(lapsedHeading('gift')).toBe('Your free period has ended')
    expect(lapsedHeading('trial')).toBe('Your trial has ended')
    expect(lapsedHeading(undefined)).toBe('Your trial has ended') // an older server
    const gift = lapsedBannerCopy('2026-12-01T12:00:00Z', 'gift')
    expect(gift).toBe(
      'Your free period has ended and your vault is read-only. Your files will be permanently deleted on 1 December 2026. Subscribe to keep them.',
    )
    expect(gift).not.toMatch(/trial/i)
    expect(lapsedBannerCopy(null, 'gift')).not.toMatch(/trial/i)
    // unchanged for a trial
    expect(lapsedBannerCopy('2026-12-01T12:00:00Z', 'trial')).toContain('Your trial has ended')
    expect(lapsedBannerCopy('2026-12-01T12:00:00Z')).toContain('Your trial has ended')
  })
  test('the upload notice and the refusal toast agree', () => {
    expect(uploadBlockedNotice('lapsed', 'gift')?.description).toContain('Your free period has ended')
    expect(uploadBlockedNotice('lapsed', 'gift')?.description).not.toMatch(/trial/i)
    expect(uploadBlockedNotice('lapsed', 'trial')?.description).toContain('Your trial has ended')
    expect(uploadBlockedNotice('lapsed')?.description).toContain('Your trial has ended')
    // The refusal carries no reason, so it names none.
    const msg = userFriendlyError(new ApiError('x', 409, 'account_lapsed'))
    expect(msg).toBe('Your vault is read-only. Subscribe to upload or share again.')
    expect(msg).not.toMatch(/trial/i)
  })
  test('the billing page and the banner pass the kind through', () => {
    const banner = readFileSync(new URL('../src/components/billing-banner.tsx', import.meta.url), 'utf8')
    expect(banner).toContain('lapsedBannerCopy(sub?.data_deletion_at, sub?.lapse_kind)')
    const billing = readFileSync(new URL('../src/pages/billing.tsx', import.meta.url), 'utf8')
    expect(billing).toContain('lapsedHeading(sub?.lapse_kind)')
    expect(billing).toContain('lapsedBannerCopy(sub?.data_deletion_at, sub?.lapse_kind)')
    const block = readFileSync(new URL('../src/hooks/use-plan-block.ts', import.meta.url), 'utf8')
    expect(block).toContain('uploadBlockedNotice(accountState, lapseKind)')
  })
})
