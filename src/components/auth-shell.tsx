import { AuthShellFrame, type AuthShellFrameProps } from './auth-shell-frame'
import { AnnouncementBanner } from './announcement-banner'
import { SignedOutInactiveNotice } from './account-inactive'

type AuthShellProps = Omit<AuthShellFrameProps, 'banner'>

/**
 * The sign-in / onboarding card. Admin-broadcast notices (maintenance windows, status updates)
 * are pinned to the top so they are visible even before the user signs in.
 *
 * The banner fetches `/api/v1/announcements` through the shared request client, WITH
 * credentials. A page that must make no credentialed request (the exit survey, task 1920) uses
 * `AuthShellFrame` instead.
 *
 * Task 1948 (1c): when this page load signed out a login whose account is no longer active,
 * every page in this card (sign-up, sign-in, onboarding) says so in one line above its content.
 */
export function AuthShell({ children, ...props }: AuthShellProps) {
  return (
    <AuthShellFrame {...props} banner={<AnnouncementBanner />}>
      <SignedOutInactiveNotice />
      {children}
    </AuthShellFrame>
  )
}
