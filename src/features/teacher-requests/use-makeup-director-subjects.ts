"use client"
import { useEffect, useState } from "react"
import { useAuth } from "@/providers/auth-provider"
import { readMyMakeupDirectorSubjects } from "./teacher-request-service"

// The server returns only the caller's active subjects. Never infer authority
// from names, role labels, a prior account, or the request's displayed approver.
export function useMakeupDirectorSubjects(enabled: boolean) {
  const { user, role } = useAuth()
  const scope = enabled && user?.id && role ? `${user.id}:${role}` : ""
  const [state, setState] = useState<{ scope: string; subjects: string[] }>({ scope: "", subjects: [] })
  useEffect(() => {
    if (!scope) return
    const controller = new AbortController()
    void readMyMakeupDirectorSubjects(controller.signal).then(subjects => {
      if (!controller.signal.aborted) setState({ scope, subjects })
    }, () => { if (!controller.signal.aborted) setState({ scope, subjects: [] }) })
    return () => controller.abort()
  }, [scope])
  return state.scope === scope && scope ? state.subjects : []
}
