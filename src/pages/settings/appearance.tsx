import { type ReactNode, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { useTheme } from '../../lib/theme-context'
import { useDisplay } from '../../lib/display-context'
import { getPreference, setPreference } from '../../lib/api'
import type { ThemeMode } from '../../lib/theme-context'
import type { FontSize, SidebarDensity } from '../../lib/display-context'

// ─── Theme preview cards ────────────────────────────

interface ThemeCardProps {
  id: ThemeMode
  label: string
  isActive: boolean
  onClick: () => void
}

/** Mini preview of the app chrome in the given theme. */
function ThemeCard({ id, label, isActive, onClick }: ThemeCardProps) {
  // Preview palette — hardcoded to show contrast between modes
  const palette = id === 'dark' || (id === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? { bg: '#1e1e1e', sidebar: '#282828', card: '#333', text: '#d4d4d4', textMuted: '#888', line: '#444', amber: 'oklch(0.82 0.17 84)' }
    : { bg: '#faf9f7', sidebar: '#f3f1ed', card: '#fff', text: '#2a2520', textMuted: '#8a857d', line: '#e5e1da', amber: 'oklch(0.82 0.17 84)' }

  // System card shows a split preview
  const isSystem = id === 'system'
  const lightPalette = { bg: '#faf9f7', sidebar: '#f3f1ed', card: '#fff', text: '#2a2520', textMuted: '#8a857d', line: '#e5e1da', amber: 'oklch(0.82 0.17 84)' }
  const darkPalette = { bg: '#1e1e1e', sidebar: '#282828', card: '#333', text: '#d4d4d4', textMuted: '#888', line: '#444', amber: 'oklch(0.82 0.17 84)' }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center gap-2.5 cursor-pointer transition-all ${
        isActive ? '' : 'opacity-80 hover:opacity-100'
      }`}
    >
      {/* Preview box */}
      <div
        className={`w-[156px] h-[100px] rounded-lg border-2 overflow-hidden transition-colors ${
          isActive
            ? 'border-amber-deep shadow-2'
            : 'border-line group-hover:border-line-2'
        }`}
      >
        {isSystem ? (
          /* Split light/dark preview */
          <div className="flex h-full">
            <div className="flex-1 flex" style={{ background: lightPalette.bg }}>
              {/* Light half sidebar */}
              <div className="w-[28px] shrink-0 flex flex-col gap-[3px] p-[5px] border-r" style={{ background: lightPalette.sidebar, borderColor: lightPalette.line }}>
                <div className="h-[4px] w-full rounded-sm" style={{ background: lightPalette.amber }} />
                <div className="h-[3px] w-full rounded-sm" style={{ background: lightPalette.line }} />
                <div className="h-[3px] w-full rounded-sm" style={{ background: lightPalette.line }} />
              </div>
              {/* Light half content */}
              <div className="flex-1 p-[6px] flex flex-col gap-[4px]">
                <div className="h-[3px] w-[70%] rounded-sm" style={{ background: lightPalette.text }} />
                <div className="flex-1 rounded" style={{ background: lightPalette.card, border: `1px solid ${lightPalette.line}` }} />
              </div>
            </div>
            <div className="flex-1 flex" style={{ background: darkPalette.bg }}>
              {/* Dark half sidebar */}
              <div className="w-[28px] shrink-0 flex flex-col gap-[3px] p-[5px] border-r" style={{ background: darkPalette.sidebar, borderColor: darkPalette.line }}>
                <div className="h-[4px] w-full rounded-sm" style={{ background: darkPalette.amber }} />
                <div className="h-[3px] w-full rounded-sm" style={{ background: darkPalette.line }} />
                <div className="h-[3px] w-full rounded-sm" style={{ background: darkPalette.line }} />
              </div>
              {/* Dark half content */}
              <div className="flex-1 p-[6px] flex flex-col gap-[4px]">
                <div className="h-[3px] w-[70%] rounded-sm" style={{ background: darkPalette.text }} />
                <div className="flex-1 rounded" style={{ background: darkPalette.card, border: `1px solid ${darkPalette.line}` }} />
              </div>
            </div>
          </div>
        ) : (
          /* Single-mode preview */
          <div className="flex h-full" style={{ background: palette.bg }}>
            {/* Sidebar preview */}
            <div className="w-[36px] shrink-0 flex flex-col gap-[3px] p-[6px] border-r" style={{ background: palette.sidebar, borderColor: palette.line }}>
              <div className="h-[4px] w-full rounded-sm" style={{ background: palette.amber }} />
              <div className="h-[3px] w-full rounded-sm" style={{ background: palette.line }} />
              <div className="h-[3px] w-full rounded-sm" style={{ background: palette.line }} />
              <div className="h-[3px] w-full rounded-sm" style={{ background: palette.line }} />
            </div>
            {/* Content preview */}
            <div className="flex-1 p-[8px] flex flex-col gap-[5px]">
              <div className="h-[4px] w-[60%] rounded-sm" style={{ background: palette.text }} />
              <div className="h-[3px] w-[40%] rounded-sm" style={{ background: palette.textMuted }} />
              <div className="flex-1 rounded" style={{ background: palette.card, border: `1px solid ${palette.line}` }}>
                <div className="p-[6px] flex flex-col gap-[3px]">
                  <div className="h-[3px] w-[80%] rounded-sm" style={{ background: palette.line }} />
                  <div className="h-[3px] w-[50%] rounded-sm" style={{ background: palette.line }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Label + check */}
      <div className="flex items-center gap-1.5">
        {isActive && (
          <Icon name="check" size={11} className="text-amber-deep" />
        )}
        <span className={`text-[13px] ${isActive ? 'font-semibold text-ink' : 'text-ink-2'}`}>
          {label}
        </span>
      </div>
    </button>
  )
}

// ─── Option group component ─────────────────────────

interface OptionCardProps {
  label: string
  description: string
  isActive: boolean
  onClick: () => void
  preview?: ReactNode
}

function OptionCard({ label, description, isActive, onClick, preview }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 px-3.5 py-3 rounded-md border text-left transition-colors cursor-pointer ${
        isActive
          ? 'border-amber-deep bg-amber-bg'
          : 'border-line bg-paper hover:bg-paper-2'
      }`}
    >
      {preview && <div className="shrink-0">{preview}</div>}
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${isActive ? 'font-semibold text-ink' : 'text-ink-2'}`}>
          {label}
        </div>
        <div className="text-[11px] text-ink-3 mt-0.5">{description}</div>
      </div>
      {isActive && (
        <Icon name="check" size={12} className="text-amber-deep shrink-0" />
      )}
    </button>
  )
}

// ─── Font size preview ──────────────────────────────

function FontSizePreview({ size }: { size: FontSize }) {
  const textSizes: Record<FontSize, { main: string; sub: string }> = {
    compact: { main: '11px', sub: '9px' },
    default: { main: '12px', sub: '10px' },
    comfortable: { main: '13px', sub: '11px' },
  }
  const s = textSizes[size]
  return (
    <div className="w-[32px] h-[32px] rounded bg-paper-2 border border-line flex flex-col items-start justify-center px-1.5 gap-0.5">
      <div className="rounded-sm bg-ink-3" style={{ height: s.main, width: '100%' }} />
      <div className="rounded-sm bg-ink-4" style={{ height: s.sub, width: '70%' }} />
    </div>
  )
}

// ─── Sidebar density preview ────────────────────────

function DensityPreview({ density }: { density: SidebarDensity }) {
  const gaps: Record<SidebarDensity, string> = {
    compact: '2px',
    default: '4px',
    spacious: '6px',
  }
  return (
    <div className="w-[32px] h-[32px] rounded bg-paper-2 border border-line flex flex-col items-stretch justify-center px-1.5" style={{ gap: gaps[density] }}>
      <div className="h-[3px] rounded-sm bg-ink-3" />
      <div className="h-[3px] rounded-sm bg-ink-4" />
      <div className="h-[3px] rounded-sm bg-ink-4" />
    </div>
  )
}

// ─── Main page ──────────────────────────────────────

// ─── Locale data ────────────────────────────────────

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

// ─── Main page ──────────────────────────────────────

const themeOptions: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

const fontSizeOptions: { id: FontSize; label: string; description: string }[] = [
  { id: 'compact', label: 'Compact', description: 'Smaller text, fits more on screen' },
  { id: 'default', label: 'Default', description: 'Balanced for everyday use' },
  { id: 'comfortable', label: 'Comfortable', description: 'Larger text, easier to read' },
]

const densityOptions: { id: SidebarDensity; label: string; description: string }[] = [
  { id: 'compact', label: 'Compact', description: 'Tighter spacing, more items visible' },
  { id: 'default', label: 'Default', description: 'Standard spacing' },
  { id: 'spacious', label: 'Spacious', description: 'More breathing room between items' },
]

interface LocalePreference {
  region?: string
  timezone?: string
  firstDay?: 'Sun' | 'Mon'
}

export function SettingsAppearance() {
  const { mode, setMode, resolved } = useTheme()
  const { fontSize, sidebarDensity, setFontSize, setSidebarDensity } = useDisplay()
  const { i18n } = useTranslation()

  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [region, setRegion] = useState('Europe · 24h · metric · €')
  const [timezone, setTimezone] = useState(defaultTimezone)
  const [firstDay, setFirstDay] = useState<'Sun' | 'Mon'>('Mon')

  useEffect(() => {
    getPreference<LocalePreference>('locale').then((pref) => {
      if (!pref) return
      if (pref.region) setRegion(pref.region)
      if (pref.timezone) setTimezone(pref.timezone)
      if (pref.firstDay) setFirstDay(pref.firstDay)
    }).catch(() => {})
  }, [])

  function saveLocale(patch: Partial<LocalePreference>) {
    const next = { region, timezone, firstDay, ...patch }
    setPreference('locale', next).catch(() => {})
  }

  return (
    <SettingsShell activeSection="appearance">
      <SettingsHeader
        title="Appearance"
        subtitle="Customize how Beebeeb looks and feels. Preferences sync across your devices."
      />

      {/* ─ Theme ─────────────────────────────────── */}
      <SettingsRow label="Theme" hint="Controls light and dark mode across the entire app">
        <div className="flex gap-5 max-w-[520px]">
          {themeOptions.map((option) => (
            <ThemeCard
              key={option.id}
              id={option.id}
              label={option.label}
              isActive={option.id === mode}
              onClick={() => setMode(option.id)}
            />
          ))}
        </div>
        {mode === 'system' && (
          <div className="mt-3 text-[11.5px] text-ink-3">
            Currently using {resolved === 'dark' ? 'dark' : 'light'} mode from your operating system
          </div>
        )}
      </SettingsRow>

      {/* ─ Font size ─────────────────────────────── */}
      <SettingsRow label="Content density" hint="Adjust text size in the main content area">
        <div className="flex flex-col gap-1.5 max-w-[520px]">
          {fontSizeOptions.map((option) => (
            <OptionCard
              key={option.id}
              label={option.label}
              description={option.description}
              isActive={option.id === fontSize}
              onClick={() => setFontSize(option.id)}
              preview={<FontSizePreview size={option.id} />}
            />
          ))}
        </div>
      </SettingsRow>

      {/* ─ Sidebar density ───────────────────────── */}
      <SettingsRow label="Sidebar spacing" hint="How much vertical space between navigation items">
        <div className="flex flex-col gap-1.5 max-w-[520px]">
          {densityOptions.map((option) => (
            <OptionCard
              key={option.id}
              label={option.label}
              description={option.description}
              isActive={option.id === sidebarDensity}
              onClick={() => setSidebarDensity(option.id)}
              preview={<DensityPreview density={option.id} />}
            />
          ))}
        </div>
      </SettingsRow>

      {/* ─ Language ──────────────────────────────── */}
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
                className={`group/lang flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left transition-all duration-200 ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg cursor-default'
                    : lang.available
                      ? 'border-line bg-paper hover:bg-paper-2 cursor-pointer'
                      : 'border-line bg-paper-2 opacity-60 hover:opacity-100 hover:border-amber/40 hover:shadow-[0_0_20px_oklch(0.82_0.17_84_/_0.15)] cursor-default'
                }`}
              >
                <span className="font-mono text-[10px] text-ink-3 w-5">{lang.code}</span>
                <span className={`text-[13px] flex-1 ${isActive ? 'font-semibold' : ''}`}>{lang.name}</span>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep" />
                )}
                {!lang.available && (
                  <BBChip className="transition-colors duration-200 group-hover/lang:border-amber/40 group-hover/lang:text-amber-deep">Coming soon</BBChip>
                )}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      {/* ─ Region format ─────────────────────────── */}
      <SettingsRow label="Region format" hint="Affects dates, numbers, currency displays">
        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value)
            saveLocale({ region: e.target.value })
          }}
          className="border rounded-md bg-paper px-3 py-2 border-line max-w-[280px] text-sm text-ink outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%237d7770%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_10px_center] pr-8 cursor-pointer"
        >
          <option value="Europe · 24h · metric · €">Europe · 24h · metric · EUR</option>
          <option value="Europe · 24h · metric · £">Europe · 24h · metric · GBP</option>
          <option value="Europe · 24h · metric · CHF">Europe · 24h · metric · CHF</option>
        </select>
      </SettingsRow>

      {/* ─ Timezone ──────────────────────────────── */}
      <SettingsRow label="Timezone" hint="Used for activity log and shared link expiry">
        <select
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value)
            saveLocale({ timezone: e.target.value })
          }}
          className="border rounded-md bg-paper px-3 py-2 border-line max-w-[280px] text-sm text-ink outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%237d7770%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_10px_center] pr-8 cursor-pointer"
        >
          {Intl.supportedValuesOf('timeZone').filter(tz => tz.startsWith('Europe/')).map(tz => (
            <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
          ))}
        </select>
      </SettingsRow>

      {/* ─ First day of week ─────────────────────── */}
      <SettingsRow label="First day of week">
        <div className="flex gap-1.5">
          {(['Sun', 'Mon'] as const).map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                setFirstDay(day)
                saveLocale({ firstDay: day })
              }}
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
