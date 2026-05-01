import type { ReactNode } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { useTheme } from '../../lib/theme-context'
import { useDisplay } from '../../lib/display-context'
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

export function SettingsAppearance() {
  const { mode, setMode, resolved } = useTheme()
  const { fontSize, sidebarDensity, setFontSize, setSidebarDensity } = useDisplay()

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
    </SettingsShell>
  )
}
