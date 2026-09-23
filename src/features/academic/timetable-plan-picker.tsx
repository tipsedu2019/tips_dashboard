'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { createTimetablePlanService, type TimetableRpcClient } from './timetable-plan-service';
import type { PlanCommand, PlanList, PlanSnapshot, ShareCandidate } from './timetable-plan-contract';
import { planErrorLabel } from './timetable-plan-interaction';
type Fields = { name: string; start: string; end: string; members: Record<string, 'viewer' | 'editor'> };
type PendingCommand = { command: PlanCommand; fields: Fields };
// These final RPC errors occur after receipt lookup and conclusively reject this body.
function rejectedBeforeCommit(error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return false;
    return (error.code === '22023' && error.message === 'timetable_invalid')
        || (error.code === 'P0001' && error.message === 'timetable_stale');
}
const labels = { create: '프리셋 만들기', rename: '이름·기준 기간 변경', clone: '프리셋 복제', archive: '프리셋 보관', restore: '프리셋 복원', share: '프리셋 공유' };

export function TimetablePlanPicker({ planId, snapshot, onChange, onRefresh, requestAction }: {
    planId: string | null;
    snapshot: PlanSnapshot | null;
    onChange: (id: string | null) => void;
    onRefresh: () => Promise<void>;
    requestAction: (action: () => void) => void;
}) {
    const { user, role, loading } = useAuth();
    const actorScope = !loading && user && role ? `${user.id}:${role}` : null;
    const service = useMemo(() => supabase && actorScope ? createTimetablePlanService({ client: supabase as unknown as TimetableRpcClient, actorScope }) : null, [actorScope]);
    const [list, setList] = useState<PlanList | null>(null);
    const [archived, setArchived] = useState(false);
    const [mode, setMode] = useState<PlanCommand['operation'] | null>(null);
    const [fields, setFields] = useState<Fields>({ name: '', start: '', end: '', members: {} });
    const [error, setError] = useState(''), [listError, setListError] = useState('');
    const [busy, setBusy] = useState(false), [recovering, setRecovering] = useState(false);
    const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
    const [recoveredPlan, setRecoveredPlan] = useState<PlanSnapshot['plan'] | null>(null);
    const pending = useRef<PendingCommand | null>(null);
    const retainedFields = useRef<Fields | null>(null);
    const currentFields = useRef(fields);
    currentFields.current = fields;
    const currentService = useRef(service);
    currentService.current = service;
    const mounted = useRef(true), operationEpoch = useRef(0), listEpoch = useRef(0);
    const shareRead = useRef<AbortController | null>(null);
    const isCurrent = (owner: typeof service, epoch: number) => mounted.current && currentService.current === owner && operationEpoch.current === epoch;
    const reload = useCallback(async () => {
        const epoch = ++listEpoch.current;
        if (!service) return;
        const valid = () => mounted.current && currentService.current === service && epoch === listEpoch.current;
        try {
            let result = await service.listPlans(archived);
            for (let page = 2; valid() && result.plans.length < result.total; page++) {
                const next = await service.listPlans(archived, page);
                if (!next.plans.length) break;
                result = { ...result, plans: [...result.plans, ...next.plans] };
            }
            if (valid()) { setList(result); setListError(''); }
        } catch (e) { if (valid()) setListError(planErrorLabel(e)); }
    }, [service, archived]);
    useEffect(() => { setList(null); void reload(); }, [reload]);
    useEffect(() => {
        mounted.current = true;
        operationEpoch.current++;
        shareRead.current?.abort();
        pending.current = null; retainedFields.current = null;
        setMode(null); setCandidates([]); setFields({ name: '', start: '', end: '', members: {} });
        setError(''); setBusy(false); setRecovering(false); setRecoveredPlan(null);
        return () => { mounted.current = false; shareRead.current?.abort(); };
    }, [service]);
    const close = () => {
        if (busy) return;
        operationEpoch.current++; shareRead.current?.abort();
        if (pending.current) retainedFields.current = currentFields.current;
        setMode(null); setCandidates([]); setError('');
    };
    const open = (requested: PlanCommand['operation']) => {
        const owner = service;
        requestAction(() => {
            if (currentService.current !== owner || !mounted.current) return;
            const epoch = ++operationEpoch.current;
            shareRead.current?.abort(); setCandidates([]); setError('');
            // An uncertain receipt owns this dialog until its immutable command is recovered.
            const next = pending.current?.command.operation ?? requested;
            const restored = retainedFields.current ?? pending.current?.fields;
            setFields(restored ?? {
                name: next === 'create' ? '' : next === 'clone' ? `${snapshot?.plan.name || ''} 복사` : snapshot?.plan.name || '',
                start: snapshot?.plan.targetStartDate || '', end: snapshot?.plan.targetEndDate || '',
                members: Object.fromEntries((snapshot?.members || []).map(m => [m.userId, m.access])),
            });
            setMode(next); setRecovering(!!pending.current);
            if (!pending.current) setRecoveredPlan(null);
            if (next === 'share' && owner) {
                const controller = new AbortController(); shareRead.current = controller;
                void owner.shareCandidates({ signal: controller.signal }).then(result => {
                    if (isCurrent(owner, epoch)) setCandidates(result);
                }).catch(e => { if (isCurrent(owner, epoch) && !controller.signal.aborted) setError(planErrorLabel(e)); });
            }
        });
    };
    const createCommand = (): PlanCommand | null => {
        if (!mode) return null;
        const { name, start, end, members } = fields;
        if (['create', 'rename', 'clone'].includes(mode) && !name.trim()) throw Error('프리셋 이름을 입력해 주세요.');
        if (['create', 'rename'].includes(mode) && ((!start !== !end) || (start && end < start))) throw Error('기준 시작일과 종료일을 함께 올바르게 입력해 주세요.');
        const requestKey = crypto.randomUUID();
        const dates = start && end ? { targetStartDate: start, targetEndDate: end } : { targetStartDate: null, targetEndDate: null };
        if (mode === 'create') return { operation: mode, planId: crypto.randomUUID(), name: name.trim(), requestKey, ...dates };
        const metadata = recoveredPlan ?? snapshot?.plan;
        if (!metadata) return null;
        if (mode === 'clone') return { operation: mode, planId: crypto.randomUUID(), sourcePlanId: metadata.id, expectedMetaRevision: metadata.metaRevision, name: name.trim(), requestKey };
        const base = { planId: metadata.id, expectedMetaRevision: metadata.metaRevision, requestKey };
        if (mode === 'rename') return { operation: mode, ...base, name: name.trim(), ...dates };
        if (mode === 'share') return { operation: mode, ...base, members: Object.entries(members).map(([userId, access]) => ({ userId, access })) };
        return { operation: mode, ...base };
    };
    const submit = async () => {
        if (!service || !mode || busy) return;
        const owner = service, epoch = operationEpoch.current;
        setError('');
        let intent = pending.current;
        if (!intent) {
            try {
                const command = createCommand();
                if (!command) return;
                intent = { command, fields: structuredClone(fields) };
                pending.current = intent;
            } catch (e) { setError(planErrorLabel(e)); return; }
        }
        setBusy(true);
        try {
            const result = await owner.mutatePlan(intent.command);
            if (!isCurrent(owner, epoch)) return;
            const latest = currentFields.current;
            pending.current = null; retainedFields.current = null;
            setRecovering(false); setBusy(false);
            const created = intent.command.operation === 'create' || intent.command.operation === 'clone';
            const changed = latest.name !== intent.fields.name || latest.start !== intent.fields.start || latest.end !== intent.fields.end;
            if ((created || intent.command.operation === 'rename') && changed) {
                setRecoveredPlan(result.plan); setMode('rename');
                setError('원래 요청의 저장을 확인했습니다. 변경한 입력은 이 프리셋에 별도로 저장해 주세요.');
            } else { setMode(null); operationEpoch.current++; }
            void reload();
            if (created) onChange(result.plan.id);
            else await onRefresh();
        } catch (e) {
            if (isCurrent(owner, epoch)) {
                if (rejectedBeforeCommit(e)) {
                    pending.current = null; retainedFields.current = null; setRecoveredPlan(null);
                    // Refresh the current metadata revision before a separately submitted correction.
                    void onRefresh().catch(refreshError => { if (isCurrent(owner, epoch)) setError(planErrorLabel(refreshError)); }); void reload();
                }
                setError(planErrorLabel(e)); setRecovering(!!pending.current);
            }
        } finally { if (isCurrent(owner, epoch)) setBusy(false); }
    };
    const setField = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(current => ({ ...current, [key]: value }));
    return <div className="space-y-2 px-4 sm:px-5 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="timetable-plan">시간표</Label>
            <Select value={planId || 'operational'} onValueChange={v => onChange(v === 'operational' ? null : v)}>
                <SelectTrigger id="timetable-plan" className="w-[min(100%,18rem)]"><SelectValue placeholder="운영 시간표" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="operational">운영 시간표</SelectItem>
                    {list?.plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.state === 'archived' ? ' (보관됨)' : ''}</SelectItem>)}
                    {snapshot && !list?.plans.some(p => p.id === planId) ? <SelectItem value={snapshot.plan.id}>{snapshot.plan.name}{snapshot.plan.state === 'archived' ? ' (보관됨)' : ''}</SelectItem> : null}
                </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={archived} onCheckedChange={v => setArchived(Boolean(v))} />보관함</label>
            {list?.canManage ? <Button variant="outline" onClick={() => open('create')}>프리셋 만들기</Button> : null}
            {recovering && !mode ? <Button variant="outline" onClick={() => open(pending.current!.command.operation)}>원래 요청 확인</Button> : null}
            {snapshot ? <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline">더보기</Button></DropdownMenuTrigger>
                <DropdownMenuContent>{snapshot.permissions.canManage ? <>
                    <DropdownMenuItem onSelect={() => open('rename')}>이름·기준 기간 변경</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open('clone')}>복제</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open(snapshot.plan.state === 'archived' ? 'restore' : 'archive')}>{snapshot.plan.state === 'archived' ? '복원' : '보관'}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open('share')}>공유</DropdownMenuItem>
                </> : <DropdownMenuItem disabled>읽기 전용</DropdownMenuItem>}</DropdownMenuContent>
            </DropdownMenu> : null}
        </div>
        {listError ? <p role="alert" className="text-sm text-destructive">{listError} <Button variant="ghost" onClick={() => void reload()}>다시 불러오기</Button></p> : null}
        <Dialog open={!!mode} onOpenChange={opened => { if (!opened) close(); }}>
            <DialogContent restoreFocusToOpener>
                <DialogHeader>
                    <DialogTitle>{mode ? labels[mode] : ''}</DialogTitle>
                    <DialogDescription>{mode === 'share' ? '선생님별 보기·편집 권한을 선택합니다.' : mode === 'archive' ? '보관한 프리셋은 읽기 전용으로 유지되며 복원할 수 있습니다.' : '기준 기간은 검토 범위입니다. 날짜가 되어도 운영 시간표에 자동 적용되지 않습니다.'}</DialogDescription>
                </DialogHeader>
                <form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-4">
                    {mode && ['create', 'rename', 'clone'].includes(mode) ? <div className="space-y-2">
                        <Label htmlFor="plan-name">프리셋 이름</Label><Input id="plan-name" value={fields.name} maxLength={120} onChange={e => setField('name', e.target.value)} autoFocus required={!recovering} />
                    </div> : null}
                    {mode && ['create', 'rename'].includes(mode) ? <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="plan-start">기준 시작일</Label><Input id="plan-start" type="date" value={fields.start} onChange={e => setField('start', e.target.value)} /></div>
                        <div className="space-y-2"><Label htmlFor="plan-end">기준 종료일</Label><Input id="plan-end" type="date" value={fields.end} onChange={e => setField('end', e.target.value)} /></div>
                    </div> : null}
                    {mode === 'share' ? <div className="max-h-80 space-y-3 overflow-y-auto">
                        {candidates.map(c => <div key={c.userId} className="flex items-center justify-between gap-3">
                            <Label htmlFor={`member-${c.userId}`}>{c.name}</Label>
                            <Select value={fields.members[c.userId] || 'none'} onValueChange={v => setFields(current => {
                                const members = { ...current.members };
                                if (v === 'none') delete members[c.userId]; else members[c.userId] = v as 'viewer' | 'editor';
                                return { ...current, members };
                            })}>
                                <SelectTrigger id={`member-${c.userId}`} className="w-32"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="none">공유 안 함</SelectItem><SelectItem value="viewer">보기</SelectItem><SelectItem value="editor">편집</SelectItem></SelectContent>
                            </Select>
                        </div>)}
                        {!candidates.length ? <p className="text-sm text-muted-foreground">공유할 선생님이 없습니다.</p> : null}
                    </div> : null}
                    {recovering ? <p role="status" className="text-sm">저장 결과를 확인하지 못했습니다. 입력을 바꾸어도 먼저 원래 요청을 확인합니다.</p> : null}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button><Button disabled={busy}>{busy ? '저장 중…' : recovering ? '원래 요청 재시도' : '저장'}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    </div>;
}
