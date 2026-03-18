import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ThemeMode = 'light' | 'dark'

interface PlatformShellContextValue {
  theme: ThemeMode
  toggleTheme: () => void
}

const PlatformShellContext = createContext<PlatformShellContextValue | null>(null)

const STORAGE_KEY = 'healthtranscribe.platform.theme'

function getInitialTheme(): ThemeMode {
  const storedTheme = window.localStorage.getItem(STORAGE_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function PlatformShellProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const value = useMemo<PlatformShellContextValue>(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))
      },
    }),
    [theme],
  )

  return <PlatformShellContext.Provider value={value}>{children}</PlatformShellContext.Provider>
}

export function usePlatformShell() {
  const context = useContext(PlatformShellContext)
  if (!context) {
    throw new Error('usePlatformShell must be used inside PlatformShellProvider')
  }

  return context
}