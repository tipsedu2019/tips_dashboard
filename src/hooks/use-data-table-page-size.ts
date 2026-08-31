"use client"

import { useCallback, useEffect, useState } from "react"

import {
  type DataTablePageSize,
  validatePageSize,
} from "@/lib/numbered-pagination"

const STORAGE_KEY = "tips.data-table-page-size.v1"

type StoredPreference = {
  mode: "manual"
  pageSize: DataTablePageSize
}

type StoredPreferences = Record<string, StoredPreference>

export type DataTablePageSizePreference = {
  ready: boolean
  pageSize: DataTablePageSize
  mode: "auto" | "manual"
  setPreference: (pageSize: DataTablePageSize) => void
  setAutoPageSize: (measuredPageSize?: DataTablePageSize) => void
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
  } catch {
    // Browser privacy settings must not block pagination controls.
  }
}

export function useDataTablePageSize(tableId: string): DataTablePageSizePreference {
  const [hydratedTableId, setHydratedTableId] = useState<string | null>(null)
  const [mode, setMode] = useState<"auto" | "manual">("auto")
  const [pageSize, setPageSize] = useState<DataTablePageSize>(10)

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      const preference = readPreferences()[tableId]
      if (preference) {
        setMode("manual")
        setPageSize(preference.pageSize)
      } else {
        setMode("auto")
        setPageSize(estimateAutoPageSize())
      }
      setHydratedTableId(tableId)
    })

    return () => {
      active = false
    }
  }, [tableId])

  const setPreference = useCallback((nextPageSize: DataTablePageSize) => {
    const validPageSize = validatePageSize(nextPageSize)
    setMode("manual")
    setPageSize(validPageSize)
    const preferences = readPreferences()
    preferences[tableId] = { mode: "manual", pageSize: validPageSize }
    writePreferences(preferences)
  }, [tableId])

  const setAutoPageSize = useCallback((measuredPageSize?: DataTablePageSize) => {
    const nextPageSize = measuredPageSize === undefined ? estimateAutoPageSize() : validatePageSize(measuredPageSize)
    setMode("auto")
    setPageSize(nextPageSize)
    const preferences = readPreferences()
    delete preferences[tableId]
    writePreferences(preferences)
  }, [tableId])

  return { ready: hydratedTableId === tableId, pageSize, mode, setPreference, setAutoPageSize }
}
