"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormDialogContent, ConfirmationDialogContent, DetailDialogContent } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import { SettingsMasterHeader, SettingsTableFrame, SettingsWorkspaceShell, settingsTableCellClass, settingsTableHeadClass } from "@/features/management/settings-master-layout";
import { parsePersonalIssue, parsePersonalPermissions, readPersonalRevokePending, savePersonalRevokePending, type PendingPersonalRevoke, parsePersonalRevoke, parsePersonalSnapshot, readPersonalPending, savePersonalPending, type PendingPersonalOperation, type PersonalConnection, type PersonalConnectionService, type PersonalSnapshot, type PersonalTarget } from "./personal-connection-contract";

import { FeatureChecklist } from "./feature-checklist";
import { API_FEATURES, featureCanSelect } from "./feature-registry";

const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
const uncertainMessage = "처리 결과를 확인하지 못했습니다. 새 발급·폐기·권한 변경 요청을 만들지 말고 ‘처리 결과 확인’을 눌러 주세요.";

import { personalConnectionService } from "./personal-connection-service";
import { PersonalTargetPicker } from "./personal-target-picker";
export function PersonalConnectionWorkspace({ ownerId, apiEnabled, service = personalConnectionService }: { ownerId: string; apiEnabled: boolean; service?: PersonalConnectionService }) {
  return <PersonalConnectionSession key={ownerId} ownerId={ownerId} apiEnabled={apiEnabled} service={service} />;
}
function PersonalConnectionSession({ ownerId, apiEnabled, service }: { ownerId: string; apiEnabled: boolean; service: PersonalConnectionService }) {
  const [snapshot, setSnapshot] = useState<PersonalSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0), [page, setPage] = useState(1);
  const { pageSize, ready: pageReady, setPreference } = useDataTablePageSize("settings:personal-connection");
  const [pending, setPending] = useState<PendingPersonalOperation | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PendingPersonalRevoke | null>(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), generation = useRef(0);
  const [form, setForm] = useState<"edit" | "review" | null>(null);
  const [label, setLabel] = useState(""), [days, setDays] = useState("1");
  const [selectedClasses, setSelectedClasses] = useState<PersonalTarget[]>([]), [selectedSchools, setSelectedSchools] = useState<PersonalTarget[]>([]);
  const classIds = selectedClasses.map(row => row.id), schoolIds = selectedSchools.map(row => row.id);
  const [recovered, setRecovered] = useState<PersonalConnection | null>(null);
  const [expiresAt, setExpiresAt] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [revoke, setRevoke] = useState<PersonalConnection | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  const [editing, setEditing] = useState<PersonalConnection | null>(null);
  const [editFeatures, setEditFeatures] = useState<string[]>([]);
  const [secret, setSecret] = useState(""), [revealed, setRevealed] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null), refreshRef = useRef<HTMLButtonElement>(null);
  const focusAfterLoad = useRef(false);
  const [focusRevision, setFocusRevision] = useState(0);
  useLayoutEffect(() => {
    if (!focusRevision) return;
    const target = createRef.current?.disabled ? refreshRef.current : createRef.current;
    target?.focus({ preventScroll: true });
  }, [focusRevision]);
  const ready = snapshot?.status === "ready" ? snapshot : null;
  const canMutate = Boolean(ready && !loading && !pending && !pendingRevoke && !busy && !error);
  const canRevoke = Boolean(ready && !loading && !busy);
  const canIssue = canMutate && apiEnabled;

  useEffect(() => {
    const current = ++generation.current;
    return () => { if (generation.current === current) generation.current += 1; };
  }, [service]);

  useEffect(() => {
    if (!pageReady) return;
    const controller = new AbortController(); let active = true;
    void (async () => {
      setLoading(true); setError("");
      let stored: PendingPersonalOperation | null = null;
      try {
        setPendingRevoke(readPersonalRevokePending(window.sessionStorage, ownerId));
        stored = readPersonalPending(window.sessionStorage, ownerId); setPending(stored);
        const raw = await service.load({ page, pageSize, pending: stored, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!active) return;
        const next = parsePersonalSnapshot(raw, ownerId, page, pageSize, stored);
        if (next.status === "ready" && next.operation && next.operation.state !== "unknown") {
          savePersonalPending(window.sessionStorage, ownerId, null); setPending(null);
          setRecovered(next.operation.kind === "issue" && next.operation.state === "applied" ? next.operation.credential : null);
          setNotice(next.operation.state === "failed" ? "기존 요청이 반영되지 않은 것을 확인했습니다." : next.operation.kind === "issue" ? "기존 발급 결과를 확인했습니다. 키 원문은 다시 표시하지 않습니다. 원문을 보관하지 못했다면 해당 연결을 폐기한 뒤 새로 만드세요." : next.operation.kind === "permissions" ? "기존 기능 권한 변경 결과를 확인했습니다. 목록에는 현재 권한이 표시됩니다." : "기존 폐기 결과를 확인했습니다.");
        }
        setSnapshot(next);
      } catch {
        if (active) {
          setSnapshot(null);
          // Failed recovery does not hide independently verified inventory.
          // Preserve the unresolved ID; only restrictive revocation stays available.
          if (stored) {
            try {
              const raw = await service.load({ page, pageSize, pending: null, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
              if (active) setSnapshot(parsePersonalSnapshot(raw, ownerId, page, pageSize, null));
            } catch { /* Keep unresolved state and never infer a failed mutation. */ }
          }
          if (active) setError("개인 연결 목록이나 처리 결과를 확인하지 못했습니다. 새 요청을 만들지 말고 다시 조회해 주세요. 확인된 기존 연결은 폐기할 수 있습니다.");
        }
      }
      finally { if (active) {
        setLoading(false);
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          setFocusRevision(value => value + 1);
        }
      } }
    })();
    return () => { active = false; controller.abort(); };
  }, [ownerId, service, page, pageSize, pageReady, revision]);

  const refresh = () => { setSecret(""); setRevealed(false); setRevision(value => value + 1); };
  const openCreate = () => {
    if (!canIssue) return;
    setLabel(""); setDays("1"); setSelectedClasses([]); setSelectedSchools([]); setFeatures([]); setConfirmed(false); setNotice(""); setForm("edit");
  };
  const begin = (kind: PendingPersonalOperation["kind"]) => {
    const operation = { requestId: crypto.randomUUID(), kind };
    // Persist before the request. Failure here prevents calling the adapter.
    savePersonalPending(window.sessionStorage, ownerId, operation); setPending(operation);
    return operation;
  };
  const issue = async () => {
    if (!canIssue || !confirmed || !ready || busyRef.current || form !== "review") return;
    if (!label.trim() || label.trim().length > 80 || !["1", "7", "30"].includes(days)
      || classIds.length > 50 || schoolIds.length > 50 || !classIds.length && !schoolIds.length
      || !features.length || features.some(id => !featureCanSelect(id, classIds.length, schoolIds.length))
      || Date.parse(expiresAt) <= Date.now()) { setForm("edit"); return; }
    busyRef.current = true; setBusy(true); const current = generation.current;
    try {
      const operation = begin("issue");
      const input = { requestId: operation.requestId, label: label.trim(), expiresAt, classIds, schoolIds, featureIds: features };
      const raw = await service.issue(input);
      if (generation.current !== current) return;
      const result = parsePersonalIssue(raw, ownerId, input);
      savePersonalPending(window.sessionStorage, ownerId, null); setPending(null);
      setForm(null); setSecret(result.secret); setRevealed(false); setNotice("개인 읽기 연결을 만들었습니다.");
    } catch { if (generation.current === current) { setForm(null); setError(uncertainMessage); } }
    finally { if (generation.current === current) { busyRef.current = false; setBusy(false); } }
  };
  const revokeConnection = async (recoveryId?: string) => {
    const credentialId = recoveryId ?? revoke?.id;
    if (!canRevoke || !credentialId || (revoke && revoke.ownerId !== ownerId) || busyRef.current) return;
    busyRef.current = true; setBusy(true); const current = generation.current;
    try {
      const stored = readPersonalRevokePending(window.sessionStorage, ownerId);
      if (stored && stored.credentialId !== credentialId) throw new Error("personal_revoke_pending");
      const operation = stored ?? { requestId: crypto.randomUUID(), credentialId };
      savePersonalRevokePending(window.sessionStorage, ownerId, operation); setPendingRevoke(operation);
      const raw = await service.revoke(operation);
      if (generation.current !== current) return;
      parsePersonalRevoke(raw, ownerId, operation.requestId, credentialId);
      savePersonalRevokePending(window.sessionStorage, ownerId, null); setPendingRevoke(null);
      setRevoke(null); setRecovered(null); setNotice("선택한 개인 연결을 폐기했습니다."); focusAfterLoad.current = true; setRevision(value => value + 1);
    } catch { if (generation.current === current) { setRevoke(null); setError("폐기 결과를 확인하지 못했습니다. ‘폐기 결과 확인’으로 같은 요청을 확인해 주세요."); } }
    finally { if (generation.current === current) { busyRef.current = false; setBusy(false); } }
  };
  const updatePermissions = async () => {
    if (!canMutate || !editing || busyRef.current) return;
    busyRef.current = true; setBusy(true); const current = generation.current;
    try {
      const operation = begin("permissions");
      const input = { requestId: operation.requestId, credentialId: editing.id, expectedRevision: editing.featureRevision, featureIds: editFeatures };
      const raw = await service.permissions(input);
      if (generation.current !== current) return;
      parsePersonalPermissions(raw, ownerId, input);
      savePersonalPending(window.sessionStorage, ownerId, null); setPending(null); setEditing(null);
      setNotice("기능 권한을 저장했습니다. 이후 요청부터 변경한 권한을 확인합니다.");
      focusAfterLoad.current = true; setRevision(value => value + 1);
    } catch { if (generation.current === current) { setEditing(null); setError(uncertainMessage); } }
    finally { if (generation.current === current) { busyRef.current = false; setBusy(false); } }
  };
  const closeSecret = () => { focusAfterLoad.current = true; setSecret(""); setRevealed(false); setPage(1); setRevision(value => value + 1); };

  return <SettingsWorkspaceShell>
    <SettingsMasterHeader filters={<span className="text-sm font-medium">내 개인 읽기 연결</span>} actions={<><Button ref={refreshRef} variant="outline" onClick={refresh} disabled={loading || busy}>{pending ? "처리 결과 확인" : "목록 새로고침"}</Button><Button ref={createRef} onClick={openCreate} disabled={!canIssue}>새 개인 연결</Button></>} />
    {!apiEnabled ? <p role="status" className="text-sm text-muted-foreground">개인 읽기 API가 비활성화되어 새 키를 발급할 수 없습니다. 기존 연결 조회·처리 결과 확인·폐기는 가능합니다.</p> : null}
    {loading ? <p role="status" className="text-sm">개인 연결 확인 중…</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {pending ? <p role="status" className="text-sm">이전 요청의 결과를 확인해야 합니다. 확인 전에는 새 발급·권한 변경은 진행할 수 없습니다. 확인된 기존 연결은 폐기할 수 있습니다.</p> : null}
    {pendingRevoke ? <Button variant="outline" disabled={!canRevoke} onClick={() => void revokeConnection(pendingRevoke.credentialId)}>폐기 결과 확인</Button> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {recovered ? <div className="text-sm [overflow-wrap:anywhere]">{recovered.label} · {recovered.id}<Button variant="outline" disabled={!canRevoke || Boolean(recovered.revokedAt) || Boolean(pendingRevoke && pendingRevoke.credentialId !== recovered.id)} onClick={() => setRevoke(recovered)}>복구한 연결 폐기</Button></div> : null}
    {ready ? <><SettingsTableFrame><Table className="min-w-[320px] table-fixed"><TableHeader><TableRow><TableHead className={`${settingsTableHeadClass} w-[38%]`}>연결</TableHead><TableHead className={settingsTableHeadClass}>허용 범위·만료</TableHead><TableHead className={`${settingsTableHeadClass} w-20`}>관리</TableHead></TableRow></TableHeader><TableBody>
      {ready.items.map(row => <TableRow key={row.id}><TableCell className={`${settingsTableCellClass} whitespace-normal align-top [overflow-wrap:anywhere]`}><p className="font-medium">{row.label}</p><p className="mt-1 text-xs text-muted-foreground">{row.revokedAt ? "폐기됨" : Date.parse(row.expiresAt) <= Date.now() ? "만료됨" : "읽기 전용"}</p></TableCell><TableCell className={`${settingsTableCellClass} whitespace-normal text-sm`}><p>수업 {row.classes.length}개 · 학교 {row.schools.length}개</p><p className="text-xs">허용 기능 {row.featureIds.length}개 · 변경 {row.featureRevision}</p>{row.featureIds.map(id => <p key={id} className="text-xs">{API_FEATURES.find(feature => feature.id === id)?.title}</p>)}{[...row.classes, ...row.schools].map(target => <p key={target.id} className="[overflow-wrap:anywhere]">{target.name}<span className="block break-all text-xs text-muted-foreground">{target.id}</span></p>)}<p className="mt-1">{dateLabel(row.expiresAt)} 만료</p></TableCell><TableCell className={`${settingsTableCellClass} align-top`}><Button size="sm" variant="outline" className="mb-2" disabled={!canMutate || Boolean(row.revokedAt) || Date.parse(row.expiresAt) <= Date.now()} aria-label={`${row.label} 기능 관리`} onClick={() => { setEditing(row); setEditFeatures([...row.featureIds]); }}>기능 관리</Button><Button size="sm" variant="outline" disabled={!canRevoke || Boolean(row.revokedAt) || Boolean(pendingRevoke && pendingRevoke.credentialId !== row.id)} aria-label={`${row.label} 폐기`} onClick={() => setRevoke(row)}>폐기</Button></TableCell></TableRow>)}
      {!ready.items.length ? <TableRow><TableCell colSpan={3} className={`${settingsTableCellClass} whitespace-normal`}>{ready.total === 0 ? "발급한 개인 읽기 연결이 없습니다." : "이 페이지에 연결이 없습니다. 앞 페이지를 확인하세요."}</TableCell></TableRow> : null}
    </TableBody></Table></SettingsTableFrame><DataTablePagination page={page} pageSize={pageSize} totalCount={ready.total} loading={loading || busy} onPageChange={setPage} onPageSizeChange={size => { setPreference(size); setPage(1); }} /></> : null}
    <Dialog open={form !== null} onOpenChange={open => { if (!open && !busyRef.current) setForm(null); }}>
      <FormDialogContent title={form === "review" ? "개인 연결 범위 확인" : "새 개인 읽기 연결"} description="본인에게 허용된 읽기 범위와 만료를 확인합니다." returnFocusRef={createRef} onCancel={() => { if (!busyRef.current) setForm(null); }} cancelLabel="개인 연결 만들기 취소" submitLabel={form === "review" ? "확인하고 키 발급" : "범위 확인"} busy={busy} submitDisabled={form === "review" ? !confirmed || !canIssue : !label.trim() || classIds.length + schoolIds.length === 0 || !features.length || features.some(id => !featureCanSelect(id, classIds.length, schoolIds.length)) || !canIssue} onSubmit={event => { event.preventDefault(); if (form === "edit") { setExpiresAt(new Date(Date.now() + Number(days) * 86400000 - 60_000).toISOString()); setConfirmed(false); setForm("review"); } else void issue(); }}>
        {form === "edit" ? <><div className="space-y-2"><Label htmlFor="personal-label">연결 이름 · 사용 목적</Label><Input id="personal-label" value={label} maxLength={80} autoComplete="off" onChange={event => setLabel(event.target.value)} placeholder="예: 내 수업 일정 확인" /></div><div className="space-y-2"><Label htmlFor="personal-expiry">만료</Label><NativeSelect id="personal-expiry" value={days} onChange={event => setDays(event.target.value)}><option value="1">1일</option><option value="7">7일</option><option value="30">30일</option></NativeSelect></div><PersonalTargetPicker ownerId={ownerId} service={service} kind="classes" title="담당 수업" selected={selectedClasses} onChange={setSelectedClasses} /><PersonalTargetPicker ownerId={ownerId} service={service} kind="schools" title="허용 학교" selected={selectedSchools} onChange={setSelectedSchools} /><FeatureChecklist value={features} onChange={setFeatures} classCount={classIds.length} schoolCount={schoolIds.length} /><p className="text-sm text-muted-foreground">선택한 대상만 읽을 수 있습니다. 수업·학교를 선택하지 않으면 해당 종류의 권한을 부여하지 않습니다.</p></> : <><dl className="space-y-3 text-sm"><div><dt className="font-medium">연결 이름 · 목적</dt><dd className="[overflow-wrap:anywhere]">{label.trim()}</dd></div><div><dt className="font-medium">만료 (한국 시각)</dt><dd>{expiresAt ? dateLabel(expiresAt) : ""}</dd></div><div><dt className="font-medium">허용 기능</dt><dd>{features.map(id => API_FEATURES.find(feature => feature.id === id)?.title).join(" · ")}</dd></div><div><dt className="font-medium">허용 대상</dt><dd><ul className="list-disc pl-5">{selectedClasses.map(row => <li key={row.id}>수업 · {row.name}</li>)}{selectedSchools.map(row => <li key={row.id}>학교 · {row.name}</li>)}</ul></dd></div></dl><p className="text-sm">{classIds.length ? "선택한 담당 수업 일정 조회. " : ""}{schoolIds.length ? "선택한 학교 목록·학사일정 조회. " : ""}학생 명단·연락처·수강료와 업무 수정·발송 권한은 없습니다.</p><label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} /><span>본인이 사용할 목적·대상·만료를 확인했고 키를 보안 입력란에 직접 넣겠습니다.</span></label><Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirmed(false); setForm("edit"); }}>범위 수정</Button></>}
      </FormDialogContent>
    </Dialog>
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !busyRef.current) setEditing(null); }}>
      <FormDialogContent title="연결 기능 권한" cancelLabel="기능 권한 변경 취소" description={editing?.label ?? "선택한 연결"} returnFocusRef={refreshRef} submitLabel="기능 권한 저장" busy={busy} submitDisabled={!canMutate} onCancel={() => { if (!busyRef.current) setEditing(null); }} onSubmit={event => { event.preventDefault(); void updatePermissions(); }}>
        <FeatureChecklist value={editFeatures} onChange={setEditFeatures} classCount={editing?.classes.length ?? 0} schoolCount={editing?.schools.length ?? 0} disabled={busy} />
        <p className="text-sm text-muted-foreground">저장을 완료하면 체크 해제한 기능의 이후 요청이 차단됩니다. 진행 중인 조회는 먼저 끝날 수 있습니다. 모두 해제해도 연결 키는 유지됩니다.</p>
      </FormDialogContent>
    </Dialog>
    <Dialog open={Boolean(revoke)} onOpenChange={open => { if (!open && !busyRef.current) setRevoke(null); }}><ConfirmationDialogContent title="개인 연결 폐기" description="이 연결의 키로 더 이상 조회할 수 없습니다. 연결한 에이전트에도 영향을 줍니다." items={revoke ? [{ id: revoke.id, title: revoke.label, detail: `수업 ${revoke.classes.length}개 · 학교 ${revoke.schools.length}개, ${dateLabel(revoke.expiresAt)} 만료` }] : []} confirmLabel="폐기" busy={busy} onCancel={() => { if (!busyRef.current) setRevoke(null); }} onConfirm={() => void revokeConnection()} /></Dialog>
    <Dialog open={Boolean(secret)} onOpenChange={open => { if (!open) closeSecret(); }}><DetailDialogContent title="개인 연결 키" description="발급 직후 한 번만 확인할 수 있습니다." onClose={closeSecret} returnFocusRef={createRef}><div className="space-y-4"><p className="text-sm">본인 에이전트의 보안 입력란에 직접 입력하세요. 자동 복사·전송하지 않으며 이 창을 닫으면 다시 표시할 수 없습니다.</p>{revealed ? <><Label htmlFor="personal-secret">이번에 발급한 키</Label><Input id="personal-secret" readOnly value={secret} autoComplete="off" spellCheck={false} className="font-mono text-xs" /><Button variant="outline" onClick={closeSecret}>키 숨기고 닫기</Button></> : <Button onClick={() => setRevealed(true)}>키 한 번 표시</Button>}</div></DetailDialogContent></Dialog>
  </SettingsWorkspaceShell>;
}
