import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { BBButton } from '../../components/bb-button'

interface Device {
  name: string
  platform: string
  firstSeen: string
  lastActive: string
  current: boolean
  synced: string
  mobile: boolean
}

const devices: Device[] = [
  { name: 'MacBook Pro · Safari', platform: 'macOS 14.4', firstSeen: '24 Aug 2024', lastActive: 'Active now', current: true, synced: '23.4 GB', mobile: false },
  { name: 'iPhone 15 Pro', platform: 'iOS 17.5 · v1.2.0', firstSeen: '24 Aug 2024', lastActive: '14 min ago', current: false, synced: '8.2 GB · Camera only', mobile: true },
  { name: 'Pixel 8', platform: 'Android 14 · v1.2.0', firstSeen: '3 Sep 2024', lastActive: '3 days ago', current: false, synced: '4.1 GB · Selective', mobile: true },
  { name: 'Desktop · Windows', platform: 'Windows 11 · Sync v0.9', firstSeen: '12 Oct 2024', lastActive: '6 days ago', current: false, synced: '23.4 GB · Full', mobile: false },
  { name: 'bb CLI', platform: 'Linux · v0.4.1', firstSeen: '4 Mar 2026', lastActive: '12 days ago', current: false, synced: 'on-demand', mobile: false },
]

export function SettingsDevices() {
  return (
    <SettingsShell activeSection="devices">
      <SettingsHeader
        title="Devices"
        subtitle="Every device holding a copy of your vault key. Revoke to re-encrypt your data against a new key."
      />

      <div className="py-2">
        {devices.map((d, i) => (
          <div
            key={i}
            className={`flex items-center gap-3.5 px-7 py-3.5 ${
              i < devices.length - 1 ? 'border-b border-line' : ''
            }`}
          >
            {/* Device icon */}
            <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Icon
                name={d.mobile ? 'image' : 'cloud'}
                size={15}
                className="text-ink-2"
              />
            </div>

            {/* Device info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                {d.name}
                {d.current && (
                  <BBChip variant="green">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green mr-1.5" />
                    This device
                  </BBChip>
                )}
              </div>
              <div className="text-[11px] text-ink-3 mt-0.5">
                {d.platform} {'·'} first seen {d.firstSeen} {'·'} {d.lastActive}
              </div>
            </div>

            {/* Synced */}
            <span className="text-[11px] font-mono text-ink-3 shrink-0">{d.synced}</span>

            {/* Revoke */}
            {!d.current && (
              <BBButton size="sm" variant="ghost">Revoke</BBButton>
            )}
          </div>
        ))}
      </div>
    </SettingsShell>
  )
}
