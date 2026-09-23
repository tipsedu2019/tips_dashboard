'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { DropTarget, PlanSnapshot, ResourceOption } from './timetable-plan-contract';
import type { TimetableItemEdit } from './timetable-plan-model';
import { suggestPlacements } from './timetable-conflicts';
import { PLAN_DAYS, PLAN_DAY_ORDER, formatPendingSlot, formatPlanTime, parsePlanTime, planErrorLabel, itemDraft, buildPlacementFormEdit, placementFormDefaults, placementScope, type PlacementEditorDraft, type PlacementFormValues } from './timetable-plan-interaction';
export type { PlacementEditorDraft } from './timetable-plan-interaction';
type Values = PlacementFormValues;
export function TimetablePlacementEditor({ draft, snapshot, onSave, onClose, onDirty, canEdit, failureKind, onRetry, onDiscard, onAcceptServer, serverSummary }: {
    draft: PlacementEditorDraft;
    snapshot: PlanSnapshot;
    onSave: (edit: TimetableItemEdit) => Promise<void>;
    onClose: (saved?: boolean) => void;
    onDirty: (dirty: boolean) => void;
    canEdit: boolean;
    failureKind: 'rejected' | 'uncertain' | 'stale' | null;
    onRetry: () => Promise<void>;
    onDiscard: () => Promise<void>;
    onAcceptServer: () => Promise<void>;
    serverSummary: string;
}) {
    const slot = draft.slots.find(s => s.id === draft.slotId);
    const scope = placementScope(draft);
    const whole = scope === 'item' && draft.slots.length > 0;
    const form = useForm<Values>({ defaultValues: placementFormDefaults(draft) });
    const submittedValues = useRef<string | null>(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [suggestions, setSuggestions] = useState<DropTarget[] | null>(null);
    useEffect(() => { onDirty(form.formState.isDirty); }, [form.formState.isDirty, onDirty]);
    const save = async (values: Values, candidate?: DropTarget) => { if (!canEdit || busy)
        return; setBusy(true); setError(''); try {
        const edit = buildPlacementFormEdit(draft, values, candidate);
        submittedValues.current = JSON.stringify(values);
        await onSave(edit);
        form.reset(values);
        onDirty(false);
        onClose(true);
    }
    catch (e) {
        setError(planErrorLabel(e));
    }
    finally {
        setBusy(false);
    } };
    const recommend = () => { try {
        const v = form.getValues();
        const fromMinute = parsePlanTime(v.start), toMinute = parsePlanTime(v.end, true);
        setSuggestions(suggestPlacements({ slots: snapshot.slots.filter(s => s.id !== draft.slotId), shadows: snapshot.shadowSlots, itemId: draft.item.id, planId: draft.item.planId, teacherId: v.teacher, classroomId: v.room, durationMinutes: Number(v.duration), weekdays: v.weekdays.length ? v.weekdays : [1, 2, 3, 4, 5], fromMinute, toMinute, operatingReference: snapshot, period: snapshot.plan.targetStartDate && snapshot.plan.targetEndDate ? { startDate: snapshot.plan.targetStartDate, endDate: snapshot.plan.targetEndDate } : null }));
        setError('');
    }
    catch (e) {
        setError(planErrorLabel(e));
        setSuggestions(null);
    } };
    const input = (name: 'name' | 'subject' | 'grade' | 'duration' | 'start' | 'end' | 'capacity' | 'tuition', label: string, required = false) => <FormField control={form.control} name={name} rules={required ? { required: `${label}을 입력해 주세요.` } : undefined} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} disabled={whole && ['start', 'end'].includes(name) && !form.watch('applyTime')} required={required} maxLength={name === 'name' ? 200 : undefined} inputMode={['duration', 'capacity', 'tuition'].includes(name) ? 'numeric' : undefined} placeholder={name === 'start' ? '17:13' : name === 'end' ? '24:00' : undefined}/></FormControl><FormMessage /></FormItem>}/>;
    const resource = (name: 'teacher' | 'room', label: string, options: ResourceOption[]) => <FormField control={form.control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><Select disabled={whole && !form.watch(name === 'teacher' ? 'applyTeacher' : 'applyRoom')} value={field.value || 'none'} onValueChange={v => field.onChange(v === 'none' ? '' : v)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="none">미정</SelectItem>{options.map(o => <SelectItem value={o.id} key={o.id} disabled={!o.isVisible || o.isMissing}>{o.name}{!o.isVisible || o.isMissing ? ' (사용 불가)' : ''}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>}/>;
    const wholeChange = (name: 'applyTeacher' | 'applyRoom' | 'applyTime' | 'applyWeekdays', label: string) =>
        <FormField control={form.control} name={name} render={({ field }) => <FormItem>
            <FormLabel className="flex min-h-11 items-center gap-2"><FormControl><Checkbox aria-label={label} checked={field.value} onCheckedChange={value => field.onChange(Boolean(value))} /></FormControl>{label}</FormLabel>
        </FormItem>} />;
    const runRecovery = async (action: () => Promise<void>, after?: () => void) => {
        setBusy(true);
        try { await action(); setError(''); after?.(); }
        catch (e) { setError(planErrorLabel(e)); }
        finally { setBusy(false); }
    };
    const retryOriginal = () => runRecovery(onRetry, () => {
        if (submittedValues.current === JSON.stringify(form.getValues())) {
            form.reset(form.getValues()); onDirty(false); onClose(true);
        }
    });
    const acceptServer = () => runRecovery(onAcceptServer, () => { onDirty(false); onClose(true); });
    const unplace = () => runRecovery(() => onSave({ operation: 'save', item: itemDraft(draft.item), slots: draft.slots.filter(s => s.id !== slot?.id) }), () => { onDirty(false); onClose(true); });
    const title = scope === 'slot' ? '단일 배치 편집' : scope === 'add' ? '추가 배치'
        : snapshot.items.some(i => i.id === draft.item.id) ? '수업 전체 편집' : '수업 추가';
    const description = scope === 'slot' ? '선택한 배치만 변경합니다. 다른 요일의 배치는 유지됩니다.'
        : scope === 'add' ? '기존 배치를 유지하고 선택한 요일에 추가합니다.'
        : whole ? '전체 변경을 선택한 항목만 모든 배치에 적용합니다. 나머지 배치 정보는 유지됩니다.'
        : '요일을 선택하지 않으면 미배치 수업으로 저장합니다.';
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
        <DialogContent restoreFocusToOpener className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(v => save(v))} className="space-y-4">
                    <fieldset disabled={!canEdit || busy} className="space-y-4">
                        {input('name', '수업명', true)}
                        {whole ? <div className="grid grid-cols-2 gap-2">
                            {wholeChange('applyTeacher', '전체 담당 변경')}
                            {wholeChange('applyRoom', '전체 강의실 변경')}
                            {wholeChange('applyWeekdays', '전체 요일 변경')}
                            {wholeChange('applyTime', '전체 시각 변경')}
                        </div> : null}
                        <div className="grid grid-cols-2 gap-3">
                            {input('subject', '과목', true)}{input('grade', '학년')}
                            {resource('teacher', '선생님', snapshot.catalogs.teachers)}
                            {resource('room', '강의실', snapshot.catalogs.classrooms)}
                            {input('capacity', '정원')}{input('tuition', '수업료')}
                        </div>
                        <FormField control={form.control} name="weekdays" render={({ field }) => <FormItem>
                            <FormLabel>배치 요일</FormLabel>
                            <div className="flex flex-wrap gap-3">{PLAN_DAY_ORDER.map(i =>
                                <Label key={i} className="flex min-h-11 items-center gap-2">
                                    <Checkbox disabled={whole && !form.watch('applyWeekdays')} checked={field.value.includes(i)}
                                        onCheckedChange={checked => field.onChange(checked ? [...field.value, i] : field.value.filter(d => d !== i))} />
                                    {PLAN_DAYS[i]}
                                </Label>
                            )}</div>
                            <FormMessage />
                        </FormItem>} />
                        <div className="grid grid-cols-2 gap-3">
                            {input('start', '시작 시각')}{input('end', '종료 시각')}{input('duration', '추천 수업 길이(분)')}
                        </div>
                        {!whole ? <Button type="button" variant="outline" onClick={recommend}>빈 시간 추천</Button> : null}
                        {suggestions ? <div className="flex flex-wrap gap-2" role="status">
                            {suggestions.length ? suggestions.map((s, i) =>
                                <Button type="button" variant="outline" key={i} onClick={() => void form.handleSubmit(v => save(v, s))()}>
                                    {PLAN_DAYS[s.weekday]} {formatPlanTime(s.startMinute)}–{formatPlanTime(s.startMinute + Number(form.getValues('duration')))}
                                </Button>
                            ) : <p className="text-sm text-muted-foreground">조건에 맞는 빈 시간이 없습니다. 요일·시작/종료 시각·수업 길이를 변경해 주세요.</p>}
                        </div> : null}
                    </fieldset>
                    {draft.item.pendingSlots.length ? <div className="space-y-1 text-sm text-muted-foreground">
                        {draft.item.pendingSlots.map(p => <p key={p.id}>
                            {formatPendingSlot(p, snapshot.catalogs)} · {p.reason === 'conflict' ? '시간 충돌' : p.reason === 'missing_resource' ? '자원 미정' : '시각 확인 필요'}
                        </p>)}
                    </div> : null}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    {failureKind ? <div className="space-y-2 text-sm" role="status">
                        <p>{failureKind === 'uncertain' ? '저장 응답을 확인하지 못했습니다. 원래 요청을 재시도한 뒤 수정 내용을 저장해 주세요.'
                            : failureKind === 'rejected' ? '서버에서 저장을 거부했습니다. 입력을 고친 뒤 수정 저장하거나 실패한 요청을 버릴 수 있습니다.'
                            : `다른 편집 내용이 있습니다. 최신 내용: ${serverSummary}`}</p>
                        {failureKind === 'uncertain' ? <Button type="button" variant="outline" disabled={busy} onClick={() => void retryOriginal()}>원래 요청 재시도</Button>
                            : failureKind === 'rejected' ? <Button type="button" variant="outline" disabled={busy} onClick={() => void runRecovery(onDiscard)}>실패한 요청 버리기</Button>
                            : <Button type="button" variant="outline" disabled={busy} onClick={() => void acceptServer()}>최신 내용 사용</Button>}
                    </div> : null}
                    <DialogFooter>
                        {slot ? <Button type="button" variant="outline" disabled={!canEdit || busy} onClick={() => void unplace()}>이 배치 해제</Button> : null}
                        <Button type="button" variant="outline" disabled={busy} onClick={() => onClose()}>닫기</Button>
                        <Button disabled={!canEdit || busy || failureKind === 'uncertain' || failureKind === 'stale'}>
                            {busy ? '저장 중…' : failureKind === 'rejected' ? '수정 저장' : '저장'}
                        </Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
    </Dialog>;
}
