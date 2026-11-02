import { Icon } from '@beebeeb/shared'

const ALL = [
  'shield', 'lock', 'key', 'eye', 'eye-off', 'check', 'chevron-right', 'chevron-down', 'upload',
  'folder', 'file', 'file-text', 'file-spreadsheet', 'file-presentation', 'file-code', 'file-archive',
  'file-audio', 'file-video', 'file-data', 'users', 'search', 'plus', 'star', 'trash', 'settings',
  'share', 'cloud', 'link', 'clock', 'download', 'copy', 'mail', 'bell', 'x', 'image', 'more',
  'arrow-up', 'pause', 'play', 'menu', 'info', 'activity', 'camera', 'scan', 'pin', 'flag', 'edit',
  'columns',
] as const

export const AllGlyphs = () => (
  <div className="grid w-[680px] grid-cols-6 gap-x-3 gap-y-4 bg-paper p-4 text-ink-2">
    {ALL.map((name) => (
      <div key={name} className="flex flex-col items-center gap-1.5">
        <Icon name={name} size={20} />
        <span className="font-mono text-[10px] text-ink-3">{name}</span>
      </div>
    ))}
  </div>
)

export const EncryptionState = () => (
  <div className="flex flex-col gap-2 bg-paper p-4">
    <div className="flex items-center gap-2 text-sm text-ink">
      <Icon name="shield" size={16} className="text-amber-deep" />
      End-to-end encrypted
    </div>
    <div className="flex items-center gap-2 text-sm text-ink">
      <Icon name="lock" size={16} className="text-amber-deep" />
      All encrypted · AES-256-GCM
    </div>
  </div>
)

export const Sizes = () => (
  <div className="flex items-end gap-4 bg-paper p-4 text-ink">
    <Icon name="folder" size={14} />
    <Icon name="folder" size={16} />
    <Icon name="folder" size={20} />
    <Icon name="folder" size={24} />
    <Icon name="folder" size={32} />
  </div>
)
