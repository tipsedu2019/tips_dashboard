"use client"
import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDraftNavigation } from "@/hooks/use-draft-navigation"
import { useUnsavedNavigationGuard } from "@/hooks/use-unsaved-navigation-guard"

/** A pending or uncertain write cannot be discarded as if it were an unsaved draft. */
export function useRequestNavigation(dirty: boolean, locked: boolean, onBlocked: () => void) {
  const router = useRouter()
  const cancel = useRef<() => void>(() => {})
  const blocked = useCallback(() => { onBlocked(); queueMicrotask(() => cancel.current()) }, [onBlocked])
  const navigate = useCallback((href: string) => router.push(href), [router])
  const { cancelNavigation } = useUnsavedNavigationGuard({ enabled: locked, onConfirmRequest: blocked, navigate })
  useEffect(() => { cancel.current = cancelNavigation }, [cancelNavigation])
  const draft = useDraftNavigation({ dirty: dirty && !locked })
  return { confirmation: draft.confirmation, move: (action: () => void) => {
    if (locked) { onBlocked(); return }
    draft.requestLocalAction(action)
  } }
}
