import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { MARKETED_PLAN_SLUGS, PLAN_LABELS, PLAN_PRICE_LABELS, PLAN_META } from '../lib/plan-constants'

interface PlanComparisonProps {
  currentPlan: string
  onUpgrade: (plan: string) => void
}

// The marketed tiers (pricing v2: Starter, Basic, Pro, Teams). Free is removed.
// Each row carries a value per marketed slug. Teams (slug `business`) is COMING
// SOON — shown as a column but not upgradeable (no checkout). Teams has no
// 14-day trial; Starter/Basic/Pro do.
const features: Array<{ name: string; starter: boolean | string; basic: boolean | string; pro: boolean | string; business: boolean | string }> = [
  { name: 'Encrypted storage', starter: '100 GB', basic: '200 GB', pro: '1 TB', business: '5 TB' },
  { name: 'Extra storage add-on', starter: false, basic: false, pro: '€10.99/TB', business: '€10.99/TB' },
  { name: '14-day free trial', starter: true, basic: true, pro: true, business: false },
  { name: 'Version history', starter: '30 days', basic: '30 days', pro: 'Unlimited', business: 'Unlimited' },
  { name: 'Link sharing', starter: true, basic: true, pro: true, business: true },
  { name: 'Passphrase protection', starter: true, basic: true, pro: true, business: true },
  { name: 'Priority support', starter: false, basic: false, pro: true, business: true },
  { name: 'EU data residency', starter: true, basic: true, pro: true, business: true },
]

const plans = MARKETED_PLAN_SLUGS
const planLabels = PLAN_LABELS
const planPrices = PLAN_PRICE_LABELS

export function PlanComparisonTable({ currentPlan, onUpgrade }: PlanComparisonProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-3 px-3 text-ink-3 font-medium text-xs">Feature</th>
            {plans.map((p) => (
              <th key={p} className={`text-center py-3 px-3 text-xs font-semibold ${p === currentPlan ? 'text-amber-deep' : 'text-ink'}`}>
                {planLabels[p]}
                {p === currentPlan && <div className="text-[10px] text-amber-deep font-normal">Current</div>}
                <div className="font-mono text-[10px] text-ink-3 font-normal mt-0.5">{`${planPrices[p]}/mo`}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((f) => (
            <tr key={f.name} className="border-b border-line/50">
              <td className="py-2.5 px-3 text-ink-2 text-xs">{f.name}</td>
              {plans.map((p) => {
                const val = f[p]
                return (
                  <td key={p} className={`text-center py-2.5 px-3 text-xs ${p === currentPlan ? 'bg-amber-bg/20' : ''}`}>
                    {val === true ? <Icon name="check" size={14} className="text-green mx-auto" /> :
                     val === false ? <span className="text-ink-4">-</span> :
                     <span className="font-mono text-ink">{val}</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            {plans.map((p) => {
              // Teams (business) is coming-soon: not upgradeable, no checkout.
              if (PLAN_META[p]?.comingSoon) {
                return (
                  <td key={p} className="text-center py-3 px-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">
                      Coming soon
                    </span>
                  </td>
                )
              }
              return (
                <td key={p} className="text-center py-3 px-3">
                  {p !== currentPlan ? (
                    <BBButton size="sm" variant={p === 'pro' ? 'amber' : 'default'} onClick={() => onUpgrade(p)}>
                      Upgrade
                    </BBButton>
                  ) : null}
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
