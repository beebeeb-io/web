import { Icon } from '@beebeeb/shared'

export function EncryptionStatus({ unlocked = true, error = false }: { unlocked?: boolean; error?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon name="shield" size={12} className={unlocked ? 'text-amber-deep' : 'text-ink-4'} />
      {error ? 'Encryption unavailable' : unlocked ? 'All encrypted · AES-256-GCM' : 'Vault locked'}
    </span>
  )
}
