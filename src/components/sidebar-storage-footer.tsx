/**
 * SidebarStorageFooter — the drive sidebar's storage section (bottom block).
 *
 * Task 1705 (user ruling): the sidebar renders exactly ONE storage progress
 * bar at every usage level. The bar, its colour escalation and the single
 * compact warning line ("Running low. Upgrade →" at ≥80%, escalating to
 * "Almost full." at ≥95%) live in `StorageUsageBar` (compact mode) — this
 * footer owns only the section chrome: Storage/plan header, the bar, and the
 * storage-region row. The old duplicate ≥80% bar (`SidebarQuotaBar`) was
 * removed; do not add a second bar here.
 */
import { Icon } from './icons'
import { StorageUsageBar } from './storage-usage-bar'

interface SidebarStorageFooterProps {
  usedBytes: number
  quotaBytes: number
  /** e.g. "pro plan" / "No plan" — shown next to the Storage heading. */
  planLabel: string
  /**
   * Where new uploads go, as the person chose it: "Europe" (the default) or a
   * country's name. Built from the server's list (`sidebarRegionLabel`), never
   * from a table in this file (task 1919, by country since task 2050).
   */
  regionLabel: string
}

export function SidebarStorageFooter({
  usedBytes,
  quotaBytes,
  planLabel,
  regionLabel,
}: SidebarStorageFooterProps) {
  return (
    <div className="mt-auto px-4 py-4 border-t border-line">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
          Storage
        </div>
        <span className="text-[10px] text-ink-3">{planLabel}</span>
      </div>
      <StorageUsageBar
        usedBytes={usedBytes}
        quotaBytes={quotaBytes}
        compact
      />
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
        <Icon name="shield" size={11} className="text-amber-deep" />
        <span className="font-mono" data-testid="sidebar-region">{regionLabel}</span>
      </div>
    </div>
  )
}
