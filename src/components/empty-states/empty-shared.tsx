import { EmptyState } from './empty-state'
import type { IconName } from '../icons'

interface EmptySharedProps {
  tab: 'with-me' | 'by-me' | 'pending'
  onGoToDrive: () => void
}

const config: Record<
  'with-me' | 'by-me' | 'pending',
  { icon: IconName; heading: string; subtitle: string; ctaLabel: string }
> = {
  'with-me': {
    icon: 'share',
    heading: 'Nothing shared with you yet',
    subtitle:
      'When someone shares a file or folder with you, it will appear here. Shared files use separate key exchange -- the sender must approve your access.',
    ctaLabel: 'Go to drive',
  },
  'by-me': {
    icon: 'upload',
    heading: 'No active shares',
    subtitle:
      'Files you share with others will appear here once they accept. Share a file from your vault to get started.',
    ctaLabel: 'Go to drive',
  },
  pending: {
    icon: 'clock',
    heading: 'No pending invites',
    subtitle:
      'Pending share invites and approval requests will appear here. Everything is quiet for now.',
    ctaLabel: 'Go to drive',
  },
}

export function EmptyShared({ tab, onGoToDrive }: EmptySharedProps) {
  const c = config[tab]
  return (
    <EmptyState
      icon={c.icon}
      heading={c.heading}
      subtitle={c.subtitle}
      cta={{
        label: c.ctaLabel,
        icon: 'folder',
        onClick: onGoToDrive,
        variant: 'default',
      }}
    />
  )
}
