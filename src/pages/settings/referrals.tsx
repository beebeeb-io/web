/**
 * Settings — Referrals
 *
 * "Give 10 GB, get 10 GB" — coming soon placeholder.
 * The full referral UI is preserved below as _SettingsReferralsFull
 * and can be re-enabled when the backend is ready.
 */

import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '@beebeeb/shared'

// ─── Coming soon placeholder ─────────────────────────────────────────────────

export function SettingsReferrals() {
  return (
    <SettingsShell activeSection="referrals">
      <SettingsHeader
        title="Referrals"
        subtitle="Invite friends and earn extra storage."
      />

      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div
          className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
          style={{
            background: 'var(--color-amber-bg)',
            border: '1.5px solid var(--color-line-2)',
          }}
        >
          <Icon name="users" size={24} className="text-amber-deep" />
        </div>

        <h2 className="text-[15px] font-semibold text-ink mb-1.5">Coming soon</h2>

        <p className="text-[13px] text-ink-3 max-w-[360px] leading-relaxed">
          Share your personal referral link and both you and your friend will get +10 GB of
          free encrypted storage. Track your referrals and earned storage right here.
        </p>
      </div>
    </SettingsShell>
  )
}

// ─── Original referral UI (preserved for re-enablement) ─────────────────────
// To restore: rename _SettingsReferralsFull back to SettingsReferrals and
// uncomment its imports.

