/**
 * Settings — Referrals
 *
 * "Give 10 GB, get 10 GB" — each user gets a unique referral link.
 * When a friend signs up via it, both accounts receive +10 GB storage.
 *
 * Referral code: derived deterministically from user_id (first 8 hex chars
 * without dashes) until the server-side /api/v1/referrals/stats endpoint
 * is deployed. The landing page at beebeeb.io/r/<code> captures the code
 * and forwards it to the signup page.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { Icon } from '../../components/icons'
import { useAuth } from '../../lib/auth-context'
import { getReferralStats, listReferrals, type ReferralEntry } from '../../lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a short, URL-safe referral code from a UUID-style user_id. */
function deriveCode(userId: string): string {
  // Take the first 8 hex chars of the UUID (before/without dashes).
  // Deterministic, readable, hard enough to guess.
  return userId.replace(/-/g, '').slice(0, 8)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ─── Share channel helpers ───────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SettingsReferrals() {
  const { user } = useAuth()

  // Referral code — from server if available, otherwise derived from user_id
  const [code, setCode] = useState<string | null>(null)
  const [earnedGb, setEarnedGb] = useState(0)
  const [referralCount, setReferralCount] = useState(0)
  const [referrals, setReferrals] = useState<ReferralEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Copy state
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const referralUrl = code ? `https://beebeeb.io/r/${code}` : null

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
        // Endpoint not deployed — derive code client-side
        setCode(deriveCode(user.user_id))
      }
      setReferrals(entries)
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SettingsShell activeSection="referrals">
      <SettingsHeader
        title="Referrals"
        subtitle="Give 10 GB, get 10 GB — invite a friend and you both get more storage."
      />

      <div className="p-7 space-y-6">

        {/* ── Hero stats ── */}
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

        {/* ── Referral link ── */}
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

            {/* Share channels */}
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
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </a>
                  <a
                    href={twitterShareUrl(referralUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-2 border border-line rounded-md hover:border-ink-3 hover:text-ink transition-colors no-underline bg-paper"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.261 5.635 5.902-5.635zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    Post on X
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Referral list ── */}
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
            <div className="rounded-xl border border-line overflow-hidden">
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
                  key={i}
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

        {/* ── Terms note ── */}
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
