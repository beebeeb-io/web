import { useState, useEffect, useCallback, useRef } from 'react'
import { BBButton } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import {
  getBillingProfile,
  saveBillingProfile,
  getVatPreview,
  type BillingProfile,
  type BillingProfilePayload,
  type CompanyRegistrationType,
  type CustomerType,
  type VatPreview,
  type VatState,
} from '../../lib/api'
import {
  EU_COUNTRIES,
  NON_EU_COUNTRIES,
  isEuCountry,
  COMPANY_REG_TYPE_OPTIONS,
  defaultRegTypeForCountry,
} from '../../lib/countries'
import { userFriendlyError } from '../../lib/user-friendly-error'

type BillingCycle = 'monthly' | 'yearly'

interface BillingInfoStepProps {
  planId: string
  planName: string
  cycle: BillingCycle
  /** Net catalog price (cents) for the chosen cycle — used as a fallback in the
   *  price summary until the live VAT preview resolves. */
  netCentsFallback: number
  /** Called once the profile is persisted; the parent then redirects to Mollie. */
  onProceed: (profile: BillingProfile) => void | Promise<void>
  onBack?: () => void
}

/** Money formatter — integer cents → "EUR 39.95". Amounts render in mono. */
function eur(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`
}

/** VIES feedback for a cross-border B2B VAT number. `valid`/`invalid`/`unreachable`
 *  mirror the server's `vat_validated` string verdict; `checking` is the in-flight
 *  state; `idle` shows nothing. */
type ViesState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'valid' } // reverse charge / 0% will apply
  | { kind: 'invalid' }
  | { kind: 'unreachable' }

/** Map the server's `vat_validated` verdict to the feedback state. `unchecked`
 *  (domestic NL B2B, or no number) shows nothing. */
function viesStateFromVerdict(verdict: VatState): ViesState {
  switch (verdict) {
    case 'valid':
      return { kind: 'valid' }
    case 'invalid':
    case 'invalid_format':
      return { kind: 'invalid' }
    case 'unreachable':
      return { kind: 'unreachable' }
    case 'unchecked':
    default:
      return { kind: 'idle' }
  }
}

export function BillingInfoStep({
  planId,
  planName,
  cycle,
  netCentsFallback,
  onProceed,
  onBack,
}: BillingInfoStepProps) {
  const [fullName, setFullName] = useState('')
  const [customerType, setCustomerType] = useState<CustomerType>('b2c')
  const [country, setCountry] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [postal, setPostal] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [regNumber, setRegNumber] = useState('')
  // Company registration register (required for B2B). Defaults from the billing
  // country until the user explicitly picks one (`regTypeTouched`).
  const [regType, setRegType] = useState<CompanyRegistrationType>('OTHER')
  const [regTypeTouched, setRegTypeTouched] = useState(false)

  const [loadingProfile, setLoadingProfile] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [preview, setPreview] = useState<VatPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [vies, setVies] = useState<ViesState>({ kind: 'idle' })

  // Prefill from any saved profile.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await getBillingProfile()
        if (cancelled) return
        setFullName(p.full_name)
        setCustomerType(p.customer_type)
        setCountry(p.billing_country)
        setStreet(p.billing_street)
        setCity(p.billing_city)
        setPostal(p.billing_postal)
        setCompanyName(p.company_name ?? '')
        setVatNumber(p.vat_number ?? '')
        setRegNumber(p.company_registration_number ?? '')
        if (p.company_registration_type) {
          setRegType(p.company_registration_type)
          setRegTypeTouched(true)
        }
      } catch {
        // No saved profile (or transient) — start with an empty form.
      } finally {
        if (!cancelled) setLoadingProfile(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Live VAT preview — re-fetch when country, customer type, plan, or cycle
  // change. Debounced so dragging through the country list doesn't spam the API.
  const previewSeq = useRef(0)
  useEffect(() => {
    if (!country) {
      setPreview(null)
      return
    }
    const seq = ++previewSeq.current
    setPreviewLoading(true)
    const t = setTimeout(() => {
      void (async () => {
        try {
          const result = await getVatPreview({
            plan: planId,
            cycle,
            country,
            type: customerType,
          })
          if (previewSeq.current === seq) setPreview(result)
        } catch {
          if (previewSeq.current === seq) setPreview(null)
        } finally {
          if (previewSeq.current === seq) setPreviewLoading(false)
        }
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [country, customerType, planId, cycle])

  // A change to any VAT-affecting field invalidates a prior VIES verdict.
  useEffect(() => {
    setVies({ kind: 'idle' })
  }, [vatNumber, country, customerType])

  // Default the registration register from the billing country until the user
  // explicitly overrides it (NL→KvK, DE→HRB, …). Keeps the required B2B field
  // pre-filled with the most likely value.
  useEffect(() => {
    if (!regTypeTouched && country) {
      setRegType(defaultRegTypeForCountry(country))
    }
  }, [country, regTypeTouched])

  const isB2b = customerType === 'b2b'
  const crossBorderB2b = isB2b && country !== '' && country !== 'NL' && isEuCountry(country)

  const buildPayload = useCallback(
    (): BillingProfilePayload => ({
      full_name: fullName.trim(),
      billing_country: country,
      billing_street: street.trim(),
      billing_postal: postal.trim(),
      billing_city: city.trim(),
      customer_type: customerType,
      company_name: isB2b ? companyName.trim() || null : null,
      vat_number: isB2b ? vatNumber.trim() || null : null,
      company_registration_number: isB2b ? regNumber.trim() || null : null,
      // REQUIRED for B2B (server rejects null with 400); omitted for B2C.
      company_registration_type: isB2b ? regType : null,
    }),
    [fullName, country, street, postal, city, customerType, isB2b, companyName, vatNumber, regNumber, regType],
  )

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!fullName.trim()) errs.fullName = 'Required.'
    if (!country) errs.country = 'Select your billing country.'
    if (!street.trim()) errs.street = 'Required.'
    if (!city.trim()) errs.city = 'Required.'
    if (!postal.trim()) errs.postal = 'Required.'
    if (isB2b && !companyName.trim()) errs.companyName = 'Required for business accounts.'
    if (isB2b && !regType) errs.regType = 'Required.'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  // On VAT-number blur for a cross-border B2B number: persist the profile so the
  // server runs VIES, then reflect the verdict from the returned `vat_validated`
  // STRING (the server returns 200 even for an invalid number — the verdict is in
  // the body). This is the dedicated check the spec asks for — it does NOT advance
  // to payment. A genuine request failure (network/5xx) → "unreachable" copy.
  const handleVatBlur = useCallback(async () => {
    if (!crossBorderB2b || !vatNumber.trim()) {
      setVies({ kind: 'idle' })
      return
    }
    setVies({ kind: 'checking' })
    try {
      const saved = await saveBillingProfile(buildPayload())
      setVies(viesStateFromVerdict(saved.vat_validated))
    } catch {
      // The PUT itself failed (network / server error) — we could not reach VIES,
      // so fall back to the conservative local-VAT message.
      setVies({ kind: 'unreachable' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossBorderB2b, vatNumber, buildPayload])

  async function handleProceed() {
    if (!validate()) return
    setSubmitting(true)
    setError(null)
    try {
      const saved = await saveBillingProfile(buildPayload())
      await onProceed(saved)
    } catch (err) {
      setError(userFriendlyError(err))
      setSubmitting(false)
    }
  }

  const grossCents = preview?.gross_cents ?? netCentsFallback
  const vatRatePct = preview ? (preview.vat_rate_bps / 100).toFixed(preview.vat_rate_bps % 100 === 0 ? 0 : 1) : null
  const interval = cycle === 'yearly' ? 'year' : 'month'

  const selectClass =
    "w-full border rounded-md bg-paper px-3 py-2 text-sm text-ink outline-none appearance-none cursor-pointer bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%237d7770%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_10px_center] pr-8 transition-all focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="billing-info-loading">
        <svg className="animate-spin h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-[18px]" data-testid="billing-info-step">
      {/* Full name */}
      <BBInput
        label="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Jane Doe"
        error={fieldErrors.fullName}
        autoComplete="name"
      />

      {/* Customer type toggle */}
      <div>
        <div className="block text-xs font-medium text-ink-2 mb-1.5">Account type</div>
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Account type">
          {([
            { id: 'b2c', label: 'Personal', hint: 'For individuals' },
            { id: 'b2b', label: 'Business', hint: 'VAT invoice' },
          ] as const).map((opt) => {
            const active = customerType === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCustomerType(opt.id)}
                data-testid={`customer-type-${opt.id}`}
                className={`p-3 rounded-md text-left transition-all ${
                  active
                    ? 'bg-amber-bg border-[1.5px] border-amber-deep'
                    : 'bg-paper border border-line hover:border-line-2'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${
                      active ? 'border-amber-deep bg-amber' : 'border-line-2'
                    }`}
                  >
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
                  </span>
                  <span className="text-[13px] font-medium">{opt.label}</span>
                </div>
                <div className="text-[11px] text-ink-3 pl-[22px] mt-0.5">{opt.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Billing country */}
      <div>
        <label htmlFor="billing-country" className="block text-xs font-medium text-ink-2 mb-1.5">
          Billing country
        </label>
        <select
          id="billing-country"
          data-testid="billing-country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={`${selectClass} ${fieldErrors.country ? 'border-red' : 'border-line'}`}
        >
          <option value="" disabled>
            Select a country
          </option>
          <optgroup label="European Union">
            {EU_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other">
            {NON_EU_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        {fieldErrors.country && <p className="text-xs mt-1.5 text-red">{fieldErrors.country}</p>}
      </div>

      {/* Address */}
      <BBInput
        label="Street and house number"
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        placeholder="Hoofdstraat 1"
        error={fieldErrors.street}
        autoComplete="address-line1"
      />
      <div className="grid grid-cols-2 gap-2.5">
        <BBInput
          label="Postal code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          placeholder="6602 AB"
          error={fieldErrors.postal}
          autoComplete="postal-code"
        />
        <BBInput
          label="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Wijchen"
          error={fieldErrors.city}
          autoComplete="address-level2"
        />
      </div>

      {/* B2B-only fields */}
      {isB2b && (
        <div className="space-y-[18px] rounded-md border border-line bg-paper-2 p-3.5" data-testid="b2b-fields">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
            Business details
          </div>
          <BBInput
            label="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Initlabs B.V."
            error={fieldErrors.companyName}
            autoComplete="organization"
          />
          <BBInput
            label="VAT number"
            hint={
              crossBorderB2b
                ? 'EU businesses outside the Netherlands: we verify this with VIES for reverse charge.'
                : 'Optional.'
            }
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value.toUpperCase())}
            onBlur={() => void handleVatBlur()}
            placeholder="NL123456789B01"
            data-testid="vat-number"
            trailing={
              vies.kind === 'checking' ? (
                <svg className="animate-spin h-4 w-4 text-ink-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : vies.kind === 'valid' ? (
                <Icon name="check" size={15} className="text-green" />
              ) : vies.kind === 'invalid' ? (
                <Icon name="x" size={15} className="text-red" />
              ) : null
            }
          />
          {/* VIES feedback */}
          {vies.kind === 'valid' && (
            <div className="flex items-start gap-2 text-[12px] text-green" data-testid="vies-valid">
              <Icon name="check" size={14} className="shrink-0 mt-0.5" />
              <span>
                VAT number verified. Reverse charge applies — you will not be charged VAT (0%).
              </span>
            </div>
          )}
          {vies.kind === 'invalid' && (
            <div className="flex items-start gap-2 text-[12px] text-red" data-testid="vies-invalid">
              <Icon name="x" size={14} className="shrink-0 mt-0.5" />
              <span>
                This VAT number is not valid. Check it, or leave it blank to be charged local VAT.
              </span>
            </div>
          )}
          {vies.kind === 'unreachable' && (
            <div className="flex items-start gap-2 text-[12px] text-ink-2" data-testid="vies-unreachable">
              <Icon name="info" size={14} className="shrink-0 mt-0.5 text-amber-deep" />
              <span>VAT number could not be verified. You will be charged with local VAT.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Registration register — REQUIRED for B2B (server enum). */}
            <div>
              <label htmlFor="reg-type" className="block text-xs font-medium text-ink-2 mb-1.5">
                Registration register
              </label>
              <select
                id="reg-type"
                data-testid="reg-type"
                value={regType}
                onChange={(e) => {
                  setRegType(e.target.value as CompanyRegistrationType)
                  setRegTypeTouched(true)
                }}
                className={`${selectClass} ${fieldErrors.regType ? 'border-red' : 'border-line'}`}
              >
                {COMPANY_REG_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {fieldErrors.regType && <p className="text-xs mt-1.5 text-red">{fieldErrors.regType}</p>}
            </div>
            <BBInput
              label="Registration number"
              hint="Optional."
              value={regNumber}
              onChange={(e) => setRegNumber(e.target.value)}
              placeholder="95157565"
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {/* VAT-inclusive price summary */}
      <div className="rounded-md border border-line bg-paper-2 px-4 py-3.5 space-y-1.5" data-testid="vat-preview">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-ink-2">{planName} — net</span>
          <span className="font-mono text-[13px] text-ink">
            {eur(preview?.net_cents ?? netCentsFallback)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-ink-2">
            VAT{vatRatePct != null ? ` (${vatRatePct}%)` : ''}
          </span>
          <span className="font-mono text-[13px] text-ink-3">
            {previewLoading && !preview ? '…' : eur(preview?.vat_amount_cents ?? 0)}
          </span>
        </div>
        <div className="border-t border-line pt-1.5 mt-1.5 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-ink">Total / {interval}</span>
          <span className="font-mono text-[15px] font-bold text-ink" data-testid="vat-gross">
            {previewLoading && !preview ? '…' : eur(grossCents)}
          </span>
        </div>
        {preview?.treatment === 'reverse_charge' && (
          <div className="text-[11px] text-green pt-0.5">
            Reverse charge — VAT accounted for by you (Art. 196).
          </div>
        )}
        {country !== '' && (preview == null && !previewLoading) && (
          <div className="text-[11px] text-ink-4 pt-0.5">
            VAT is calculated at checkout based on your billing country.
          </div>
        )}
      </div>

      {error && <div className="text-sm text-red text-center">{error}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2.5">
        {onBack && (
          <BBButton variant="ghost" size="lg" onClick={onBack} disabled={submitting}>
            Back
          </BBButton>
        )}
        <BBButton
          variant="amber"
          size="lg"
          className="flex-1 justify-center"
          onClick={() => void handleProceed()}
          disabled={submitting}
          data-testid="billing-continue"
        >
          {submitting ? 'Saving...' : 'Continue to payment'}
          {!submitting && <Icon name="chevron-right" size={13} className="ml-1" />}
        </BBButton>
      </div>
      <p className="text-[11px] text-ink-4 text-center -mt-1">
        You will be charged local VAT where it applies. Choose your payment method on the next step.
      </p>
    </div>
  )
}