/*
import { useState, useEffect, useRef, useCallback } from 'react'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { useAuth } from '../../lib/auth-context'
import { getReferralStats, listReferrals, type ReferralEntry } from '../../lib/api'

function deriveCode(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function twitterShareUrl(url: string): string {
  const text = encodeURIComponent(
    'I use Beebeeb for encrypted cloud storage — files are encrypted before they leave your device. Sign up and we both get +10 GB free:'
  )
  return `https://x.com/intent/post?text=${text}&url=${encodeURIComponent(url)}`
}

function whatsappShareUrl(url: string): string {
  const text = encodeURIComponent(
    `Try Beebeeb — end-to-end encrypted cloud storage. We both get +10 GB when you sign up: ${url}`
  )
  return `https://wa.me/?text=${text}`
}

function mailtoUrl(url: string): string {
  const subject = encodeURIComponent('You should try Beebeeb — encrypted cloud storage')
  const body = encodeURIComponent(
    `Hey,\n\nI've been using Beebeeb for encrypted cloud storage. Files are end-to-end encrypted before they leave your device — nobody else can read them.\n\nIf you sign up through my link, we both get +10 GB free storage: ${url}\n\nBeebeeb is made in Europe and open source. No tracking, no ads.`
  )
  return `mailto:?subject=${subject}&body=${body}`
}

function _SettingsReferralsFull() {
  const { user } = useAuth()

  const [code, setCode] = useState<string | null>(null)
  const [earnedGb, setEarnedGb] = useState(0)
  const [referralCount, setReferralCount] = useState(0)
  const [referrals, setReferrals] = useState<ReferralEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const referralUrl = code ? `${window.location.origin}/join/${code}` : null

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [stats, entries] = await Promise.all([
        getReferralStats(),
        listReferrals(),
      ])
      if (stats) {
        setCode(stats.code)
        setEarnedGb(stats.earned_gb)
        setReferralCount(stats.referral_count)
      } else {
        setCode(deriveCode(user.user_id))
      }
      setReferrals(entries)
    } catch (err) {
      console.error('Failed to load referrals:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { void load() }, [load])

  async function handleCopy() {
    if (!referralUrl) return
    await navigator.clipboard.writeText(referralUrl)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2500)
  }

  return (
    <SettingsShell activeSection="referrals">
      <SettingsHeader
        title="Referrals"
        subtitle="Give 10 GB, get 10 GB — invite a friend and you both get more storage."
      />

      <div className="p-7 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-paper p-5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-2">
              Storage earned
            </div>
            <div className="text-[32px] font-bold tracking-tight text-ink leading-none mb-1">
              {earnedGb} <span className="text-[18px] text-ink-3 font-medium">GB</span>
            </div>
            <div className="text-[12px] text-ink-3">
              {referralCount === 0
                ? 'Invite your first friend to start earning'
                : `From ${referralCount} friend${referralCount !== 1 ? 's' : ''}`}
            </div>
          </div>
          <div className="rounded-xl border border-amber/30 bg-amber-bg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-deep mb-2">
              How it works
            </div>
            <ul className="space-y-1.5 text-[12.5px] text-ink-2">
              <li className="flex gap-2"><span className="text-amber-deep font-bold shrink-0">1.</span> Share your link below</li>
              <li className="flex gap-2"><span className="text-amber-deep font-bold shrink-0">2.</span> Friend signs up + verifies email</li>
              <li className="flex gap-2"><span className="text-amber-deep font-bold shrink-0">3.</span> You both get +10 GB instantly</li>
            </ul>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-2">
            Your referral link
          </div>
          <div className="rounded-xl border border-line bg-paper overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
              {loading || !referralUrl ? (
                <div className="flex-1 h-5 rounded bg-paper-3 animate-pulse" />
              ) : (
                <code className="flex-1 font-mono text-[13px] text-ink-2 truncate select-all">
                  {referralUrl}
                </code>
              )}
              <BBButton
                size="sm"
                variant={copied ? 'default' : 'amber'}
                onClick={() => void handleCopy()}
                disabled={!referralUrl}
                className="shrink-0 gap-1.5"
              >
                <Icon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? 'Copied!' : 'Copy link'}
              </BBButton>
            </div>

            <div className="flex items-center gap-2 px-4 py-2.5 bg-paper-2 flex-wrap">
              <span className="text-[11.5px] text-ink-4 shrink-0">Share via:</span>
              {referralUrl && (
                <>
                  <a
                    href={mailtoUrl(referralUrl)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-2 border border-line rounded-md hover:border-ink-3 hover:text-ink transition-colors no-underline bg-paper"
                  >
                    <Icon name="mail" size={11} />
                    Email
                  </a>
                  <a
                    href={whatsappShareUrl(referralUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-2 border border-line rounded-md hover:border-ink-3 hover:text-ink transition-colors no-underline bg-paper"
                  >
                    WhatsApp
                  </a>
                  <a
                    href={twitterShareUrl(referralUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-2 border border-line rounded-md hover:border-ink-3 hover:text-ink transition-colors no-underline bg-paper"
                  >
                    Post on X
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4">
              Friends referred
            </div>
            {referralCount > 0 && (
              <BBChip variant="amber">{referralCount} friend{referralCount !== 1 ? 's' : ''}</BBChip>
            )}
          </div>

          {loading ? (
            <div className="rounded-xl border border-line bg-paper-2 py-8 flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : referrals.length === 0 ? (
            <div className="rounded-xl border border-line bg-paper-2 py-10 px-6 text-center">
              <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-paper border border-line flex items-center justify-center">
                <Icon name="users" size={16} className="text-ink-3" />
              </div>
              <div className="text-[13.5px] font-medium text-ink mb-1">No referrals yet</div>
              <div className="text-[12.5px] text-ink-3 max-w-[320px] mx-auto">
                Share your link above. When a friend signs up, they appear here and you both get +10 GB.
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-line overflow-x-auto">
              <div
                className="grid gap-4 px-5 py-2.5 bg-paper-2 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-4"
                style={{ gridTemplateColumns: '2fr 1fr 80px' }}
              >
                <span>Friend</span>
                <span>Joined</span>
                <span>Status</span>
              </div>
              {referrals.map((ref, i) => (
                <div
                  key={(ref as ReferralEntry & { id?: string }).id ?? ref.display_email ?? i}
                  className="grid gap-4 px-5 py-3 border-b border-line last:border-b-0 items-center hover:bg-paper-2/40 transition-colors"
                  style={{ gridTemplateColumns: '2fr 1fr 80px' }}
                >
                  <span className="font-mono text-[12.5px] text-ink-2">{ref.display_email}</span>
                  <span className="text-[12.5px] text-ink-3">{formatDate(ref.joined_at)}</span>
                  <BBChip variant={ref.status === 'active' ? 'green' : 'default'}>
                    {ref.status.charAt(0).toUpperCase() + ref.status.slice(1)}
                  </BBChip>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-[12px] text-ink-4 flex items-start gap-2 pt-1">
          <Icon name="shield" size={12} className="text-ink-4 shrink-0 mt-0.5" />
          <span>
            +10 GB per successful referral (friend verifies email and stays active for 7 days).
            Bonus storage is permanent. No limit on referrals.
          </span>
        </div>
      </div>
    </SettingsShell>
  )
}
*/
