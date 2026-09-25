/**
 * Plan intent — the plan + billing cycle a visitor picked on the marketing
 * site before they had an account (flow-4 money flow, P1).
 *
 * Every pricing CTA on beebeeb.io links to `/signup?plan=<slug>&cycle=<cycle>`
 * ("Start a 14-day trial", "Get Basic", …). Before this module the web app
 * read only the referral params on /signup and every new account landed on the
 * drive on Free with no trial, silently dropping that choice.
 *
 * Flow: /signup persists a VALID intent to localStorage (it has to survive the
 * multi-step onboarding, exactly like the referral attribution next to it);
 * onboarding reads + clears it after the account exists and routes to
 * `postSignupDestination(intent)` — the change-plan view with the plan
 * preselected, where billing.tsx offers the one-click trial for that plan and
 * cycle. Nothing is started automatically: starting the trial uses the
 * account's single trial, so the user confirms it with one click.
 *
 * Only plans the server accepts for a trial (`TRIALABLE_PLANS` in
 * beebeeb-api/src/trial.rs) are honoured; anything else (free, business/Teams,
 * a typo, an injected value) is ignored and the user lands on the drive as
 * before.
 */

export type BillingCycle = 'monthly' | 'yearly'

export interface PlanIntent {
  plan: string
  cycle: BillingCycle
}

/** Mirrors `TRIALABLE_PLANS` in beebeeb-api/src/trial.rs. */
export const INTENT_PLANS = ['starter', 'basic', 'personal', 'pro'] as const

export const PLAN_INTENT_KEY = 'bb_plan_intent'

/** An intent older than this is stale (the visitor came back days later). */
export const PLAN_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Validate a raw plan/cycle pair. Returns null when the plan is not a
 * trialable paid plan. An absent or unknown cycle falls back to monthly.
 */
export function parsePlanIntent(
  plan: string | null | undefined,
  cycle: string | null | undefined,
): PlanIntent | null {
  const p = (plan ?? '').trim().toLowerCase()
  if (!(INTENT_PLANS as readonly string[]).includes(p)) return null
  const c = (cycle ?? '').trim().toLowerCase()
  return { plan: p, cycle: c === 'yearly' || c === 'annual' ? 'yearly' : 'monthly' }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function savePlanIntent(intent: PlanIntent, now = Date.now(), store = storage()): void {
  try {
    store?.setItem(PLAN_INTENT_KEY, JSON.stringify({ ...intent, ts: now }))
  } catch {
    /* storage blocked — the user can still pick a plan from billing */
  }
}

/** Read the stored intent (null when absent, malformed, or stale). */
export function readPlanIntent(now = Date.now(), store = storage()): PlanIntent | null {
  try {
    const raw = store?.getItem(PLAN_INTENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { plan?: unknown; cycle?: unknown; ts?: unknown }
    if (typeof parsed.ts !== 'number' || now - parsed.ts > PLAN_INTENT_TTL_MS || parsed.ts > now + 60_000) {
      return null
    }
    return parsePlanIntent(
      typeof parsed.plan === 'string' ? parsed.plan : null,
      typeof parsed.cycle === 'string' ? parsed.cycle : null,
    )
  } catch {
    return null
  }
}

export function clearPlanIntent(store = storage()): void {
  try {
    store?.removeItem(PLAN_INTENT_KEY)
  } catch {
    /* ignore */
  }
}

/** Where a freshly created account goes: the plan chooser for an intent, else the drive. */
export function postSignupDestination(intent: PlanIntent | null): string {
  if (!intent) return '/'
  const q = new URLSearchParams({ view: 'change', plan: intent.plan, cycle: intent.cycle })
  return `/billing?${q.toString()}`
}
