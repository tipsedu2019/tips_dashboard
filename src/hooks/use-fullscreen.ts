"use client"

import { useCallback, useEffect, useState } from "react"

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false,
  )

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
    }
  }, [])

  const enterFullscreen = useCallback(() => {
    if (typeof document !== "undefined" && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error)
    }
  }, [])

  const exitFullscreen = useCallback(() => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(console.error)
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen()
    } else {
      enterFullscreen()
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen])

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  }
}
