/**
 * Account-stage view model (task 1745, spec 4b.8, 5.4 B to E, 5.6).
 *
 * `summarizeAccount(doc)` turns an `account` document into plain strings and
 * numbers a component can lay out. It is pure so every `account.state` fixture
 * can be asserted without a DOM.
 *
 * Copy rules:
 *   - Anything the server says in `copy` / `purchase.copy` wins over client
 *     wording (the server owns the sentence that depends on its numbers).
 *   - The client only writes generic framing. It never states a price, a charge
 *     date or a trial length that the document did not carry (the hand-mirrored
 *     charge-date maths that T8 removes lived exactly there).
 *   - An unknown `account.state` is only a label: the headline falls back to a
 *     generic one and the capability rows carry the truth (rule 4).
 *   - Sizes are decimal (2 GB = 2_000_000_000), matching the server.
 */

import type { Capability, CapabilityName, OnboardingDocument } from './types'

export type Tone = 'neutral' | 'attention' | 'restricted'

export interface CapabilityRow {
  name: CapabilityName
  label: string
  allowed: boolean
  /** What the person reads next to the row, e.g. "Up to 2 GB" or "Needs a plan". */
  detail: string
  /** The raw machine reason (mono in the UI) when it is not one we phrase. */
  rawReason: string | null
}

export interface UsageSummary {
  usedBytes: number
  quotaBytes: number
  allowanceBytes: number | null
  overAllowance: boolean
  /** used / quota clamped to 0..1; 0 when the quota is 0. */
  fraction: number
}

export interface AccountSummary {
  state: string
  headline: string
  /** Sentences, in order. Server copy first when present. */
  lines: string[]
  tone: Tone
  usage: UsageSummary | null
  rows: CapabilityRow[]
  /** Server wording for a surface that cannot sell (iOS), or null. */
  plansManagedNote: string | null
  /** True when the document allows a purchase / trial call to action. */
  canOfferPurchase: boolean
}

const MB = 1_000_000
const GB = 1_000_000_000
const TB = 1_000_000_000_000

/** "2 GB", "6.3 GB", "10 GB", "500 MB". Decimal units. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))
  if (bytes >= TB) return `${trim(Math.round((bytes / TB) * 10) / 10)} TB`
  if (bytes >= GB) return `${trim(Math.round((bytes / GB) * 10) / 10)} GB`
  if (bytes >= MB) return `${trim(Math.round(bytes / MB))} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

/** "18 Oct 2026", or null for a missing or unparseable value. */
export function formatDay(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}) })
}

const REASON_TEXT: Record<string, string> = {
  plan_required: 'Needs a plan',
  account_lapsed: 'Plan ended',
  trial_cancelled_read_only: 'Trial cancelled',
  trial_ended: 'Trial ended',
  email_unverified: 'Verify your email first',
  billing_read_only: 'Billing is read-only',
  account_frozen: 'Account frozen',
}

const CAPABILITY_LABEL: Record<CapabilityName, string> = {
  download: 'Download',
  upload: 'Upload',
  share: 'Share links',
  delete: 'Delete',
}

function capabilityRow(name: CapabilityName, cap: Capability | undefined): CapabilityRow {
  // Closed set per major (rule 11): absent means not allowed.
  const label = CAPABILITY_LABEL[name]
  if (!cap || !cap.allowed) {
    const reason = cap?.reason ?? null
    const phrased = reason ? REASON_TEXT[reason] : undefined
    return {
      name,
      label,
      allowed: false,
      detail: phrased ?? (reason ? 'Not available' : 'Not available'),
      rawReason: reason && !phrased ? reason : null,
    }
  }
  let detail = 'Allowed'
  if (cap.limitBytes !== null) detail = `Up to ${formatSize(cap.limitBytes)}`
  else if (cap.activeLinksLimit !== null) detail = `Up to ${cap.activeLinksLimit} active links`
  return { name, label, allowed: true, detail, rawReason: null }
}

