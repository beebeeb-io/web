import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { SplitAuthScreen } from '../components/split-auth-screen'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import { getApiUrl } from '../lib/api'

async function validateReferralCode(code: string): Promise<void> {
  try {
    const res = await fetch(`${getApiUrl()}/api/v1/referrals/validate/${encodeURIComponent(code)}`)
    if (!res.ok && res.status !== 404) {
      // Non-404 errors are still ignored — code validated at signup
    }
  } catch {
    // Network error — still show page
  }
}

export function JoinPage() {
  const { code } = useParams<{ code: string }>()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!code) return
    void validateReferralCode(code).then(() => setReady(true))
  }, [code])

  if (!code) return <Navigate to="/signup" replace />

  const signupUrl = `/signup?ref=referral&code=${encodeURIComponent(code)}`

  const contextPanel = (
    <div className="max-w-[384px] w-full space-y-8">
      <div>
        <div className="mb-4">
          <BBChip variant="amber">10 GB free encrypted storage</BBChip>
        </div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink leading-tight mb-3">
          You've been invited to Beebeeb
        </h1>
        <p className="text-[14.5px] text-ink-3 leading-relaxed">
          Private cloud storage that encrypts your files before they leave your device. Nobody else can read them — not even us.
        </p>
      </div>

      <ul className="space-y-4">
        <li className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-bg border border-amber/30 flex items-center justify-center shrink-0 mt-0.5">
            <Icon name="shield" size={14} className="text-amber-deep" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-ink mb-0.5">End-to-end encrypted</div>
            <div className="text-[12.5px] text-ink-3">Files are encrypted on your device before upload. Your keys never leave your device.</div>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-bg border border-amber/30 flex items-center justify-center shrink-0 mt-0.5">
            <Icon name="cloud" size={14} className="text-amber-deep" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-ink mb-0.5">EU servers</div>
            <div className="text-[12.5px] text-ink-3">Stored in Falkenstein. Hetzner. Under EU jurisdiction and GDPR.</div>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-bg border border-amber/30 flex items-center justify-center shrink-0 mt-0.5">
            <Icon name="users" size={14} className="text-amber-deep" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-ink mb-0.5">Works everywhere</div>
            <div className="text-[12.5px] text-ink-3">Web, mobile, desktop, and CLI — your files follow you across all devices.</div>
          </div>
        </li>
      </ul>
    </div>
  )

  return (
    <SplitAuthScreen contextPanel={contextPanel}>
      <div className="max-w-[384px] w-full space-y-6">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-ink mb-2">
            Create your account
          </h2>
          <p className="text-[13.5px] text-ink-3">
            Your referral code is applied automatically. You and your friend both get +10 GB when you sign up.
          </p>
        </div>

        <div className="rounded-xl border border-amber/30 bg-amber-bg px-4 py-3 flex items-center gap-3">
          <Icon name="check" size={14} className="text-amber-deep shrink-0" />
          <span className="text-[13px] text-amber-deep font-medium">
            Referral code applied — 10 GB bonus waiting for you
          </span>
        </div>

        <BBButton
          variant="amber"
          size="lg"
          className="w-full"
          disabled={!ready}
          onClick={() => { window.location.href = signupUrl }}
        >
          Get started — it's free
        </BBButton>

        <p className="text-[12px] text-ink-4 text-center">
          Already have an account?{' '}
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Log in
          </a>
        </p>

        <div className="border-t border-line pt-4 flex items-center gap-2 text-[11px] text-ink-3">
          <Icon name="shield" size={12} className="text-amber-deep shrink-0" />
          <span>Stored in Falkenstein. Hetzner. Under EU jurisdiction.</span>
        </div>
      </div>
    </SplitAuthScreen>
  )
}
