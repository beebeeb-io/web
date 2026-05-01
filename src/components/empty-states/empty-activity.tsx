import { EmptyState } from './empty-state'

interface EmptyActivityProps {
  onGoToDrive: () => void
}

export function EmptyActivity({ onGoToDrive }: EmptyActivityProps) {
  return (
    <EmptyState
      icon="clock"
      heading="No activity yet"
      subtitle="Your encrypted activity log will record uploads, shares, security events, and more as you use Beebeeb."
      cta={{
        label: 'Go to drive',
        icon: 'folder',
        onClick: onGoToDrive,
        variant: 'default',
      }}
      hint="Activity events are encrypted per-entry. Only you can read them."
    />
  )
}
