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
  storageLabel,
} from '../src/lib/coupon'
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
