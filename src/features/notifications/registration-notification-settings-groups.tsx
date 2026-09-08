"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import type { NotificationDraft } from "./notification-control-plane-model"
import type { NotificationRuleDto } from "./notification-control-plane-types"
import { getRegistrationNotificationRulePolicy } from "./notification-registration-settings-policy"
import type { RegistrationSettingsGroup } from "./notification-settings-editor-state"
import { buildNotificationTemplatePreview } from "./notification-template-preview"

const GROUPS = [
  { key: "visit", title: "방문상담 인계", description: "예약 · 일정 변경 · 취소", fixed: true },
  { key: "progress", title: "관리팀 진행 공유", description: "상담 신청 · 상담 완료 · 대기 신청 · 등록 신청", fixed: false },
] as const

function archiveCategory(eventKey: string) {
  if (eventKey.startsWith("registration.observation_")) return "자동 경로 폐지"
  if (eventKey === "registration.appointment_reminder_due") return "사용 안 함"
  return "이전 흐름"
}

export function RegistrationNotificationSettingsGroups({
  rules,
  draft,
  group,
  onGroupChange,
  renderControl,
}: {
  rules: ReadonlyArray<NotificationRuleDto>
  draft: NotificationDraft
  group: RegistrationSettingsGroup | null
  onGroupChange: (group: RegistrationSettingsGroup | null) => void
  renderControl: (rule: NotificationRuleDto) => React.ReactNode
}) {
  const [selectedRuleId, setSelectedRuleId] = React.useState<string | null>(null)
  const grouped = React.useMemo(() => {
    const result: Record<RegistrationSettingsGroup, NotificationRuleDto[]> = { visit: [], progress: [], archive: [] }
    for (const rule of rules) {
      const policy = getRegistrationNotificationRulePolicy(rule)
      result[policy?.group ?? "archive"].push(rule)
    }
    return result
  }, [rules])
  const selectedGroup = GROUPS.find((item) => item.key === group)
  const selectedRules = group ? grouped[group] : []
  const selectedRule = selectedRules.find((rule) => rule.id === selectedRuleId) ?? selectedRules[0] ?? null
  const policy = selectedRule ? getRegistrationNotificationRulePolicy(selectedRule) : null
  const value = selectedRule ? draft.rules[selectedRule.id] : null
  const preview = selectedRule && value ? buildNotificationTemplatePreview({
    titleTemplate: value.titleTemplate,
    bodyTemplate: value.bodyTemplate,
    availableVariables: selectedRule.contentContract.availableVariables,
  }) : null

  return (
    <div className="space-y-3" data-registration-settings-groups>
      <div className="overflow-hidden rounded-xl border bg-background">
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_10rem_4rem] gap-4 border-b bg-muted/25 px-5 py-2.5 text-xs text-muted-foreground md:grid" aria-hidden="true">
          <span>업무</span><span>받는 곳</span><span>설정</span><span />
        </div>
        {GROUPS.map((item) => {
          const groupRules = grouped[item.key]
          const enabled = groupRules.filter((rule) => draft.rules[rule.id]?.enabled).length
          const status = groupRules.length === 0 ? "설정 없음" : enabled === 0 ? `${groupRules.length}개 꺼짐` : enabled === groupRules.length ? `${enabled}개 켜짐` : `${enabled}/${groupRules.length}개 켜짐`
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              className="grid h-auto min-h-24 w-full grid-cols-[minmax(0,1fr)_auto] justify-start gap-3 rounded-none border-b px-5 py-5 text-left last:border-b-0 md:grid-cols-[minmax(0,1fr)_7rem_10rem_4rem] md:gap-4"
              aria-label={`${item.title} · ${status} · 상세 설정`}
              onClick={() => { setSelectedRuleId(null); onGroupChange(item.key) }}
            >
              <span className="col-span-2 min-w-0 md:col-span-1"><span className="block text-base font-semibold">{item.title}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{item.description}</span></span>
              <span className="text-xs font-normal md:text-sm">관리팀</span>
              <span className="row-start-3 flex items-center gap-2 md:row-auto"><Badge variant="secondary">{status}{item.fixed ? " · 고정" : ""}</Badge></span>
              <span className="col-start-2 row-start-3 flex items-center justify-end gap-1 text-xs text-muted-foreground md:col-auto md:row-auto">상세<ChevronRight aria-hidden="true" className="size-3.5" /></span>
            </Button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1">
        {grouped.archive.length > 0 ? <Button type="button" variant="link" size="sm" className="h-10 px-0 text-xs text-muted-foreground" onClick={() => onGroupChange("archive")}>이전 설정 {grouped.archive.length}개 보기</Button> : null}
      </div>
      <p className="text-xs text-muted-foreground"><Link href="/admin/registration?flow=observation" className="font-medium text-primary underline underline-offset-4">청강 담당 전달 · 피드백 요청</Link>은 등록의 청강 화면에서 내용을 확인한 뒤 직접 전달합니다.</p>
      <Dialog open={group !== null} onOpenChange={(open) => { if (!open) onGroupChange(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" closeButtonLabel="등록 알림 상세 닫기">
          <DialogHeader>
            <DialogTitle>{group === "archive" ? "이전 알림 설정" : selectedGroup?.title ?? "등록 알림"}</DialogTitle>
            <DialogDescription>{group === "archive" ? "현재 업무와 분리된 설정과 이력을 확인합니다." : "상황별 받는 곳과 문구를 확인하고 변경사항에 반영합니다."}</DialogDescription>
          </DialogHeader>
          {group === "archive" ? (
            <div className="divide-y rounded-lg border">
              {grouped.archive.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium">{rule.eventLabel ?? rule.eventKey}</p><p className="text-xs text-muted-foreground">{rule.audienceLabel ?? rule.audienceKey} · {rule.enabled ? "설정 켜짐" : "설정 꺼짐"}</p></div><Badge variant="outline">{archiveCategory(rule.eventKey)}</Badge></div>)}
            </div>
          ) : selectedRule && value ? (
            <div className="space-y-5">
              <div className="space-y-2"><Label htmlFor="registration-notification-scenario">상황</Label><Select value={selectedRule.id} onValueChange={setSelectedRuleId}><SelectTrigger id="registration-notification-scenario" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{selectedRules.map((rule) => <SelectItem key={rule.id} value={rule.id}>{rule.eventLabel ?? rule.eventKey}</SelectItem>)}</SelectContent></Select></div>
              <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-muted-foreground">받는 곳</dt><dd className="mt-1">{selectedRule.audienceLabel ?? "관리팀"} Google Chat</dd></div><div><dt className="text-xs text-muted-foreground">전달 방식</dt><dd className="mt-1">{policy?.mode === "compatibility" ? "이전 기록 호환" : "내용 확인 후 직접 전달"}</dd></div></dl>
              {policy?.mode === "compatibility" ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">이전 흐름의 원본 기록과 연결된 설정입니다. 현행 화면의 직접 전달과 구분해 유지합니다.</p> : null}
              {policy?.editable ? renderControl(selectedRule) : <p className="text-xs text-muted-foreground">현재 업무에서 수정하지 않는 설정입니다.</p>}
              {preview ? <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">내용 미리보기</h3><span className="text-xs text-muted-foreground">변수는 예시 값으로 표시</span></div><div className="rounded-lg border bg-muted/20 p-4"><p className="text-sm font-semibold">{preview.title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{preview.body}</p></div></div> : null}
            </div>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">이 업무의 설정을 불러오지 못했습니다.</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onGroupChange(null)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
