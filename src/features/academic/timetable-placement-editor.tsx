'use client';
import { TIMETABLE_SUBJECTS, timetableTeacherMatchesSubject } from './timetable-subjects';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { TimetablePlanService } from './timetable-plan-service';
import type { DropTarget, PlanSnapshot, ScienceSubjectArea } from './timetable-plan-contract';
import type { TimetableItemEdit } from './timetable-plan-model';
import { suggestPlacements } from './timetable-conflicts';
import { presetSlots } from './timetable-plan-placements';
import { PLAN_DAYS, PLAN_DAY_ORDER, formatPendingSlot, formatPlanTime, parsePlanTime, planErrorLabel, itemDraft, buildPlacementRowsEdit, placementRowsDefaults, placementScope, type PlacementEditorDraft, type PlacementRowsFormValues } from './timetable-plan-interaction';
export type { PlacementEditorDraft } from './timetable-plan-interaction';
import { ClassMetadataFields, ClassScheduleFields } from '@/components/class-form-fields';
import type { ClassFieldOption } from '@/components/class-form-model';
import { ACADEMIC_SUBJECTS } from '@/lib/academic-subject-registry';
type Values = PlacementRowsFormValues;
export function TimetablePlacementEditor({ draft, snapshot, onSave, onClose, onDirty, canEdit, failureKind, onRetry, onDiscard, onAcceptServer, serverSummary, loadScienceSubjectAreas, localDraft = false }: {
    localDraft?: boolean;
    loadScienceSubjectAreas?: TimetablePlanService['listScienceSubjectAreas'];
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
    const form = useForm<Values>({ defaultValues: placementRowsDefaults(draft) });
    const submittedValues = useRef<string | null>(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [suggestions, setSuggestions] = useState<DropTarget[] | null>(null);
    const science = form.watch('subject').trim() === '과학';
    const [areas, setAreas] = useState<ScienceSubjectArea[]>([]), [areaError, setAreaError] = useState('');
    useEffect(() => {
        if (!science || !loadScienceSubjectAreas) return;
        const abort = new AbortController();
        void loadScienceSubjectAreas({ signal: abort.signal }).then(rows => {
            if (!abort.signal.aborted) { setAreas(rows); setAreaError(''); }
        }).catch(() => { if (!abort.signal.aborted) setAreaError('과학 영역을 불러오지 못했습니다. 창을 다시 열어 확인해 주세요.'); });
        return () => abort.abort();
    }, [science, loadScienceSubjectAreas]);
    useEffect(() => { onDirty(form.formState.isDirty); }, [form.formState.isDirty, onDirty]);
    const save = async (values: Values, candidate?: DropTarget) => { if (!canEdit || busy)
        return; setBusy(true); setError(''); try {
        const submitted = candidate ? { ...values, rows: values.rows.map((row, index) => index === 0 ? { ...row, day: PLAN_DAYS[candidate.weekday], start: formatPlanTime(candidate.startMinute), end: formatPlanTime(candidate.startMinute + Number(values.duration)) } : row) } : values;
        const edit = buildPlacementRowsEdit(draft, submitted);
        submittedValues.current = JSON.stringify(values);
        await onSave(edit);
        if (JSON.stringify(form.getValues()) === submittedValues.current) {
            form.reset(values); onDirty(false); onClose(true);
        }
    }
    catch (e) {
        setError(planErrorLabel(e));
    }
    finally {
        setBusy(false);
    } };
    const recommend = () => { try {
        const v = form.getValues();
        const row = v.rows[0];
        if (!row) throw Error("추천할 시간표 행을 추가해 주세요.");
        const fromMinute = parsePlanTime(row.start), toMinute = parsePlanTime(row.end, true);
        setSuggestions(suggestPlacements({ slots: presetSlots(snapshot).filter(s => s.id !== draft.slotId), shadows: [], itemId: draft.item.id, planId: draft.item.planId, teacherId: row.teacher, classroomId: row.room, durationMinutes: Number(v.duration), weekdays: row.day ? PLAN_DAY_ORDER.filter(day => PLAN_DAYS[day] === row.day) : [1, 2, 3, 4, 5], fromMinute, toMinute }));
        setError('');
    }
    catch (e) {
        setError(planErrorLabel(e));
        setSuggestions(null);
    } };
    const rows = form.watch('rows');
    const subject = form.watch('subject');
    const nameField = form.register('name', { required: '수업명을 입력해 주세요.' });
    const resourceOptions = (kind: 'teacher' | 'room'): ClassFieldOption[] => {
        const catalog = kind === 'teacher' ? snapshot.catalogs.teachers : snapshot.catalogs.classrooms;
        const options = catalog.map(option => ({ value: option.id, label: option.name,
            disabled: !option.isVisible || option.isMissing || (kind === 'teacher' && !timetableTeacherMatchesSubject(option, subject)) }));
        for (const row of rows) if (row[kind] && !options.some(option => option.value === row[kind])) {
            const saved = draft.slots.find(slot => slot.id === row.key);
            options.push({ value: row[kind], label: (kind === 'teacher' ? saved?.teacherName : saved?.classroomName) || '정보 확인 필요', disabled: true });
        }
        return options;
    };
    const changeRows = (next: Values['rows']) => { form.setValue('rows', next, { shouldDirty: true }); setSuggestions(null); };
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
        : whole ? '각 시간표 행의 요일·시각·선생님·강의실을 편집합니다.'
        : localDraft ? '요일을 선택하지 않으면 미배치 수업으로 적용합니다.' : '요일을 선택하지 않으면 미배치 수업으로 저장합니다.';
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
        <DialogContent restoreFocusToOpener className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(v => save(v))} className="space-y-4">
                    <fieldset disabled={!canEdit || busy} className="space-y-4">
                        <ClassMetadataFields idPrefix="preset-class" autoFocus nameInputRef={nameField.ref} onNameBlur={nameField.onBlur}
                            values={{ name: form.watch('name'), status: '개강 준비', grade: form.watch('grade'), subject,
                                capacity: form.watch('capacity'), tuition: form.watch('tuition'), subjectAreaKey: form.watch('subjectAreaKey') }}
                            statuses={[{ value: '개강 준비', label: '개강 준비' }]} statusDisabled
                            subjects={TIMETABLE_SUBJECTS.map(value => ({ value, label: value }))}
                            grades={[...(ACADEMIC_SUBJECTS.find(option => option.value === subject)?.grades || ACADEMIC_SUBJECTS[0].grades)]}
                            capacities={snapshot.items.flatMap(item => item.capacity === null ? [] : [String(item.capacity)])}
                            tuitions={snapshot.items.flatMap(item => item.tuition === null ? [] : [String(item.tuition)])}
                            areas={areas.map(area => ({ value: area.key, label: area.label }))}
                            errors={{ name: form.formState.errors.name?.message }}
                            disabled={!canEdit || busy}
                            onChange={(field, value) => {
                                if (field === 'status') return;
                                form.setValue(field, value, { shouldDirty: true, shouldValidate: true });
                                if (field === 'subject') {
                                    changeRows(form.getValues('rows').map(row => {
                                        const teacher = snapshot.catalogs.teachers.find(option => option.id === row.teacher);
                                        return teacher && !timetableTeacherMatchesSubject(teacher, value) ? { ...row, teacher: '' } : row;
                                    }));
                                    if (value !== '과학') form.setValue('subjectAreaKey', '', { shouldDirty: true });
                                }
                            }} />
                        {science && areaError ? <p role="alert" className="text-sm text-destructive">{areaError}</p> : null}
                        <ClassScheduleFields rows={rows} teachers={resourceOptions('teacher')} rooms={resourceOptions('room')}
                            disabled={!canEdit || busy}
                            onChange={(index, patch) => changeRows(rows.map((row, position) => position === index ? { ...row, ...patch } : row))}
                            onRemove={index => changeRows(rows.filter((_, position) => position !== index))}
                            onAdd={() => changeRows([...rows, { key: crypto.randomUUID(), day: '', start: rows[rows.length - 1]?.start || '09:00', end: rows[rows.length - 1]?.end || '10:00', teacher: rows[rows.length - 1]?.teacher || form.getValues('teacher'), room: rows[rows.length - 1]?.room || form.getValues('room') }])} />
                        {!whole && rows.length === 1 ? <div className="flex flex-wrap items-end gap-3">
                            <FormField control={form.control} name="duration" render={({ field }) => <FormItem><FormLabel>추천 수업 길이(분)</FormLabel><FormControl><Input {...field} inputMode="numeric" /></FormControl><FormMessage /></FormItem>} />
                            <Button type="button" variant="outline" onClick={recommend}>빈 시간 추천</Button>
                        </div> : null}
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
                            {busy ? localDraft ? '적용 중…' : '저장 중…' : localDraft ? '적용' : failureKind === 'rejected' ? '수정 저장' : '저장'}
                        </Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
    </Dialog>;
}
