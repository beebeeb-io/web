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

  if (!user) return null

  if (sub?.storage_grace_deadline) {
    const deadline = new Date(sub.storage_grace_deadline)
    const now = new Date()
    if (deadline > now) {
      const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      return (
        <div className="bg-amber-bg border-b border-amber/30 px-4 py-2.5 flex items-center gap-3">
          <Icon name="clock" size={14} className="text-amber-deep shrink-0" />
          <span className="text-[12.5px] text-ink flex-1">
            <strong>{daysLeft} days</strong> to reduce your storage below your plan limit.
            After that, your oldest files will be automatically deleted.
          </span>
          <BBButton size="sm" variant="amber" onClick={() => navigate('/billing')}>
            Manage storage
          </BBButton>
        </div>
      )
    }
  }

  if (!state || state === 'active') return null

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
