/**
 * Email verification nudge banner.
 *
 * Shown at the top of authenticated pages when `user.email_verified === false`.
 * Dismissible per-session (sessionStorage). Lets the user enter the 6-digit
 * code inline or request a resend — no page navigation needed.
 */

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/auth-context'
import { useToast } from './toast'
import { verifyEmail, resendVerification } from '../lib/api'
import { Icon } from '@beebeeb/shared'

const DISMISSED_KEY = 'bb_email_verify_dismissed'

export function EmailVerifyBanner() {
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()

  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === '1',
  )
  const [expanded, setExpanded] = useState(false)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Focus the code field when the inline form opens
  useEffect(() => {
    if (expanded) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [expanded])

  // Tick down the resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return
    cooldownRef.current = setInterval(() => {
      setResendCooldown((n) => {
        if (n <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [resendCooldown])

  // Don't show when verified, dismissed, or user not loaded
  if (!user || user.email_verified || dismissed) return null

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (verifying || code.trim().length < 4) return
    setVerifying(true)
    try {
      await verifyEmail(code.trim())
      await refreshUser()
      showToast({ icon: 'check', title: 'Email verified', description: 'Your email address has been confirmed.' })
      // Banner will auto-hide because user.email_verified is now true
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Invalid code',
        description: err instanceof Error ? err.message : 'That code didn\'t work. Try again or request a new one.',
        danger: true,
      })
      setCode('')
      inputRef.current?.focus()
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (resending || resendCooldown > 0) return
    setResending(true)
    try {
      await resendVerification()
      setResendCooldown(60)
      showToast({ icon: 'cloud', title: 'Verification email sent', description: 'Check your inbox for a new 6-digit code.' })
      setExpanded(true)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not resend',
        description: err instanceof Error ? err.message : 'Something went wrong. Try again in a moment.',
        danger: true,
      })
    } finally {
      setResending(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2.5 bg-amber-bg border-b border-amber/30 text-[12.5px] text-ink"
    >
      <Icon name="shield" size={12} className="text-amber-deep shrink-0" />

      <span className="flex-1 text-ink-2">
        Check your email for a verification code.
      </span>

      {/* Inline code entry */}
      {expanded ? (
        <form onSubmit={handleVerify} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={verifying}
            aria-label="Verification code"
            className="w-24 px-2 py-1 rounded border border-amber/40 bg-paper text-[12px] font-mono text-center focus:outline-none focus:ring-1 focus:ring-amber/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={verifying || code.trim().length < 4}
            className="px-2.5 py-1 rounded bg-amber text-ink text-[12px] font-medium disabled:opacity-50 hover:brightness-105 transition-all cursor-pointer"
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => { setExpanded(false); setCode('') }}
            className="text-ink-3 hover:text-ink transition-colors cursor-pointer text-[12px]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-2.5 py-1 rounded bg-amber text-ink text-[12px] font-medium hover:brightness-105 transition-all cursor-pointer"
          >
            Enter code
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            className="px-2.5 py-1 rounded border border-amber/40 text-ink-2 text-[12px] font-medium disabled:opacity-50 hover:bg-amber-bg/60 transition-colors cursor-pointer"
          >
            {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : resending ? 'Sending…' : 'Resend'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss verification banner"
        className="shrink-0 p-0.5 text-ink-3 hover:text-ink transition-colors cursor-pointer"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
