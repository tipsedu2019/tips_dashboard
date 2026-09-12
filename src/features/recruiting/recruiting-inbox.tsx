"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import type { RecruitingApplicationDetail, RecruitingApplicationSummary } from "./recruiting-policy";

type InboxData = { applications: RecruitingApplicationSummary[]; totalCount: number; retentionLastSucceededAt: string | null };
const BASE = "/api/admin/recruiting/applications";
function date(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(value)); }
function safePortfolio(value: string | null) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function message(status: number) {
  if (status === 401 || status === 403) return "관리자 권한을 확인할 수 없습니다. 다시 로그인해 주세요.";
  if (status === 404) return "지원서가 삭제되었거나 보관기간이 만료되었습니다.";
  return "지원서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function RecruitingInbox({ accessToken }: { accessToken: string }) {
  const { ready, pageSize, setPreference } = useDataTablePageSize("management:recruiting");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<InboxData | null>(null);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecruitingApplicationDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const deletePending = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setListError(""); setList(null);
      try {
        const response = await fetch(`${BASE}?page=${page}&pageSize=${pageSize}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(message(response.status));
        const data: InboxData = await response.json();
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.totalCount / pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setList(data);
      } catch (error) {
        if (!controller.signal.aborted) setListError(error instanceof Error && error.message.startsWith("관리자") ? error.message : message(503));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [accessToken, page, pageSize, ready, revision]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${BASE}/${selectedId}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(message(response.status));
        const data: { application: RecruitingApplicationDetail } = await response.json();
        if (!controller.signal.aborted) setDetail(data.application);
      } catch (error) {
        if (!controller.signal.aborted) setDetailError(error instanceof Error && [message(401), message(404)].includes(error.message) ? error.message : message(503));
      }
    }
    void load();
    return () => controller.abort();
  }, [accessToken, selectedId, revision]);

  function close() { if (deletePending.current) return; setSelectedId(null); setDetail(null); setDetailError(""); setConfirmDelete(false); }
  async function remove() {
    if (!selectedId || !confirmDelete || deletePending.current) return;
    deletePending.current = true; setDeleting(true); setDetailError("");
    try {
      const response = await fetch(`${BASE}/${selectedId}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }), cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok && response.status !== 404) throw new Error();
      deletePending.current = false; close(); setNotice("지원서가 삭제되었습니다."); setRevision((value) => value + 1);
    } catch { setDetailError("삭제를 확인하지 못했습니다. 다시 시도해 주세요."); }
    finally { deletePending.current = false; setDeleting(false); }
  }
  const retentionStale = list && (!list.retentionLastSucceededAt || Date.now() - Date.parse(list.retentionLastSucceededAt) >= 3 * 60 * 60 * 1000);
  const portfolio = safePortfolio(detail?.portfolioUrl ?? null);
  return <div className="space-y-5 px-4 md:px-6">
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">채용 지원서</h1><Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}>새로고침</Button></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {retentionStale && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">자동 파기 작업을 확인해야 합니다. 새 지원서 접수는 일시 중단됩니다. 운영 담당자가 보관기간 정리 작업을 복구해 주세요.</p>}
    {loading ? <p role="status" className="py-12 text-center text-muted-foreground">지원서를 불러오고 있습니다.</p> : listError ? <div role="alert" className="space-y-3 rounded-lg border p-6"><p>{listError}</p><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>다시 시도</Button></div> : !list?.applications.length ? <p className="rounded-lg border py-16 text-center text-muted-foreground">보관 중인 지원서가 없습니다.</p> : <ul className="divide-y rounded-lg border" aria-label="보관 중인 지원서">
      {list.applications.map((application) => <li key={application.id}>
        <button type="button" className="flex w-full flex-col gap-2 p-5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex-row md:items-center md:justify-between" onClick={(event) => { trigger.current = event.currentTarget; setDetail(null); setDetailError(""); setConfirmDelete(false); setSelectedId(application.id); }}>
          <span className="space-y-1"><span className="block font-medium">{application.name} <span className="ml-2 font-normal text-muted-foreground">{application.subject}</span></span><span className="block text-sm">{application.phone}</span></span>
          <span className="text-sm leading-6 text-muted-foreground">접수 {date(application.createdAt)}<span className="block">보관 만료 {date(application.expiresAt)}</span></span>
        </button>
      </li>)}
    </ul>}
    <DataTablePagination page={page} pageSize={pageSize} totalCount={list?.totalCount ?? null} loading={loading || Boolean(listError)} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPreference(size); }} ariaLabel="지원서 페이지 탐색" />
    <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!deleting} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} onEscapeKeyDown={(event) => { if (deleting) event.preventDefault(); }} onPointerDownOutside={(event) => { if (deleting) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{confirmDelete ? "지원서를 영구 삭제할까요?" : detail ? `${detail.name} · ${detail.subject}` : "지원서"}</DialogTitle><DialogDescription>{confirmDelete ? "지원자 본인의 삭제 요청을 확인한 뒤 진행하세요. 이름, 연락처와 지원 내용이 삭제되며 되돌릴 수 없습니다." : "보관기간 안에 있는 인재풀 지원서입니다."}</DialogDescription></DialogHeader>
        {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
        {!confirmDelete && (!detail ? !detailError && <p role="status">지원서를 불러오고 있습니다.</p> : <div className="space-y-5 break-words">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">연락처</dt><dd className="mt-1">{detail.phone}</dd></div><div><dt className="text-muted-foreground">접수일 · 보관 만료일</dt><dd className="mt-1">{date(detail.createdAt)} · {date(detail.expiresAt)}</dd></div></dl>
          <section><h2 className="mb-2 font-medium">경력</h2><p className="whitespace-pre-wrap text-sm leading-7">{detail.experience}</p></section>
          <section><h2 className="mb-2 font-medium">지원 동기</h2><p className="whitespace-pre-wrap text-sm leading-7">{detail.motivation}</p></section>
          {portfolio && <a href={portfolio} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline underline-offset-4">포트폴리오 열기 (새 창)</a>}
          <p className="text-sm text-muted-foreground">인재풀 보관 동의: {date(detail.consentedAt)} · {detail.retentionDays}일 ({detail.consentVersion})</p>
        </div>)}
        <DialogFooter>{confirmDelete ? <><Button variant="outline" disabled={deleting} onClick={() => { setConfirmDelete(false); setDetailError(""); }}>취소</Button><Button variant="destructive" disabled={deleting} onClick={() => void remove()}>{deleting ? "삭제 중…" : "지원서 영구 삭제"}</Button></> : <><Button variant="outline" onClick={close}>닫기</Button>{detail && <Button variant="destructive" onClick={() => { setDetailError(""); setConfirmDelete(true); }}>삭제 요청 처리</Button>}{detailError && !detail && <Button variant="outline" onClick={() => { setDetailError(""); setRevision((value) => value + 1); }}>다시 시도</Button>}</>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
