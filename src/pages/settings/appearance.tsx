import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { useTheme } from '../../lib/theme-context'
import type { ThemeMode } from '../../lib/theme-context'

interface ThemeOption {
  id: ThemeMode
  label: string
  description: string
}

const themeOptions: ThemeOption[] = [
  { id: 'light', label: 'Light', description: 'Always use the light theme' },
  { id: 'dark', label: 'Dark', description: 'Always use the dark theme' },
  { id: 'system', label: 'System', description: 'Match your operating system' },
]

export function SettingsAppearance() {
  const { mode, setMode, resolved } = useTheme()

  return (
    <SettingsShell activeSection="appearance">
      <SettingsHeader
        title="Appearance"
        subtitle="Choose how Beebeeb looks. Your preference is stored locally on this device."
      />

      <SettingsRow label="Theme" hint="Controls light and dark mode across the entire app">
        <div className="flex flex-col gap-1.5 max-w-[520px]">
          {themeOptions.map((option) => {
            const isActive = option.id === mode
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-md border text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg'
                    : 'border-line bg-paper hover:bg-paper-2'
                }`}
              >
                <span className={`text-[13.5px] flex-1 ${isActive ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                  {option.label}
                </span>
                <span className="text-[11.5px] text-ink-3">{option.description}</span>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow label="Current appearance" hint="">
        <span className="text-sm text-ink-3">
          {resolved === 'dark' ? 'Dark' : 'Light'}
          {mode === 'system' && ' (from system preference)'}
        </span>
      </SettingsRow>
    </SettingsShell>
  )
}
