"use client"

import * as React from "react"
import { ThemeProviderContext } from "@/contexts/theme-context"

type Theme = "dark" | "light" | "system"

const subscribeHydration = () => () => {}
const clientHydrated = () => true
const serverHydrated = () => false

function readTheme(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null
    return stored === "dark" || stored === "light" || stored === "system" ? stored : fallback
  } catch {
    return fallback
  }
}

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [storedTheme, setTheme] = React.useState<Theme>(() => readTheme(storageKey, defaultTheme))
  // Server markup and the first hydration render must agree, including labels.
  const hydrated = React.useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated)
  const theme = hydrated ? storedTheme : defaultTheme

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const root = window.document.documentElement

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      root.classList.remove("light", "dark")
      root.classList.add(theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme)
    }
    applyTheme()
    if (theme !== "system") return
    mediaQuery.addEventListener("change", applyTheme)
    return () => mediaQuery.removeEventListener("change", applyTheme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      try {
        window.localStorage.setItem(storageKey, theme)
      } catch {
        // A blocked/full storage area must not prevent changing this session.
      }
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
