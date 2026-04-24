import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import type { IconName } from '../../components/icons'

interface FolderRow {
  name: string
  size: string
  /** Percentage of total storage (0-100) */
  percent: number
  isTrash?: boolean
}

interface StorageFullProps {
  usedLabel?: string
  totalLabel?: string
  folders?: FolderRow[]
  upgradePlan?: string
  upgradePrice?: string
  onUpgrade?: () => void
  onStartReview?: () => void
}

const defaultFolders: FolderRow[] = [
  { name: 'Archive 2025', size: '412 GB', percent: 20 },
  { name: 'raw/interviews', size: '298 GB', percent: 14 },
  { name: 'Photos / 2024', size: '184 GB', percent: 9 },
  { name: 'Trash (emptying will free)', size: '89 GB', percent: 4, isTrash: true },
]

export function StorageFull({
  usedLabel = '2.00 TB',
  totalLabel = '2.00 TB',
  folders = defaultFolders,
  upgradePlan = '5 TB',
  upgradePrice = '€9.99/mo',
  onUpgrade,
  onStartReview,
}: StorageFullProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-6">
      <div
        className="w-full max-w-[680px] bg-paper rounded-xl overflow-hidden"
        style={{
          border: '1px solid var(--color-amber-deep)',
          boxShadow: 'var(--shadow-2)',
        }}
      >
        {/* Warning header */}
        <div className="px-[22px] py-4 border-b border-line flex items-center gap-2.5 bg-amber-bg">
          <Icon name="shield" size={13} className="text-amber-deep" />
          <span className="text-[14px] font-semibold">
            You&apos;re out of space
          </span>
          <BBChip variant="amber">
            {usedLabel} used &middot; 0 GB left
          </BBChip>
        </div>

        <div className="p-[22px]">
          <p className="text-[13.5px] text-ink-2 leading-relaxed">
            Uploads are paused. Your existing files stay safe and accessible
            — nothing gets deleted automatically.
          </p>

          {/* Storage bar */}
          <div className="mt-4 h-2.5 rounded-[5px] bg-paper-2 overflow-hidden">
            <div
              className="h-full w-full"
              style={{ background: 'var(--color-amber-deep)' }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] text-ink-3">
            <span className="font-mono">
              {usedLabel} / {totalLabel}
            </span>
            <span className="font-mono">100%</span>
          </div>

          {/* Biggest folders */}
          <div className="mt-[22px]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2.5">
              Biggest folders
            </div>
            {folders.map((f, i) => {
              const icon: IconName = f.isTrash ? 'x' : 'folder'
              const barColor = f.isTrash
                ? 'var(--color-red)'
                : 'var(--color-amber-deep)'
              const iconColor = f.isTrash
                ? 'var(--color-red)'
                : 'var(--color-amber-deep)'

              return (
                <div
                  key={i}
                  className="flex items-center gap-2.5 py-2"
                >
                  <Icon name={icon} size={13} style={{ color: iconColor }} />
                  <span className="text-[12.5px] flex-1">{f.name}</span>
                  <div className="w-[120px] h-1 bg-paper-2 rounded-sm overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${f.percent * 5}%`,
                        background: barColor,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] w-[60px] text-right text-ink-3">
                    {f.size}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Action cards */}
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <div className="p-3.5 rounded-lg border border-line-2 bg-paper-2">
              <div className="text-[13px] font-semibold">Clean up</div>
              <div className="text-[11.5px] text-ink-3 mt-1 leading-relaxed">
                Empty trash, review large files
              </div>
              <BBButton
                size="sm"
                variant="ghost"
                className="mt-2.5"
                onClick={onStartReview}
              >
                Start review
              </BBButton>
            </div>
            <div
              className="p-3.5 rounded-lg bg-amber-bg"
              style={{ border: '1px solid var(--color-amber-deep)' }}
            >
              <div className="text-[13px] font-semibold">
                Upgrade to {upgradePlan}
              </div>
              <div className="text-[11.5px] text-ink-3 mt-1 leading-relaxed">
                {upgradePrice} &middot; pro-rated today
              </div>
              <BBButton
                size="sm"
                variant="amber"
                className="mt-2.5"
                onClick={onUpgrade}
              >
                Upgrade
              </BBButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
