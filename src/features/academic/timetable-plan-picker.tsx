'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ConfirmationDialogContent } from '@/components/ui/form-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { createTimetablePlanService, type TimetablePlanService, type TimetableRpcClient } from './timetable-plan-service';
import type { PlanCommand, PlanList, PlanMetadata, PlanSnapshot } from './timetable-plan-contract';
import { availableTimetableSessionStorage, timetableDraftStorageKey, observeTimetableActorRetirement, observeTimetablePlanRevocation, clearTimetableActorRecovery } from './timetable-plan-recovery.ts';
import { planErrorLabel } from './timetable-plan-interaction';
type Fields = { name: string };
type PendingCommand = { command: PlanCommand; fields: Fields; target?: PlanMetadata };
// Exact validation/stale pairs in the final RPC; partial-date validation precedes receipt lookup.
// Classify the code/message pair, never the SQLSTATE alone.
function rejectedBeforeCommit(error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return false;
    return (error.code === '22023' && error.message === 'timetable_invalid')
        || (error.code === 'P0001' && error.message === 'timetable_stale');
}
const labels = { create: '프리셋 만들기', rename: '이름 변경', clone: '프리셋 복제', archive: '프리셋 삭제', restore: '프리셋 복구', share: '프리셋 공유' };
async function readPlanList(service: TimetablePlanService, archived: boolean, valid: () => boolean) {
    let result = await service.listPlans(archived);
    for (let page = 2; valid() && result.plans.length < result.total; page++) {
        const next = await service.listPlans(archived, page);
        if (!next.plans.length) throw Error('timetable_plan_response_invalid');
        result = { ...result, plans: [...result.plans, ...next.plans], total: next.total };
    }
    return result;
}

