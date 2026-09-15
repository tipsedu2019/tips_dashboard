"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog } from "@/components/ui/dialog"
import { FormDialogContent, DetailDialogContent, DocumentDialogContent, ConfirmationDialogContent } from "@/components/ui/form-dialog"
import { WorkspaceTabs, WorkspaceTabsList, WorkspaceTabsTrigger, WorkspaceTabsPanel } from "@/components/ui/workspace-tabs"
import { DataTableWorkspaceToolbar, DataTableViewport, DataTableHeaderCell, DataTableBodyCell, DATA_TABLE_LAYOUT_CLASS_NAME } from "@/components/data-table/data-table-surface"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { RegistrationCaseList } from "@/features/tasks/registration-case-list"
import { buildRegistrationCaseListItems, filterRegistrationCaseListItems } from "@/features/tasks/registration-case-list-model"
import { Skeleton } from "@/components/ui/skeleton"

const registrationItems = filterRegistrationCaseListItems(buildRegistrationCaseListItems([{
  id: "case-3", studentName: "긴이름학생", registration: { schoolName: "긴학교이름중학교", schoolGrade: "중2" },
  registrationTracks: ["영어", "수학", "과학"].map((subject, index) => ({
    id: `track-${index}`, taskId: "case-3", subject, status: "consultation_waiting", workflowStatus: "consultation_requested",
    directorName: ["영어 담당자", "수학 담당자 이름이 길어 여러 줄이 되는 경우", "과학 담당자"][index], directorProfileId: `teacher-${index}`,
    phoneReadyAt: index === 0 ? "2026-09-15T03:00:00Z" : null, visitScheduledAt: index === 1 ? "2026-09-16T03:00:00Z" : "", visitPlace: index === 1 ? "본관의 긴 상담 장소" : "",
    stageEnteredAt: "2026-09-15T00:00:00Z", workflowStatusEnteredAt: "2026-09-15T00:00:00Z",
  })),
}] as unknown as Parameters<typeof buildRegistrationCaseListItems>[0]), "consultation_requested")

