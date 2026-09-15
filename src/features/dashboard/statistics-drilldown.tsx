"use client"

import { useEffect, useId, useRef, useState } from "react"

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

type StatisticsDrilldownProps = {
  input: StatisticsDrilldownInput
  label: string
  trigger?: React.ReactNode
  renderRow?: (row: DrilldownRow) => React.ReactNode
}

export function StatisticsDrilldown(props: StatisticsDrilldownProps) {
  const { session, user, role } = useAuth()
  // A changed query or viewer must never inherit an already expanded roster.
  const scope = JSON.stringify([props.input, user?.id ?? session?.user?.id ?? "", role, Boolean(session?.access_token)])
  return <StatisticsDrilldownContent key={scope} {...props} accessToken={session?.access_token ?? ""} />
}

function StatisticsDrilldownContent({ input, label, trigger, renderRow, accessToken }: StatisticsDrilldownProps & { accessToken: string }) {
  const panelId = useId()
  const requestRef = useRef<AbortController | null>(null)
  const [rows, setRows] = useState<DrilldownRow[]>([])
  const [cursor, setCursor] = useState<Cursor>(null)
  const [hasMore, setHasMore] = useState(true)
  const [opened, setOpened] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const unit = input.kind === "class-group" ? "개" : "명"
  const noun = input.kind === "class-group" ? "수업" : "학생"

  useEffect(() => () => requestRef.current?.abort(), [])

  const load = async () => {
    if (!accessToken || requestRef.current || (loaded && !hasMore)) return
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError("")
    try {
      const result = await fetch("/api/dashboard/statistics/drilldown", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ...input, cursorName: cursor?.sortValue ?? null, cursorId: cursor?.id ?? null }),
      })
      const payload = await result.json().catch(() => null) as { ok?: boolean; data?: unknown } | null
      if (controller.signal.aborted) return
      const page = payload?.ok ? rowsFrom(payload.data) : null
      if (!result.ok || !page) throw new Error("dashboard_statistics_drilldown_unavailable")
      setRows(current => [...new Map([...current, ...page.rows].map(row => [rowId(row), row])).values()])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setLoaded(true)
    } catch {
      if (!controller.signal.aborted) setError(`${noun} 목록을 불러오지 못했습니다.`)
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const toggle = () => {
    setOpened(!opened)
    if (!opened && !loaded && !loading) void load()
  }

  return (
    <div className="grid gap-2">
      <Button type="button" size="sm" variant={trigger ? "ghost" : "outline"} className={trigger ? "h-auto min-h-11 w-full whitespace-normal px-1 py-2" : "justify-self-start"} aria-label={label} aria-expanded={opened} aria-controls={panelId} onClick={toggle}>
        {trigger ?? label}<span aria-hidden="true" className="ml-2 shrink-0 text-xs text-muted-foreground">{opened ? "접기" : "펼치기"}</span>
      </Button>
      <div id={panelId} hidden={!opened} aria-busy={loading}>
        {opened ? <div className="grid gap-2">
          {rows.length > 0 ? <div role="list" aria-label={`${noun} 목록`} className="grid gap-1 rounded-md border bg-background p-2">
            {rows.map(row => <div key={rowId(row)} role="listitem" className="text-sm">{renderRow ? renderRow(row) : `${row.name || row.title || "항목"}`}</div>)}
          </div> : null}
          {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void load()}>다시 시도</Button></div> : null}
          {loading ? <p role="status" className="text-sm text-muted-foreground">{noun} 목록을 불러오는 중입니다.</p> : null}
          {loaded && hasMore && !error ? <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>다음 {STATISTICS_DRILLDOWN_PAGE_SIZE}{unit} 더 보기</Button> : null}
          {loaded && !hasMore && !error ? <p role="status" className="text-xs text-muted-foreground">{rows.length ? `총 ${rows.length.toLocaleString("ko-KR")}${unit} · 모두 표시했습니다.` : `해당하는 ${noun}이 없습니다.`}</p> : null}
        </div> : null}
      </div>
    </div>
  )
}
