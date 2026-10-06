import { Link } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import { AuthShell } from '../components/auth-shell'

/**
 * The fixed page a native app's checkout returns to (task 1743, spec 4.3 / 5.9).
 *
 * The desktop app opens the Mollie hosted checkout in the SYSTEM browser and cannot
 * receive a deep link, so it polls `GET /onboarding` while the person pays. When the
 * payment page is done, Mollie sends the browser here. The server chooses this URL
 * (`checkout_return::APP_RETURN_PATH`, for `return_kind: "app"`); no client ever
 * supplies one, and this route must stay exactly `/return-to-app`.
 *
 * Public on purpose: the system browser holds no web session, so the page must make no
 * authenticated call and must never bounce to /login (it is in App.tsx's
 * PUBLIC_ROUTE_PATTERNS). It also cannot tell whether the payment succeeded, because
 * Mollie redirects here after a cancel or a failure too; the copy says so instead of
 * guessing, and the app is the one place that learns the real state from the server.
 */
export const RETURN_TO_APP_PATH = '/return-to-app'

export function ReturnToApp() {
  return (
    <AuthShell
      title="Return to the Beebeeb app"
      subtitle="Your browser's part is done. The app checks with us and updates on its own, usually within a few seconds."
      hideTrust
    >
      <div data-testid="return-to-app" className="flex flex-col gap-4">
        <div className="rounded-lg border border-line bg-paper-2 px-3.5 py-3 flex gap-2.5 text-[13px] text-ink-2 leading-relaxed">
          <Icon name="clock" size={15} className="text-amber-deep shrink-0 mt-[3px]" />
          <p data-testid="return-to-app-note">
            If the app still shows your old plan after a minute, the payment may not have completed. Check Billing on
            the web, or start again from the app.
          </p>
        </div>
        <Link
          to="/billing"
          data-testid="return-to-app-billing"
          className="text-[13px] text-amber-deep font-medium hover:underline self-start"
        >
          Open Billing on the web
        </Link>
      </div>
    </AuthShell>
  )
}
