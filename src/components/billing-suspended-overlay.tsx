import { BBButton } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { useNavigate } from 'react-router-dom'
import { createPortalSession } from '../lib/api'

export function BillingSuspendedOverlay() {
  const { user } = useAuth()
  const { planDetails } = useDriveData()
  const navigate = useNavigate()
  const sub = planDetails.subscription
  const state = sub?.billing_state

  if (!user || state !== 'suspended') return null

  const pastDueSince = sub?.past_due_since ? new Date(sub.past_due_since) : null
  const deletionDate = pastDueSince
    ? new Date(pastDueSince.getTime() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : null

  async function handleUpdatePayment() {
    try {
      const result = await createPortalSession()
      if (result) {
        window.location.href = result.url
        return
      }
    } catch {
      // fall through to billing settings
    }
    navigate('/settings/billing')
  }

  return (
    <div className="fixed inset-0 z-[100] bg-paper flex items-center justify-center p-xl">
      <div className="text-center max-w-[28rem]">
        <div className="mb-xl">
          <BBLogo size={16} />
        </div>

        <div className="mx-auto mb-lg flex items-center justify-center rounded-xl"
          style={{ width: 56, height: 56, background: 'var(--color-paper-2)', border: '1px solid var(--color-line)' }}>
          <Icon name="shield" size={24} className="text-red" />
        </div>

        <h1 className="text-xl font-bold text-ink mb-sm">Your account is suspended</h1>

        <p className="text-sm text-ink-3 leading-relaxed mb-md">
          We haven't received payment for your subscription. Your files are still encrypted and safe,
          but you need to update your payment method to restore access.
        </p>

        {deletionDate && (
          <p className="text-sm text-red font-medium mb-lg">
            If no action is taken, your files will be permanently deleted on {deletionDate}.
          </p>
        )}

        <div className="flex flex-wrap gap-sm justify-center">
          <BBButton variant="amber" size="lg" onClick={() => void handleUpdatePayment()}>
            Update payment method
          </BBButton>
          <BBButton size="lg" onClick={() => navigate('/settings/billing')}>
            Export my data
          </BBButton>
        </div>
      </div>
    </div>
  )
}
