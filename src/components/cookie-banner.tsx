/**
 * GDPR cookie consent banner.
 *
 * Beebeeb uses session cookies for authentication (always essential) and
 * loads Stripe.js on /billing for payment processing (functional).
 *
 * Two explicit choices:
 *   Accept all         → essential + functional (Stripe on /billing)
 *   Essential only     → auth only; Stripe blocked on /billing with a notice
 *
 * Consent is stored in localStorage under 'bb_cookie_consent'. The banner
 * does not reappear once a choice is made.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { setConsent } from '../lib/consent'

const CONSENT_KEY = 'bb_cookie_consent'

export function CookieBanner() {
  const [visible, setVisible] = useState(() => {
    try {
      const v = localStorage.getItem(CONSENT_KEY)
      // Show if no choice yet; hide for legacy '1' (treated as 'all')
      return v === null || v === undefined
    } catch {
      return false
    }
  })

  if (!visible) return null

  function accept() {
    setConsent('all')
    setVisible(false)
  }

  function decline() {
    setConsent('essential')
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      aria-modal="false"
      className="fixed bottom-0 inset-x-0 z-[9999] px-4 pb-4 pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-line bg-paper-2/95 backdrop-blur-sm shadow-2 px-4 py-3 animate-slide-in-up">
        {/* Text */}
        <p className="text-[12px] text-ink-2 leading-relaxed flex-1">
          We use session cookies for authentication (always on). On the billing page,
          Stripe sets cookies for payment processing.{' '}
          <Link
            to="/cookies"
            className="underline underline-offset-2 text-ink-2 hover:text-ink transition-colors"
          >
            Cookie details
          </Link>
          {' · '}
          <a
            href="https://beebeeb.io/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 text-ink-2 hover:text-ink transition-colors"
          >
            Privacy policy
          </a>
        </p>

        {/* Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={decline}
            className="px-3 py-1.5 rounded-lg border border-line text-[12px] font-medium text-ink-3 hover:text-ink hover:border-line-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={accept}
            className="px-3 py-1.5 rounded-lg bg-amber hover:brightness-105 border border-amber-deep/20 text-[12px] font-medium text-ink transition-colors cursor-pointer whitespace-nowrap"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}
