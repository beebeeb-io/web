/**
 * UpgradeNudge — small, dismissible inline card surfaced at feature boundaries
 * where the current plan can't perform the requested action.
 *
 * Rules (task 0550):
 *   - Subtle inline card (amber-bg). Not a modal. Doesn't block interaction.
 *   - Dismissal stored in localStorage as `nudge_dismissed_<surface>: <timestamp>`.
 *     If dismissed less than 7 days ago, the component renders nothing.
 *   - Honest copy. No urgency, no caps lock, no "limited time".
 */

import { useState, useEffect, useCallback } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

const DISMISS_KEY_PREFIX = 'nudge_dismissed_'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export type UpgradeNudgeTargetPlan = 'basic' | 'pro' | 'business'

const TARGET_PLAN_LABEL: Record<UpgradeNudgeTargetPlan, string> = {
  basic: 'Basic',
  pro: 'Pro',
  business: 'Business',
}

export interface UpgradeNudgeProps {
  /** Stable key used for the localStorage dismissal entry. */
  surface: string
  /** Plan we recommend upgrading to (only used for the CTA label). */
  targetPlan: UpgradeNudgeTargetPlan
  /** Short heading — one sentence, sentence case. */
  heading: string
  /** Optional supporting line — keep to one short sentence. */
  body?: string
  /** Called when the user clicks the Upgrade CTA. */
  onUpgrade: () => void
}

function isDismissed(surface: string): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY_PREFIX + surface)
    if (!raw) return false
    const ts = parseInt(raw, 10)
    if (!Number.isFinite(ts)) return false
    if (Date.now() - ts < DISMISS_DURATION_MS) return true
    // Expired — clear the stale entry so the lookup stays cheap next time.
    localStorage.removeItem(DISMISS_KEY_PREFIX + surface)
    return false
  } catch {
    // Private mode / storage disabled — fail open (show the nudge).
    return false
  }
}

export function UpgradeNudge({
  surface,
  targetPlan,
  heading,
  body,
  onUpgrade,
}: UpgradeNudgeProps) {
  // Initialise to true so we never flash the nudge before the dismissal check
  // settles (the check is cheap and synchronous, but useEffect-only would still
  // briefly render the card before unmounting on dismissed surfaces).
  const [hidden, setHidden] = useState<boolean>(() => isDismissed(surface))

  // Re-check when surface changes (a single mounted component should never
  // change surface, but keep this for safety / hot reload).
  useEffect(() => {
    setHidden(isDismissed(surface))
  }, [surface])

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY_PREFIX + surface, String(Date.now()))
    } catch {
      // Storage unavailable — just hide for this render.
    }
    setHidden(true)
  }, [surface])

  if (hidden) return null

  return (
    <div
      role="region"
      aria-label={`Upgrade to ${TARGET_PLAN_LABEL[targetPlan]}`}
      className="flex items-start gap-3 px-4 py-3 bg-amber-bg border border-amber/30 rounded-md"
    >
      <Icon
        name="shield"
        size={14}
        className="text-amber-deep shrink-0 mt-[2px]"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-ink leading-snug">
          {heading}
        </p>
        {body && (
          <p className="text-[11.5px] text-ink-2 leading-snug mt-0.5">
            {body}
          </p>
        )}
      </div>
      <BBButton
        size="sm"
        variant="amber"
        onClick={onUpgrade}
        className="shrink-0"
      >
        Upgrade to {TARGET_PLAN_LABEL[targetPlan]}
      </BBButton>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
