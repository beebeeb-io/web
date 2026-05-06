import { Icon } from '@beebeeb/shared'
import { useImpersonation } from '../lib/impersonation-context'

export function ImpersonationBanner() {
  const { impersonatingEmail, stopImpersonation } = useImpersonation()

  if (!impersonatingEmail) return null

  return (
    <div
      role="alert"
      className="w-full px-md py-1.5 flex items-center justify-center gap-sm text-xs font-medium bg-amber-bg text-amber-deep"
    >
      <Icon name="eye" size={14} />
      <span>
        Viewing as{' '}
        <span className="font-mono">{impersonatingEmail}</span>
      </span>
      <span className="mx-1">—</span>
      <button
        onClick={stopImpersonation}
        className="underline hover:no-underline font-semibold cursor-pointer"
      >
        Exit
      </button>
    </div>
  )
}
