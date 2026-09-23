import type { DropTarget, GridTarget, PendingSlot, PlanItemDraft, PlanSnapshot, PlanSlot, ShadowSlot, TimetableView } from './timetable-plan-contract.ts';
import { assertInterval, moveSlot, type TimetableItemEdit } from './timetable-plan-model.ts';
import { findConflicts, findOperatingConflicts } from './timetable-conflicts.ts';
import { projectTimetableSlot, resolveGridTarget, resolveMovedGridTarget } from './timetable-placement-adapter.ts';
export const PLAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const PLAN_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const PLAN_VIEWS: {
    id: TimetableView;
    label: string;
}[] = [{ id: 'teacher-weekly', label: '선생님 주간' }, { id: 'classroom-weekly', label: '강의실 주간' }, { id: 'daily-teacher', label: '일별 선생님' }, { id: 'daily-classroom', label: '일별 강의실' }];
export function formatPlanTime(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
/** Stored originals may include canonical JSON; presentation never exposes IDs. */
export function formatPendingSlot(pending: PendingSlot, catalogs: PlanSnapshot['catalogs']) {
    let source: Record<string, unknown> | null = null;
    try { const value: unknown = JSON.parse(pending.sourceText); if (value && typeof value === 'object' && !Array.isArray(value)) source = value as Record<string, unknown>; } catch { /* Human-entered original text. */ }
    if (pending.weekday === null && pending.startMinute === null && pending.endMinute === null)
        return source ? '원본 배치 확인 필요' : pending.sourceText;
    const teacher = catalogs.teachers.find(row => row.id === pending.teacherId)?.name
        ?? (typeof source?.teacherName === 'string' ? source.teacherName : '선생님 미정');
    const room = catalogs.classrooms.find(row => row.id === pending.classroomId)?.name
        ?? (typeof source?.classroomName === 'string' ? source.classroomName : '강의실 미정');
    return `${pending.weekday === null ? '요일 미정' : PLAN_DAYS[pending.weekday]} ${pending.startMinute === null ? '시작 미정' : formatPlanTime(pending.startMinute)}–${pending.endMinute === null ? '종료 미정' : formatPlanTime(pending.endMinute)} · ${teacher} · ${room}`;
}
export function parsePlanTime(value: string, allowMidnight = false) {
    if (!/^\d{2}:\d{2}$/.test(value))
        throw Error('시각을 17:13 형식으로 입력해 주세요.');
    const [h, m] = value.split(':').map(Number);
    const minute = h * 60 + m;
    if (m > 59 || h > 24 || minute > (allowMidnight ? 1440 : 1439))
        throw Error('시작은 00:00–23:59, 종료는 24:00까지 입력해 주세요.');
    return minute;
}
export function itemDraft(item: PlanItemDraft): PlanItemDraft {
    const { id, planId, name, subject, subjectAreaKey, grade, capacity, tuition, defaultTeacherId, defaultClassroomId, durationMinutes, pendingSlots } = item;
    return { id, planId, name, subject, subjectAreaKey, grade, capacity, tuition, defaultTeacherId, defaultClassroomId, durationMinutes, pendingSlots };
}
export function blankPlanItem(planId: string, id = crypto.randomUUID()): PlanItemDraft { return { id, planId, name: '', subject: '영어', subjectAreaKey: null, grade: '', capacity: null, tuition: null, defaultTeacherId: null, defaultClassroomId: null, durationMinutes: 60, pendingSlots: [] }; }
export type PlacementIntent = {
    kind: 'move';
    slotId: string;
    origin: GridTarget;
    target: GridTarget;
} | {
    kind: 'resize';
    slotId: string;
    endMinute: number;
} | {
    kind: 'unplace';
    slotId: string;
} | {
    kind: 'drop';
    itemId: string;
    slotId: string;
    target: GridTarget;
};
export function placementEdit(snapshot: PlanSnapshot, intent: PlacementIntent): TimetableItemEdit {
    const slot = intent.kind === 'drop' ? undefined : snapshot.slots.find(s => s.id === intent.slotId);
    if (intent.kind !== 'drop' && !slot)
        throw Error('기존 수업은 편집할 수 없습니다.');
    const item = snapshot.items.find(i => i.id === (intent.kind === 'drop' ? intent.itemId : slot!.itemId));
    if (!item || item.state !== 'draft')
        throw Error('편집할 수업을 선택해 주세요.');
    let slots = snapshot.slots.filter(s => s.itemId === item.id);
    if (intent.kind === 'unplace')
        slots = slots.filter(s => s.id !== intent.slotId);
    if (intent.kind === 'move')
        slots = slots.map(s => s.id === slot!.id ? moveSlot(s, resolveMovedGridTarget(s, intent.origin, intent.target)) : s);
    if (intent.kind === 'resize') {
        assertInterval(slot!.startMinute, intent.endMinute);
        slots = slots.map(s => s.id === slot!.id ? { ...s, endMinute: intent.endMinute } : s);
    }
    if (intent.kind === 'drop') {
        const target = resolveGridTarget(intent.target);
        const teacherId = target.teacherId || item.defaultTeacherId, classroomId = target.classroomId || item.defaultClassroomId;
        if (!teacherId || !classroomId || !item.durationMinutes)
            throw Error('선생님·강의실·수업 길이를 입력해 주세요.');
        const endMinute = target.startMinute + item.durationMinutes;
        assertInterval(target.startMinute, endMinute);
        slots = [...slots, { id: intent.slotId, itemId: item.id, planId: item.planId, weekday: target.weekday, startMinute: target.startMinute, endMinute, teacherId, classroomId, sourceSlotId: null }];
    }
    return { operation: 'save', item: itemDraft(item), slots };
}
export type PlanGridBlock = {
    id: string;
    itemId: string;
    shadow: boolean;
    title: string;
    subject: string;
    teacher: string;
    classroom: string;
    columnKey: string;
    startMinute: number;
    endMinute: number;
    slot: PlanSlot | ShadowSlot;
};
export function buildPlanPanels(snapshot: PlanSnapshot, view: TimetableView, subject = '', selectedTargets: string[] = []) {
    const weekly = view.endsWith('weekly'), teacher = view.includes('teacher');
    const resources = teacher ? snapshot.catalogs.teachers : snapshot.catalogs.classrooms;
    if (!resources.length) return [];
    const options = resources.map(r => ({ id: r.id, name: `${r.name}${!r.isVisible || r.isMissing ? ' (사용 불가)' : ''}` }));
    const days = PLAN_DAY_ORDER.map(i => ({ id: String(i), name: PLAN_DAYS[i] }));
    const panels = (weekly ? options : days).filter(p => !selectedTargets.length || selectedTargets.includes(p.id));
    const columns = weekly ? days : options;
    const all: PlanGridBlock[] = [...snapshot.slots, ...snapshot.shadowSlots].flatMap(slot => {
        const shadow = 'classId' in slot;
        const item = shadow ? snapshot.shadowClasses.find(i => i.id === slot.classId) : snapshot.items.find(i => i.id === slot.itemId);
        if (!item || (subject && item.subject !== subject))
            return [];
        const projected = projectTimetableSlot(slot, view);
        return [{ ...projected, itemId: shadow ? slot.classId : slot.itemId, shadow, title: item.name, subject: item.subject || '', teacher: resourceLabel(snapshot.catalogs.teachers, slot.teacherId), classroom: resourceLabel(snapshot.catalogs.classrooms, slot.classroomId), slot }];
    });
    return panels.map(panel => ({ ...panel, columns, blocks: all.filter(b => projectTimetableSlot(b.slot, view).panelKey === panel.id) }));
}
/** Connected interval groups share a lane count; adjacency is not overlap. */
export function layoutOverlapLanes<T extends {
    id: string;
    startMinute: number;
    endMinute: number;
}>(blocks: T[]) {
    const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
    const result: (T & {
        lane: number;
        laneCount: number;
    })[] = [];
    let group: typeof result = [];
    let ends: number[] = [];
    let groupEnd = -1;
    const flush = () => { for (const b of group)
        b.laneCount = ends.length; result.push(...group); group = []; ends = []; };
    for (const b of sorted) {
        if (b.startMinute >= groupEnd)
            flush();
        let lane = ends.findIndex(end => end <= b.startMinute);
        if (lane < 0)
            lane = ends.length;
        ends[lane] = b.endMinute;
        groupEnd = Math.max(group.length ? groupEnd : 0, b.endMinute);
        group.push({ ...b, lane, laneCount: 1 });
    }
    flush();
    return result;
}
export type PointerSession = {
    slotId: string;
    origin: GridTarget;
    target: GridTarget;
};
export function createPointerSession(slotId: string, origin: GridTarget): PointerSession { return { slotId, origin, target: origin }; }
export function finishPointerSession(session: PointerSession, reason: string): PlacementIntent | null {
    if (reason !== 'pointerup')
        return null;
    const { origin, target } = session;
    const moved = origin.view !== target.view || origin.panelKey !== target.panelKey || origin.columnKey !== target.columnKey || Math.round((target.visibleStartMinute + target.rowPosition * target.slotMinutes - origin.visibleStartMinute - origin.rowPosition * origin.slotMinutes) / 5) !== 0;
    return moved ? { kind: 'move', ...session } : null;
}
export function planErrorLabel(error: unknown) {
    const text = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
    if (text.includes('stale'))
        return '다른 편집 내용이 있습니다. 최신 내용과 내 입력 중 하나를 선택해 주세요.';
    if (text.includes('conflict'))
        return '선생님 또는 강의실 시간이 겹칩니다. 다른 시간을 선택해 주세요.';
    if (text.includes('invalid') || error instanceof RangeError)
        return '요일·시각·과목에 맞는 선생님과 강의실을 확인해 주세요. 자정을 넘는 수업은 두 요일로 나누어 주세요.';
    if (text.includes('permission') || text.includes('access'))
        return '편집 권한을 확인할 수 없습니다. 다시 불러와 주세요.';
    return /^[가-힣]/.test(text) ? text : '저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.';
}
/** Check only changed occupancy against the complete canonical scope. Metadata repair remains possible. */
export function validatePlacementEdit(snapshot: PlanSnapshot, edit: TimetableItemEdit) {
    if (edit.operation !== 'save')
        return;
    const same = (a: PlanSlot, b: PlanSlot) => a.weekday === b.weekday && a.startMinute === b.startMinute && a.endMinute === b.endMinute && a.teacherId === b.teacherId && a.classroomId === b.classroomId;
    const changed = edit.slots.filter(slot => !snapshot.slots.some(old => old.id === slot.id && same(old, slot)));
    const all = [...snapshot.slots.filter(s => s.itemId !== edit.item.id), ...edit.slots];
    const conflicts = [...findConflicts(all, snapshot.shadowSlots), ...findOperatingConflicts(changed, snapshot, snapshot.plan.targetStartDate && snapshot.plan.targetEndDate ? { startDate: snapshot.plan.targetStartDate, endDate: snapshot.plan.targetEndDate } : null)].filter(c => changed.some(s => s.id === c.slotId || s.id === c.otherSlotId));
    if (conflicts.length) {
        const conflict = conflicts[0];
        const otherId = conflict.otherSlotId;
        const other = snapshot.shadowSlots.find(s => s.id === otherId);
        const planSlot = all.find(s => s.id === otherId);
        const name = other ? snapshot.shadowClasses.find(c => c.id === other.classId)?.name : snapshot.items.find(i => i.id === planSlot?.itemId)?.name;
        throw Error(`${conflict.date ? conflict.date + ' · ' : ''}${name || '다른 수업'}과 ${conflict.kind === 'teacher' ? '선생님' : conflict.kind === 'classroom' ? '강의실' : '수업'} 시간이 겹칩니다.`);
    }
}
function resourceLabel(options: PlanSnapshot['catalogs']['teachers'], id: string) { const row = options.find(r => r.id === id); return row ? `${row.name}${!row.isVisible || row.isMissing ? ' (사용 불가)' : ''}` : '사용 불가'; }


export type PlacementEditorDraft = {
    item: PlanItemDraft; slots: PlanSlot[]; scope?: 'item' | 'slot' | 'add';
    pendingResolutionId?: string; weekdays?: number[];
    slotId?: string; target?: DropTarget; startMinute?: number; endMinute?: number; revision?: number | null;
};
export function pendingPlacementDraft(item: PlanItemDraft, slots: PlanSlot[], pendingId: string): PlacementEditorDraft {
    const pending = item.pendingSlots.find(row => row.id === pendingId);
    if (!pending) throw Error('미배치 원안을 다시 확인해 주세요.');
    const target = pending.weekday !== null && pending.startMinute !== null ? {
        weekday: pending.weekday, startMinute: pending.startMinute,
        ...(pending.teacherId ? { teacherId: pending.teacherId } : {}),
        ...(pending.classroomId ? { classroomId: pending.classroomId } : {}),
    } : undefined;
    return { item: { ...itemDraft(item), defaultTeacherId: pending.teacherId ?? item.defaultTeacherId,
        defaultClassroomId: pending.classroomId ?? item.defaultClassroomId,
        durationMinutes: pending.startMinute !== null && pending.endMinute !== null && pending.endMinute > pending.startMinute
            ? pending.endMinute - pending.startMinute : item.durationMinutes },
        slots, scope: 'add', pendingResolutionId: pending.id, weekdays: pending.weekday === null ? [] : [pending.weekday], target, startMinute: pending.startMinute ?? undefined, endMinute: pending.endMinute ?? undefined };
}
export type PlacementFormValues = {
    name: string; subject: string; subjectAreaKey: string; grade: string; teacher: string; room: string;
    duration: string; start: string; end: string; weekdays: number[]; capacity: string; tuition: string;
    applyTeacher: boolean; applyRoom: boolean; applyTime: boolean; applyWeekdays: boolean;
};
export function placementScope(draft: PlacementEditorDraft) {
    return draft.scope ?? (draft.slotId ? 'slot' : draft.target ? 'add' : 'item');
}
export function placementFormDefaults(draft: PlacementEditorDraft): PlacementFormValues {
    const whole = placementScope(draft) === 'item';
    const slot = draft.slots.find(s => s.id === draft.slotId) ?? (whole ? draft.slots[0] : undefined);
    const initial = draft.target;
    const duration = draft.item.durationMinutes || 60;
    return {
        name: draft.item.name, subject: draft.item.subject, subjectAreaKey: draft.item.subjectAreaKey ?? '', grade: draft.item.grade,
        teacher: initial?.teacherId || (whole ? draft.item.defaultTeacherId : slot?.teacherId) || slot?.teacherId || draft.item.defaultTeacherId || '',
        room: initial?.classroomId || (whole ? draft.item.defaultClassroomId : slot?.classroomId) || slot?.classroomId || draft.item.defaultClassroomId || '',
        duration: String(duration), start: formatPlanTime(initial?.startMinute ?? draft.startMinute ?? slot?.startMinute ?? 540),
        end: formatPlanTime(draft.endMinute ?? (initial ? Math.min(1440, initial.startMinute + duration) : slot?.endMinute ?? 600)),
        weekdays: draft.weekdays ?? (initial ? [initial.weekday] : whole ? PLAN_DAY_ORDER.filter(day => draft.slots.some(s => s.weekday === day)) : slot ? [slot.weekday] : []),
        capacity: draft.item.capacity === null ? '' : String(draft.item.capacity), tuition: draft.item.tuition === null ? '' : String(draft.item.tuition),
        applyTeacher: false, applyRoom: false, applyTime: false, applyWeekdays: false,
    };
}
export function buildPlacementFormEdit(draft: PlacementEditorDraft, values: PlacementFormValues, candidate?: DropTarget): TimetableItemEdit {
    if (draft.pendingResolutionId && placementScope(draft) !== 'add') throw Error('미배치는 추가 배치로 편성해 주세요.');
    const duration = Number(values.duration);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) throw Error('수업 길이는 1–1440분으로 입력해 주세요.');
    if (!values.name.trim() || !values.subject.trim()) throw Error('수업명과 과목을 입력해 주세요.');
    for (const value of [values.capacity, values.tuition]) if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw Error('정원과 수업료는 0 이상의 수로 입력해 주세요.');
    const whole = placementScope(draft) === 'item' && draft.slots.length > 0;
    const item = { ...itemDraft(draft.item), name: values.name.trim(), subject: values.subject.trim(), subjectAreaKey: values.subject.trim() === '과학' ? values.subjectAreaKey?.trim() || null : null, grade: values.grade,
        defaultTeacherId: whole && !values.applyTeacher ? draft.item.defaultTeacherId : values.teacher || null,
        defaultClassroomId: whole && !values.applyRoom ? draft.item.defaultClassroomId : values.room || null,
        durationMinutes: duration, capacity: values.capacity ? Number(values.capacity) : null, tuition: values.tuition ? Number(values.tuition) : null };
    let slots = draft.slots.map(s => ({ ...s }));
    if (whole) {
        if (values.applyWeekdays) {
            const desired = PLAN_DAY_ORDER.filter(day => values.weekdays.includes(day));
            const oldDays = PLAN_DAY_ORDER.filter(day => slots.some(s => s.weekday === day));
            const removed = oldDays.filter(day => !desired.includes(day));
            const added = desired.filter(day => !oldDays.includes(day));
            // Remap whole weekday groups, retaining each slot's own time/resources and stable identity.
            const remapped = new Map(removed.map((day, index) => [day, added[index]]));
            slots = slots.flatMap(s => desired.includes(s.weekday) ? [s] : remapped.get(s.weekday) !== undefined ? [{ ...s, weekday: remapped.get(s.weekday)! }] : []);
            for (const day of added.slice(removed.length)) {
                const template = draft.slots.filter(s => s.weekday === oldDays[0]);
                slots.push(...template.map(s => ({ ...s, id: crypto.randomUUID(), sourceSlotId: null, weekday: day })));
            }
        }
        if (values.applyTeacher && slots.length && !values.teacher) throw Error('전체 배치의 선생님을 선택해 주세요.');
        if (values.applyRoom && slots.length && !values.room) throw Error('전체 배치의 강의실을 선택해 주세요.');
        const interval = values.applyTime ? { startMinute: parsePlanTime(values.start), endMinute: parsePlanTime(values.end, true) } : null;
        if (interval) assertInterval(interval.startMinute, interval.endMinute);
        slots = slots.map(s => ({ ...s, ...(values.applyTeacher ? { teacherId: values.teacher } : {}), ...(values.applyRoom ? { classroomId: values.room } : {}), ...interval }));
    } else {
        const weekdays = candidate ? [candidate.weekday] : values.weekdays;
        if (draft.pendingResolutionId && (!weekdays.length || !item.pendingSlots.some(row => row.id === draft.pendingResolutionId))) throw Error('해결할 미배치와 배치 요일을 선택해 주세요.');
        if (weekdays.length) {
            if (!values.teacher || !values.room) throw Error('배치하려면 선생님과 강의실을 선택해 주세요.');
            const startMinute = candidate?.startMinute ?? parsePlanTime(values.start);
            const endMinute = candidate ? startMinute + duration : parsePlanTime(values.end, true);
            assertInterval(startMinute, endMinute);
            const selected = draft.slots.find(s => s.id === draft.slotId);
            slots = [...slots.filter(s => s.id !== draft.slotId), ...weekdays.map((weekday, index) => ({
                id: index === 0 && selected ? selected.id : crypto.randomUUID(), itemId: item.id, planId: item.planId,
                weekday, startMinute, endMinute, teacherId: values.teacher, classroomId: values.room,
                sourceSlotId: index === 0 && selected ? selected.sourceSlotId : null,
            }))];
        }
    }
    if (draft.pendingResolutionId) item.pendingSlots = item.pendingSlots.filter(row => row.id !== draft.pendingResolutionId);
    return { operation: 'save', item, slots };
}
