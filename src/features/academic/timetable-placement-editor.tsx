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
import type { DropTarget, PlanItemDraft, PlanSlot, PlanSnapshot, ResourceOption } from './timetable-plan-contract';
import type { TimetableItemEdit } from './timetable-plan-model';
import { assertInterval } from './timetable-plan-model';
import { suggestPlacements } from './timetable-conflicts';
import { PLAN_DAYS, PLAN_DAY_ORDER, formatPlanTime, parsePlanTime, planErrorLabel, itemDraft } from './timetable-plan-interaction';
export type PlacementEditorDraft = {
    item: PlanItemDraft;
    slots: PlanSlot[];
    slotId?: string;
    target?: DropTarget;
    endMinute?: number;
    revision?: number | null;
};
type Values = {
    name: string;
    subject: string;
    grade: string;
    teacher: string;
    room: string;
    duration: string;
    start: string;
    end: string;
    weekdays: number[];
    capacity: string;
    tuition: string;
};
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
    const initial = draft.target;
    const form = useForm<Values>({ defaultValues: { name: draft.item.name, subject: draft.item.subject, grade: draft.item.grade, teacher: initial?.teacherId || slot?.teacherId || draft.item.defaultTeacherId || '', room: initial?.classroomId || slot?.classroomId || draft.item.defaultClassroomId || '', duration: String(draft.item.durationMinutes || 60), start: formatPlanTime(initial?.startMinute ?? slot?.startMinute ?? 540), end: formatPlanTime(draft.endMinute ?? (initial ? Math.min(1440, initial.startMinute + (draft.item.durationMinutes || 60)) : slot?.endMinute ?? 600)), weekdays: initial ? [initial.weekday] : slot ? [slot.weekday] : [], capacity: draft.item.capacity === null ? '' : String(draft.item.capacity), tuition: draft.item.tuition === null ? '' : String(draft.item.tuition) } });
    const submittedValues = useRef<string | null>(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [suggestions, setSuggestions] = useState<DropTarget[] | null>(null);
    useEffect(() => { onDirty(form.formState.isDirty); }, [form.formState.isDirty, onDirty]);
    const build = (values: Values, candidate?: DropTarget): TimetableItemEdit => {
        const duration = Number(values.duration);
        if (!Number.isInteger(duration) || duration <= 0 || duration > 1440)
            throw Error('수업 길이는 1–1440분으로 입력해 주세요.');
        if (!values.name.trim() || !values.subject.trim())
            throw Error('수업명과 과목을 입력해 주세요.');
        for (const value of [values.capacity, values.tuition])
            if (value && (!Number.isFinite(Number(value)) || Number(value) < 0))
                throw Error('정원과 수업료는 0 이상의 수로 입력해 주세요.');
        const item = { ...itemDraft(draft.item), name: values.name.trim(), subject: values.subject.trim(), grade: values.grade, defaultTeacherId: values.teacher || null, defaultClassroomId: values.room || null, durationMinutes: duration, capacity: values.capacity ? Number(values.capacity) : null, tuition: values.tuition ? Number(values.tuition) : null };
        const weekdays = candidate ? [candidate.weekday] : values.weekdays;
        let slots = draft.slots;
        if (weekdays.length) {
            if (!values.teacher || !values.room)
                throw Error('배치하려면 선생님과 강의실을 선택해 주세요.');
            const startMinute = candidate?.startMinute ?? parsePlanTime(values.start);
            const endMinute = candidate ? startMinute + duration : parsePlanTime(values.end, true);
            assertInterval(startMinute, endMinute);
            slots = [...slots.filter(s => s.id !== draft.slotId), ...weekdays.map((weekday, index) => ({ id: index === 0 && slot ? slot.id : crypto.randomUUID(), itemId: item.id, planId: item.planId, weekday, startMinute, endMinute, teacherId: values.teacher, classroomId: values.room, sourceSlotId: index === 0 && slot ? slot.sourceSlotId : null }))];
        }
        return { operation: 'save', item, slots };
    };
    const save = async (values: Values, candidate?: DropTarget) => { if (!canEdit || busy)
        return; setBusy(true); setError(''); try {
        const edit = build(values, candidate);
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
    const input = (name: 'name' | 'subject' | 'grade' | 'duration' | 'start' | 'end' | 'capacity' | 'tuition', label: string, required = false) => <FormField control={form.control} name={name} rules={required ? { required: `${label}을 입력해 주세요.` } : undefined} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} required={required} maxLength={name === 'name' ? 200 : undefined} inputMode={['duration', 'capacity', 'tuition'].includes(name) ? 'numeric' : undefined} placeholder={name === 'start' ? '17:13' : name === 'end' ? '24:00' : undefined}/></FormControl><FormMessage /></FormItem>}/>;
    const resource = (name: 'teacher' | 'room', label: string, options: ResourceOption[]) => <FormField control={form.control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><Select value={field.value || 'none'} onValueChange={v => field.onChange(v === 'none' ? '' : v)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="none">미정</SelectItem>{options.map(o => <SelectItem value={o.id} key={o.id} disabled={!o.isVisible || o.isMissing}>{o.name}{!o.isVisible || o.isMissing ? ' (사용 불가)' : ''}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>}/>;
    return <Dialog open onOpenChange={open => { if (!open && !busy)
        onClose(); }}><DialogContent restoreFocusToOpener className="sm:max-w-xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{slot ? '배치 편집' : snapshot.items.some(i => i.id === draft.item.id) ? '수업 편집' : '수업 추가'}</DialogTitle><DialogDescription>{slot ? '선택한 배치만 변경합니다. 다른 요일의 배치는 유지됩니다.' : '요일을 선택하지 않으면 미배치 수업으로 저장합니다.'}</DialogDescription></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(v => save(v))} className="space-y-4"><fieldset disabled={!canEdit || busy} className="space-y-4">{input('name', '수업명', true)}<div className="grid grid-cols-2 gap-3">{input('subject', '과목', true)}{input('grade', '학년')}{resource('teacher', '선생님', snapshot.catalogs.teachers)}{resource('room', '강의실', snapshot.catalogs.classrooms)}{input('capacity', '정원')}{input('tuition', '수업료')}</div><FormField control={form.control} name="weekdays" render={({ field }) => <FormItem><FormLabel>배치 요일</FormLabel><div className="flex flex-wrap gap-3">{PLAN_DAY_ORDER.map(i => <Label key={i} className="flex min-h-11 items-center gap-2"><Checkbox checked={field.value.includes(i)} onCheckedChange={checked => field.onChange(checked ? [...field.value, i] : field.value.filter(d => d !== i))}/>{PLAN_DAYS[i]}</Label>)}</div><FormMessage /></FormItem>}/><div className="grid grid-cols-2 gap-3">{input('start', '시작 시각')}{input('end', '종료 시각')}{input('duration', '추천 수업 길이(분)')}</div><Button type="button" variant="outline" onClick={recommend}>빈 시간 추천</Button>{suggestions ? <div className="flex flex-wrap gap-2" role="status">{suggestions.length ? suggestions.map((s, i) => <Button type="button" variant="outline" key={i} onClick={() => void form.handleSubmit(v => save(v, s))()}>{PLAN_DAYS[s.weekday]} {formatPlanTime(s.startMinute)}–{formatPlanTime(s.startMinute + Number(form.getValues('duration')))}</Button>) : <p className="text-sm text-muted-foreground">조건에 맞는 빈 시간이 없습니다. 요일·시작/종료 시각·수업 길이를 변경해 주세요.</p>}</div> : null}</fieldset>{draft.item.pendingSlots.length ? <div className="space-y-1 text-sm text-muted-foreground">{draft.item.pendingSlots.map(p => <p key={p.id}>{p.sourceText} · {p.reason === 'conflict' ? '시간 충돌' : p.reason === 'missing_resource' ? '자원 미정' : '시각 확인 필요'}</p>)}</div> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}{failureKind ? <div className="space-y-2 text-sm" role="status"><p>{failureKind === 'uncertain' ? '저장 응답을 확인하지 못했습니다. 원래 요청을 재시도한 뒤 수정 내용을 저장해 주세요.' : failureKind === 'rejected' ? '서버에서 저장을 거부했습니다. 입력을 고친 뒤 수정 저장하거나 실패한 요청을 버릴 수 있습니다.' : `다른 편집 내용이 있습니다. 최신 내용: ${serverSummary}`}</p>{failureKind === 'uncertain' ? <Button type="button" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try {
        await onRetry();
        setError('');
        if (submittedValues.current === JSON.stringify(form.getValues())) {
            form.reset(form.getValues());
            onDirty(false);
            onClose(true);
        }
    }
    catch (e) {
        setError(planErrorLabel(e));
    }
    finally {
        setBusy(false);
    } }}>원래 요청 재시도</Button> : failureKind === 'rejected' ? <Button type="button" variant="outline" disabled={busy} onClick={async () => { try {
        await onDiscard();
        setError('');
    }
    catch (e) {
        setError(planErrorLabel(e));
    } }}>실패한 요청 버리기</Button> : <Button type="button" variant="outline" disabled={busy} onClick={async () => { try {
        await onAcceptServer();
        onDirty(false);
        onClose(true);
    }
    catch (e) {
        setError(planErrorLabel(e));
    } }}>최신 내용 사용</Button>}</div> : null}<DialogFooter>{slot ? <Button type="button" variant="outline" disabled={!canEdit || busy} onClick={async () => { setBusy(true); try {
        await onSave({ operation: 'save', item: itemDraft(draft.item), slots: draft.slots.filter(s => s.id !== slot.id) });
        onDirty(false);
        onClose(true);
    }
    catch (e) {
        setError(planErrorLabel(e));
    }
    finally {
        setBusy(false);
    } }}>이 배치 해제</Button> : null}<Button type="button" variant="outline" disabled={busy} onClick={() => onClose()}>닫기</Button><Button disabled={!canEdit || busy || failureKind === 'uncertain' || failureKind === 'stale'}>{busy ? '저장 중…' : failureKind === 'rejected' ? '수정 저장' : '저장'}</Button></DialogFooter></form></Form></DialogContent></Dialog>;
}
