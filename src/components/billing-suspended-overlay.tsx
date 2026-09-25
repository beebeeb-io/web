import { BBButton } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { useNavigate } from 'react-router-dom'
import { updatePaymentMethod } from '../lib/api'
import { suspendedAccountSafetyMessage } from '../lib/suspended-overlay-copy'

export function BillingSuspendedOverlay() {
  const { user } = useAuth()
  const { planDetails } = useDriveData()
  const navigate = useNavigate()
  const sub = planDetails.subscription
  const state = sub?.billing_state

  if (!user || state !== 'suspended') return null

  async function handleUpdatePayment() {
    try {
      const { url } = await updatePaymentMethod()
      window.location.href = url
      return
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

        <p className="text-sm text-ink-3 leading-relaxed mb-lg">
          {suspendedAccountSafetyMessage()}
        </p>

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
