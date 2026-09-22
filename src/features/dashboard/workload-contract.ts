export const WORKLOAD_KINDS = [
  "registration",
  "transfer",
  "withdrawal",
  "makeup",
] as const
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number]
export const WORKLOAD_LABELS: Record<WorkloadKind, string> = {
  registration: "등록",
  transfer: "전반",
  withdrawal: "퇴원",
  makeup: "휴보강",
}
export type WorkloadGroup = {
  team: string
  ownerKey: string
  ownerLabel: string
  workflow: WorkloadKind
  stage: string
  stageLabel: string
  total: number
  aged: number
  oldestAt: string
  oldestRequestedAt: string
  elapsedSeconds: number
}
export type WorkloadSummary = { generatedAt: string; groups: WorkloadGroup[] }
export type WorkloadFilter = {
  team: string
  ownerKey?: string
  workflow?: WorkloadKind
  stage?: string
  agedOnly?: boolean
}
export type WorkloadItem = Omit<
  WorkloadGroup,
  "total" | "aged" | "oldestAt" | "oldestRequestedAt" | "elapsedSeconds"
> & {
  key: string
  title: string
  enteredAt: string
  requestedAt: string
  href: string
}
export type WorkloadPage = {
  generatedAt: string
  rows: WorkloadItem[]
  totalCount: number
  page: number
  pageSize: 10 | 15 | 20
}

function invalid(): never {
  throw new Error("dashboard_workload_contract_invalid")
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid()
  return value
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid()
  return value
}
function timestamp(value: unknown): string {
  const result = text(value)
  if (
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid()
  return result
}
function identity(row: Record<string, unknown>) {
  const workflow = text(row.workflow) as WorkloadKind
  if (!WORKLOAD_KINDS.includes(workflow)) invalid()
  return {
    team: text(row.team),
    ownerKey: text(row.ownerKey),
    ownerLabel: text(row.ownerLabel),
    workflow,
    stage: text(row.stage),
    stageLabel: text(row.stageLabel),
  }
}
export function normalizeWorkloadSummary(value: unknown): WorkloadSummary {
  const source = object(value)
  if (!Array.isArray(source.groups)) invalid()
  const keys = new Set<string>()
  return {
    generatedAt: timestamp(source.generatedAt),
    groups: source.groups.map((value) => {
      const row = object(value),
        base = identity(row),
        total = count(row.total),
        aged = count(row.aged)
      const key = JSON.stringify([
        base.team,
        base.ownerKey,
        base.workflow,
        base.stage,
      ])
      if (!total || aged > total || keys.has(key)) invalid()
      keys.add(key)
      if (
        typeof row.elapsedSeconds !== "number" ||
        !Number.isFinite(row.elapsedSeconds) ||
        row.elapsedSeconds < 0
      )
        invalid()
      return {
        ...base,
        total,
        aged,
        oldestAt: timestamp(row.oldestAt),
        oldestRequestedAt: timestamp(row.oldestRequestedAt),
        elapsedSeconds: row.elapsedSeconds,
      }
    }),
  }
}
export function normalizeWorkloadPage(value: unknown): WorkloadPage {
  const source = object(value),
    page = count(source.page),
    pageSize = count(source.pageSize),
    totalCount = count(source.totalCount)
  if (
    !page ||
    ![10, 15, 20].includes(pageSize) ||
    !Array.isArray(source.rows) ||
    source.rows.length > pageSize ||
    source.rows.length > totalCount
  )
    invalid()
  const keys = new Set<string>()
  return {
    generatedAt: timestamp(source.generatedAt),
    page,
    pageSize: pageSize as 10 | 15 | 20,
    totalCount,
    rows: source.rows.map((value) => {
      const row = object(value),
        base = identity(row),
        key = text(row.key),
        href = text(row.href)
      const url = new URL(href, "https://workload.invalid")
      const path =
        base.workflow === "makeup"
          ? "/admin/makeup-requests"
          : `/admin/${base.workflow}`
      if (
        !href.startsWith(`${path}?`) ||
        url.origin !== "https://workload.invalid" ||
        url.pathname !== path ||
        keys.has(key)
      )
        invalid()
      keys.add(key)
      return {
        ...base,
        key,
        href,
        title: text(row.title),
        enteredAt: timestamp(row.enteredAt),
        requestedAt: timestamp(row.requestedAt),
      }
    }),
  }
}
export function workloadDays(since: string, now: string): number {
  return Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(since)) / 86_400_000),
  )
}
export type WorkloadRow = {
  key: string
  label: string
  team: string
  ownerKey?: string
  total: number
  aged: number
  oldestAt: string
  oldestRequestedAt: string
  elapsedSeconds: number
  counts: Record<WorkloadKind, number>
}
export function buildWorkloadTeams(
  groups: readonly WorkloadGroup[],
): Array<{ summary: WorkloadRow; owners: WorkloadRow[] }> {
  const teams = new Map<
    string,
    { summary: WorkloadRow; owners: Map<string, WorkloadRow> }
  >()
  const create = (
    team: string,
    label: string,
    ownerKey?: string,
  ): WorkloadRow => ({
    key: JSON.stringify([team, ownerKey]),
    label,
    team,
    ownerKey,
    total: 0,
    aged: 0,
    oldestAt: "",
    oldestRequestedAt: "",
    elapsedSeconds: 0,
    counts: { registration: 0, transfer: 0, withdrawal: 0, makeup: 0 },
  })
  const add = (row: WorkloadRow, group: WorkloadGroup) => {
    row.total += group.total
    row.aged += group.aged
    row.elapsedSeconds += group.elapsedSeconds
    if (
      !row.oldestRequestedAt ||
      Date.parse(group.oldestRequestedAt) < Date.parse(row.oldestRequestedAt)
    )
      row.oldestRequestedAt = group.oldestRequestedAt
    row.counts[group.workflow] += group.total
    if (!row.oldestAt || Date.parse(group.oldestAt) < Date.parse(row.oldestAt))
      row.oldestAt = group.oldestAt
  }
  const compare = (a: WorkloadRow, b: WorkloadRow) =>
    b.aged - a.aged || b.total - a.total || a.label.localeCompare(b.label, "ko")
  for (const group of groups) {
    let team = teams.get(group.team)
    if (!team) {
      team = { summary: create(group.team, group.team), owners: new Map() }
      teams.set(group.team, team)
    }
    let owner = team.owners.get(group.ownerKey)
    if (!owner) {
      owner = create(group.team, group.ownerLabel, group.ownerKey)
      team.owners.set(group.ownerKey, owner)
    }
    add(team.summary, group)
    add(owner, group)
  }
  return [...teams.values()]
    .sort((a, b) => compare(a.summary, b.summary))
    .map((team) => ({
      summary: team.summary,
      owners: [...team.owners.values()].sort(compare),
    }))
}
