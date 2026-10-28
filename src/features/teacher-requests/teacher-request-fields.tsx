"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchCombobox, SearchComboboxItem, SearchComboboxOptionContent } from "@/components/ui/search-combobox"
import { RequestOption } from "@/features/textbooks/teacher-textbook-request-create"
import { isoToSeoulDateTimeInput, seoulDateTimeInputToIso } from "@/features/tasks/ops-task-service"
import type { MakeupSlot, OwnRequestDetail, RequestDomain, RequestInput, RequestReferences } from "./teacher-request-service"

export function blankRequestInput(domain: RequestDomain): RequestInput {
  if (domain === "textbook") return { title: "", textbookId: null, classId: null, locationId: null, studentQuantity: 0, teacherQuantity: 0, memo: "" }
  if (domain === "makeup") return { request_kind: "cancel_makeup", class_id: "", reason: "", cancel_date: null, original_lesson_session_id: null, makeup_slots: [] }
  if (domain === "withdrawal") return { student_id: "", memo: "", class_id: "", withdrawal_date: null, withdrawal_session: "", customer_reason: "", teacher_opinion: "", undistributed_textbooks: "" }
  return { student_id: "", memo: "", from_class_id: "", to_class_id: "", transfer_reason: "", from_class_end_date: null, from_class_end_session: "", to_class_start_date: null, to_class_start_session: "", from_undistributed_textbooks: "", to_undistributed_textbooks: "" }
}
function Option({ label, value, fallback, options, disabled, onChange }: { label: string; value: string; fallback?: string; options: Array<{ id: string; label: string }>; disabled: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState("")
  const id = useId()
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="grid min-w-0 gap-2"><Label htmlFor={id}>{label}</Label><SearchCombobox triggerId={id} open={open && !disabled} onOpenChange={setOpen}
    triggerLabel={options.find(option => option.id === value)?.label || (value ? fallback || "기존 선택 유지" : "선택해 주세요")}
    triggerPlaceholder={!value} triggerAriaLabel={label} wrapTrigger disabled={disabled} selectedValue={value}
    searchValue={search} onSearchValueChange={setSearch} searchPlaceholder={`${label} 검색`} searchAriaLabel={`${label} 검색`} listAriaLabel={`${label} 목록`}
    emptyMessage={search.trim() ? "검색 결과가 없습니다." : "선택할 항목이 없습니다."}>
    {filtered.map(option => <SearchComboboxItem key={option.id} value={option.id} onSelect={() => { onChange(option.id); setOpen(false) }}><SearchComboboxOptionContent label={option.label} selected={option.id === value} /></SearchComboboxItem>)}
  </SearchCombobox></div>
}
export type TeacherRequestFieldProps = {
  domain: RequestDomain; input: RequestInput; onChange: (input: RequestInput) => void; editing: boolean;
  labels: OwnRequestDetail["referenceLabels"]; references: RequestReferences | null; disabled: boolean;
  approver?: OwnRequestDetail["approver"]
  onReadyChange?: (ready: boolean) => void
  month: string; onMonthChange: (value: string) => void; onPermissionDenied: () => void
}
export function TeacherRequestFields({ domain, input, onChange, editing, labels, references, disabled, month, onMonthChange, onPermissionDenied }: TeacherRequestFieldProps) {
  const prefix = useId()
  const [selectedLabels, setSelectedLabels] = useState(labels)
  const value = (key: string) => typeof input[key] === "string" ? input[key] as string : ""
  const patch = (next: RequestInput) => onChange({ ...input, ...next })
  const field = (key: string, label: string, type: "text" | "date" | "textarea" = "text") => <div className="grid min-w-0 gap-2" key={key}>
    <Label htmlFor={`${prefix}-${key}`}>{label}</Label>{type === "textarea"
      ? <Textarea id={`${prefix}-${key}`} aria-label={label} value={value(key)} maxLength={4000} disabled={disabled} onChange={event => patch({ [key]: event.target.value })} />
      : <Input id={`${prefix}-${key}`} aria-label={label} type={type} value={value(key)} disabled={disabled} maxLength={type === "text" ? 4000 : undefined} onChange={event => patch({ [key]: type === "date" ? event.target.value || null : event.target.value, ...(domain === "textbook" && key === "title" ? { textbookId: null } : {}) })} />}</div>
  if (domain === "textbook") {
    const option = (scope: "textbooks" | "classes" | "locations", key: string, labelKey: "textbook" | "class" | "location", label: string) => <div className="grid min-w-0 gap-2"><Label htmlFor={`${prefix}-${key}`}>{label}</Label><RequestOption
      triggerId={`${prefix}-${key}`} scope={scope} label={label} value={typeof input[key] === "string" ? { id: value(key), label: selectedLabels[labelKey] || "기존 선택 유지" } : null}
      disabled={disabled} onPermissionDenied={onPermissionDenied} onChange={option => { setSelectedLabels(current => ({ ...current, [labelKey]: option?.label })); patch({ [key]: option?.id || null, ...(scope === "textbooks" && option ? { title: option.label } : {}) }) }} /></div>
    return <div className="grid gap-4">{option("textbooks", "textbookId", "textbook", "등록 교재")}{field("title", "교재명")}{option("classes", "classId", "class", "요청 수업")}
      <div className="grid grid-cols-2 gap-4">{[["studentQuantity", "학생용 요청 수량"], ["teacherQuantity", "교사용 요청 수량"]].map(([key, label]) => <div className="grid gap-2" key={key}><Label htmlFor={`${prefix}-${key}`}>{label}</Label><Input id={`${prefix}-${key}`} aria-label={label} type="number" min={0} max={2147483647} step={1} value={String(input[key])} disabled={disabled} onChange={event => patch({ [key]: Number(event.target.value) })} /></div>)}</div>
      {option("locations", "locationId", "location", "요청 위치")}{field("memo", "요청 메모", "textarea")}</div>
  }
  const selectClass = (key: string, label: string, labelKey: "class" | "fromClass" | "toClass", locked = false) => <div className="grid min-w-0 gap-2"><Label htmlFor={`${prefix}-${key}`}>{label}</Label><RequestOption
    triggerId={`${prefix}-${key}`} scope="classes" label={label} value={value(key) ? { id: value(key), label: selectedLabels[labelKey] || "기존 선택 유지" } : null}
    disabled={disabled || locked} onPermissionDenied={onPermissionDenied} onChange={option => {
      const id = option?.id || "", sourceChanged = key !== "to_class_id" && id !== value(key)
      setSelectedLabels(current => ({ ...current, [labelKey]: option?.label, ...(sourceChanged ? { student: undefined } : {}) }))
      patch({ [key]: id, ...(sourceChanged ? domain === "makeup" ? { cancel_date: null, original_lesson_session_id: null } : { student_id: "", ...(input.to_class_id === id ? { to_class_id: "" } : {}) } : {}) })
    }} /></div>
  if (domain !== "makeup") return <div className="grid gap-4">
    {domain === "withdrawal" ? selectClass("class_id", "퇴원 수업", "class", editing) : selectClass("from_class_id", "전 수업", "fromClass", editing)}
    <Option label="신청 학생" value={value("student_id")} fallback={selectedLabels.student} options={(references?.students || []).map(item => ({ id: item.id, label: `${item.name}${item.status === "waitlisted" ? " · 대기" : ""}` }))} disabled={disabled || !references || editing} onChange={id => { setSelectedLabels(current => ({ ...current, student: references?.students.find(item => item.id === id)?.name })); patch({ student_id: id }) }} />
    {domain === "withdrawal" ? <><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{field("withdrawal_date", "퇴원일", "date")}{field("withdrawal_session", "퇴원 회차")}</div>{field("customer_reason", "고객 사유", "textarea")}{field("teacher_opinion", "선생님 의견", "textarea")}{field("undistributed_textbooks", "미배부 교재", "textarea")}</>
      : <>{selectClass("to_class_id", "후 수업", "toClass")}{value("to_class_id") && input.to_class_id === input.from_class_id && <p role="alert" className="text-sm text-destructive">후 수업은 전 수업과 다르게 선택해 주세요.</p>}<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{field("from_class_end_date", "전 수업 종료일", "date")}{field("from_class_end_session", "전 수업 종료 회차")}{field("to_class_start_date", "후 수업 시작일", "date")}{field("to_class_start_session", "후 수업 시작 회차")}</div>{field("transfer_reason", "전반 사유", "textarea")}{field("from_undistributed_textbooks", "전 수업 미배부 교재", "textarea")}{field("to_undistributed_textbooks", "후 수업 미배부 교재", "textarea")}</>}
    {field("memo", "신청 메모", "textarea")}</div>
  const selectedClass = references?.classes.find(item => item.id === input.class_id)
  const slots = input.makeup_slots as MakeupSlot[]
  const cancel = input.request_kind !== "makeup_only", makeup = input.request_kind !== "cancel_only"
  const patchSlot = (index: number, next: Partial<MakeupSlot>) => patch({ makeup_slots: slots.map((slot, position) => position === index ? { ...slot, ...next } : slot) })
  return <div className="grid gap-4">
    <div className="grid gap-2"><Label htmlFor={`${prefix}-kind`}>신청 종류</Label><Select value={value("request_kind")} disabled={disabled} onValueChange={kind => patch({ request_kind: kind,
      ...(kind === "makeup_only" ? { cancel_date: null, original_lesson_session_id: null } : {}), ...(kind === "cancel_only" ? { makeup_slots: [] } : {}) })}><SelectTrigger id={`${prefix}-kind`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cancel_makeup">휴강 및 보강</SelectItem><SelectItem value="cancel_only">휴강</SelectItem><SelectItem value="makeup_only">보강</SelectItem></SelectContent></Select></div>
    {selectClass("class_id", "신청 수업", "class", editing)}{field("reason", "휴보강 사유", "textarea")}
    {cancel && references && (selectedClass?.scheduleStorageMode === "normalized" ? <>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-month`}>휴강 회차 조회 월</Label><Input id={`${prefix}-month`} aria-label="휴강 회차 조회 월" type="month" value={month} disabled={disabled} onChange={event => { if (event.target.value) onMonthChange(event.target.value) }} /></div>
      <Option label="휴강 수업 회차" value={value("original_lesson_session_id")} fallback={input.cancel_date ? `${input.cancel_date} 선택 회차` : undefined}
        options={(references?.sessions || []).map(session => ({ id: session.id, label: `${session.date} ${session.startTime?.slice(0, 5) || ""}–${session.endTime?.slice(0, 5) || ""}` }))} disabled={disabled}
        onChange={id => { const session = references?.sessions.find(item => item.id === id); if (session) patch({ original_lesson_session_id: id, cancel_date: session.date }) }} />
    </> : field("cancel_date", "휴강일", "date"))}
    {makeup && <div className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><Label>보강 일정</Label><Button type="button" variant="outline" disabled={disabled || slots.length >= 30} onClick={() => patch({ makeup_slots: [...slots, { startAt: "", endAt: "", classroom: "" }] })}>보강일시 추가</Button></div>
      {slots.map((slot, index) => <fieldset key={index} className="grid min-w-0 gap-3 rounded-md border p-3" disabled={disabled}><legend className="px-1 text-sm">보강 {index + 1}</legend>
        {(["startAt", "endAt"] as const).map(key => <div className="grid min-w-0 gap-2" key={key}><Label htmlFor={`${prefix}-${index}-${key}`}>{key === "startAt" ? "시작 일시" : "종료 일시"}</Label><Input id={`${prefix}-${index}-${key}`} aria-label={`보강 ${index + 1} ${key === "startAt" ? "시작" : "종료"} 일시`} type="datetime-local" value={isoToSeoulDateTimeInput(slot[key])} onChange={event => patchSlot(index, { [key]: seoulDateTimeInputToIso(event.target.value) })} /></div>)}
        <Option label={`보강 ${index + 1} 강의실`} value={slot.classroom} fallback={slot.classroom} options={(references?.rooms || []).map(room => ({ id: room.name, label: room.name }))} disabled={disabled || !references} onChange={classroom => patchSlot(index, { classroom })} />
        <Button type="button" variant="outline" className="justify-self-end" onClick={() => patch({ makeup_slots: slots.filter((_, position) => index !== position) })}>보강 {index + 1} 제외</Button>
      </fieldset>)}
    </div>}
    <p className="text-sm text-muted-foreground">승인자: {references?.approver?.label || "지정 승인자를 확인해 주세요."}</p>
  </div>
}
