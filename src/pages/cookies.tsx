/**
 * Cookie information page — lists every cookie Beebeeb sets or allows.
 * Accessible without authentication at /cookies.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { getConsent, setConsent, type ConsentLevel } from '../lib/consent'

// ── Cookie table ──────────────────────────────────────────────────────────────

interface CookieRow {
  name: string
  provider: string
  purpose: string
  duration: string
  category: 'essential' | 'functional'
}

const COOKIES: CookieRow[] = [
  {
    name: 'bb_session',
    provider: 'Beebeeb',
    purpose: 'Authentication — keeps you signed in across page reloads.',
    duration: '30 days',
    category: 'essential',
  },
  {
    name: 'bb_cookie_consent',
    provider: 'Beebeeb',
    purpose: 'Remembers your cookie preference so this banner does not reappear.',
    duration: 'Until cleared',
    category: 'essential',
  },
  {
    name: '__stripe_mid, __stripe_sid',
    provider: 'Stripe (stripe.com)',
    purpose: 'Fraud prevention and payment processing. Only loaded on the billing page.',
    duration: 'Session / 1 year',
    category: 'functional',
  },
]

const CATEGORY_LABELS: Record<CookieRow['category'], string> = {
  essential: 'Essential',
  functional: 'Functional',
}

const CATEGORY_DESCRIPTION: Record<CookieRow['category'], string> = {
  essential: 'Always active. Required for the service to function.',
  functional: 'Used for specific features (payment processing). You can decline these.',
}

const CATEGORY_COLOR: Record<CookieRow['category'], string> = {
  essential: 'bg-green/10 text-green border-green/20',
  functional: 'bg-amber-bg text-amber-deep border-amber-deep/20',
}

// ── Consent controls ──────────────────────────────────────────────────────────

function ConsentPanel() {
  const [current, setCurrent] = useState<ConsentLevel | null>(getConsent)
  const [saved, setSaved] = useState(false)

  function update(level: ConsentLevel) {
    setConsent(level)
    setCurrent(level)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="rounded-lg border border-line bg-paper-2 p-5">
      <h2 className="text-[13px] font-semibold text-ink mb-1">Your current choice</h2>
      <p className="text-[12px] text-ink-3 mb-4">
        {current === 'all'
          ? 'You have accepted all cookies (essential + functional).'
          : current === 'essential'
            ? 'You have chosen essential cookies only. Stripe is blocked on the billing page.'
            : 'You have not made a choice yet — the banner will appear on your next visit.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <BBButton
          size="sm"
          variant={current === 'all' ? 'amber' : 'default'}
          onClick={() => update('all')}
        >
          Accept all
        </BBButton>
        <BBButton
          size="sm"
          variant={current === 'essential' ? 'default' : 'ghost'}
          onClick={() => update('essential')}
        >
          Essential only
        </BBButton>
      </div>
      {saved && (
        <p className="text-[11.5px] text-green mt-2 flex items-center gap-1.5">
          <Icon name="check" size={11} />
          Preference saved
        </p>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Cookies() {
  return (
    <div className="min-h-screen bg-paper px-4 py-12">
      <div className="max-w-[760px] mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink transition-colors mb-6">
            <Icon name="chevron-right" size={11} className="rotate-180" />
            Back
          </Link>
          <h1 className="text-[26px] font-bold text-ink mb-2">Cookie information</h1>
          <p className="text-[14px] text-ink-3 leading-relaxed">
            Beebeeb uses as few cookies as possible. We have no advertising, no cross-site tracking,
            and no analytics cookies. This page lists every cookie we set or allow.
          </p>
        </div>

        {/* Consent panel */}
        <div className="mb-8">
          <ConsentPanel />
        </div>

        {/* Cookie table */}
        <div className="mb-8">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Cookies in use</h2>

          <div className="rounded-lg border border-line overflow-hidden">
            {/* Column headers */}
            <div
              className="grid px-4 py-2.5 bg-paper-2 border-b border-line text-[10px] font-semibold uppercase tracking-wider text-ink-4"
              style={{ gridTemplateColumns: '1.2fr 1fr 2fr 1fr 90px' }}
            >
              <span>Name</span>
              <span>Provider</span>
              <span>Purpose</span>
              <span>Duration</span>
              <span>Category</span>
            </div>

            {COOKIES.map((cookie, i) => (
              <div
                key={cookie.name}
                className={`grid px-4 py-3 items-start text-[12px] ${
                  i < COOKIES.length - 1 ? 'border-b border-line' : ''
                }`}
                style={{ gridTemplateColumns: '1.2fr 1fr 2fr 1fr 90px' }}
              >
                <span className="font-mono text-[11px] text-ink truncate pt-0.5">{cookie.name}</span>
                <span className="text-ink-2">{cookie.provider}</span>
                <span className="text-ink-3 leading-snug">{cookie.purpose}</span>
                <span className="font-mono text-[11px] text-ink-3">{cookie.duration}</span>
                <span>
                  <span
                    className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[cookie.category]}`}
                  >
                    {CATEGORY_LABELS[cookie.category]}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Category definitions */}
        <div className="mb-8 space-y-3">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Categories</h2>
          {(Object.entries(CATEGORY_DESCRIPTION) as [CookieRow['category'], string][]).map(([cat, desc]) => (
            <div key={cat} className="flex items-start gap-3">
              <span
                className={`shrink-0 mt-0.5 inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[cat]}`}
              >
                {CATEGORY_LABELS[cat]}
              </span>
              <p className="text-[13px] text-ink-2 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-line pt-6 text-[12px] text-ink-4 space-y-1.5">
          <p>
            We do not use Google Analytics, Meta Pixel, or any other advertising or tracking service.
          </p>
          <p>
            Stripe processes payments and is subject to its own{' '}
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink-3"
            >
              privacy policy
            </a>
            .
          </p>
          <p>
            Questions?{' '}
            <a href="mailto:privacy@beebeeb.io" className="underline hover:text-ink-3">
              privacy@beebeeb.io
            </a>{' '}
            · Initlabs B.V. (KvK 95157565), Wijchen, Netherlands.
          </p>
        </div>
      </div>
    </div>
  )
}
