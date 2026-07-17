"use client"

import * as React from "react"

type NavigationIntent = () => void

type NavigationIntentOptions = {
  managesHistory?: boolean
}

type UseNotificationNavigationGuardOptions = {
  dirty: boolean
  saving: boolean
  onSave: () => Promise<boolean>
}

export function canResolveNotificationNavigation(saving: boolean) {
  return !saving
}

export function useNotificationNavigationGuard({
  dirty,
  saving,
  onSave,
}: UseNotificationNavigationGuardOptions) {
  const [confirmationOpen, setConfirmationOpen] = React.useState(false)
  const pendingIntentRef = React.useRef<NavigationIntent | null>(null)
  const pendingManagesHistoryRef = React.useRef(false)
  const bypassRef = React.useRef(false)
  const guardEntryActiveRef = React.useRef(false)
  const suppressNextPopRef = React.useRef(false)
  const dirtyRef = React.useRef(dirty)

  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const removeGuardHistoryEntry = React.useCallback(() => {
    if (!guardEntryActiveRef.current || typeof window === "undefined") return
    guardEntryActiveRef.current = false
    suppressNextPopRef.current = true
    bypassRef.current = true
    window.history.back()
  }, [])

  const finishNavigation = React.useCallback(() => {
    const intent = pendingIntentRef.current
    const managesHistory = pendingManagesHistoryRef.current
    pendingIntentRef.current = null
    pendingManagesHistoryRef.current = false
    setConfirmationOpen(false)
    if (!intent) return
    bypassRef.current = true
    if (managesHistory) guardEntryActiveRef.current = false
    else removeGuardHistoryEntry()
    intent()
  }, [removeGuardHistoryEntry])

  const requestNavigation = React.useCallback((
    intent: NavigationIntent,
    options: NavigationIntentOptions = {},
  ) => {
    if (!dirtyRef.current || bypassRef.current) {
      intent()
      return true
    }
    pendingIntentRef.current = intent
    pendingManagesHistoryRef.current = options.managesHistory === true
    setConfirmationOpen(true)
    return false
  }, [])

  const continueEditing = React.useCallback(() => {
    if (!canResolveNotificationNavigation(saving)) return
    pendingIntentRef.current = null
    pendingManagesHistoryRef.current = false
    setConfirmationOpen(false)
  }, [saving])

  const discardAndContinue = React.useCallback(() => {
    if (!canResolveNotificationNavigation(saving)) return
    finishNavigation()
  }, [finishNavigation, saving])

  const saveAndContinue = React.useCallback(async () => {
    if (!canResolveNotificationNavigation(saving)) return
    const saved = await onSave()
    if (saved) finishNavigation()
  }, [finishNavigation, onSave, saving])

  React.useEffect(() => {
    if (dirty && !guardEntryActiveRef.current) {
      window.history.pushState({ notificationSettingsGuard: true }, "", window.location.href)
      guardEntryActiveRef.current = true
    }
    if (!dirty) {
      removeGuardHistoryEntry()
      pendingIntentRef.current = null
      pendingManagesHistoryRef.current = false
      setConfirmationOpen(false)
      bypassRef.current = false
    }
  }, [dirty, removeGuardHistoryEntry])

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypassRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }

    const handleCapturedLink = (event: MouseEvent) => {
      if (!dirtyRef.current) return
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>("a[href]")
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (destination.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      requestNavigation(
        () => window.location.replace(destination.href),
        { managesHistory: true },
      )
    }

    const handlePopState = () => {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false
        bypassRef.current = false
        return
      }
      if (!dirtyRef.current) return
      if (!guardEntryActiveRef.current || bypassRef.current) return
      window.history.forward()
      requestNavigation(
        () => window.history.go(-2),
        { managesHistory: true },
      )
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("popstate", handlePopState)
    document.addEventListener("click", handleCapturedLink, true)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("popstate", handlePopState)
      document.removeEventListener("click", handleCapturedLink, true)
    }
  }, [requestNavigation])

  return {
    confirmationOpen,
    requestNavigation,
    continueEditing,
    discardAndContinue,
    saveAndContinue,
  }
}
