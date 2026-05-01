import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  /** The user's preference: light, dark, or system */
  mode: ThemeMode
  /** The resolved appearance (never "system") */
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
})

const STORAGE_KEY = 'beebeeb-theme'

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage may be unavailable
  }
  return 'system'
}

function applyThemeClass(resolved: 'light' | 'dark') {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode)
  const [systemPref, setSystemPref] = useState<'light' | 'dark'>(getSystemPreference)

  const resolved = mode === 'system' ? systemPref : mode

  // Listen for OS-level preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPref(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Apply .dark class whenever resolved value changes
  useEffect(() => {
    applyThemeClass(resolved)
  }, [resolved])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage may be unavailable
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
