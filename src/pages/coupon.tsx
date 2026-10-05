import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, BBButton, Icon } from '@beebeeb/shared'
import { AuthShell } from '../components/auth-shell'
import { useAuth } from '../lib/auth-context'
import { getCoupon, redeemCoupon } from '../lib/api'
import {
  claimedCopy,
  clearHeldCoupon,
  couponPath,
  holdCoupon,
  normalizeCouponCode,
  pitchHeadline,
  pitchTerms,
  refusalCopy,
  type CouponPitch,
  type CouponRedeemed,
  type RefusalCopy,
} from '../lib/coupon'

/**
 * `/c/:code` (task 1814, slice A: free grants). A public page: it shows what the
 * coupon grants, then routes a signed-out visitor to sign up (the code is held in
 * sessionStorage and redeemed once the account exists) or sign in, and lets a
 * signed-in account claim it with one click.
 *
 * `?from=signup` is where PlanGate sends a brand-new account that holds a coupon: it
 * claims once on arrival, because creating the account WAS the intent. A signed-in
 * visitor who merely opens a link always clicks first; a link is never a charge, but
 * it does spend this email address's one use of the coupon.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'pitch'; pitch: CouponPitch }
  | { kind: 'claiming'; pitch: CouponPitch }
  | { kind: 'claimed'; result: CouponRedeemed }
  | { kind: 'refused'; pitch: CouponPitch | null; refusal: RefusalCopy }

function Term({ label, text, id }: { label: string; text: string; id: string }) {
  return (
    <div data-testid={`coupon-term-${id}`} className="flex gap-3 py-2.5 border-b border-line last:border-b-0">
      <div className="w-[7.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-4 pt-[2px]">{label}</div>
      <div className="text-[13px] text-ink-2 leading-relaxed">{text}</div>
    </div>
  )
}

export function Coupon() {
  const { code: rawCode } = useParams()
  const code = normalizeCouponCode(rawCode)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromSignup = searchParams.get('from') === 'signup'
  const { user, loading: authLoading } = useAuth()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const autoClaimed = useRef(false)

  // The pitch: public, so it loads for a signed-out visitor too.
  useEffect(() => {
    if (!code) {
      setView({ kind: 'invalid' })
      return
    }
    let cancelled = false
    setView({ kind: 'loading' })
    getCoupon(code)
      .then((pitch) => {
        if (!cancelled) setView(pitch ? { kind: 'pitch', pitch } : { kind: 'invalid' })
      })
      .catch(() => {
        // A network or rate-limit failure is not "this link is bad".
        if (!cancelled) setView({ kind: 'refused', pitch: null, refusal: refusalCopy(undefined, undefined) })
      })
    return () => {
      cancelled = true
    }
  }, [code])

  // A link that no longer works must also end the hold, or PlanGate would keep sending a
  // new account back here instead of to the plan chooser.
  useEffect(() => {
    if (view.kind === 'invalid') clearHeldCoupon()
  }, [view.kind])

  const claim = useCallback(
    async (pitch: CouponPitch | null) => {
      if (!code) return
      if (pitch) setView({ kind: 'claiming', pitch })
      try {
        const result = await redeemCoupon(code)
        clearHeldCoupon()
        // The shared subscription cache re-reads, so the plan gate lifts by itself.
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        setView({ kind: 'claimed', result })
      } catch (err) {
        const e = err instanceof ApiError ? err : null
        const refusal = refusalCopy(e?.code, e?.status)
        // A refusal that will not change on a retry ends the hold, or PlanGate would
        // keep sending this account back here instead of to the plan chooser.
        if (refusal.action !== 'retry' && refusal.action !== 'verify_email') clearHeldCoupon()
        setView({ kind: 'refused', pitch, refusal })
      }
    },
    [code],
  )

  // A new account that came here from signup claims once, without another click.
  useEffect(() => {
    if (!fromSignup || !user || authLoading || autoClaimed.current) return
    if (view.kind !== 'pitch') return
    autoClaimed.current = true
    void claim(view.pitch)
  }, [fromSignup, user, authLoading, view, claim])

  const here = code ? couponPath(code) : '/'

  function startSignup() {
    if (code) holdCoupon(code)
    navigate('/signup')
  }
  function startLogin() {
    // No hold: signing in comes back to this page (`next`), where the claim is one click.
    navigate(`/login?next=${encodeURIComponent(here)}`)
  }
  function skipToPlans() {
    clearHeldCoupon()
    navigate('/choose-plan')
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  if (view.kind === 'loading' || authLoading) {
    return (
      <AuthShell title="Opening your coupon" hideTrust>
        <div data-testid="coupon-loading" className="flex items-center justify-center py-8" aria-busy="true">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
        </div>
      </AuthShell>
    )
  }

  if (view.kind === 'invalid') {
    return (
      <AuthShell title="This link does not work any more" subtitle="It may have expired, been used up or been turned off. Ask whoever sent it for a new one." hideTrust>
        <div data-testid="coupon-invalid" className="flex flex-col gap-3">
          <Link to="/" className="text-[13px] text-amber-deep font-medium hover:underline">
            {user ? 'Back to your drive' : 'Go to Beebeeb'}
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (view.kind === 'claimed') {
    const copy = claimedCopy(view.result)
    return (
      <AuthShell title={copy.title} subtitle={copy.body} hideTrust>
        <div data-testid="coupon-claimed" className="flex flex-col gap-3">
          <BBButton variant="amber" size="lg" className="w-full" onClick={() => navigate('/')} data-testid="coupon-open-drive">
            Open your drive
          </BBButton>
        </div>
      </AuthShell>
    )
  }

  if (view.kind === 'refused') {
    const { refusal } = view
    return (
      <AuthShell title={refusal.title} subtitle={refusal.body} hideTrust>
        <div data-testid="coupon-refused" data-refusal={refusal.action} className="flex flex-col gap-3">
          {refusal.action === 'drive' && (
            <BBButton variant="amber" size="lg" className="w-full" onClick={() => navigate('/')}>
              Back to your drive
            </BBButton>
          )}
          {refusal.action === 'choose_plan' && user && (
            <BBButton variant="amber" size="lg" className="w-full" onClick={skipToPlans}>
              Choose a plan
            </BBButton>
          )}
          {refusal.action === 'verify_email' && (
            <BBButton variant="amber" size="lg" className="w-full" onClick={() => navigate('/verify-email')}>
              Verify your email
            </BBButton>
          )}
          {refusal.action === 'retry' && (
            <BBButton variant="default" size="lg" className="w-full" onClick={() => void claim(view.pitch)}>
              Try again
            </BBButton>
          )}
        </div>
      </AuthShell>
    )
  }

  const { pitch } = view
  const claiming = view.kind === 'claiming'
  return (
    <AuthShell
      title={pitchHeadline(pitch)}
      subtitle="Someone gave you this. There is nothing to pay and no card to enter."
      hideTrust
    >
      <div data-testid="coupon-pitch" className="flex flex-col">
        <div className="rounded-lg border border-line bg-paper-2 px-3.5 mb-4">
          {pitchTerms(pitch).map((t) => (
            <Term key={t.id} id={t.id} label={t.label} text={t.text} />
          ))}
        </div>

        {user ? (
          <BBButton
            variant="amber"
            size="lg"
            className="w-full"
            disabled={claiming}
            onClick={() => void claim(pitch)}
            data-testid="coupon-claim"
          >
            {claiming ? 'Claiming…' : `Claim ${pitch.plan_label} for ${pitch.duration_months} month${pitch.duration_months === 1 ? '' : 's'}`}
          </BBButton>
        ) : (
          <>
            <BBButton variant="amber" size="lg" className="w-full" onClick={startSignup} data-testid="coupon-signup">
              Create your account
            </BBButton>
            <p className="text-xs text-ink-3 text-center mt-4">
              Already have an account?{' '}
              <button type="button" onClick={startLogin} data-testid="coupon-login" className="text-amber-deep font-medium hover:underline cursor-pointer">
                Log in
              </button>
            </p>
          </>
        )}

        <div className="border-t border-line mt-[18px] pt-3.5 flex items-center gap-2 text-[11px] text-ink-3">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0" />
          <span>End-to-end encrypted. Stored in the EU.</span>
        </div>
      </div>
    </AuthShell>
  )
}
