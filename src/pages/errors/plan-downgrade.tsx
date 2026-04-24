import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'

interface TimelineRow {
  day: string
  text: string
  kind: 'ok' | 'soft' | 'warn' | 'danger'
}

interface PlanDowngradeProps {
  currentUsage?: string
  newLimit?: string
  timeline?: TimelineRow[]
  onKeepPlan?: () => void
  onDowngrade?: () => void
  onPackAndDelete?: () => void
}

const defaultTimeline: TimelineRow[] = [
  { day: 'Now', text: 'Your plan ends · grace period starts', kind: 'ok' },
  { day: '30 days', text: 'Pick which 20 GB to keep', kind: 'soft' },
  {
    day: '60 days',
    text: 'Everything still readable · just no uploads / shares',
    kind: 'soft',
  },
  {
    day: '90 days',
    text: 'Over-limit files go read-only · download anytime',
    kind: 'warn',
  },
  {
    day: '180 days',
    text: 'If still unresolved, we email you twice before archiving',
    kind: 'danger',
  },
]

const chipVariant: Record<
  TimelineRow['kind'],
  'default' | 'amber' | 'green'
> = {
  ok: 'green',
  soft: 'green',
  warn: 'amber',
  danger: 'default',
}

const chipLabel: Record<TimelineRow['kind'], string> = {
  ok: 'Today',
  soft: 'Safe',
  warn: 'Read-only',
  danger: 'Emails',
}

export function PlanDowngrade({
  currentUsage = '412 GB',
  newLimit = '20 GB',
  timeline = defaultTimeline,
  onKeepPlan,
  onDowngrade,
  onPackAndDelete,
}: PlanDowngradeProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-6">
      <div
        className="w-full max-w-[620px] bg-paper border border-line-2 rounded-xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-2)' }}
      >
        {/* Header */}
        <div className="px-[22px] py-4 border-b border-line flex items-center gap-2.5">
          <Icon name="shield" size={13} style={{ color: 'var(--color-red)' }} />
          <span className="text-[14px] font-semibold">
            Downgrade to Free — a heads up
          </span>
        </div>

        <div className="p-[22px]">
          <p className="text-[13.5px] text-ink-2 leading-relaxed">
            You&apos;re using <strong>{currentUsage}</strong>, but Free
            gives you <strong>{newLimit}</strong>. Here&apos;s exactly what
            happens — nothing gets deleted without you saying so.
          </p>

          {/* Timeline */}
          <div className="mt-[18px] border border-line-2 rounded-lg overflow-hidden">
            {timeline.map((row, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3.5 py-3"
                style={{
                  borderBottom:
                    i < timeline.length - 1
                      ? '1px solid var(--color-line)'
                      : 'none',
                  background:
                    row.kind === 'danger'
                      ? 'oklch(0.98 0.03 25)'
                      : 'var(--color-paper)',
                }}
              >
                <span
                  className="font-mono text-[11px] w-[70px] shrink-0"
                  style={{
                    color:
                      row.kind === 'danger'
                        ? 'var(--color-red)'
                        : 'var(--color-ink-3)',
                  }}
                >
                  {row.day}
                </span>
                <span className="text-[12.5px] flex-1">{row.text}</span>
                <BBChip variant={chipVariant[row.kind]}>
                  {chipLabel[row.kind]}
                </BBChip>
              </div>
            ))}
          </div>

          {/* Info box */}
          <div className="mt-[18px] p-3.5 bg-paper-2 border border-line rounded-lg text-[12.5px] leading-relaxed">
            <strong>
              We never delete encrypted data in a way we could recover it.
            </strong>{' '}
            If you want out for good, use{' '}
            <button
              onClick={onPackAndDelete}
              className="text-amber-deep hover:underline"
            >
              Pack my vault
            </button>{' '}
            first.
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-[22px] py-3 border-t border-line bg-paper-2 flex gap-2 justify-end">
          <BBButton variant="ghost" onClick={onKeepPlan}>
            Keep my plan
          </BBButton>
          <BBButton variant="ghost" onClick={onPackAndDelete}>
            Pack &amp; delete account
          </BBButton>
          <BBButton onClick={onDowngrade}>Downgrade anyway</BBButton>
        </div>
      </div>
    </div>
  )
}