export function TimetablePlanPicker({ planId, snapshot, onChange, onRefresh, requestAction, reloadNonce = 0, onFormDirty, onCommitted, disabled = false }: {
    disabled?: boolean;
    onCommitted?: (id: string | null) => void;
    onFormDirty?: (dirty: boolean) => void;
    reloadNonce?: number;
    planId: string | null;
    snapshot: PlanSnapshot | null;
    onChange: (id: string | null) => void;
    onRefresh: () => Promise<void>;
    requestAction: (action: () => void) => void;
}) {
    const { user, role, loading } = useAuth();
    const actorScope = !loading && user && role === 'admin' ? `${user.id}:${role}` : null;
    const service = useMemo(() => supabase && actorScope ? createTimetablePlanService({ client: supabase as unknown as TimetableRpcClient, actorScope }) : null, [actorScope]);
    const [list, setList] = useState<PlanList | null>(null);
    const [mode, setMode] = useState<PlanCommand['operation'] | null>(null);
    const [fields, setFields] = useState<Fields>({ name: '' });
    const [error, setError] = useState(''), [listError, setListError] = useState('');
    const [storageError, setStorageError] = useState(false);
    const recoveryKey = actorScope ? timetableDraftStorageKey(actorScope, '$metadata') : null;
    const previousActor = useRef(actorScope);
    const displayedPlan = useRef(planId); displayedPlan.current = planId;
    const [busy, setBusy] = useState(false), [recovering, setRecovering] = useState(false);
    const [recoveredPlan, setRecoveredPlan] = useState<PlanSnapshot['plan'] | null>(null);
    const [targetPlan, setTargetPlan] = useState<PlanMetadata | null>(null);
    const [lifecycleReady, setLifecycleReady] = useState(true);
    const [restoreOpen, setRestoreOpen] = useState(false), [restoreLoading, setRestoreLoading] = useState(false);
    const [restorePlans, setRestorePlans] = useState<PlanMetadata[] | null>(null), [restoreError, setRestoreError] = useState('');
    const pending = useRef<PendingCommand | null>(null);
    const retainedFields = useRef<Fields | null>(null);
    const currentFields = useRef(fields);
    currentFields.current = fields;
    const currentService = useRef(service);
    currentService.current = service;
    const mounted = useRef(true), operationEpoch = useRef(0), listEpoch = useRef(0), restoreEpoch = useRef(0);
    const inFlight = useRef<object | null>(null);
    const currentTarget = useRef(targetPlan); currentTarget.current = targetPlan;
    const pickerTrigger = useRef<HTMLButtonElement>(null), moreTrigger = useRef<HTMLButtonElement>(null), restoreEntry = useRef<HTMLButtonElement>(null);
    const confirmationOpener = useRef<HTMLElement | null>(null);
    // The dropdown/list target disappears; resolve a persistent fallback at close time.
    const confirmationReturn = useMemo(() => ({ get current() {
        const preferred = confirmationOpener.current;
        return preferred?.isConnected && !preferred.matches(':disabled, [aria-disabled="true"]') ? preferred : pickerTrigger.current;
    } }), []);
    const isCurrent = (owner: typeof service, epoch: number) => mounted.current && currentService.current === owner && operationEpoch.current === epoch;
    const reload = useCallback(async () => {
        const epoch = ++listEpoch.current;
        if (!service) return;
        const valid = () => mounted.current && currentService.current === service && epoch === listEpoch.current;
        try {
            const result = await readPlanList(service, false, valid);
            if (valid()) { setList(result); setListError(''); }
        } catch (e) { if (valid()) setListError(planErrorLabel(e)); }
    }, [service]);
    useEffect(() => { setList(null); void reload(); }, [reload, reloadNonce]);
    useEffect(() => {
        mounted.current = true;
        operationEpoch.current++;

        pending.current = null; retainedFields.current = null; inFlight.current = null; restoreEpoch.current++;
        setMode(null); setFields({ name: '' });
        setError(''); setBusy(false); setRecovering(false); setRecoveredPlan(null); setTargetPlan(null); setLifecycleReady(true);
        setRestoreOpen(false); setRestoreLoading(false); setRestorePlans(null); setRestoreError('');
        return () => { mounted.current = false; };
    }, [service]);
    const persist = useCallback(() => {
        if (!recoveryKey) return;
        try {
            const storage = availableTimetableSessionStorage();
            if (!storage) throw Error('storage unavailable');
            if (pending.current) storage.setItem(recoveryKey, JSON.stringify({ version: 1, pending: pending.current, followup: currentFields.current }));
            else storage.removeItem(recoveryKey);
            setStorageError(false);
        } catch { setStorageError(true); }
    }, [recoveryKey]);
    useEffect(() => {
        if (previousActor.current && previousActor.current !== actorScope) clearTimetableActorRecovery(previousActor.current);
        previousActor.current = actorScope;
        if (!actorScope || !recoveryKey) return;
        const retire = () => {
            operationEpoch.current++; listEpoch.current++; restoreEpoch.current++;
            pending.current = null; retainedFields.current = null; inFlight.current = null;
            setMode(null); setList(null); setRecoveredPlan(null); setRecovering(false); setBusy(false);
            setTargetPlan(null); setLifecycleReady(true); setRestoreOpen(false); setRestoreLoading(false); setRestorePlans(null); setRestoreError('');
            setFields({ name: '' }); setError('');
        };
        const stop = observeTimetableActorRetirement(actorScope, retire);
        const stopRevocation = observeTimetablePlanRevocation(actorScope, id => {
            listEpoch.current++; restoreEpoch.current++;
            setList(value => value ? { ...value, plans: value.plans.filter(plan => plan.id !== id) } : value);
            setRestorePlans(value => value?.filter(plan => plan.id !== id) ?? null);
            setRestoreLoading(false); setRestoreOpen(false);
            const command = pending.current?.command;
            if (command ? command.planId === id || ('sourcePlanId' in command && command.sourcePlanId === id) : currentTarget.current?.id === id || displayedPlan.current === id) {
                operationEpoch.current++;
                pending.current = null; retainedFields.current = null; inFlight.current = null;
                setMode(null); setRecoveredPlan(null); setRecovering(false); setBusy(false);
                setTargetPlan(null); setLifecycleReady(true);
                setFields({ name: '' }); setError('');
            }
        });
        try {
            const storage = availableTimetableSessionStorage();
            if (!storage) throw Error('storage unavailable');
            const raw = storage.getItem(recoveryKey);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved.version !== 1 || !saved.pending?.command?.requestKey || !labels[saved.pending.command.operation as keyof typeof labels]
                    || typeof saved.pending.fields?.name !== 'string' || typeof saved.followup?.name !== 'string') throw Error('invalid recovery');
                pending.current = saved.pending; retainedFields.current = saved.followup; currentFields.current = saved.followup;
                setFields(saved.followup); setRecovering(true);
            }
        } catch { setStorageError(true); }
        return () => { stop(); stopRevocation(); };
    }, [actorScope, recoveryKey]);
    useEffect(() => { if (pending.current) persist(); }, [fields, persist]); // Only submitted intents are recoverable.
    useEffect(() => { onFormDirty?.(!!mode || recovering); return () => onFormDirty?.(false); }, [mode, recovering, onFormDirty]);
    const close = () => {
        if (inFlight.current) return;
        operationEpoch.current++;
        if (pending.current) retainedFields.current = currentFields.current;
        setMode(null); setError('');
    };
    const open = (requested: PlanCommand['operation'], requestedTarget = snapshot?.plan) => {
        const owner = service;
        const action = () => {
            if (currentService.current !== owner || !mounted.current || inFlight.current) return;
            ++operationEpoch.current;
            restoreEpoch.current++; setRestoreOpen(false); setRestoreLoading(false);
            setError('');
            // An uncertain receipt owns this dialog until its immutable command is recovered.
            const next = pending.current?.command.operation ?? requested;
            if (next === 'archive' || next === 'restore') confirmationOpener.current = next === 'archive' ? moreTrigger.current : restoreEntry.current;
            const restored = retainedFields.current ?? pending.current?.fields;
            setFields(restored ?? {
                name: next === 'create' ? '' : next === 'clone' ? `${requestedTarget?.name || ''} 복사` : requestedTarget?.name || '',
            });
            setTargetPlan(pending.current?.target ?? ((next === 'archive' || next === 'restore') && !pending.current ? requestedTarget ?? null : null));
            setLifecycleReady(true);
            setMode(next); setRecovering(!!pending.current);
            if (!pending.current) setRecoveredPlan(null);

        };
        if (pending.current) action(); else requestAction(action);
    };
    const loadRestorePlans = useCallback(async () => {
        const owner = service, epoch = ++restoreEpoch.current;
        if (!owner) return;
        const valid = () => mounted.current && currentService.current === owner && restoreEpoch.current === epoch;
        setRestoreLoading(true); setRestoreError('');
        try {
            const result = await readPlanList(owner, true, valid);
            if (valid()) setRestorePlans(result.plans.filter(plan => plan.state === 'archived'));
        } catch (e) { if (valid()) setRestoreError(planErrorLabel(e)); }
        finally { if (valid()) setRestoreLoading(false); }
    }, [service]);
    const openRestorePlans = () => {
        if (pending.current) { open(pending.current.command.operation); return; }
        const owner = service;
        requestAction(() => {
            if (!owner || currentService.current !== owner || !mounted.current || inFlight.current) return;
            setRestoreOpen(true); setRestorePlans(null); void loadRestorePlans();
        });
    };
    const closeRestorePlans = () => { restoreEpoch.current++; setRestoreOpen(false); setRestoreLoading(false); };
    const createCommand = (): PlanCommand | null => {
        if (!mode) return null;
        const { name } = fields;
        if (['create', 'rename', 'clone'].includes(mode) && !name.trim()) throw Error('프리셋 이름을 입력해 주세요.');
        const requestKey = crypto.randomUUID();
        const dates = { targetStartDate: null, targetEndDate: null };
        if (mode === 'create') return { operation: mode, planId: crypto.randomUUID(), name: name.trim(), requestKey, ...dates };
        const metadata = mode === 'archive' || mode === 'restore' ? targetPlan : recoveredPlan ?? snapshot?.plan;
        if (!metadata) return null;
        if (mode === 'clone') return { operation: mode, planId: crypto.randomUUID(), sourcePlanId: metadata.id, expectedMetaRevision: metadata.metaRevision, name: name.trim(), requestKey };
        const base = { planId: metadata.id, expectedMetaRevision: metadata.metaRevision, requestKey };
        if (mode === 'rename') return { operation: mode, ...base, name: name.trim(), ...dates };
        if (mode === 'share') return null; // Only an already submitted legacy receipt may be retried.
        return { operation: mode, ...base };
    };
    const submit = async () => {
        if (!service || !mode || inFlight.current || (disabled && !pending.current)) return;
        if (!pending.current && ((mode === 'archive' && (!lifecycleReady || targetPlan?.state !== 'draft')) || (mode === 'restore' && (!lifecycleReady || targetPlan?.state !== 'archived')))) return;
        const owner = service, epoch = operationEpoch.current;
        setError('');
        let intent = pending.current;
        if (!intent) {
            try {
                const command = createCommand();
                if (!command) return;
                intent = { command, fields: structuredClone(fields), ...(targetPlan ? { target: structuredClone(targetPlan) } : {}) };
                pending.current = intent;
                persist();
            } catch (e) { setError(planErrorLabel(e)); return; }
        }
        const flight = {}; inFlight.current = flight; setBusy(true);
        try {
            const result = await owner.mutatePlan(intent.command);
            if (!isCurrent(owner, epoch)) return;
            if (result.plan.id !== intent.command.planId
                || (intent.command.operation === 'archive' && result.plan.state !== 'archived')
                || (intent.command.operation === 'restore' && result.plan.state !== 'draft')) throw Error('timetable_plan_response_invalid');
            const latest = currentFields.current;
            pending.current = null; retainedFields.current = null; persist();
            setRecovering(false); setBusy(false);
            const created = intent.command.operation === 'create' || intent.command.operation === 'clone';
            const metadataChanged = latest.name !== intent.fields.name;
            const continuation = (created || intent.command.operation === 'rename') && metadataChanged ? 'rename' : null;
            if (continuation) {
                setRecoveredPlan(result.plan); setMode(continuation);
                setError('원래 요청의 저장을 확인했습니다. 변경한 입력은 이 프리셋에 별도로 저장해 주세요.');
            } else { setMode(null); operationEpoch.current++; }
            void reload();
            if (intent.command.operation === 'archive') {
                setList(value => value ? { ...value, plans: value.plans.filter(plan => plan.id !== intent.command.planId) } : value);
                (onCommitted ?? onChange)(null);
            } else if (created || intent.command.operation === 'restore') (onCommitted ?? onChange)(result.plan.id);
            else await onRefresh();
        } catch (e) {
            if (isCurrent(owner, epoch)) {
                if (rejectedBeforeCommit(e)) {
                    pending.current = null; retainedFields.current = null; persist(); setRecoveredPlan(null); setRecovering(false);
                    if (intent.command.operation === 'archive' || intent.command.operation === 'restore') {
                        // A new lifecycle command requires another explicit confirmation of current metadata.
                        setLifecycleReady(false);
                        try {
                            const result = await readPlanList(owner, true, () => isCurrent(owner, epoch));
                            if (!isCurrent(owner, epoch)) return;
                            const target = result.plans.find(plan => plan.id === intent.command.planId) ?? null;
                            if (target) { setTargetPlan(target); setFields({ name: target.name }); setLifecycleReady(true); }
                        } catch (refreshError) {
                            if (isCurrent(owner, epoch)) setError(planErrorLabel(refreshError));
                            return;
                        }
                    } else {
                        // Refresh the current metadata revision before a separately submitted correction.
                        void onRefresh().catch(refreshError => { if (isCurrent(owner, epoch)) setError(planErrorLabel(refreshError)); });
                    }
                    void reload();
                }
                setError(planErrorLabel(e)); setRecovering(!!pending.current);
            }
        } finally {
            if (inFlight.current === flight) { inFlight.current = null; if (mounted.current && currentService.current === owner) setBusy(false); }
        }
    };
    const setField = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(current => ({ ...current, [key]: value }));
    const lifecycle = mode === 'archive' || mode === 'restore';
    const confirmationTarget = pending.current ? { id: pending.current.command.planId, name: pending.current.fields.name } : targetPlan;
    const lifecycleBlocked = lifecycle && !pending.current && (!lifecycleReady || (mode === 'archive' ? targetPlan?.state !== 'draft' : targetPlan?.state !== 'archived'));
    return <div className="space-y-2 px-4 sm:px-5 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="timetable-plan">시간표</Label>
            <Select value={planId || 'operational'} onValueChange={v => onChange(v === 'operational' ? null : v)}>
                <SelectTrigger ref={pickerTrigger} id="timetable-plan" className="w-[min(100%,18rem)]"><SelectValue placeholder="운영 시간표" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="operational">운영 시간표</SelectItem>
                    {list?.plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.state === 'archived' ? ' (삭제됨)' : ''}</SelectItem>)}
                    {snapshot && !list?.plans.some(p => p.id === planId) ? <SelectItem value={snapshot.plan.id}>{snapshot.plan.name}{snapshot.plan.state === 'archived' ? ' (삭제됨)' : ''}</SelectItem> : null}
                </SelectContent>
            </Select>
            {list?.canManage ? <Button variant="outline" disabled={disabled || !!listError} onClick={() => open('create')}>프리셋 만들기</Button> : null}
            {list?.canManage ? <Button ref={restoreEntry} variant="ghost" disabled={disabled || busy} onClick={openRestorePlans}>삭제한 프리셋 복구</Button> : null}
            {recovering && !mode ? <Button variant="outline" onClick={() => open(pending.current!.command.operation)}>원래 요청 확인</Button> : null}
            {snapshot ? <DropdownMenu>
                <DropdownMenuTrigger asChild><Button ref={moreTrigger} variant="outline" disabled={disabled}>더보기</Button></DropdownMenuTrigger>
                <DropdownMenuContent>{snapshot.permissions.canManage ? snapshot.plan.state === 'draft' ? <>
                    <DropdownMenuItem onSelect={() => open('rename')}>이름 변경</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open('clone')}>복제</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => open('archive')}>삭제</DropdownMenuItem>
                </> : <DropdownMenuItem onSelect={() => open('restore')}>복구</DropdownMenuItem> : <DropdownMenuItem disabled>읽기 전용</DropdownMenuItem>}</DropdownMenuContent>
            </DropdownMenu> : null}
        </div>
        {storageError ? <p role="alert" className="text-sm text-destructive">이 탭에서 복구 정보를 저장할 수 없습니다. 결과를 확인하기 전에는 새로고침하지 마세요.</p> : null}
        {listError ? <p role="alert" className="text-sm text-destructive">{listError} <Button variant="ghost" onClick={() => void reload()}>다시 불러오기</Button></p> : null}
        <Dialog open={!!mode} onOpenChange={opened => { if (!opened) close(); }}>
            {lifecycle && !lifecycleBlocked ? <ConfirmationDialogContent
                title={mode === 'archive' ? '프리셋 삭제' : '프리셋 복구'}
                description={recovering ? '결과를 확인하지 못한 원래 요청을 같은 대상으로 다시 확인합니다.' : mode === 'archive' ? '이 프리셋을 목록에서 삭제합니다. 삭제한 프리셋 복구에서 되돌릴 수 있으며 운영 시간표는 유지됩니다.' : '이 프리셋과 저장된 수업·배치를 복구합니다. 운영 시간표는 유지됩니다.'}
                items={confirmationTarget ? [{ id: confirmationTarget.id, title: confirmationTarget.name, detail: '' }] : []}
                confirmLabel={recovering ? '원래 요청 재시도' : mode === 'archive' ? '삭제' : '복구'}
                onConfirm={() => void submit()} onCancel={close} busy={busy} error={error} returnFocusRef={confirmationReturn}
            /> : <DialogContent restoreFocusToOpener restoreFocusFallbackRef={pickerTrigger} onCloseAutoFocus={event => {
                const target = confirmationReturn.current;
                if (lifecycle && target) { event.preventDefault(); target.focus({ preventScroll: true }); }
            }}>
                <DialogHeader>
                    <DialogTitle>{mode ? labels[mode] : ''}</DialogTitle>
                    <DialogDescription>{lifecycleBlocked ? '현재 프리셋 상태를 확인한 뒤 다시 실행해 주세요.' : mode === 'clone' ? '수업과 배치를 새 프리셋으로 복제합니다.' : '프리셋 이름을 입력하세요.'}</DialogDescription>
                </DialogHeader>
                <form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-4">
                    {mode && ['create', 'rename', 'clone'].includes(mode) ? <div className="space-y-2">
                        <Label htmlFor="plan-name">프리셋 이름</Label><Input id="plan-name" value={fields.name} maxLength={120} onChange={e => setField('name', e.target.value)} required={!recovering} />
                    </div> : null}
                    {recovering ? <p role="status" className="text-sm">저장 결과를 확인하지 못했습니다. 입력을 바꾸어도 먼저 원래 요청을 확인합니다.</p> : null}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    {lifecycleBlocked ? <p role="status" className="text-sm">{targetPlan?.name}{' · '}{!lifecycleReady || !targetPlan ? '대상의 최신 상태를 확인할 수 없습니다. 닫은 뒤 다시 시도해 주세요.' : targetPlan.state === 'archived' ? '이미 삭제된 프리셋입니다.' : '이미 복구된 프리셋입니다.'}</p> : null}
                    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button>{!lifecycleBlocked ? <Button disabled={busy || (disabled && !recovering)}>{busy ? '저장 중…' : recovering ? '원래 요청 재시도' : '저장'}</Button> : null}</DialogFooter>
                </form>
            </DialogContent>}
        </Dialog>
        <Dialog open={restoreOpen} onOpenChange={opened => { if (!opened) closeRestorePlans(); }}>
            <DialogContent restoreFocusToOpener>
                <DialogHeader><DialogTitle>삭제한 프리셋 복구</DialogTitle><DialogDescription>복구할 프리셋을 선택하세요.</DialogDescription></DialogHeader>
                {restoreLoading ? <p role="status" className="text-sm">삭제한 프리셋 불러오는 중…</p> : restoreError ? <p role="alert" className="text-sm text-destructive">{restoreError} <Button variant="ghost" onClick={() => void loadRestorePlans()}>다시 불러오기</Button></p> : restorePlans?.length ? <div className="max-h-72 space-y-2 overflow-y-auto">
                    {restorePlans.map(plan => <Button key={plan.id} variant="outline" size="form" className="w-full justify-start" onClick={() => open('restore', plan)}><span className="truncate">{plan.name}</span></Button>)}
                </div> : <p className="text-sm text-muted-foreground">삭제한 프리셋이 없습니다.</p>}
                <DialogFooter><Button variant="outline" onClick={closeRestorePlans}>닫기</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    </div>;
}
