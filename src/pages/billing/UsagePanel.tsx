/**
 * The storage panel of the billing page (task W-P2-2).
 *
 * The summary card (#7) draws two meters side by side — plan storage and the
 * add-on TB meter — while the change-plan card draws one animated bar plus the
 * base/extra split and the "almost full" nudge. Same numbers, different
 * drawing, so they are one component with an explicit variant rather than two
 * copies drifting apart.
 */

import { formatCentsAsEur } from '../../lib/billing/money'
import { formatStorageSI } from '../../lib/format'
import { AnimatedProgress, MeterBar } from './ui'

interface UsageMetersProps {
  readonly variant: 'meters'
  readonly usedBytes: number
  readonly totalStorageBytes: number
  readonly usedPercent: number
  /** Extra TB on the add-on; 0 hides the secondary meter. */
  readonly extraTb: number
  readonly addonPerTbCents: number
  readonly billingCycle: string | null
}

interface UsageProgressProps {
  readonly variant: 'progress'
  readonly usedBytes: number
  readonly totalStorageBytes: number
  readonly usedPercent: number
  readonly extraTb: number
  readonly baseTb: number
  readonly canAddStorage: boolean
  readonly noCardTrial: boolean
}

export type UsagePanelProps = UsageMetersProps | UsageProgressProps

export function UsagePanel(props: UsagePanelProps) {
  switch (props.variant) {
    case 'meters':
      return <UsageMeters {...props} />
    case 'progress':
      return <UsageProgress {...props} />
    default: {
      const unreachable: never = props
      return unreachable
    }
  }
}

/** #7 right column: primary usage meter + the muted add-on meter. */
function UsageMeters({ usedBytes, totalStorageBytes, usedPercent, extraTb, addonPerTbCents, billingCycle }: UsageMetersProps) {
  return (
    <div className="md:pl-2">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[13px] text-ink-2">Storage</span>
        <span className="font-mono text-[13px] font-semibold">
          {formatStorageSI(usedBytes)}
          <span className="text-ink-3 font-normal"> / {formatStorageSI(totalStorageBytes)}</span>
        </span>
      </div>
      <MeterBar percent={usedPercent} usagePercent={usedPercent} />

      {extraTb > 0 && (
        <>
          <div className="flex items-baseline justify-between mt-4 mb-2">
            <span className="text-[13px] text-ink-2">Add-on storage</span>
            <span className="font-mono text-[13px] font-semibold text-ink-2">
              +{extraTb} TB
            </span>
          </div>
          <MeterBar percent={100} variant="secondary" />
          {/* Server-truth per-TB price (task 1064, D4) — was a hard-coded
              "EUR 10.99" literal that could drift from what Mollie actually
              bills; reuses the same `addonPerTbCents` breakdown computed
              above from the server's `addon_per_tb_cents` (task 0947). */}
          <div className="font-mono text-[11px] text-ink-4 mt-1.5">
            EUR {formatCentsAsEur(addonPerTbCents)} / extra TB · billed {billingCycle === 'yearly' ? 'annually' : 'monthly'}
          </div>
        </>
      )}
    </div>
  )
}

/** Change-plan card: one animated bar, base/extra split, over-quota nudge. */
function UsageProgress({ usedBytes, totalStorageBytes, usedPercent, extraTb, baseTb, canAddStorage, noCardTrial }: UsageProgressProps) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] text-ink-4 font-medium">Storage</div>
        <div className="font-mono text-sm font-semibold">
          {formatStorageSI(usedBytes)}
          <span className="text-ink-3 font-normal"> / {formatStorageSI(totalStorageBytes)}</span>
        </div>
      </div>
      {extraTb > 0 && (
        <div className="text-[11px] text-ink-3 mb-1.5">
          {formatStorageSI(baseTb * 1_000_000_000_000)} base + {formatStorageSI(extraTb * 1_000_000_000_000)} extra
        </div>
      )}
      <AnimatedProgress percent={usedPercent} />
      {usedPercent > 90 && (
        <div className="text-[11px] text-red mt-1.5">
          {noCardTrial
            ? 'Your trial is almost full. Choose a plan to store more.'
            : canAddStorage
            ? 'Storage almost full. Add more storage below.'
            : 'Storage almost full. Consider upgrading your plan.'}
        </div>
      )}
    </div>
  )
}
