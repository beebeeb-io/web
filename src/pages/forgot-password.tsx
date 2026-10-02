/**
 * Trouble signing in? — Recovery path chooser.
 *
 * OPAQUE users cannot use a traditional email password-reset link: the reset
 * would overwrite the OPAQUE password file but leave the vault master key
 * intact, making the vault permanently unreadable. This page routes users to
 * the correct recovery path based on what they have access to.
 *
 * Task 1713 FIX A — the chooser ALSO exposes the email-based reset entry
 * (the amendment, D-2026-10-02): posting to the shipped, always-200
 * enumeration-safe endpoint (POST /api/v1/auth/forgot-password) emails a
 * one-time 60-minute set-password link (1704 slice 1). The copy stays honest
 * about what that does and does not do: it replaces the sign-in credential,
 * it does NOT decrypt anything — the vault stays locked until the recovery
 * phrase re-wraps it.
 */

import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { ApiError, BBButton, BBInput, Icon, type IconName } from '@beebeeb/shared'
import { forgotPassword } from '../lib/api'

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

/**
 * FIX A — the email-reset entry's network call, exported so the harness pin
 * can prove at the HTTP level what leaves the browser (test/
 * 1713-forgot-password-email-entry.test.tsx): exactly one POST to the shipped
 * enumeration-safe endpoint with the email and nothing else. The server's
 * verbatim 200 message comes back — it is the only honest thing to show.
 */
export async function submitEmailReset(email: string): Promise<string> {
  const res = await forgotPassword(email)
  return res.message
}

/**
 * FIX A — the post-submit success screen. Shows the server's enumeration-safe
 * message VERBATIM (never paraphrased into a promise) plus the honest truths:
 * the emailed link is one-time and expires in 60 minutes
 * (SET_PASSWORD_TOKEN_TTL_MINUTES, repos/server/beebeeb-api/src/routes/
 * password.rs:323), it lets the user set a new password — and that does NOT
 * unlock the vault. The vault stays locked until the recovery phrase re-wraps
 * it under the new password (1704 slice 2's locked-state surface handles the
 * aftermath after the next sign-in).
 */
export function EmailResetSuccess({ message }: { message: string }) {
  return (
    <AuthShell
      title="Check your email"
      subtitle="Follow the link in that message to set a new password."
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line">
          <Icon name="mail" size={14} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">{message}</p>
        </div>

        <p className="text-[12.5px] text-ink-2 leading-relaxed">
          The link is one-time and opens a page where you can set a new
          password. It works for 60 minutes — after that, request a fresh link.
        </p>

        <p className="text-[12.5px] text-ink-3 leading-relaxed">
          Setting a new password changes how you sign in. It does not unlock
          your vault: your vault stays locked until you verify your recovery
          phrase, which re-wraps it under the new password.
        </p>

        <div className="text-center pt-2 border-t border-line mt-1">
          <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  )
}

export function ForgotPassword() {
  const navigate = useNavigate()
  const [showNoRecovery, setShowNoRecovery] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [emailError, setEmailError] = React.useState<string | null>(null)
  const [resetMessage, setResetMessage] = React.useState<string | null>(null)

  if (resetMessage !== null) {
    return <EmailResetSuccess message={resetMessage} />
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setEmailError(null)
    try {
      const message = await submitEmailReset(trimmed)
      setResetMessage(message)
    } catch (err) {
      setEmailError(
        err instanceof ApiError
          ? err.message
          : 'We could not send the reset request. Check the address and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

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

          <div className="pt-2 space-y-2 border-t border-line mt-1">
            <p className="text-[12.5px] font-semibold text-ink pt-3">What we can still do</p>
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              We cannot decrypt your files or reset your vault — that is the
              architecture, not a policy we can make an exception to. We can help
              you close the account, confirm what was stored, and answer questions
              about billing.
            </p>
            <a
              href="mailto:support@beebeeb.io"
              className="flex items-center gap-1.5 text-[12.5px] text-amber-deep hover:underline underline-offset-2"
            >
              <Icon name="mail" size={12} />
              support@beebeeb.io
            </a>
            <p className="text-[12px] text-ink-4 leading-relaxed">
              Include the email address on the account. Do not send us your
              recovery phrase — it is useless to us and dangerous to send.
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

        <div className="relative rounded-lg border p-4 transition-colors border-line bg-paper hover:border-line-2">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Icon name="mail" size={15} className="text-ink-2" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-ink mb-0.5">I know my email address</div>
              <div className="text-[12px] text-ink-3 leading-relaxed">
                We email a one-time link to set a new password. It does not decrypt your files — your vault stays locked until your recovery phrase re-wraps it.
              </div>
            </div>
          </div>
          <form onSubmit={handleEmailSubmit}>
            <BBInput
              type="email"
              placeholder="you@example.com"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <BBButton
              type="submit"
              className="w-full mt-2"
              disabled={submitting || !email.trim()}
            >
              Send reset link
            </BBButton>
          </form>
          {emailError && (
            <p className="text-[12px] text-red mt-1.5 leading-relaxed">{emailError}</p>
          )}
        </div>

        <OptionCard
          icon="cloud"
          title="I have another device logged in"
          description="Approve access from a device where you're already signed in — no phrase needed."
          cta="Coming soon"
          ctaVariant="ghost"
          disabled
          badge="Soon"
        />
        <p className="text-[11.5px] text-ink-3 leading-relaxed -mt-1.5 px-1">
          For now, use your recovery phrase on the other device to export your files, then re-register.
        </p>

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
