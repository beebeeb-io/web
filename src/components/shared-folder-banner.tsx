import { Icon } from '@beebeeb/shared'

interface SharedFolderBannerProps {
  ownerEmail: string
  memberCount: number
  isOwner: boolean
  onManage?: () => void
}

export function SharedFolderBanner({ ownerEmail, memberCount, isOwner, onManage }: SharedFolderBannerProps) {
  return (
    <div className="px-5 py-2.5 border-b border-line bg-amber-bg/30 flex items-center gap-2.5">
      <Icon name="users" size={14} className="text-amber-deep" />
      <span className="text-[13px] text-ink">
        {isOwner ? 'You shared this folder' : `Shared by ${ownerEmail}`}
      </span>
      <span className="text-[11px] text-ink-3 font-mono">
        {memberCount} member{memberCount !== 1 ? 's' : ''}
      </span>
      {isOwner && onManage && (
        <button
          onClick={onManage}
          className="ml-auto text-[12px] font-medium text-amber-deep hover:underline cursor-pointer"
        >
          Manage
        </button>
      )}
    </div>
  )
}
