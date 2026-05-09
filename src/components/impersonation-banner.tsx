import { Icon } from '@beebeeb/shared'
import { useImpersonation } from '../lib/impersonation-context'

/**
 * Persistent red banner shown across the whole app while the current session
 * was created via admin impersonation (task 0161). Has no dismiss control —
 * the only way out is the explicit "Exit support view" action so the admin
 * cannot accidentally hide the indicator and forget they're acting as the
 * target user.
 */
export function ImpersonationBanner() {
  const { impersonatingEmail, stopImpersonation } = useImpersonation()

  if (!impersonatingEmail) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full px-md py-2 flex items-center justify-center gap-sm text-xs font-semibold bg-red text-white"
    >
      <Icon name="eye" size={14} />
      <span className="uppercase tracking-wide text-[10px] font-bold">Support view</span>
      <span className="mx-1 opacity-60">·</span>
      <span>
        You are viewing as{' '}
        <span className="font-mono">{impersonatingEmail}</span>
      </span>
      <span className="mx-1 opacity-60">·</span>
      <span className="opacity-90">Session expires in 15 minutes</span>
      <span className="mx-1 opacity-60">·</span>
      <button
        onClick={stopImpersonation}
        className="underline hover:no-underline font-semibold cursor-pointer"
      >
        Exit support view
      </button>
    </div>
  )
}
