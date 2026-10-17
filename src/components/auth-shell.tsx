import { AuthShellFrame, type AuthShellFrameProps } from './auth-shell-frame'
import { AnnouncementBanner } from './announcement-banner'

type AuthShellProps = Omit<AuthShellFrameProps, 'banner'>

/**
 * The sign-in / onboarding card. Admin-broadcast notices (maintenance windows, status updates)
 * are pinned to the top so they are visible even before the user signs in.
 *
 * The banner fetches `/api/v1/announcements` through the shared request client, WITH
 * credentials. A page that must make no credentialed request (the exit survey, task 1920) uses
 * `AuthShellFrame` instead.
 */
export function AuthShell(props: AuthShellProps) {
  return <AuthShellFrame {...props} banner={<AnnouncementBanner />} />
}
