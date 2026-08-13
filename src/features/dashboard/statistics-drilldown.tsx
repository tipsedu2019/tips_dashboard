"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/providers/auth-provider"

export const STATISTICS_DRILLDOWN_PAGE_SIZE = 30

export type StatisticsDrilldownInput =
  | { kind: "student-roster"; subject: string; division: string; axis: "grade" | "school" | "grade_school" | "school_grade"; key: string; parentKey: string }
  | { kind: "class-group"; subject: string; division: string; axis: "grade" | "teacher" | "classroom"; key: string }
  | { kind: "class-roster"; classId: string }

type DrilldownRow = Record<string, unknown> & { id?: string; name?: string; title?: string }
type Cursor = { sortValue: string; id: string } | null

function rowsFrom(value: unknown): { rows: DrilldownRow[]; nextCursor: Cursor; hasMore: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.rows) || typeof data.hasMore !== "boolean") return null
  const nextCursor = data.nextCursor && typeof data.nextCursor === "object" && !Array.isArray(data.nextCursor)
    ? data.nextCursor as Cursor
    : null
  return { rows: data.rows.filter((row): row is DrilldownRow => Boolean(row && typeof row === "object")), nextCursor, hasMore: data.hasMore }
}

function rowId(row: DrilldownRow) {
  return typeof row.id === "string" ? row.id : JSON.stringify(row)
}

export function StatisticsDrilldown({
  input,
  label,
  renderRow,
}: {
  input: StatisticsDrilldownInput
  label: string
  renderRow?: (row: DrilldownRow) => React.ReactNode
}) {
  const { session } = useAuth()
  const [rows, setRows] = useState<DrilldownRow[]>([])
  const [cursor, setCursor] = useState<Cursor>(null)
  const [hasMore, setHasMore] = useState(true)
  const [opened, setOpened] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = async () => {
    if (!session?.access_token || loading || (!hasMore && opened)) return
    setOpened(true)
    setLoading(true)
    setError("")
    try {
      const result = await fetch("/api/dashboard/statistics/drilldown", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ...input, cursorName: cursor?.sortValue ?? null, cursorId: cursor?.id ?? null }),
      })
      const payload = await result.json().catch(() => null) as { ok?: boolean; data?: unknown } | null
      const page = payload?.ok ? rowsFrom(payload.data) : null
      if (!result.ok || !page) throw new Error("dashboard_statistics_drilldown_unavailable")
      setRows((current) => [...new Map([...current, ...page.rows].map((row) => [rowId(row), row])).values()])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      setError("명단을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-2">
      {!opened ? <Button type="button" size="sm" variant="outline" onClick={() => void load()}>{label}</Button> : null}
      {opened && rows.length > 0 ? <div role="list" className="grid gap-1 rounded-md border bg-background p-2">
        {rows.map((row) => <div key={rowId(row)} role="listitem" className="text-sm">{renderRow ? renderRow(row) : `${row.name || row.title || "항목"}`}</div>)}
      </div> : null}
      {error ? <div className="flex items-center gap-2 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void load()}>다시 시도</Button></div> : null}
      {opened && hasMore ? <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? "불러오는 중" : "다음 30명/개"}</Button> : null}
      {opened && !hasMore && !error ? <p className="text-xs text-muted-foreground">마지막 항목입니다.</p> : null}
    </div>
  )
}
