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
    const [list, setList] = useState<PlanList | null>(null), [archived, setArchived] = useState(false), [mode, setMode] = useState<PlanCommand['operation'] | null>(null), [name, setName] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [candidates, setCandidates] = useState<ShareCandidate[]>([]), [members, setMembers] = useState<Record<string, 'viewer' | 'editor'>>({});
    const commandRef = useRef<{
        signature: string;
        command: PlanCommand;
    } | null>(null);
    const listEpoch = useRef(0);
    const reload = useCallback(async () => { const epoch = ++listEpoch.current; if (!service)
        return; try {
        let result = await service.listPlans(archived);
        for (let page = 2; result.plans.length < result.total; page++) {
            const next = await service.listPlans(archived, page);
            if (!next.plans.length)
                break;
            result = { ...result, plans: [...result.plans, ...next.plans] };
        }
        if (epoch === listEpoch.current) {
            setList(result);
            setError('');
        }
    }
    catch (e) {
        if (epoch === listEpoch.current)
            setError(planErrorLabel(e));
    } }, [service, archived]);
    useEffect(() => { setList(null); void reload(); }, [reload]);
    useEffect(() => { setMode(null); setCandidates([]); setMembers({}); commandRef.current = null; }, [service]);
    const open = (next: PlanCommand['operation']) => requestAction(() => { setName(next === 'create' ? '' : next === 'clone' ? `${snapshot?.plan.name || ''} 복사` : snapshot?.plan.name || ''); setStart(snapshot?.plan.targetStartDate || ''); setEnd(snapshot?.plan.targetEndDate || ''); setMembers(Object.fromEntries((snapshot?.members || []).map(m => [m.userId, m.access]))); setError(''); commandRef.current = null; setMode(next); if (next === 'share')
        void service?.shareCandidates().then(setCandidates).catch(e => setError(planErrorLabel(e))); });
    const submit = async () => {
        if (!service || !mode || busy)
            return;
        setError('');
        if (['create', 'rename', 'clone'].includes(mode) && !name.trim()) {
            setError('프리셋 이름을 입력해 주세요.');
            return;
        }
        if (['create', 'rename'].includes(mode) && ((!start !== !end) || (start && end < start))) {
            setError('기준 시작일과 종료일을 함께 올바르게 입력해 주세요.');
            return;
        }
        const metadata = snapshot?.plan;
        const signature = JSON.stringify({ mode, name, start, end, members, planId });
        let command = commandRef.current?.signature === signature ? commandRef.current.command : null;
        if (!command) {
            const requestKey = crypto.randomUUID();
            if (mode === 'create')
                command = { operation: mode, planId: crypto.randomUUID(), name: name.trim(), requestKey, ...(start && end ? { targetStartDate: start, targetEndDate: end } : { targetStartDate: null, targetEndDate: null }) };
            else if (metadata) {
                if (mode === 'clone')
                    command = { operation: mode, planId: crypto.randomUUID(), sourcePlanId: metadata.id, expectedMetaRevision: metadata.metaRevision, name: name.trim(), requestKey };
                else if (mode === 'rename')
                    command = { operation: mode, planId: metadata.id, expectedMetaRevision: metadata.metaRevision, name: name.trim(), requestKey, ...(start && end ? { targetStartDate: start, targetEndDate: end } : { targetStartDate: null, targetEndDate: null }) };
                else if (mode === 'share')
                    command = { operation: mode, planId: metadata.id, expectedMetaRevision: metadata.metaRevision, members: Object.entries(members).map(([userId, access]) => ({ userId, access })), requestKey };
                else
                    command = { operation: mode, planId: metadata.id, expectedMetaRevision: metadata.metaRevision, requestKey };
            }
            if (!command)
                return;
            commandRef.current = { signature, command };
        }
        setBusy(true);
        try {
            const result = await service.mutatePlan(command);
            setMode(null);
            await reload();
            if (mode === 'create' || mode === 'clone')
                onChange(result.plan.id);
            else
                await onRefresh();
        }
        catch (e) {
            setError(planErrorLabel(e));
        }
        finally {
            setBusy(false);
        }
    };
    const labels = { create: '프리셋 만들기', rename: '이름·기준 기간 변경', clone: '프리셋 복제', archive: '프리셋 보관', restore: '프리셋 복원', share: '프리셋 공유' };
    return <div className="space-y-2 px-4 sm:px-5 lg:px-6"><div className="flex flex-wrap items-center gap-2"><Label htmlFor="timetable-plan">시간표</Label><Select value={planId || 'operational'} onValueChange={v => onChange(v === 'operational' ? null : v)}><SelectTrigger id="timetable-plan" className="w-[min(100%,18rem)]"><SelectValue placeholder="운영 시간표"/></SelectTrigger><SelectContent><SelectItem value="operational">운영 시간표</SelectItem>{list?.plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.state === 'archived' ? ' (보관됨)' : ''}</SelectItem>)}{snapshot && !list?.plans.some(p => p.id === planId) ? <SelectItem value={snapshot.plan.id}>{snapshot.plan.name}{snapshot.plan.state === 'archived' ? ' (보관됨)' : ''}</SelectItem> : null}</SelectContent></Select><label className="flex items-center gap-2 text-sm"><Checkbox checked={archived} onCheckedChange={v => setArchived(Boolean(v))}/>보관함</label>{list?.canManage ? <Button variant="outline" onClick={() => open('create')}>프리셋 만들기</Button> : null}{snapshot ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">더보기</Button></DropdownMenuTrigger><DropdownMenuContent>{snapshot.permissions.canManage ? <><DropdownMenuItem onSelect={() => open('rename')}>이름·기준 기간 변경</DropdownMenuItem><DropdownMenuItem onSelect={() => open('clone')}>복제</DropdownMenuItem><DropdownMenuItem onSelect={() => open(snapshot.plan.state === 'archived' ? 'restore' : 'archive')}>{snapshot.plan.state === 'archived' ? '복원' : '보관'}</DropdownMenuItem><DropdownMenuItem onSelect={() => open('share')}>공유</DropdownMenuItem></> : <DropdownMenuItem disabled>읽기 전용</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu> : null}</div>{error && !mode ? <p role="alert" className="text-sm text-destructive">{error} <Button variant="ghost" onClick={() => void reload()}>다시 불러오기</Button></p> : null}<Dialog open={!!mode} onOpenChange={open => { if (!open && !busy)
        setMode(null); }}><DialogContent restoreFocusToOpener><DialogHeader><DialogTitle>{mode ? labels[mode] : ''}</DialogTitle><DialogDescription>{mode === 'share' ? '선생님별 보기·편집 권한을 선택합니다.' : mode === 'archive' ? '보관한 프리셋은 읽기 전용으로 유지되며 복원할 수 있습니다.' : '기준 기간은 검토 범위입니다. 날짜가 되어도 운영 시간표에 자동 적용되지 않습니다.'}</DialogDescription></DialogHeader><form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-4">{mode && ['create', 'rename', 'clone'].includes(mode) ? <div className="space-y-2"><Label htmlFor="plan-name">프리셋 이름</Label><Input id="plan-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} autoFocus required/></div> : null}{mode && ['create', 'rename'].includes(mode) ? <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="plan-start">기준 시작일</Label><Input id="plan-start" type="date" value={start} onChange={e => setStart(e.target.value)}/></div><div className="space-y-2"><Label htmlFor="plan-end">기준 종료일</Label><Input id="plan-end" type="date" value={end} onChange={e => setEnd(e.target.value)}/></div></div> : null}{mode === 'share' ? <div className="max-h-80 space-y-3 overflow-y-auto">{candidates.map(c => <div key={c.userId} className="flex items-center justify-between gap-3"><Label htmlFor={`member-${c.userId}`}>{c.name}</Label><Select value={members[c.userId] || 'none'} onValueChange={v => setMembers(current => { const next = { ...current }; if (v === 'none')
        delete next[c.userId];
    else
        next[c.userId] = v as 'viewer' | 'editor'; return next; })}><SelectTrigger id={`member-${c.userId}`} className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">공유 안 함</SelectItem><SelectItem value="viewer">보기</SelectItem><SelectItem value="editor">편집</SelectItem></SelectContent></Select></div>)}{!candidates.length ? <p className="text-sm text-muted-foreground">공유할 선생님이 없습니다.</p> : null}</div> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setMode(null)}>취소</Button><Button disabled={busy}>{busy ? '저장 중…' : '저장'}</Button></DialogFooter></form></DialogContent></Dialog></div>;
}
