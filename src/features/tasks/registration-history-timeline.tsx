"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

import type { OpsProfileOption } from "./ops-task-service"
import {
  buildRegistrationSubjectHistory,
  type RegistrationSubjectHistoryItem,
} from "./registration-track-history.js"
import type { OpsRegistrationCaseDetail } from "./registration-track-service"

export type RegistrationHistoryTimelineProps = {
  detail: OpsRegistrationCaseDetail
  profiles: OpsProfileOption[]
  embedded?: boolean
}

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

const SYSTEM_SOURCE_LABELS: Record<string, string> = {
  registration_director_defaults: "상담 책임자 자동 배정",
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function historyTimeLabel(item: RegistrationSubjectHistoryItem) {
  if (item.timeKind !== "exact" || !item.occurredAt) return "시간 확인 불가"
  const occurredAt = new Date(item.occurredAt)
  return Number.isNaN(occurredAt.getTime())
    ? "시간 확인 불가"
    : HISTORY_DATE_FORMATTER.format(occurredAt)
}

function historyActorLabel(item: RegistrationSubjectHistoryItem, profileById: Map<string, string>) {
  if (item.actorKind === "migration") return "마이그레이션"
  if (item.actorKind === "system") {
    return item.systemSource
      ? `시스템 · ${SYSTEM_SOURCE_LABELS[item.systemSource] || "자동 처리"}`
      : "시스템"
  }
  if (item.actorKind === "user") {
    return item.actorId ? profileById.get(item.actorId) || "알 수 없음" : "알 수 없음"
  }
  return "알 수 없음"
}

const APPOINTMENT_CHANGE_LABELS: Record<string, string> = {
  appointment_updated: "예약 변경",
  appointment_replaced: "예약 교체",
  appointment_subject_deselected: "예약 과목 제외",
  appointment_canceled: "예약 취소",
}

function historyDetailValue(value: unknown, date = false) {
  if (typeof value !== "string" || !value) return ""
  if (!date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : HISTORY_DATE_FORMATTER.format(parsed)
}

function appointmentChangeLine(value: unknown) {
  const change = record(value)
  const metadata = record(change.metadata)
  const facts: string[] = []
  const oldScheduledAt = historyDetailValue(metadata.oldScheduledAt, true)
  const scheduledAt = historyDetailValue(metadata.scheduledAt, true)
  const oldPlace = historyDetailValue(metadata.oldPlace)
  const place = historyDetailValue(metadata.place)

  if (oldScheduledAt && scheduledAt) facts.push(`예약 시각: ${oldScheduledAt} → ${scheduledAt}`)
  else if (scheduledAt) facts.push(`예약 시각: ${scheduledAt}`)
  else if (oldScheduledAt) facts.push(`이전 예약 시각: ${oldScheduledAt}`)
  if (oldPlace && place) facts.push(`장소: ${oldPlace} → ${place}`)
  else if (place) facts.push(`장소: ${place}`)
  else if (oldPlace) facts.push(`이전 장소: ${oldPlace}`)
  const reason = typeof change.reasonLabel === "string" && change.reasonLabel
    ? change.reasonLabel
    : typeof change.reason === "string" && change.reason
      ? change.reason
      : ""
  if (reason) facts.push(`사유: ${reason}`)

  const eventType = typeof change.eventType === "string" ? change.eventType : ""
  const label = APPOINTMENT_CHANGE_LABELS[eventType] || "예약 변경"
  return facts.length > 0 ? `${label} · ${facts.join(" · ")}` : label
}

function historyDetailLines(item: RegistrationSubjectHistoryItem) {
  const metadata = record(item.metadata)
  const appointmentChanges = Array.isArray(metadata.appointmentChanges) ? metadata.appointmentChanges : []
  const subjectTransitions = Array.isArray(metadata.subjectTransitions) ? metadata.subjectTransitions : []
  const lines: string[] = []

  for (const appointmentChange of appointmentChanges) {
    lines.push(appointmentChangeLine(appointmentChange))
  }
  if (subjectTransitions.length > 1) lines.push(`과목별 단계 기록 ${subjectTransitions.length}건`)
  if (typeof metadata.scheduledAt === "string" && metadata.scheduledAt) {
    const scheduledAt = new Date(metadata.scheduledAt)
    lines.push(`예약 시각: ${Number.isNaN(scheduledAt.getTime()) ? metadata.scheduledAt : HISTORY_DATE_FORMATTER.format(scheduledAt)}`)
  }
  if (typeof metadata.place === "string" && metadata.place) lines.push(`장소: ${metadata.place}`)
  if (item.description) lines.push(`기록 요약: ${item.description}`)
  if (lines.length === 0) lines.push("자동 기록의 세부 정보가 보존되어 있습니다.")
  return lines
}

function RegistrationHistoryDetails({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-xs text-muted-foreground">
      <CollapsibleTrigger type="button" className="w-fit cursor-pointer font-medium text-foreground">
        {open ? "상세 닫기" : "상세 보기"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 grid gap-1 pl-4">
          {lines.map((line) => <li key={line} className="list-disc break-words">{line}</li>)}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RegistrationHistoryTimeline({ detail, profiles, embedded = false }: RegistrationHistoryTimelineProps) {
  const history = useMemo(() => buildRegistrationSubjectHistory(detail), [detail])
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.label])),
    [profiles],
  )
  return (
    <section
      className={embedded
        ? "grid min-w-0 gap-3 p-3"
        : "grid min-w-0 gap-3 rounded-md border p-3"}
      aria-label="등록 자동 이력"
    >
      <div>
        <h3 className="text-sm font-semibold">자동 이력</h3>
        <p className="text-xs text-muted-foreground">누가 · 언제 · 무엇을 · 어떻게 처리했는지 시간순으로 보여 줍니다.</p>
      </div>
      {history.length === 0 ? (
        <p className="rounded-md bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
          아직 자동 이력이 없습니다.
        </p>
      ) : (
        <ol className="grid gap-2">
          {history.map((item) => {
            const detailLines = historyDetailLines(item)
            return (
              <li key={item.id} className="grid min-w-0 gap-2 rounded-md bg-muted/30 px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{item.title}</span>
                      {item.subjects.map((subject) => <Badge key={subject} variant="secondary">{subject}</Badge>)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {historyActorLabel(item, profileById)} · {historyTimeLabel(item)}
                    </p>
                  </div>
                </div>
                <RegistrationHistoryDetails lines={detailLines} />
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