function usageOf(doc: OnboardingDocument): UsageSummary | null {
  const s = doc.account?.storage
  if (!s) return null
  return {
    usedBytes: s.usedBytes,
    quotaBytes: s.quotaBytes,
    allowanceBytes: s.allowanceBytes,
    overAllowance: s.overAllowance === true,
    fraction: s.quotaBytes > 0 ? Math.min(1, Math.max(0, s.usedBytes / s.quotaBytes)) : 0,
  }
}

export function summarizeAccount(doc: OnboardingDocument, timeZone?: string): AccountSummary {
  const account = doc.account
  if (!account) throw new Error('summarizeAccount: not an account document')

  const state = account.state
  const trial = account.trial
  const life = account.lifecycle
  const usage = usageOf(doc)
  const lines: string[] = []
  let headline: string
  let tone: Tone = 'neutral'

  const trialEnd = formatDay(trial?.endsAt, timeZone)
  const deletion = formatDay(life?.dataDeletionAt, timeZone)

  switch (state) {
    case 'allowance': {
      const gb = usage?.allowanceBytes ?? usage?.quotaBytes ?? null
      headline = gb !== null ? `You have ${formatSize(gb)} to start with` : 'You have a starting allowance'
      lines.push('Your files are encrypted on this device before they leave it.')
      break
    }
    case 'trialing_no_card':
      headline = trialEnd ? `Your trial runs until ${trialEnd}` : 'Your trial is running'
      if (trial?.kind === 'no_card') lines.push('No card is on file, so nothing will be charged.')
      if (doc.copy.trial_end_over_allowance) lines.push(doc.copy.trial_end_over_allowance)
      if (usage?.overAllowance) tone = 'attention'
      break
    case 'trial_ended':
      headline = 'Your trial has ended'
      tone = 'restricted'
      lines.push(
        doc.copy.trial_ended_over_allowance ??
          (deletion
            ? `Files above your allowance are read-only until ${deletion}.`
            : 'Files above your allowance are read-only.'),
      )
      break
    case 'needs_plan':
      headline = account.emailVerified ? 'Choose a plan to continue' : 'Verify your email to continue'
      tone = 'restricted'
      break
    case 'trialing':
      headline = trialEnd ? `Your trial runs until ${trialEnd}` : 'Your trial is running'
      {
        const charge = formatDay(trial?.firstChargeAt, timeZone)
        if (charge) lines.push(`The first payment is on ${charge}.`)
      }
      break
    case 'trial_cancelling':
      headline = 'Your trial is cancelled'
      tone = 'attention'
      lines.push(trialEnd ? `You can still download until ${trialEnd}.` : 'You can still download your files.')
      break
    case 'active':
      headline = 'Your plan is active'
      break
    case 'past_due':
      headline = 'A payment did not go through'
      tone = 'attention'
      break
    case 'read_only':
      headline = 'Your account is read-only'
      tone = 'restricted'
      break
    case 'frozen':
      headline = 'Your account is frozen'
      tone = 'restricted'
      break
    case 'lapsed':
      headline = 'Your plan has ended'
      tone = 'restricted'
      lines.push(deletion ? `Files you do not move or renew are deleted on ${deletion}.` : 'Your files are read-only.')
      break
    case 'legacy_free':
      headline = 'You are on the free plan'
      break
    default:
      // Rule 4: unknown state is only a label; the rows below carry the truth.
      headline = 'Your account'
      break
  }

  const rows = (['download', 'upload', 'share', 'delete'] as const)
    .filter((n) => n !== 'delete' || account.capabilities.delete !== undefined)
    .map((n) => capabilityRow(n, account.capabilities[n]))

  const note = doc.purchase?.copy.plans_managed_on_web ?? doc.copy.plans_managed_on_web ?? null

  return {
    state,
    headline,
    lines,
    tone,
    usage,
    rows,
    plansManagedNote: doc.purchase?.ctaAllowed ? null : note,
    canOfferPurchase: doc.purchase?.ctaAllowed === true,
  }
}
