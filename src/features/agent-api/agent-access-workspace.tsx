"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Plus, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/supabase";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmationDialogContent, DetailDialogContent, FormDialogContent } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettingsMasterHeader, SettingsTableFrame, SettingsWorkspaceShell, settingsTableCellClass, settingsTableHeadClass, settingsTableActionCellClass, settingsTableActionHeadClass } from "@/features/management/settings-master-layout";

type Credential = { id: string; label: string; scopes: string[]; classIds: string[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null };
type ClassOption = { id: string; name: string; teacher: string | null; schedule: string | null };
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "—";

export function AgentAccessWorkspace({ apiEnabled }: { apiEnabled: boolean }) {
  const { role, loading: authLoading, user } = useAuth();
  const allowed = !authLoading && role === "admin" && user?.isFallbackRole === false;
  const [rows, setRows] = useState<Credential[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { pageSize, ready, setPreference } = useDataTablePageSize("settings:agent-access");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Credential | null>(null);
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("뮤즈AI");
  const [mode, setMode] = useState("read");
  const [edits, setEdits] = useState<string[]>([]);
  const [days, setDays] = useState("1");
  const [calendar, setCalendar] = useState(false);
  const [selected, setSelected] = useState<ClassOption[]>([]);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ClassOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const createRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const actorIdentity = `${user?.id ?? ""}:${allowed}`;
  const currentActor = useRef(actorIdentity);

  useEffect(() => {
    if (!allowed || !ready || !supabase) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setLoadError(""); } });
    void (async () => {
      try {
        const { data, error: failure } = await supabase!.rpc("list_agent_credentials_v1", { p_page: page, p_page_size: pageSize }).abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])).retry(false);
        if (!active) return;
        if (failure || !Array.isArray(data?.items) || !Number.isInteger(data?.total)) throw new Error("load");
        setRows(data.items); setTotal(data.total);
      } catch { if (active) { setRows([]); setLoadError("연결 목록을 불러오지 못했습니다. 다시 시도해 주세요."); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [allowed, user?.id, ready, page, pageSize, revision]);

  useEffect(() => {
    if (!allowed || !createOpen || !supabase) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true); setSearchError("");
      try {
        const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
        let request = supabase!.from("classes").select("id,name,teacher,schedule").eq("status", "수강").is("closed_at", null).order("name").order("id").limit(20);
        if (escaped) request = request.ilike("name", `%${escaped}%`);
        const { data, error: failure } = await request.abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)])).retry(false);
        if (!active) return;
        if (failure) throw failure;
        setOptions(data ?? []);
      } catch { if (active) { setOptions([]); setSearchError("수업 검색에 실패했습니다. 검색어를 다시 입력해 주세요."); } }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [allowed, user?.id, createOpen, query]);

  // A role/account transition must also clear a one-time secret already in memory.
  useEffect(() => {
    generation.current += 1;
    currentActor.current = actorIdentity;
    queueMicrotask(() => { setSecret(""); setCreateOpen(false); setRevokeTarget(null); setRows([]); });
  }, [actorIdentity]);

  const closeCreate = useCallback(() => { if (!busyRef.current) { setCreateOpen(false); setError(""); } }, []);
  const beginCreate = () => {
    setLabel("뮤즈AI"); setMode("read"); setEdits([]); setDays("1"); setCalendar(false); setSelected([]); setQuery(""); setOptions([]); setError(""); setMutationError(""); setCreateOpen(true);
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current || actorIdentity !== currentActor.current || !allowed || !supabase || !selected.length || !label.trim() || (mode === "write" && !edits.length)) return;
    busyRef.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const scopes = ["classes:read", "class-details:read", ...(calendar ? ["calendar:read"] : []), ...(mode === "write" ? edits : []), ...(mode === "write" && edits.includes("weekly-plan:write") ? ["schedule:preview", "schedule:write"] : [])];
      const { data, error: failure } = await supabase.rpc("create_agent_credential_v1", { p_label: label.trim(), p_scopes: scopes, p_class_ids: selected.map((item) => item.id), p_expires_at: new Date(Date.now() + Number(days) * 86400000).toISOString() }).abortSignal(AbortSignal.timeout(15_000)).retry(false);
      if (current !== generation.current) return;
      if (failure || typeof data?.token !== "string") throw new Error("create");
      setCreateOpen(false); setSecret(data.token); setPage(1); setRevision((value) => value + 1);
    } catch { if (current === generation.current) { setCreateOpen(false); setMutationError("키 발급 결과를 확인하지 못했습니다. 목록을 새로고침하고 새 연결이 있으면 폐기한 뒤 다시 발급해 주세요."); setRevision((value) => value + 1); } }
    finally { busyRef.current = false; setBusy(false); }
  };
  const revoke = async () => {
    if (busyRef.current || actorIdentity !== currentActor.current || !allowed || !supabase || !revokeTarget) return;
    busyRef.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const { error: failure } = await supabase.rpc("revoke_agent_credential_v1", { p_id: revokeTarget.id }).abortSignal(AbortSignal.timeout(15_000)).retry(false);
      if (current !== generation.current) return;
      if (failure) throw failure;
      setRevokeTarget(null); setMessage("연결 키를 폐기했습니다."); setRevision((value) => value + 1);
    } catch { if (current === generation.current) setError("폐기 결과를 확인하지 못했습니다. 목록을 새로고침해 상태를 확인해 주세요."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  if (authLoading) return <SettingsWorkspaceShell><p role="status">권한 확인 중…</p></SettingsWorkspaceShell>;
  if (!allowed) return <SettingsWorkspaceShell><p role="alert">관리자 계정에서만 AI 연결을 관리할 수 있습니다.</p></SettingsWorkspaceShell>;
  return <SettingsWorkspaceShell>
    <SettingsMasterHeader filters={<span className="text-sm text-muted-foreground">내가 발급한 연결</span>} actions={<>
      <Button variant="outline" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label="연결 목록 새로고침"><RefreshCw />새로고침</Button>
      <Button ref={createRef} onClick={beginCreate} disabled={!apiEnabled || busy || loading || Boolean(loadError || mutationError)}><Plus />연결 키 발급</Button>
    </>} />
    {!apiEnabled ? <p role="status" className="text-sm text-muted-foreground">AI 연결이 아직 활성화되지 않았습니다.</p> : null}
    {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
    <SettingsTableFrame><Table className="min-w-[860px]"><TableHeader><TableRow>
      {["연결 이름", "권한", "대상 수업", "만료", "마지막 사용", "작업"].map((title) => <TableHead className={title === "작업" ? settingsTableActionHeadClass : settingsTableHeadClass} key={title}>{title}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {rows.map((row) => {
        const status = row.revokedAt ? "폐기됨" : Date.parse(row.expiresAt) <= Date.now() ? "만료됨" : "사용 가능";
        return <TableRow key={row.id}>
          <TableCell className={settingsTableCellClass}>{row.label}<span className="block text-xs text-muted-foreground">{status}</span></TableCell>
          <TableCell className={settingsTableCellClass}>{["조회", ...(row.scopes.includes("class-info:write") ? ["기본 정보"] : []), ...(row.scopes.includes("weekly-plan:write") ? ["주간 일정"] : row.scopes.includes("schedule:write") ? ["주간 시간 변경"] : []), ...(row.scopes.includes("lesson-plan:write") ? ["날짜별 일정·휴보강"] : [])].join(" · ")}{row.scopes.includes("calendar:read") ? " · 학사일정" : ""}</TableCell>
          <TableCell className={settingsTableCellClass}>{row.classIds.length ? `${row.classIds.length}개 수업` : "전체 수업"}</TableCell>
          <TableCell className={settingsTableCellClass}>{dateLabel(row.expiresAt)}</TableCell><TableCell className={settingsTableCellClass}>{dateLabel(row.lastUsedAt)}</TableCell>
          <TableCell className={settingsTableActionCellClass}><Button variant="outline" size="sm" disabled={status !== "사용 가능" || busy} aria-label={`${row.label} 연결 키 폐기`} onClick={() => { setError(""); setRevokeTarget(row); }}>폐기</Button></TableCell>
        </TableRow>;
      })}
      {!rows.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">{loading ? "불러오는 중…" : loadError ? "목록을 확인할 수 없습니다." : "발급한 연결 키가 없습니다."}</TableCell></TableRow> : null}
    </TableBody></Table></SettingsTableFrame>
    <DataTablePagination page={page} pageSize={pageSize} totalCount={loadError ? null : total} loading={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPreference(size); setPage(1); }} ariaLabel="AI 연결 페이지" />
    {message || mutationError ? <ActionFeedback message={mutationError || message} error={Boolean(mutationError)} onDismiss={() => { setMessage(""); setMutationError(""); }} /> : null}
    <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreate(); }}><FormDialogContent title="연결 키 발급" description="선택한 수업에만 접근할 수 있는 키를 발급합니다." onSubmit={create} onCancel={closeCreate} cancelLabel="키 발급 취소" submitLabel="키 발급" busy={busy} submitDisabled={!selected.length || !label.trim() || selected.length > 50 || (mode === "write" && !edits.length)} error={error} returnFocusRef={createRef} height={650}>
      <div className="grid gap-2"><Label htmlFor="agent-label">연결 이름</Label><Input id="agent-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required disabled={busy} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="agent-mode">허용 작업</Label><NativeSelect id="agent-mode" value={mode} onChange={(event) => setMode(event.target.value)} disabled={busy}><option value="read">조회만</option><option value="write">조회 + 수정</option></NativeSelect></div><div className="grid gap-2"><Label htmlFor="agent-days">유효 기간</Label><NativeSelect id="agent-days" value={days} onChange={(event) => setDays(event.target.value)} disabled={busy}>{[1,7,30].map((day) => <option key={day} value={day}>{day}일</option>)}</NativeSelect></div></div>
      {mode === "write" ? <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">수정 허용 범위</legend>{[
        ["class-info:write", "기본 정보 (이름·정원·수강료 등)"],
        ["weekly-plan:write", "주간 요일·시간·선생님·강의실"],
        ["lesson-plan:write", "날짜별 일정·휴강·보강"],
      ].map(([scope, title]) => <div className="flex items-center gap-2" key={scope}><Checkbox id={`agent-${scope}`} checked={edits.includes(scope)} onCheckedChange={(checked) => setEdits((values) => checked ? [...values.filter(value => value !== scope), scope] : values.filter(value => value !== scope))} disabled={busy} /><Label htmlFor={`agent-${scope}`}>{title}</Label></div>)}</fieldset> : null}
      <div className="flex items-center gap-2"><Checkbox id="agent-calendar" checked={calendar} onCheckedChange={(checked) => setCalendar(checked === true)} disabled={busy} /><Label htmlFor="agent-calendar">학사일정 조회 허용 (학교 일정 전체)</Label></div>
      <div className="grid gap-2"><Label htmlFor="agent-classes">대상 수업 ({selected.length}/50)</Label><Input id="agent-classes" placeholder="수업 이름 검색" value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} maxLength={100} />
        <ul className="flex flex-wrap gap-2" aria-label="선택한 수업">{selected.map((item) => <li key={item.id}><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setSelected((items) => items.filter((entry) => entry.id !== item.id))} aria-label={`${item.name} 선택 해제`}>{item.name}<X /></Button></li>)}</ul>
        <p className="text-xs text-muted-foreground">수강 중인 수업 최대 20개 표시 · 찾는 수업이 없으면 이름을 입력하세요.</p>
        {searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}
        <ul className="max-h-44 overflow-y-auto divide-y divide-border" aria-label="수업 검색 결과" aria-busy={searching}>{options.map((item) => <li key={item.id} className="flex items-center gap-2 py-2"><Checkbox id={`agent-class-${item.id}`} checked={selected.some((entry) => entry.id === item.id)} disabled={busy || (selected.length >= 50 && !selected.some((entry) => entry.id === item.id))} onCheckedChange={(checked) => setSelected((items) => checked ? [...items.filter((entry) => entry.id !== item.id), item] : items.filter((entry) => entry.id !== item.id))} /><Label htmlFor={`agent-class-${item.id}`} className="flex flex-col items-start gap-1">{item.name}<span className="font-normal text-xs text-muted-foreground">{item.teacher} · {item.schedule}</span></Label></li>)}</ul>
      </div>
    </FormDialogContent></Dialog>
    <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) { setSecret(""); setError(""); } }}><DetailDialogContent title="연결 키가 발급되었습니다" description="이 키는 다시 표시되지 않습니다. 뮤즈의 보안 연결 페이지에 직접 입력하세요." onClose={() => { setSecret(""); setError(""); }}>
      <div className="grid gap-3"><p className="text-sm">키를 복사해 뮤즈의 보안 연결 페이지에 입력하세요. 닫으면 다시 볼 수 없습니다.</p><Label htmlFor="agent-secret">연결 키</Label><Input id="agent-secret" type="password" autoComplete="off" value={secret} readOnly />
        <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(secret); setMessage("연결 키를 복사했습니다."); } catch { setError("키 입력란을 선택해 직접 복사해 주세요."); } }}><Copy />키 복사</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<p className="text-sm text-muted-foreground">대화나 문서에 붙여 넣지 마세요. 연결 후에는 클립보드도 비워 주세요.</p>
      </div>
    </DetailDialogContent></Dialog>
    <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && !busyRef.current) setRevokeTarget(null); }}><ConfirmationDialogContent title="연결 키 폐기" description={`${revokeTarget?.label ?? ""}의 API 접근을 즉시 중단합니다. 기존 작업 이력은 남습니다.`} confirmLabel="폐기" onConfirm={revoke} onCancel={() => { if (!busyRef.current) setRevokeTarget(null); }} busy={busy} error={error} /></Dialog>
  </SettingsWorkspaceShell>;
}
