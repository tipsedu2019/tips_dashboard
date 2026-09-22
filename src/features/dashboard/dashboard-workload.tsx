"use client"

import { Fragment, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { DetailDialogContent } from "@/components/ui/form-dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import {
  DATA_TABLE_LAYOUT_CLASS_NAME,
  DataTableViewport,
  DataTableHeaderRow,
  DataTableHeaderCell,
  DataTableBodyRow,
  DataTableBodyCell,
} from "@/components/data-table/data-table-surface"
import {
  buildWorkloadTeams,
  workloadDays,
  WORKLOAD_KINDS,
  WORKLOAD_LABELS,
  type WorkloadFilter,
  type WorkloadGroup,
  type WorkloadPage,
  type WorkloadRow,
  type WorkloadSummary,
} from "./workload-contract.ts"
import { useDashboardWorkload } from "./use-dashboard-workload"

type Selection = { label: string; filter: WorkloadFilter }
const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
function age(since: string, now: string) {
  const days = workloadDays(since, now)
  const hours =
    Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 3_600_000)) %
    24
  return days ? `${days}일 ${hours}시간` : hours ? `${hours}시간` : "1시간 미만"
}

export function DashboardWorkload() {
  const state = useDashboardWorkload()
  return <DashboardWorkloadView {...state} />
}

