import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { useNavigate } from 'react-router-dom'

export function BillingBanner() {
  const { user } = useAuth()
  const { planDetails } = useDriveData()
  const navigate = useNavigate()
  const sub = planDetails.subscription
  const state = sub?.billing_state

  if (!user || !state || state === 'active') return null

  if (state === 'grace') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-bg border-b border-amber/30 text-[12.5px]">
        <Icon name="shield" size={12} className="text-amber-deep shrink-0" />
        <span className="flex-1 text-ink-2">
          Your last payment failed. Update your payment method to avoid losing access.
        </span>
        <BBButton size="sm" variant="amber" onClick={() => navigate('/settings/billing')}>
          Update payment
        </BBButton>
      </div>
    )
  }

  if (state === 'read_only') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-red/10 border-b border-red/30 text-[12.5px]">
        <Icon name="x" size={12} className="text-red shrink-0" />
        <span className="flex-1 text-ink-2">
          Your account is read-only due to an unpaid invoice. Uploads and sharing are disabled.
        </span>
        <BBButton size="sm" variant="danger" onClick={() => navigate('/settings/billing')}>
          Update payment
        </BBButton>
      </div>
    )
  }

  return null
}
