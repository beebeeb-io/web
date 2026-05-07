/**
 * Trouble signing in? — Recovery path chooser.
 *
 * OPAQUE users cannot use a traditional email password-reset link: the reset
 * would overwrite the OPAQUE password file but leave the vault master key
 * intact, making the vault permanently unreadable. This page routes users to
 * the correct recovery path based on what they have access to.
 *
 * The old email-reset flow is intentionally not offered here. It's disabled
 * at the route level for any user with OPAQUE credentials.
 */

import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { Icon, type IconName } from '@beebeeb/shared'

interface OptionCardProps {
  icon: IconName
  title: string
  description: string
  cta: string
  ctaVariant?: 'amber' | 'default' | 'ghost'
  onClick?: () => void
  disabled?: boolean
  badge?: string
}

function OptionCard({ icon, title, description, cta, ctaVariant = 'default', onClick, disabled, badge }: OptionCardProps) {
  return (
    <div
      className={`relative rounded-lg border p-4 transition-colors ${
        disabled
          ? 'border-line bg-paper-2 opacity-60'
          : 'border-line bg-paper hover:border-line-2'
      }`}
    >
      {badge && (
        <span className="absolute top-3 right-3 px-1.5 py-0.5 bg-paper-3 border border-line rounded text-[10px] font-medium text-ink-3 uppercase tracking-wide">
          {badge}
        </span>
      )}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center shrink-0">
          <Icon name={icon} size={15} className="text-ink-2" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink mb-0.5">{title}</div>
          <div className="text-[12px] text-ink-3 leading-relaxed">{description}</div>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-[12.5px] font-medium py-1.5 px-3 rounded-md border transition-colors ${
          ctaVariant === 'amber'
            ? 'bg-amber text-[oklch(0.22_0.01_70)] border-transparent hover:brightness-95'
            : ctaVariant === 'ghost'
            ? 'bg-transparent border-line text-ink-3 cursor-default'
            : 'bg-paper-2 border-line text-ink-2 hover:bg-paper-3'
        }`}
      >
        {cta}
      </button>
    </div>
  )
}

export function ForgotPassword() {
  const navigate = useNavigate()
  const [showNoRecovery, setShowNoRecovery] = React.useState(false)

  if (showNoRecovery) {
    return (
      <AuthShell
        title="We cannot recover your account"
        hideTrust
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line">
            <Icon name="shield" size={14} className="text-ink-3 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Beebeeb is zero-knowledge by architecture. We never see your password
              or encryption keys. Without your recovery phrase or a logged-in device,
              we have no way to restore access to your vault.
            </p>
          </div>

          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            Your files are encrypted with keys only you hold. Even under a court
            order, we could not hand over your data in readable form.
          </p>

          <p className="text-[12.5px] text-ink-3 leading-relaxed">
            To prevent this in future, save your recovery phrase somewhere safe
            (password manager, printed copy in a fireproof location).
          </p>

          <div className="pt-2 space-y-2">
            <a
              href="https://docs.beebeeb.io/recovery"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12.5px] text-amber-deep hover:underline underline-offset-2"
            >
              <Icon name="link" size={12} />
              Recovery guide — preventing this in future
            </a>
            <p className="text-[12px] text-ink-4">
              If you need to delete this account, sign in on a device that still has access, then go to Settings &gt; Privacy.
            </p>
          </div>

          <button
            onClick={() => setShowNoRecovery(false)}
            className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors mt-1"
          >
            ← Back to recovery options
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Trouble signing in?"
      subtitle="Choose the recovery option that applies to you."
    >
      <div className="space-y-3">
        <OptionCard
          icon="key"
          title="I have my recovery phrase"
          description="The 12-word phrase shown during account setup. Use it to set a new password."
          cta="Recover with phrase →"
          ctaVariant="amber"
          onClick={() => navigate('/recover-with-phrase')}
        />

        <OptionCard
          icon="cloud"
          title="I have another device logged in"
          description="Approve access from a device where you're already signed in — no phrase needed."
          cta="Coming soon"
          ctaVariant="ghost"
          disabled
          badge="Soon"
        />

        <OptionCard
          icon="x"
          title="I have neither"
          description="We'll explain what this means for your data and your options."
          cta="Show my options"
          onClick={() => setShowNoRecovery(true)}
        />
      </div>

      <div className="text-center mt-5">
        <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
