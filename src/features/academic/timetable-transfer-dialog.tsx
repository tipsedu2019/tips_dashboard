'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { createTimetableTransferSession, transferEffect } from './timetable-transfer-session';
import { observeTimetableActorRetirement, observeTimetablePlanRevocation } from './timetable-plan-recovery';
import { planErrorLabel, PLAN_DAYS, formatPlanTime } from './timetable-plan-interaction';
import type { PlanMetadata, TransferRequest, TransferResult } from './timetable-plan-contract';
import type { useTimetablePlan } from './use-timetable-plan';

export function TimetableTransferDialog({ open, onOpenChange, state, selectedItemIds, setSelectedItemIds, onPending, onTransferred, onEditItem }: {
  onEditItem: (itemId: string) => void;
  open: boolean; onOpenChange: (open: boolean) => void; state: ReturnType<typeof useTimetablePlan>;
  selectedItemIds: string[]; setSelectedItemIds: (ids: string[]) => void; onPending: (pending: boolean) => void;
  onTransferred: (result: TransferResult, request: TransferRequest) => Promise<void>;
}) {
  const { service, controller, snapshot } = state;
  const [target, setTarget] = useState('operational'), [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [keepPending, setKeepPending] = useState(false), [plans, setPlans] = useState<PlanMetadata[]>([]), [listError, setListError] = useState('');
  const planId = snapshot?.plan.id ?? '';
  const session = useMemo(() => service && controller && planId ? createTimetableTransferSession({
    service, planId, apply: result => controller.applyTransfer(result),
    refresh: async () => { await controller.refresh(); if (controller.snapshot().referenceStatus !== 'verified') throw Error('timetable_reference_unverifiable'); },
    afterCommit: onTransferred, onForbidden: () => controller.clearSensitive(),
  }) : null, [service, controller, planId, onTransferred]);
  const transfer = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.snapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => {
    if (!session || !service) return;
    session.resume();
    const stop = observeTimetableActorRetirement(service.actorScope, () => session.retire());
    const stopRevocation = observeTimetablePlanRevocation(service.actorScope, id => {
      setPlans(value => value.filter(plan => plan.id !== id));
      const request = session.snapshot().command?.request;
      if (id === planId || request?.target.kind === 'plan' && request.target.planId === id) session.retire();
    });
    return () => { stop(); stopRevocation(); session.pause(); };
  }, [session, service, planId]);
  useEffect(() => { onPending(!!transfer?.command); }, [transfer?.command, onPending]);
  useEffect(() => {
    if (!open || !service) return;
    const abort = new AbortController();
    void (async () => {
      let list = await service.listPlans(false, 1, { signal: abort.signal });
      const all = [...list.plans];
      for (let page = 2; all.length < list.total; page++) {
        list = await service.listPlans(false, page, { signal: abort.signal });
        if (!list.plans.length) break;
        all.push(...list.plans);
      }
      if (!abort.signal.aborted) { setPlans(all.filter(plan => plan.id !== planId)); setListError(''); }
    })().catch(error => { if (!abort.signal.aborted) setListError(planErrorLabel(error)); });
    return () => abort.abort();
  }, [open, service, planId]);
  const request: TransferRequest = { source: { kind: 'plan', planId }, target: target === 'operational' ? { kind: 'operational' } : { kind: 'plan', planId: target }, mode, itemIds: selectedItemIds, onConflict: keepPending && target !== 'operational' && mode === 'copy' ? 'keep_pending' : 'reject' };
  const signature = JSON.stringify(request);
  useEffect(() => { session?.reset(); }, [signature, session]);
  if (!snapshot || !session || !transfer) return null;
  const locked = !!transfer.command;
  const displayedRequest = transfer.command?.request ?? (transfer.status === 'completed' ? transfer.preview?.request : null) ?? request;
  const busy = ['previewing','committing','refreshing'].includes(transfer.status);
  const canPreview = !locked && !busy && !state.dirty && state.referenceStatus === 'verified'
    && snapshot.permissions.canEdit && selectedItemIds.length > 0 && (target !== 'operational' || snapshot.permissions.canTransfer);
  const rows = snapshot.items.filter(item => displayedRequest.itemIds.includes(item.id));
  const close = () => { if (busy) return; session.reset(); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent restoreFocusToOpener className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>선택 수업 이동·복사</DialogTitle><DialogDescription>{transferEffect(displayedRequest)}</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="transfer-target">목적지</Label><Select value={locked ? displayedRequest.target.kind === 'operational' ? 'operational' : displayedRequest.target.planId : target} disabled={locked || busy} onValueChange={setTarget}><SelectTrigger id="transfer-target"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="operational" disabled={!snapshot.permissions.canTransfer}>수강 · 새 수업 생성</SelectItem>
          {plans.map(plan => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
        </SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="transfer-mode">방식</Label><Select value={displayedRequest.mode} disabled={locked || busy} onValueChange={value => setMode(value as 'copy' | 'move')}><SelectTrigger id="transfer-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="copy">복사 · 원안 보관</SelectItem><SelectItem value="move">이동 · 원안 제거</SelectItem></SelectContent></Select></div>
      </div>
      {displayedRequest.target.kind === 'plan' && displayedRequest.mode === 'copy' ? <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={locked ? displayedRequest.onConflict === 'keep_pending' : keepPending} disabled={locked || busy} onCheckedChange={value => setKeepPending(value === true)} />충돌·미해결 배치를 미배치로 보존</label> : null}
      {listError ? <p role="alert" className="text-sm text-destructive">{listError}</p> : null}
      <div className="divide-y rounded-lg border">
        {rows.map(item => {
          const slots = item.state === 'applied' ? snapshot.appliedSnapshots.find(history => history.itemId === item.id)?.slots ?? [] : snapshot.slots.filter(slot => slot.itemId === item.id);
          const issues = [...(transfer.preview?.blockers ?? []), ...(transfer.preview?.warnings ?? [])].filter(issue => issue.sourceId === item.id);
          return <div key={item.id} className="space-y-1 p-3 text-sm">
            <div className="flex items-start gap-2"><Checkbox aria-label={`${item.name} 전송 선택`} checked disabled={locked || busy} onCheckedChange={() => setSelectedItemIds(selectedItemIds.filter(id => id !== item.id))} /><span className="break-words font-medium">{item.name}</span></div>
            <p className="text-muted-foreground">{item.subject} · {item.grade || '학년 미정'} · 정원 {item.capacity ?? '미정'} · 수업료 {item.tuition?.toLocaleString() ?? '미정'}</p>
            <p>{slots.map(slot => `${PLAN_DAYS[slot.weekday]} ${formatPlanTime(slot.startMinute)}–${formatPlanTime(slot.endMinute)} · ${slot.teacherName ?? snapshot.catalogs.teachers.find(t => t.id === slot.teacherId)?.name ?? '선생님 미정'} · ${slot.classroomName ?? snapshot.catalogs.classrooms.find(r => r.id === slot.classroomId)?.name ?? '강의실 미정'}`).join(' / ') || '미배치'}</p>
            {item.state === 'draft' ? <Button size="sm" variant="outline" disabled={locked || busy || state.dirty || state.referenceStatus !== 'verified'} onClick={() => { if (locked || busy) return; session.reset(); onEditItem(item.id); }}>수업 정보 수정</Button> : null}
            {issues.map((issue, index) => <p key={index} className={displayedRequest.onConflict === 'keep_pending' ? 'text-muted-foreground' : 'text-destructive'}>{issue.label}{displayedRequest.onConflict === 'keep_pending' ? ' 미배치로 복사합니다.' : ''}</p>)}
          </div>;
        })}
      </div>
      {transfer.error ? <p role="alert" className="text-sm text-destructive">{transfer.status === 'refresh_failed' ? '반영은 완료되었습니다. 화면 갱신을 다시 시도하세요.' : transfer.status === 'uncertain' ? '응답을 확인하지 못했습니다. 같은 요청으로 결과를 확인하세요.' : planErrorLabel(transfer.error)}</p> : null}
      {transfer.status === 'completed' ? <p role="status">반영 완료 · 최신 시간표를 확인했습니다.</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={close}>{transfer.status === 'completed' ? '닫기' : '나중에 계속'}</Button>
        {transfer.status === 'uncertain' ? <Button onClick={() => void session.commit()}>같은 요청으로 결과 확인</Button>
          : transfer.status === 'refresh_failed' ? <Button onClick={() => void session.refreshCommitted()}>화면 갱신 재시도</Button>
          : transfer.status === 'completed' ? null
          : transfer.status === 'ready' && !transfer.preview?.blockers.length ? <Button disabled={!canPreview} onClick={() => void session.commit()}>확인한 수업 {selectedItemIds.length}개 {mode === 'copy' ? '복사' : '이동'}</Button>
          : <Button disabled={!canPreview} onClick={() => void session.preview(request)}>{busy ? '확인 중…' : '선택 수업 다시 검사'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
const noSubscribe = () => () => {};
const emptySnapshot = () => null;
