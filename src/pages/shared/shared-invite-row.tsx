import type { MouseEvent } from 'react'
import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import type { ShareInvite } from '../../lib/api'
import { timeAgo } from './format'

/**
 * One pending-invite row of the Shared page (W-P2-4). The three pending
 * sections differ only in icon, copy, chip and action, so they are one
 * component behind a `variant` union; the actions stay in the page.
 */
export type SharedInviteVariant = 'claim' | 'waiting-to-claim' | 'waiting-approval'

export interface SharedInviteRowProps {
  variant: SharedInviteVariant
  invite: ShareInvite
  onClaim?(invite: ShareInvite): void
  onOpenMenu?(invite: ShareInvite, e: MouseEvent): void
}

const ICON_TONE = {
  claim: { icon: 'share', box: 'bg-amber-bg', tint: 'text-amber-deep' },
  'waiting-to-claim': { icon: 'mail', box: 'bg-paper-2', tint: 'text-ink-3' },
  'waiting-approval': { icon: 'clock', box: 'bg-paper-2', tint: 'text-ink-3' },
} as const

export function SharedInviteRow({ variant, invite, onClaim, onOpenMenu }: SharedInviteRowProps) {
  const tone = ICON_TONE[variant]

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-paper-2 transition-colors">
      <div className={`shrink-0 w-[30px] h-[30px] rounded-[8px] border border-line flex items-center justify-center ${tone.box}`}>
        <Icon name={tone.icon} size={13} className={tone.tint} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink truncate">
          {variant === 'claim' && `${invite.sender_email ?? 'Someone'} shared a file`}
          {variant === 'waiting-to-claim' && (
            <span className="font-mono text-xs">{invite.recipient_email}</span>
          )}
          {variant === 'waiting-approval' && (invite.sender_email ?? 'Unknown sender')}
        </div>
        <div className="text-[11px] text-ink-3 mt-0.5">
          {variant === 'claim' && timeAgo(invite.created_at)}
          {variant === 'waiting-to-claim' && `Invited ${timeAgo(invite.created_at)}`}
          {variant === 'waiting-approval' && (
            `Claimed ${invite.claimed_at ? timeAgo(invite.claimed_at) : timeAgo(invite.created_at)}`
          )}
        </div>
      </div>
      {variant === 'claim' && (
        <BBButton
          variant="amber"
          size="sm"
          className="shrink-0 gap-1"
          onClick={() => onClaim?.(invite)}
        >
          <Icon name="check" size={11} />
          Claim
        </BBButton>
      )}
      {variant === 'waiting-to-claim' && (
        <BBChip variant="default" className="text-[10px] shrink-0">Waiting to claim</BBChip>
      )}
      {variant === 'waiting-approval' && (
        <BBChip variant="default" className="text-[10px] shrink-0">Waiting for approval</BBChip>
      )}
      {variant !== 'claim' && (
        <BBButton
          size="sm"
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); onOpenMenu?.(invite, e) }}
        >
          <Icon name="more" size={13} />
        </BBButton>
      )}
    </div>
  )
}
