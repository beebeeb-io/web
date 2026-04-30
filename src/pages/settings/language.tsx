import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'

interface Language {
  name: string
  code: string
  available: boolean
}

const languages: Language[] = [
  { name: 'English', code: 'en', available: true },
  { name: 'Nederlands', code: 'nl', available: false },
  { name: 'Deutsch', code: 'de', available: false },
  { name: 'Français', code: 'fr', available: false },
  { name: 'Italiano', code: 'it', available: false },
  { name: 'Español', code: 'es', available: false },
]

export function SettingsLanguage() {
  const { i18n } = useTranslation()
  const [firstDay, setFirstDay] = useState<'Sun' | 'Mon'>('Mon')

  return (
    <SettingsShell activeSection="language">
      <SettingsHeader title="Language & region" />

      <SettingsRow label="Language" hint="More languages are on the way. Want to help translate? Get in touch.">
        <div className="grid grid-cols-2 gap-1.5 max-w-[520px]">
          {languages.map((lang) => {
            const isActive = lang.code === i18n.language
            return (
              <button
                key={lang.code}
                type="button"
                disabled={!lang.available}
                onClick={() => lang.available && i18n.changeLanguage(lang.code)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left transition-colors ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg cursor-default'
                    : lang.available
                      ? 'border-line bg-paper hover:bg-paper-2 cursor-pointer'
                      : 'border-line bg-paper-2 opacity-50 cursor-not-allowed'
                }`}
              >
                <span className="font-mono text-[10px] text-ink-3 w-5">{lang.code}</span>
                <span className={`text-[13px] flex-1 ${isActive ? 'font-semibold' : ''}`}>{lang.name}</span>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep" />
                )}
                {!lang.available && (
                  <BBChip>Coming soon</BBChip>
                )}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow label="Region format" hint="Affects dates, numbers, currency displays">
        <div className="flex items-center gap-2 border rounded-md bg-paper px-3 py-2 border-line max-w-[280px]">
          <input
            defaultValue="Europe · 24h · metric · €"
            className="flex-1 bg-transparent text-sm text-ink outline-none"
          />
          <Icon name="chevron-down" size={12} className="text-ink-3 shrink-0" />
        </div>
      </SettingsRow>

      <SettingsRow label="Timezone" hint="Used for activity log and shared link expiry">
        <div className="flex items-center gap-2 border rounded-md bg-paper px-3 py-2 border-line max-w-[280px]">
          <input
            defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
            className="flex-1 bg-transparent text-sm text-ink outline-none"
          />
          <Icon name="chevron-down" size={12} className="text-ink-3 shrink-0" />
        </div>
      </SettingsRow>

      <SettingsRow label="First day of week">
        <div className="flex gap-1.5">
          {(['Sun', 'Mon'] as const).map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setFirstDay(day)}
              className={`px-3.5 py-1.5 text-[12.5px] rounded-sm border cursor-pointer transition-colors ${
                firstDay === day
                  ? 'bg-ink text-paper border-ink'
                  : 'bg-paper text-ink-2 border-line-2 hover:bg-paper-2'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsShell>
  )
}
