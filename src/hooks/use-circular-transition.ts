"use client"

import { useRef, useCallback } from "react"
import { useTheme } from "@/hooks/use-theme"

interface CircularTransitionHook {
  startTransition: (coords: { x: number; y: number }, callback: () => void) => void
  toggleTheme: (event: React.MouseEvent) => void
  isTransitioning: () => boolean
}

export function useCircularTransition(): CircularTransitionHook {
  const { theme, setTheme } = useTheme()
  const isTransitioningRef = useRef(false)

  const startTransition = useCallback((coords: { x: number; y: number }, callback: () => void) => {
    if (isTransitioningRef.current) return

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      callback()
      return
    }
    isTransitioningRef.current = true

    // Set CSS variables for the circular reveal animation - exactly like tweakcn
    const x = (coords.x / window.innerWidth) * 100
    const y = (coords.y / window.innerHeight) * 100

    // Set the CSS variables on document element
    document.documentElement.style.setProperty('--x', `${x}%`)
    document.documentElement.style.setProperty('--y', `${y}%`)

    // Check if View Transitions API is supported
    if ('startViewTransition' in document) {
      const transition = (document as Document & { startViewTransition: (callback: () => void) => { finished: Promise<void> } }).startViewTransition(() => {
        callback()
      })

      const finish = () => { isTransitioningRef.current = false }
      void transition.finished.then(finish, finish)
    } else {
      // Fallback for browsers without View Transitions API
      callback()
      setTimeout(() => {
        isTransitioningRef.current = false
      }, 400)
    }
  }, [])

  const toggleTheme = useCallback((event: React.MouseEvent) => {
    // Get precise click coordinates - use clientX/clientY directly like tweakcn
    const coords = {
      x: event.clientX,
      y: event.clientY
    }

    startTransition(coords, () => {
      const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      setTheme(isDark ? "light" : "dark")
    })
  }, [theme, setTheme, startTransition])

  const isTransitioning = useCallback(() => {
    return isTransitioningRef.current
  }, [])

  return {
    startTransition,
    toggleTheme,
    isTransitioning
  }
}
