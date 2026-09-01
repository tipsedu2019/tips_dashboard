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
  setPreference: (preference: DataTablePageSizePreference) => void
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
  const [state, setState] = useState<{ tableId: string | null; pageSize: DataTablePageSize }>({ tableId: null, pageSize: 10 })

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
          // Invalid legacy values or unavailable storage keep the fixed default.
        }
      }
      setState({ tableId, pageSize: preference?.pageSize ?? 10 })
    })

    return () => {
      active = false
    }
  }, [tableId])

  const setPreference = useCallback((preference: DataTablePageSizePreference) => {
    const validPageSize = validatePageSize(preference)
    setState({ tableId, pageSize: validPageSize })
    const preferences = readPreferences()
    preferences[tableId] = { mode: "manual", pageSize: validPageSize }
    writePreferences(preferences)
  }, [tableId])

  return { ready: state.tableId === tableId, pageSize: state.pageSize, setPreference }
}
