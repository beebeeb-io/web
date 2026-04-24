import { useState } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'

interface Language {
  name: string
  code: string
  completion: string
}

const languages: Language[] = [
  { name: 'English', code: 'en', completion: 'complete' },
  { name: 'Nederlands', code: 'nl', completion: 'complete' },
  { name: 'Deutsch', code: 'de', completion: 'complete' },
  { name: 'Français', code: 'fr', completion: 'complete' },
  { name: 'Italiano', code: 'it', completion: '94%' },
  { name: 'Polski', code: 'pl', completion: '82%' },
  { name: 'Español', code: 'es', completion: '72%' },
  { name: 'Svenska', code: 'sv', completion: '51%' },
]

export function SettingsLanguage() {
  const [activeLang, setActiveLang] = useState('en')
  const [firstDay, setFirstDay] = useState<'Sun' | 'Mon'>('Mon')

  return (
    <SettingsShell activeSection="language">
      <SettingsHeader title="Language & region" />

      <SettingsRow label="Language" hint="We contribute translations upstream — open-source, not machine.">
        <div className="grid grid-cols-2 gap-1.5 max-w-[520px]">
          {languages.map((lang) => {
            const isActive = lang.code === activeLang
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => setActiveLang(lang.code)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left cursor-pointer transition-colors ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg'
                    : 'border-line bg-paper hover:bg-paper-2'
                }`}
              >
                <span className="font-mono text-[10px] text-ink-3 w-5">{lang.code}</span>
                <span className={`text-[13px] flex-1 ${isActive ? 'font-semibold' : ''}`}>{lang.name}</span>
                <span
                  className="font-mono text-[10px]"
                  style={{ color: lang.completion === 'complete' ? 'oklch(0.5 0.1 155)' : undefined }}
                >
                  {lang.completion === 'complete' ? '✓' : lang.completion}
                </span>
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
            defaultValue="Europe/Berlin · CEST"
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
