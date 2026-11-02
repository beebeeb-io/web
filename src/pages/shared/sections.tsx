import { SharedRowSkeleton } from '@beebeeb/shared'

/** The pending tab's loading placeholder. */
export function LoadingSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }, (_, i) => (
        <SharedRowSkeleton key={i} />
      ))}
    </div>
  )
}

/** Section title + optional count pill (pending tab). */
export function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="px-5 py-2.5 border-b border-line bg-paper-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</span>
      {count > 0 && (
        <span className="text-[10px] font-mono font-medium text-amber-deep bg-amber-bg px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  )
}
