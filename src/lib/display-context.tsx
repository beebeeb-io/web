import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type FontSize = 'compact' | 'default' | 'comfortable'
export type SidebarDensity = 'compact' | 'default' | 'spacious'

interface DisplayPreferences {
  fontSize: FontSize
  sidebarDensity: SidebarDensity
}

interface DisplayContextValue extends DisplayPreferences {
  setFontSize: (size: FontSize) => void
  setSidebarDensity: (density: SidebarDensity) => void
}

const STORAGE_KEY = 'beebeeb-display'

const defaults: DisplayPreferences = {
  fontSize: 'default',
  sidebarDensity: 'default',
}

function getStored(): DisplayPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DisplayPreferences>
      return {
        fontSize: isValidFontSize(parsed.fontSize) ? parsed.fontSize : defaults.fontSize,
        sidebarDensity: isValidDensity(parsed.sidebarDensity) ? parsed.sidebarDensity : defaults.sidebarDensity,
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return defaults
}

function isValidFontSize(v: unknown): v is FontSize {
  return v === 'compact' || v === 'default' || v === 'comfortable'
}

function isValidDensity(v: unknown): v is SidebarDensity {
  return v === 'compact' || v === 'default' || v === 'spacious'
}

const fontSizeScale: Record<FontSize, string> = {
  compact: '14px',
  default: '15px',
  comfortable: '16px',
}

const sidebarPaddingScale: Record<SidebarDensity, string> = {
  compact: '4px',
  default: '7px',
  spacious: '10px',
}

function applyDisplayVars(prefs: DisplayPreferences) {
  const root = document.documentElement
  root.style.setProperty('--display-font-size', fontSizeScale[prefs.fontSize])
  root.style.setProperty('--sidebar-item-py', sidebarPaddingScale[prefs.sidebarDensity])
}

const DisplayContext = createContext<DisplayContextValue>({
  ...defaults,
  setFontSize: () => {},
  setSidebarDensity: () => {},
})

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<DisplayPreferences>(getStored)

  // Apply CSS variables on mount and changes
  useEffect(() => {
    applyDisplayVars(prefs)
  }, [prefs])

  function persist(next: DisplayPreferences) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
    applyDisplayVars(next)
  }

  const setFontSize = useCallback((fontSize: FontSize) => {
    setPrefs((prev) => {
      const next = { ...prev, fontSize }
      persist(next)
      return next
    })
  }, [])

  const setSidebarDensity = useCallback((sidebarDensity: SidebarDensity) => {
    setPrefs((prev) => {
      const next = { ...prev, sidebarDensity }
      persist(next)
      return next
    })
  }, [])

  return (
    <DisplayContext.Provider value={{ ...prefs, setFontSize, setSidebarDensity }}>
      {children}
    </DisplayContext.Provider>
  )
}

export function useDisplay() {
  return useContext(DisplayContext)
}
