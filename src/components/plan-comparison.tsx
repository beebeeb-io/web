import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { CANONICAL_PLAN_SLUGS, PLAN_LABELS, PLAN_PRICE_LABELS } from '../lib/plan-constants'

interface PlanComparisonProps {
  currentPlan: string
  onUpgrade: (plan: string) => void
}

const features: Array<{ name: string; free: boolean | string; basic: boolean | string; pro: boolean | string; business: boolean | string }> = [
  { name: 'Encrypted storage', free: '5 GB', basic: '1 TB', pro: '5 TB', business: '10 TB' },
  { name: 'Extra storage add-on', free: false, basic: false, pro: true, business: true },
  { name: 'Version history', free: false, basic: '30 days', pro: 'Unlimited', business: 'Unlimited' },
  { name: 'Link sharing', free: true, basic: true, pro: true, business: true },
  { name: 'Passphrase protection', free: true, basic: true, pro: true, business: true },
  { name: 'Priority support', free: false, basic: false, pro: true, business: true },
  { name: 'EU data residency', free: true, basic: true, pro: true, business: true },
]

const plans = CANONICAL_PLAN_SLUGS
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
              <th key={p} className={`text-center py-3 px-3 text-xs font-semibold ${p === 'business' ? 'text-ink-4' : p === currentPlan ? 'text-amber-deep' : 'text-ink'}`}>
                {planLabels[p]}
                {p === currentPlan && <div className="text-[10px] text-amber-deep font-normal">Current</div>}
                <div className="font-mono text-[10px] text-ink-3 font-normal mt-0.5">{p === 'business' ? 'Coming soon' : `${planPrices[p]}/mo`}</div>
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
            {plans.map((p) => (
              <td key={p} className="text-center py-3 px-3">
                {p === 'business' ? (
                  <span className="text-[10px] text-ink-4 font-mono uppercase">Coming soon</span>
                ) : p !== currentPlan && p !== 'free' ? (
                  <BBButton size="sm" variant={p === 'pro' ? 'amber' : 'default'} onClick={() => onUpgrade(p)}>
                    Upgrade
                  </BBButton>
                ) : null}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
