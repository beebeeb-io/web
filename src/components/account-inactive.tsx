/**
 * Task 1948 (1c) — the two surfaces for a login whose account is no longer active.
 * The logic and the exact copy live in `src/lib/account-inactive.ts`.
 *
 * Neither surface says WHY the account is not active (Guus's ruling 1c): the
 * device may have held someone else's login, and the reason is theirs.
 */
import { useNavigate } from 'react-router-dom'
import { BBButton, Icon } from '@beebeeb/shared'
import { AuthShellFrame } from './auth-shell-frame'
import {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_INACTIVE_SUPPORT_EMAIL,
  clearSignedOutInactive,
  useSignedOutInactive,
} from '../lib/account-inactive'

/**
 * Public pages (sign-up, sign-in, onboarding): one calm line at the top of the
 * card, after which the page works as normal. `AuthShell` draws it, so every
 * page in that card gets it without its own wiring.
 */
export function SignedOutInactiveNotice() {
  const inactive = useSignedOutInactive()
  if (!inactive) return null
  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-line bg-paper-2 px-3.5 py-3 flex items-start gap-2.5"
      data-testid="account-inactive-notice"
    >
      <Icon name="info" size={14} className="text-ink-3 shrink-0 mt-[2px]" />
      <p className="text-[12.5px] text-ink-2 leading-relaxed">{ACCOUNT_INACTIVE_NOTICE}</p>
    </div>
  )
}

/**
 * Signed-in pages: ProtectedRoute renders this instead of sending the person to
 * the sign-in page, so they learn what happened. The login on this device is
 * already cleared (`signOutInactiveLocally`); Sign out acknowledges it and opens
 * the sign-in page. Drawn in the frame WITHOUT the announcement banner, whose
 * request would carry the same dead cookie.
 */
export function AccountInactiveScreen() {
  const navigate = useNavigate()
  return (
    <AuthShellFrame title="This account is not active" hideTrust>
      <div data-testid="account-inactive-screen" className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-2 leading-relaxed">
          We signed you out on this device.
        </p>
        <p className="text-[13px] text-ink-2 leading-relaxed">
          Questions about this account? Write to{' '}
          <a
            href={`mailto:${ACCOUNT_INACTIVE_SUPPORT_EMAIL}`}
            className="font-medium text-ink underline underline-offset-2"
            data-testid="account-inactive-support"
          >
            {ACCOUNT_INACTIVE_SUPPORT_EMAIL}
          </a>
          .
        </p>
        <BBButton
          variant="default"
          size="lg"
          className="w-full justify-center"
          data-testid="account-inactive-sign-out"
          onClick={() => {
            clearSignedOutInactive()
            navigate('/login', { replace: true })
          }}
        >
          Sign out
        </BBButton>
      </div>
    </AuthShellFrame>
  )
}