export function DashboardWorkloadView({
  data,
  loading,
  error,
  refresh,
}: {
  data: WorkloadSummary | null
  loading: boolean
  error: string | null
  refresh: () => void
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const teams = useMemo(() => buildWorkloadTeams(data?.groups ?? []), [data])
  const total = teams.reduce((sum, team) => sum + team.summary.total, 0)
  const open = (row: WorkloadRow, extra: Partial<WorkloadFilter> = {}) =>
    setSelection({
      label: row.ownerKey ? `${row.team} · ${row.label}` : row.label,
      filter: { team: row.team, ownerKey: row.ownerKey, ...extra },
    })
  const cell = (
    row: WorkloadRow,
    count: number,
    label: string,
    extra: Partial<WorkloadFilter> = {},
  ) =>
    count ? (
      <Button
        variant="ghost"
        size="sm"
        className="min-w-10 tabular-nums"
        onClick={() => open(row, extra)}
        aria-label={`${row.team}${row.ownerKey ? ` ${row.label}` : ""} ${label} ${count}건 보기`}
      >
        {count}
      </Button>
    ) : (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">0건</span>
      </span>
    )
  const renderRow = (row: WorkloadRow, isTeam: boolean) => (
    <DataTableBodyRow
      key={row.key}
      className={isTeam ? "bg-muted/40 font-semibold" : undefined}
    >
      <DataTableBodyCell wrap className={isTeam ? "min-w-36" : "min-w-36 pl-6"}>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-9 max-w-full whitespace-normal text-left"
          onClick={() => open(row)}
          aria-label={`${row.team}${row.ownerKey ? ` ${row.label}` : ""} 전체 업무 ${row.total}건 보기`}
        >
          {row.label}
        </Button>
      </DataTableBodyCell>
      {WORKLOAD_KINDS.map((kind) => (
        <DataTableBodyCell key={kind} className="text-right">
          {cell(row, row.counts[kind], WORKLOAD_LABELS[kind], {
            workflow: kind,
          })}
        </DataTableBodyCell>
      ))}
      <DataTableBodyCell className="text-right font-semibold">
        {cell(row, row.total, "전체")}
      </DataTableBodyCell>
      <DataTableBodyCell className="text-right">
        {cell(row, row.aged, "7일 이상", { agedOnly: true })}
      </DataTableBodyCell>
      <DataTableBodyCell className="text-right text-xs tabular-nums">
        {(row.elapsedSeconds / row.total / 86_400).toFixed(1)}일
      </DataTableBodyCell>
      <DataTableBodyCell className="text-right text-xs tabular-nums">
        {data ? age(row.oldestRequestedAt, data.generatedAt) : "—"}
      </DataTableBodyCell>
    </DataTableBodyRow>
  )
  return (
    <section
      className="grid w-full min-w-0 max-w-[1120px] gap-3"
      aria-labelledby="dashboard-workload-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dashboard-workload-heading" className="text-xl font-semibold">
          처리 대기 업무{" "}
          {data ? (
            <span className="ml-1 text-base font-normal text-muted-foreground tabular-nums">
              {total}건
            </span>
          ) : null}
        </h2>
        <div className="flex items-center gap-1">
          {data ? (
            <time
              dateTime={data.generatedAt}
              className="text-xs text-muted-foreground"
            >
              {timeFormat.format(new Date(data.generatedAt))} 기준
            </time>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={loading}
            onClick={refresh}
            aria-label="업무 현황 새로고침"
          >
            <RefreshCw
              className={
                loading
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
              aria-hidden="true"
            />
          </Button>
        </div>
      </header>
      <div role="status" aria-live="polite" className="empty:hidden">
        {error ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {data ? "새로고침하지 못했습니다. 이전 조회 결과입니다." : error}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={refresh}
            >
              다시 시도
            </Button>
          </div>
        ) : null}
        {loading ? (
          <span className="sr-only">업무 현황을 불러오는 중입니다.</span>
        ) : null}
      </div>
      {!data && loading ? (
        <div
          aria-label="업무 현황을 불러오는 중"
          className="grid gap-3 rounded-[var(--radius-surface)] border p-4"
        >
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
      {data ? (
        teams.length ? (
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
            <DataTableViewport
              role="region"
              aria-label="팀별 담당자별 업무 현황 스크롤"
              tabIndex={0}
              className="max-h-[480px] [&>[data-slot=table-container]]:overflow-visible"
            >
              <Table className="min-w-[760px]">
                <TableHeader>
                  <DataTableHeaderRow>
                    <DataTableHeaderCell>팀 / 담당자</DataTableHeaderCell>
                    {WORKLOAD_KINDS.map((kind) => (
                      <DataTableHeaderCell key={kind} className="text-right">
                        {WORKLOAD_LABELS[kind]}
                      </DataTableHeaderCell>
                    ))}
                    <DataTableHeaderCell className="text-right">
                      합계
                    </DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">
                      7일 이상
                    </DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">
                      평균 경과
                    </DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">
                      최장 경과
                    </DataTableHeaderCell>
                  </DataTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team) => (
                    <Fragment key={team.summary.key}>
                      {renderRow(team.summary, true)}
                      {team.owners.map((owner) => renderRow(owner, false))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </DataTableViewport>
          </div>
        ) : (
          <p className="rounded-[var(--radius-surface)] border border-border/70 bg-card px-5 py-8 text-sm text-muted-foreground">
            처리 대기 중인 업무가 없습니다.
          </p>
        )
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        등록은 과목별 1건 · 경과 시간은 접수일부터 집계 · 화면을 보고 있을 때
        1분마다 갱신
      </p>
      <Dialog
        open={Boolean(selection)}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
      >
        {selection ? (
          <WorkloadDetail
            key={JSON.stringify(selection.filter)}
            selection={selection}
            groups={data?.groups ?? []}
            onClose={() => setSelection(null)}
          />
        ) : null}
      </Dialog>
    </section>
  )
}

function WorkloadDetail({
  selection,
  groups,
  onClose,
}: {
  selection: Selection
  groups: WorkloadGroup[]
  onClose: () => void
}) {
  const [picked, setPicked] = useState<{
    workflow: WorkloadGroup["workflow"]
    stage: string
    label: string
  } | null>(null)
  const stage = picked ? `${picked.workflow}:${picked.stage}` : ""
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 15 | 20>(10)
  const stages = useMemo(() => {
    const options = new Map<
      string,
      {
        label: string
        count: number
        workflow: WorkloadGroup["workflow"]
        stage: string
      }
    >()
    for (const group of groups) {
      if (
        group.team !== selection.filter.team ||
        (selection.filter.ownerKey !== undefined &&
          group.ownerKey !== selection.filter.ownerKey) ||
        (selection.filter.workflow &&
          group.workflow !== selection.filter.workflow)
      )
        continue
      const value = `${group.workflow}:${group.stage}`,
        count = selection.filter.agedOnly ? group.aged : group.total
      if (!count) continue
      const current = options.get(value)
      options.set(value, {
        label: `${WORKLOAD_LABELS[group.workflow]} · ${group.stageLabel}`,
        count: (current?.count ?? 0) + count,
        workflow: group.workflow,
        stage: group.stage,
      })
    }
    // Keep a selected stage scoped even when automatic refresh removes its last task.
    if (picked && !options.has(stage))
      options.set(stage, { ...picked, count: 0 })
    return options
  }, [groups, selection, picked, stage])
  const filter: WorkloadFilter = {
    ...selection.filter,
    ...(picked ? { workflow: picked.workflow, stage: picked.stage } : {}),
  }
  const { data, loading, error, refresh } = useDashboardWorkload<WorkloadPage>({
    filter,
    page,
    pageSize,
  })
  const lastPage = data
    ? Math.max(1, Math.ceil(data.totalCount / pageSize))
    : page
  // Live completion can remove the final page while this dialog stays open.
  if (data?.page === page && page > lastPage) setPage(lastPage)
  return (
    <DetailDialogContent
      title={`${selection.label} · ${selection.filter.workflow ? WORKLOAD_LABELS[selection.filter.workflow] : "전체 업무"}${selection.filter.agedOnly ? " · 7일 이상" : ""}`}
      description="현재 처리 단계와 담당자를 확인하고 업무로 이동합니다."
      onClose={onClose}
      compact={false}
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="업무 단계"
            value={stage}
            onChange={(event) => {
              setPicked(stages.get(event.target.value) ?? null)
              setPage(1)
            }}
          >
            <option value="">전체 단계</option>
            {[...stages].map(([value, option]) => (
              <option key={value} value={value}>
                {option.label} ({option.count})
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={loading}
            aria-label="대기 업무 목록 새로고침"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div role="status" aria-live="polite" className="empty:hidden">
          {error ? (
            <div className="flex items-center gap-2 text-sm">
              <span>
                {data
                  ? "이전 조회 결과입니다. 새로고침하지 못했습니다."
                  : error}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
              >
                다시 시도
              </Button>
            </div>
          ) : loading ? (
            <span className="sr-only">대기 업무 목록을 불러오는 중입니다.</span>
          ) : null}
        </div>
        {loading && !data ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-20 w-full" />
            ))}
          </div>
        ) : null}
        {data ? (
          data.rows.length ? (
            <ul
              className="divide-y divide-border/70"
              aria-label="대기 업무 목록"
            >
              {data.rows.map((item) => (
                <li key={item.key}>
                  <Link
                    prefetch={false}
                    href={item.href}
                    className="grid min-h-20 gap-1 rounded-md px-1 py-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="break-words text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      {WORKLOAD_LABELS[item.workflow]} · {item.stageLabel} ·{" "}
                      {item.ownerLabel}
                    </span>
                    <span className="text-xs tabular-nums">
                      접수 후 {age(item.requestedAt, data.generatedAt)} · 현재
                      단계 {age(item.enteredAt, data.generatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              해당 조건의 처리 대기 업무가 없습니다.
            </p>
          )
        ) : null}
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalCount={data?.totalCount ?? null}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          ariaLabel="대기 업무 페이지 탐색"
        />
      </div>
    </DetailDialogContent>
  )
}
