"use client"

import { useCallback, useEffect, useState } from "react"

import {
  type DataTablePageSize,
  type DataTablePageSizePreference,
  validatePageSize,
} from "@/lib/numbered-pagination"

const STORAGE_KEY = "tips.data-table-page-size.v1"

type StoredPreference = {
  mode: "manual"
  pageSize: DataTablePageSize
}

type StoredPreferences = Record<string, StoredPreference>

export type UseDataTablePageSizeResult = {
  ready: boolean
  pageSize: DataTablePageSize
  mode: "auto" | "manual"
  setPreference: (preference: DataTablePageSizePreference) => void
  setAutoPageSize: (measuredPageSize: DataTablePageSize) => void
}

function estimateAutoPageSize(viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight): DataTablePageSize {
  if (viewportHeight >= 1_120) return 20
  if (viewportHeight >= 800) return 15
  return 10
}

function readPreferences(): StoredPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== "object") return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([tableId, preference]) => {
        if (!preference || typeof preference !== "object") return []
        const candidate = preference as { mode?: unknown; pageSize?: unknown }
        if (candidate.mode !== "manual") return []
        try {
          return [[tableId, { mode: "manual" as const, pageSize: validatePageSize(candidate.pageSize) }]]
        } catch {
          return []
        }
      }),
    )
  } catch {
    return {}
  }
}

function writePreferences(preferences: StoredPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    return true
  } catch {
    // Browser privacy settings must not block pagination controls.
    return false
  }
}

export function useDataTablePageSize(tableId: string): UseDataTablePageSizeResult {
  const [state, setState] = useState<{ tableId: string | null; mode: "auto" | "manual"; pageSize: DataTablePageSize }>({ tableId: null, mode: "auto", pageSize: 10 })

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      const preferences = readPreferences()
      let preference = preferences[tableId]
      // Only management opts into the legacy key; unrelated tables keep their schema.
      if (/^management:(students|classes|textbooks)$/.test(tableId)) {
        const legacyKey = `tips:management-page-size:${tableId.slice("management:".length)}:v1`
        try {
          let persisted = Boolean(preference)
          const legacy = JSON.parse(window.localStorage.getItem(legacyKey) || "null")
          if (!preference && legacy?.version === 1) {
            preference = { mode: "manual", pageSize: validatePageSize(legacy.size) }
            preferences[tableId] = preference
            persisted = writePreferences(preferences)
          }
          if (persisted) window.localStorage.removeItem(legacyKey)
        } catch {
          // Invalid legacy values or unavailable storage leave auto sizing intact.
        }
      }
      setState({ tableId, mode: preference ? "manual" : "auto", pageSize: preference?.pageSize ?? estimateAutoPageSize() })
    })

    return () => {
      active = false
    }
  }, [tableId])

  const setPreference = useCallback((preference: DataTablePageSizePreference) => {
    if (preference === "auto") {
      setState({ tableId, mode: "auto", pageSize: estimateAutoPageSize() })
      const preferences = readPreferences()
      delete preferences[tableId]
      writePreferences(preferences)
      if (/^management:(students|classes|textbooks)$/.test(tableId)) {
        try { window.localStorage.removeItem(`tips:management-page-size:${tableId.slice("management:".length)}:v1`) } catch { /* storage may be unavailable */ }
      }
      return
    }

    const validPageSize = validatePageSize(preference)
    setState({ tableId, mode: "manual", pageSize: validPageSize })
    const preferences = readPreferences()
    preferences[tableId] = { mode: "manual", pageSize: validPageSize }
    writePreferences(preferences)
  }, [tableId])

  const setAutoPageSize = useCallback((measuredPageSize: DataTablePageSize) => {
    const pageSize = validatePageSize(measuredPageSize)
    setState((current) => current.tableId === tableId && current.mode === "auto" && current.pageSize !== pageSize
      ? { ...current, pageSize } : current)
  }, [tableId])

  return { ready: state.tableId === tableId, pageSize: state.pageSize, mode: state.mode, setPreference, setAutoPageSize }
}
