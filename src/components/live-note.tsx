/**
 * Task 2162 — a status note that announces. A `role="status"` region that is mounted together
 * with its text is often not announced; the region must exist BEFORE the text changes. So the
 * wrapper is always rendered and only its content comes and goes.
 */
import type { ReactNode } from 'react'

export function LiveNote({
  text,
  testId,
  className,
  children,
}: {
  text: string | null
  testId?: string
  className?: string
  /** Extra content shown with the text (e.g. a dismiss button). */
  children?: ReactNode
}) {
  return (
    <div role="status" aria-live="polite">
      {text ? (
        <div data-testid={testId} className={className}>
          <span className="flex-1">{text}</span>
          {children}
        </div>
      ) : null}
    </div>
  )
}
