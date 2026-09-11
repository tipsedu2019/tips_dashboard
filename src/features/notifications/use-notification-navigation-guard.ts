"use client"

import * as React from "react"
import { APP_NAVIGATION_REQUEST, type AppNavigationRequest } from "../../lib/guarded-navigation.ts"

type NavigationIntent = () => void

type NavigationIntentOptions = {
  managesHistory?: boolean
  preserveHistory?: boolean
  skipConfirmation?: boolean
}

type UseNotificationNavigationGuardOptions = {
  active?: boolean
  dirty: boolean
  saving: boolean
  onSave: () => Promise<boolean>
}

export function canResolveNotificationNavigation(saving: boolean) {
  return !saving
}

export function useNotificationNavigationGuard({
  active = true,
  dirty,
  saving,
  onSave,
}: UseNotificationNavigationGuardOptions) {
  const [confirmationOpen, setConfirmationOpen] = React.useState(false)
  const [localClosePending, setLocalClosePending] = React.useState(false)
  const pendingIntentRef = React.useRef<NavigationIntent | null>(null)
  const pendingManagesHistoryRef = React.useRef(false)
  const pendingPreservesHistoryRef = React.useRef(false)
  const resolvingSaveRef = React.useRef(false)
  const bypassRef = React.useRef(false)
  const guardEntryActiveRef = React.useRef(false)
  const suppressNextPopRef = React.useRef(false)
  const historyCleanupRef = React.useRef<{ url: string; after?: NavigationIntent } | null>(null)
  const historyCleanupEventsRef = React.useRef(new WeakSet<PopStateEvent>())
  const isHistoryCleanupEvent = React.useCallback((event: PopStateEvent) => historyCleanupEventsRef.current.has(event), [])
  const dirtyRef = React.useRef(dirty)

  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const removeGuardHistoryEntry = React.useCallback((after?: NavigationIntent) => {
    if (historyCleanupRef.current) {
      if (after && !historyCleanupRef.current.after) historyCleanupRef.current.after = after
      return
    }
    if (!guardEntryActiveRef.current || typeof window === "undefined") {
      after?.()
      return
    }
    guardEntryActiveRef.current = false
    suppressNextPopRef.current = true
    bypassRef.current = true
    historyCleanupRef.current = { url: window.location.href, after }
    window.history.back()
  }, [])

  const finishNavigation = React.useCallback(() => {
    const intent = pendingIntentRef.current
    const managesHistory = pendingManagesHistoryRef.current
    const preservesHistory = pendingPreservesHistoryRef.current
    pendingIntentRef.current = null
    pendingManagesHistoryRef.current = false
    pendingPreservesHistoryRef.current = false
    setConfirmationOpen(false)
    setLocalClosePending(false)
    if (!intent) return
    if (preservesHistory) {
      intent()
      return
    }
    bypassRef.current = true
    if (managesHistory) {
      guardEntryActiveRef.current = false
      intent()
    } else removeGuardHistoryEntry(intent)
  }, [removeGuardHistoryEntry])

  const requestNavigation = React.useCallback((
    intent: NavigationIntent,
    options: NavigationIntentOptions = {},
  ) => {
    if (historyCleanupRef.current) {
      if (!historyCleanupRef.current.after) historyCleanupRef.current.after = intent
      return false
    }
    if (pendingIntentRef.current) return false
    if (!dirtyRef.current || bypassRef.current || options.skipConfirmation) {
      intent()
      return true
    }
    pendingIntentRef.current = intent
    pendingManagesHistoryRef.current = options.managesHistory === true
    pendingPreservesHistoryRef.current = options.preserveHistory === true
    setLocalClosePending(options.preserveHistory === true)
    setConfirmationOpen(true)
    return false
  }, [])

  const continueEditing = React.useCallback(() => {
    if (!canResolveNotificationNavigation(saving)) return
    if (resolvingSaveRef.current) return
    pendingIntentRef.current = null
    pendingManagesHistoryRef.current = false
    pendingPreservesHistoryRef.current = false
    setLocalClosePending(false)
    setConfirmationOpen(false)
  }, [saving])

  const discardAndContinue = React.useCallback(() => {
    if (!canResolveNotificationNavigation(saving)) return
    if (resolvingSaveRef.current) return
    finishNavigation()
  }, [finishNavigation, saving])

  const saveAndContinue = React.useCallback(async () => {
    if (!canResolveNotificationNavigation(saving)) return
    if (resolvingSaveRef.current) return
    resolvingSaveRef.current = true
    try {
      const saved = await onSave()
      if (saved) finishNavigation()
    } finally {
      resolvingSaveRef.current = false
    }
  }, [finishNavigation, onSave, saving])

  React.useEffect(() => {
    if (dirty && !guardEntryActiveRef.current) {
      window.history.pushState({ ...window.history.state, notificationSettingsGuard: true }, "", window.location.href)
      guardEntryActiveRef.current = true
    }
    if (!dirty) {
      removeGuardHistoryEntry()
      // onSave can publish a clean draft before its promise continuation runs.
      // Keep the approved destination until saveAndContinue consumes it.
      if (!resolvingSaveRef.current) {
        pendingIntentRef.current = null
        pendingManagesHistoryRef.current = false
        pendingPreservesHistoryRef.current = false
      }
      setConfirmationOpen(false)
      setLocalClosePending(false)
      bypassRef.current = false
    }
  }, [dirty, removeGuardHistoryEntry])

  React.useEffect(() => {
    if (!active) return
    const handleAppNavigation = (event: Event) => {
      const detail = (event as AppNavigationRequest).detail
      const intent = detail?.intent
      if (typeof intent !== "function") return
      // An approved route waits for the existing sentinel cleanup. Repeated
      // requests must not execute ahead of it or replace its destination.
      if (historyCleanupRef.current?.after) {
        event.preventDefault()
        return
      }
      if (!dirtyRef.current) {
        // Reverting the last edit starts asynchronous history cleanup. Prepare
        // the shared intent even if another editor is awaiting confirmation.
        if (historyCleanupRef.current || guardEntryActiveRef.current) {
          detail.beforeNavigate?.push(removeGuardHistoryEntry)
        }
        return
      }
      if (event.defaultPrevented) return
      event.preventDefault()
      requestNavigation(intent)
    }
    window.addEventListener(APP_NAVIGATION_REQUEST, handleAppNavigation)
    return () => window.removeEventListener(APP_NAVIGATION_REQUEST, handleAppNavigation)
  }, [active, removeGuardHistoryEntry, requestNavigation])

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

    const handlePopState = (event: PopStateEvent) => {
      if (suppressNextPopRef.current) {
        historyCleanupEventsRef.current.add(event)
        suppressNextPopRef.current = false
        const cleanup = historyCleanupRef.current
        historyCleanupRef.current = null
        if (cleanup) window.history.replaceState(window.history.state, "", cleanup.url)
        bypassRef.current = false
        cleanup?.after?.()
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
    localClosePending,
    isHistoryCleanupEvent,
    requestNavigation,
    continueEditing,
    discardAndContinue,
    saveAndContinue,
  }
}
