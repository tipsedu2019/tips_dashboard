import type {ClassScheduleFormRow} from '../../components/classes/class-form-model.ts';
import type {PlanSlot} from './timetable-plan-contract.ts';
import {formatPlanTime, parsePlanTime, placementFormDefaults, placementScope, buildPlacementFormEdit, type PlacementEditorDraft, type PlacementFormValues} from './timetable-plan-interaction.ts';
import {assertInterval, type TimetableItemEdit} from './timetable-plan-model.ts';
const DAYS=['일','월','화','수','목','금','토'];
function rowFor(slot: PlanSlot): ClassScheduleFormRow {return {key:slot.id,day:DAYS[slot.weekday],startTime:formatPlanTime(slot.startMinute),endTime:formatPlanTime(slot.endMinute),teacher:slot.teacherId,classroom:slot.classroomId};}
export function placementScheduleRows(draft: PlacementEditorDraft): ClassScheduleFormRow[] {
  const scope=placementScope(draft);
  if(scope==='item') return draft.slots.map(rowFor);
  if(scope==='slot') return draft.slots.filter(slot=>slot.id===draft.slotId).map(rowFor);
  const values=placementFormDefaults(draft);
  return values.weekdays.map(day=>({key:crypto.randomUUID(),day:DAYS[day],startTime:values.start,endTime:values.end,teacher:values.teacher,classroom:values.room}));
}
export function placementClassFormDefaults(draft: PlacementEditorDraft) {
  return {...placementFormDefaults(draft),teacher:draft.item.defaultTeacherId||'',room:draft.item.defaultClassroomId||'',scheduleRows:placementScheduleRows(draft)};
}
export function buildPlacementRowsEdit(draft: PlacementEditorDraft, values: PlacementFormValues, rows: ClassScheduleFormRow[], {isNewItem=false}: {isNewItem?: boolean} = {}): TimetableItemEdit {
  const scope=placementScope(draft);
  if(scope==='slot'&&!draft.slots.some(slot=>slot.id===draft.slotId))throw Error('선택한 배치를 다시 확인해 주세요.');
  if(draft.pendingResolutionId&&(scope!=='add'||!rows.length||!draft.item.pendingSlots.some(row=>row.id===draft.pendingResolutionId)))throw Error('해결할 미배치와 배치 요일을 선택해 주세요.');
  if(new Set(rows.map(row=>row.key)).size!==rows.length)throw Error('시간표 행을 다시 확인해 주세요.');
  // Reuse the existing metadata/default-resource contract; row placement is
  // validated below, with its own exact slot/add/item ownership.
  const metadata=buildPlacementFormEdit({...draft,pendingResolutionId:undefined},{...values,weekdays:[],applyTeacher:false,applyRoom:false,applyTime:false,applyWeekdays:false});
  if(metadata.operation!=='save')throw Error('수업 정보를 다시 확인해 주세요.');
  const item=metadata.item;
  if(scope!=='item'){item.defaultTeacherId=draft.item.defaultTeacherId;item.defaultClassroomId=draft.item.defaultClassroomId;}
  else if(rows.length===0){item.defaultTeacherId=values.teacher||null;item.defaultClassroomId=values.room||null;}
  const owned=scope==='item'?draft.slots:scope==='slot'?draft.slots.filter(slot=>slot.id===draft.slotId):[];
  const next=rows.map(row=>{
    const previous=owned.find(slot=>slot.id===row.key);
    // An add/slot editor cannot take ownership of a sibling through a row key.
    if(!previous&&draft.slots.some(slot=>slot.id===row.key))throw Error('다른 배치의 식별값을 사용할 수 없습니다.');
    const weekday=DAYS.indexOf(row.day),startMinute=parsePlanTime(row.startTime),endMinute=parsePlanTime(row.endTime,true);
    if(weekday<0)throw Error('수업 요일을 선택해 주세요.');assertInterval(startMinute,endMinute);
    if(!row.teacher||!row.classroom)throw Error('배치하려면 선생님과 강의실을 선택해 주세요.');
    const slot: PlanSlot={...(previous||{}),id:row.key,itemId:item.id,planId:item.planId,weekday,startMinute,endMinute,teacherId:row.teacher,classroomId:row.classroom,sourceSlotId:previous?.sourceSlotId??null};
    if(previous&&previous.teacherId!==row.teacher)delete slot.teacherName;
    if(previous&&previous.classroomId!==row.classroom)delete slot.classroomName;
    return slot;
  });
  const slots=scope==='item'?next:scope==='add'?[...draft.slots,...next]:draft.slots.flatMap(slot=>slot.id===draft.slotId?next:[slot]);
  // A new grid-created item has no independent stored defaults yet. Seed its
  // first placement so subsequent drag placement keeps the selected resources.
  // Existing items keep explicit null or different defaults unchanged.
  if(isNewItem&&next.length){item.defaultTeacherId=next[0].teacherId;item.defaultClassroomId=next[0].classroomId;}
  if(draft.pendingResolutionId)item.pendingSlots=item.pendingSlots.filter(row=>row.id!==draft.pendingResolutionId);
  return {operation:'save',item,slots};
}
