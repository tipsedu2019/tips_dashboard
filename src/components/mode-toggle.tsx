"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"
import { useCircularTransition } from "@/hooks/use-circular-transition"
import "./mode-toggle-transition.css"

interface ModeToggleProps {
  variant?: "outline" | "ghost" | "default"
}

function getSystemDarkMode() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function ModeToggle({ variant = "outline" }: ModeToggleProps) {
  const { theme } = useTheme()
  const { toggleTheme } = useCircularTransition()

  const [systemDarkMode, setSystemDarkMode] = React.useState(getSystemDarkMode)
  const isDarkMode = theme === "dark" || (theme !== "light" && systemDarkMode)

  React.useEffect(() => {
    if (theme === "dark" || theme === "light") {
      return
    }

    const updateMode = () => setSystemDarkMode(getSystemDarkMode())

    const mediaQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null
    if (mediaQuery) {
      updateMode()
      mediaQuery.addEventListener("change", updateMode)
    }

    return () => {
      if (mediaQuery) {
        mediaQuery.removeEventListener("change", updateMode)
      }
    }
  }, [theme])

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    toggleTheme(event)
  }

  const nextThemeLabel = isDarkMode ? "라이트 모드로 전환" : "다크 모드로 전환"

  return (
    <Button
      variant={variant}
      size="icon"
      onClick={handleToggle}
      aria-label={nextThemeLabel}
      title={nextThemeLabel}
      data-testid="admin-theme-toggle"
      data-theme-target={isDarkMode ? "light" : "dark"}
      className="cursor-pointer mode-toggle-button relative overflow-hidden"
    >
      {isDarkMode ? (
        <Sun className="h-[1.2rem] w-[1.2rem] transition-transform duration-300 rotate-0 scale-100" />
      ) : (
        <Moon className="h-[1.2rem] w-[1.2rem] transition-transform duration-300 rotate-0 scale-100" />
      )}
      <span className="sr-only">{nextThemeLabel}</span>
    </Button>
  )
}
