/**
 * GDPR cookie consent banner.
 *
 * Beebeeb uses only essential session cookies — no tracking, analytics, or
 * third-party scripts. This banner exists for GDPR transparency, not for
 * granular opt-in. A single "OK, got it" click stores the preference in
 * localStorage and the banner never reappears.
 *
 * Mounts at the app root so it shows on all pages, authenticated or not.
 */

import { useState } from 'react'

const CONSENT_KEY = 'bb_cookie_consent'

export function CookieBanner() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem(CONSENT_KEY) !== '1',
  )

  if (!visible) return null

  function accept() {
    localStorage.setItem(CONSENT_KEY, '1')
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      aria-modal="false"
      className="fixed bottom-0 inset-x-0 z-[9999] px-4 pb-4 pointer-events-none"
    >
      {/* Card: full-bleed strip on desktop, padded on mobile */}
      <div className="pointer-events-auto w-full max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-line bg-paper-2/95 backdrop-blur-sm shadow-2 px-4 py-3 animate-slide-in-up">
        <p className="text-[12px] text-ink-2 leading-relaxed">
          Beebeeb uses only essential cookies for authentication.{' '}
          <span className="text-ink">No tracking, no analytics, no third parties.</span>{' '}
          <a
            href="https://beebeeb.io/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 text-ink-2 hover:text-ink transition-colors"
          >
            Privacy policy
          </a>
        </p>
        <button
          type="button"
          onClick={accept}
          className="w-full sm:w-auto shrink-0 px-3 py-1.5 rounded-lg bg-paper-3 hover:bg-paper-3/80 border border-line text-[12px] font-medium text-ink transition-colors cursor-pointer whitespace-nowrap"
        >
          OK, got it
        </button>
      </div>
    </div>
  )
}