export default function PremiumGallery() {
  const [tab, setTab] = useState("normal")
  const [modal, setModal] = useState("")
  const [value, setValue] = useState("합성 이름")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [openedCount, setOpenedCount] = useState(0)
  return <main className="mx-auto grid max-w-5xl gap-6 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-lg font-semibold">TIPS 공통 컴포넌트 검수</h1><Button variant="outline" onClick={() => document.documentElement.classList.toggle("dark")}>테마 전환</Button></div>
    <section className="grid gap-3" aria-label="버튼 상태"><h2 className="text-base font-semibold">행동</h2><div className="flex flex-wrap gap-2">{(["default", "secondary", "outline", "ghost", "destructive"] as const).map(variant => <Button key={variant} variant={variant} data-variant-example={variant}>{variant}</Button>)}<Button disabled>사용 불가</Button></div></section>
    <section className="grid gap-3" aria-label="필드 상태"><h2 className="text-base font-semibold">입력</h2><div className="grid gap-4 md:grid-cols-3"><div className="grid gap-2"><Label htmlFor="gallery-name">이름</Label><Input id="gallery-name" value={value} onChange={event => setValue(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="gallery-invalid">확인이 필요한 입력</Label><Input id="gallery-invalid" aria-invalid="true" aria-describedby="gallery-error" defaultValue="합성 값" /><p id="gallery-error" className="text-xs text-destructive">입력값을 확인해 주세요.</p></div><div className="grid gap-2"><Label htmlFor="gallery-disabled">변경할 수 없는 입력</Label><Input id="gallery-disabled" disabled value="읽기 전용 상태" /></div><Select defaultValue="english"><SelectTrigger aria-label="과목 선택"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="english">영어</SelectItem><SelectItem value="math">수학</SelectItem></SelectContent></Select><div className="flex items-center gap-2"><Checkbox id="gallery-check" /><Label htmlFor="gallery-check">대상 선택</Label></div></div></section>
    <WorkspaceTabs value={tab} onValueChange={setTab}><WorkspaceTabsList aria-label="표 상태"><WorkspaceTabsTrigger value="normal">일반</WorkspaceTabsTrigger><WorkspaceTabsTrigger value="loading">불러오는 중</WorkspaceTabsTrigger><WorkspaceTabsTrigger value="empty">빈 결과</WorkspaceTabsTrigger><WorkspaceTabsTrigger value="error">오류</WorkspaceTabsTrigger></WorkspaceTabsList><WorkspaceTabsPanel className="pt-3"><div className={DATA_TABLE_LAYOUT_CLASS_NAME}><DataTableWorkspaceToolbar search={<Input aria-label="목록 검색" placeholder="이름 검색" />} actions={<Button>등록</Button>} summary="전체 2건" /><DataTableViewport><Table><TableHeader><TableRow><DataTableHeaderCell>이름</DataTableHeaderCell><DataTableHeaderCell>수량</DataTableHeaderCell></TableRow></TableHeader><TableBody>{tab === "normal" ? ["합성 학생", "합성 긴 수업 이름으로 줄바꿈과 행의 높이를 확인합니다"].map((name,index) => <TableRow key={name}><DataTableBodyCell className="whitespace-normal font-semibold">{name}</DataTableBodyCell><DataTableBodyCell className="text-right tabular-nums">{index * 123}권</DataTableBodyCell></TableRow>) : <TableRow><DataTableBodyCell colSpan={2}>{tab === "loading" ? <Skeleton className="h-8 w-full" /> : tab === "empty" ? "검색 결과가 없습니다." : <span role="alert" className="text-destructive">목록을 불러오지 못했습니다. <Button variant="ghost" onClick={() => setTab("normal")}>다시 시도</Button></span>}</DataTableBodyCell></TableRow>}</TableBody></Table></DataTableViewport></div></WorkspaceTabsPanel></WorkspaceTabs>
    <section aria-label="대화상자" className="flex flex-wrap gap-2">{["입력", "상세", "문서", "확인"].map(name => <Button key={name} variant="outline" onClick={() => { setError("");setBusy(false);setModal(name) }}>{name} 열기</Button>)}</section>
    <section className="min-w-0" aria-label="등록 다과목 행"><h2 className="mb-3 text-base font-semibold">등록 과목별 대응</h2><RegistrationCaseList items={registrationItems} viewerRole="admin" onOpen={() => setOpenedCount(n => n + 1)} onEdit={() => setOpenedCount(n => n + 1)} onStatusChange={() => {}} canDelete={() => false} onDelete={() => {}} /><p role="status" data-testid="gallery-registration-opens">상세 요청 {openedCount}회</p></section>
    <Dialog open={Boolean(modal)} onOpenChange={open => { if (!open) setModal("") }}>
      {modal === "입력" ? <FormDialogContent title="학생 정보 편집" description="합성 입력 상태 확인" onCancel={() => setModal("")} submitLabel="저장" busy={busy} error={error} onSubmit={event => {event.preventDefault();setError("저장하지 못했습니다. 입력은 유지됩니다.")}}><Label htmlFor="gallery-modal-name">이름</Label><Input id="gallery-modal-name" value={value} onChange={event => setValue(event.target.value)} /><Button type="button" variant="outline" onClick={() => setBusy(current => !current)}>저장 중 상태 전환</Button></FormDialogContent> : null}
      {modal === "상세" ? <DetailDialogContent title="학생 상세" description="합성 정보" onClose={() => setModal("")}><dl className="grid gap-2"><dt>이름</dt><dd>{value}</dd><dt>연락처</dt><dd>—</dd></dl></DetailDialogContent> : null}
      {modal === "문서" ? <DocumentDialogContent title="출고 문서" description="합성 문서" toolbar={<span>합성 출고 2건</span>} feedback="생성 완료" onClose={() => setModal("")}><p>합성 문서 내용</p></DocumentDialogContent> : null}
      {modal === "확인" ? <ConfirmationDialogContent title="삭제 확인" description="합성 대상만 표시합니다." confirmLabel="삭제" onConfirm={() => setModal("")} onCancel={() => setModal("")} items={[{id:"synthetic",title:value,detail:"합성 검수 항목"}]} /> : null}
    </Dialog>
  </main>
}
