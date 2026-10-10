"use client";
import { useState } from "react";
import { API_FEATURES } from "./feature-registry";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { SettingsTableFrame, settingsTableCellClass, settingsTableHeadClass } from "@/features/management/settings-master-layout";
export function ApiFeatureCatalog() {
  const [page, setPage] = useState(1), [size, setSize] = useState<10 | 15 | 20>(10);
  return <>
    <p className="text-sm">외부 업무 API {API_FEATURES.filter(row => row.endpoint).length}개 · 개인 연결 조회 {API_FEATURES.filter(row => row.personal).length}개</p>
    <p className="text-sm text-muted-foreground">기능별 허용 설정은 로컬 후보입니다. 운영 반영 기록과 현재 실제 요청 검증은 구분합니다.</p>
    <SettingsTableFrame><Table className="min-w-[320px] table-fixed"><TableHeader><TableRow><TableHead className={`${settingsTableHeadClass} w-[42%]`}>API 기능</TableHead><TableHead className={settingsTableHeadClass}>개발·운영·검증 상태</TableHead></TableRow></TableHeader><TableBody>
      {API_FEATURES.slice((page - 1) * size, page * size).map(row => <TableRow key={row.id}><TableCell className={`${settingsTableCellClass} whitespace-normal align-top [overflow-wrap:anywhere]`}><p className="font-medium">{row.title}</p><p className="text-xs text-muted-foreground">{row.mode === "write" ? "변경" : row.mode === "read" ? "조회" : "내부 RPC·화면 전용"}</p>{row.endpoint ? <code className="block break-all text-xs">{row.endpoint.method.toUpperCase()} /api/v{row.endpoint.version}{row.endpoint.path}</code> : null}</TableCell><TableCell className={`${settingsTableCellClass} whitespace-normal align-top`}><p className="text-sm">{row.personal ? "개인 연결 선택 가능" : row.endpoint ? "관리자 발급 키 전용" : "외부 API 미제공"}</p><p className="text-xs text-muted-foreground">{row.implemented ? "개발 완료" : "개발 미완료"} · {row.production === "baseline_bdf13d0d" ? "기존 운영 코드 반영 기록 있음" : "외부 배포 상태 확인 대상 아님"} · {row.verification === "runtime_unverified" ? "현재 운영 동작 미검증" : "외부 API 검증 대상 아님"}</p></TableCell></TableRow>)}
    </TableBody></Table></SettingsTableFrame>
    <DataTablePagination page={page} pageSize={size} totalCount={API_FEATURES.length} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(1); }} />
  </>;
}
