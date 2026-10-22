'use client';
import { planPlacements } from './timetable-plan-placements.ts';
import { TIMETABLE_SUBJECTS, timetableTeachers } from './timetable-subjects';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {ClassAmountInput, ClassInformationFields, ClassScheduleRows} from '@/components/classes/class-form-fields';
import type {ClassScheduleFormRow} from '@/components/classes/class-form-model';
import {placementClassFormDefaults, buildPlacementRowsEdit} from './timetable-class-form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { TimetablePlanService } from './timetable-plan-service';
import type { DropTarget, PlanSnapshot, ResourceOption, ScienceSubjectArea } from './timetable-plan-contract';
import type { TimetableItemEdit } from './timetable-plan-model';
import { suggestPlacements } from './timetable-conflicts';
import { PLAN_DAYS, formatPendingSlot, formatPlanTime, parsePlanTime, planErrorLabel, itemDraft, placementScope, type PlacementEditorDraft, type PlacementFormValues } from './timetable-plan-interaction';
export type { PlacementEditorDraft } from './timetable-plan-interaction';
type Values = PlacementFormValues & {scheduleRows: ClassScheduleFormRow[]};
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
    const [initialValues] = useState(() => placementClassFormDefaults(draft));
    const form = useForm<Values>({ defaultValues: initialValues });
    const scheduleRows = form.watch('scheduleRows') ?? [];
    const setRows = (rows: ClassScheduleFormRow[]) => {form.setValue('scheduleRows',rows,{shouldDirty:true});setSuggestions(null);};
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
        const candidateRows = candidate ? [{key:values.scheduleRows?.[0]?.key || crypto.randomUUID(),day:PLAN_DAYS[candidate.weekday],startTime:formatPlanTime(candidate.startMinute),endTime:formatPlanTime(candidate.startMinute + Number(values.duration)),teacher:values.scheduleRows?.[0] ? values.scheduleRows[0].teacher : values.teacher,classroom:values.scheduleRows?.[0] ? values.scheduleRows[0].classroom : values.room}] : values.scheduleRows;
        const edit = buildPlacementRowsEdit(draft,values,candidateRows,{isNewItem:!snapshot.items.some(item=>item.id===draft.item.id)});
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
        const row = v.scheduleRows?.[0];
        const fromMinute = parsePlanTime(row?.startTime || v.start), toMinute = parsePlanTime(row?.endTime || v.end, true);
        setSuggestions(suggestPlacements({ slots: planPlacements(snapshot).filter(s => s.id !== draft.slotId), shadows: [], itemId: draft.item.id, planId: draft.item.planId, teacherId: row ? row.teacher : v.teacher, classroomId: row ? row.classroom : v.room, durationMinutes: Number(v.duration), weekdays: row?.day ? [PLAN_DAYS.indexOf(row.day)] : v.weekdays.length ? v.weekdays : [1, 2, 3, 4, 5], fromMinute, toMinute }));
        setError('');
    }
    catch (e) {
        setError(planErrorLabel(e));
        setSuggestions(null);
    } };
    const input = (name: 'name' | 'subject' | 'grade' | 'duration' | 'start' | 'end' | 'capacity' | 'tuition', label: string, required = false) => <FormField control={form.control} name={name} rules={required ? { required: `${label}을 입력해 주세요.` } : undefined} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl>{name === 'tuition' ? <ClassAmountInput {...field} /> : <Input {...field} disabled={whole && ['start', 'end'].includes(name) && !form.watch('applyTime')} required={required} maxLength={name === 'name' ? 200 : undefined} inputMode={['duration', 'capacity', 'tuition'].includes(name) ? 'numeric' : undefined} placeholder={name === 'start' ? '17:13' : name === 'end' ? '24:00' : undefined}/>}</FormControl><FormMessage /></FormItem>}/>;
    const resource = (name: 'teacher' | 'room', label: string, options: ResourceOption[]) => <FormField control={form.control} name={name} render={({ field }) => {
        const selected=field.value;
        const catalog=name==='teacher'?snapshot.catalogs.teachers:snapshot.catalogs.classrooms;
        const shown=selected&&!options.some(option=>option.id===selected)?[...options,{id:selected,name:catalog.find(option=>option.id===selected)?.name||`기존 ${label}`,isVisible:false,isMissing:true}]:options;
        return <FormItem><FormLabel>{label}</FormLabel><Select value={selected || 'none'} onValueChange={v => field.onChange(v === 'none' ? '' : v)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="none">미정</SelectItem>{shown.map(o => <SelectItem value={o.id} key={o.id} disabled={!o.isVisible || o.isMissing}>{o.name}{!o.isVisible || o.isMissing ? ' (사용 불가)' : ''}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>;
    }}/>;
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
        : whole ? '요일별 시간과 담당·강의실을 편집합니다.'
        : localDraft ? '요일을 선택하지 않으면 미배치 수업으로 적용합니다.' : '요일을 선택하지 않으면 미배치 수업으로 저장합니다.';
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
        <DialogContent restoreFocusToOpener className="sm:max-w-5xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(v => save(v))} className="space-y-4">
                    <fieldset disabled={!canEdit || busy} className="space-y-4">
                        <ClassInformationFields fields={[
                            {name:'name',content:input('name','수업명',true)},
                            {name:'grade',content:input('grade','학년')},
                            {name:'subject',content:<FormField control={form.control} name="subject" render={({field})=><FormItem><FormLabel>과목</FormLabel><Select value={field.value} onValueChange={value=>{field.onChange(value);setSuggestions(null);}}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{TIMETABLE_SUBJECTS.map(value=><SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>}/>},
                            ...(science ? [{name:'subjectAreaKey',content:<FormField control={form.control} name="subjectAreaKey" render={({field})=><FormItem><FormLabel>과학 영역</FormLabel><Select value={field.value||'none'} onValueChange={value=>field.onChange(value==='none'?'':value)}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="none">미정</SelectItem>{field.value&&!areas.some(area=>area.key===field.value)?<SelectItem value={field.value} disabled>사용 불가</SelectItem>:null}{areas.map(area=><SelectItem key={area.key} value={area.key}>{area.label}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>}/>}]:[]),
                            {name:'capacity',content:input('capacity','정원')},
                            {name:'tuition',content:input('tuition','수업료')},
                        ]}/>
                        {science&&areaError?<p role="alert" className="text-sm text-destructive">{areaError}</p>:null}
                        {scope==='item'&&scheduleRows.length===0?<div className="grid gap-3 sm:grid-cols-2">{resource('teacher','기본 선생님',timetableTeachers(snapshot.catalogs.teachers,form.watch('subject')))}{resource('room','기본 강의실',snapshot.catalogs.classrooms)}</div>:null}
                        <section className="space-y-3 rounded-md border p-3"><h3 className="text-sm font-semibold">시간표</h3>
                        <ClassScheduleRows rows={scheduleRows} disabled={!canEdit||busy}
                            teacherOptions={index=>{
                                const selected=scheduleRows[index].teacher;
                                const options=timetableTeachers(snapshot.catalogs.teachers,form.watch('subject')).map(option=>({value:option.id,label:option.name,disabled:!option.isVisible||option.isMissing}));
                                if(selected&&!options.some(option=>option.value===selected)){const original=draft.slots.find(slot=>slot.id===scheduleRows[index].key);options.push({value:selected,label:original?.teacherName||snapshot.catalogs.teachers.find(option=>option.id===selected)?.name||'기존 선생님',disabled:true});}
                                return options;
                            }}
                            classroomOptions={index=>{
                                const selected=scheduleRows[index].classroom;
                                const options=snapshot.catalogs.classrooms.map(option=>({value:option.id,label:option.name,disabled:!option.isVisible||option.isMissing}));
                                if(selected&&!options.some(option=>option.value===selected)){const original=draft.slots.find(slot=>slot.id===scheduleRows[index].key);options.push({value:selected,label:original?.classroomName||'기존 강의실',disabled:true});}
                                return options;
                            }}
                            onChange={(index,patch)=>setRows(scheduleRows.map((row,i)=>i===index?{...row,...patch}:row))}
                            onRemove={index=>setRows(scheduleRows.filter((_,i)=>i!==index))}
                            onAdd={()=>{const last=scheduleRows[scheduleRows.length-1];setRows([...scheduleRows,{key:crypto.randomUUID(),day:'',startTime:last?.startTime||form.getValues('start'),endTime:last?.endTime||form.getValues('end'),teacher:last?.teacher||form.getValues('teacher'),classroom:last?.classroom||form.getValues('room')}]);}}
                        /></section>
                        {input('duration','추천 수업 길이(분)')}
                        {!whole && scheduleRows.length <= 1 ? <Button type="button" variant="outline" onClick={recommend}>빈 시간 추천</Button> : null}
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
