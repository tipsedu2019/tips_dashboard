import { createHash, randomUUID } from 'node:crypto';
import { normalizeSchedulePlan, buildSchedulePlanForSave } from '../../../lib/class-schedule-planner.js';

export class EditError extends Error {}
const fail = code => { throw new EditError(code); };
const rows = value => Array.isArray(value) ? value : [];
const minutes = value => /^\d{2}:\d{2}/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
export const clockTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const inWindow = (date, window) => date >= window.from && date <= window.to;
const rowKey = row => `${row.date}:${row.originalDate || ''}`;
const defaults = context => ({ subject: context.basic.subject, className: context.basic.name, schedule: context.schedule });
function normalizedPlan(context) { return normalizeSchedulePlan(context.plan || {}, defaults(context)); }
function unique(values) { return [...new Set(values)]; }
function catalog(context, kind, id) {
  const found = rows(context.catalogs[kind]).find(row => row.id === id && row.isVisible !== false);
  if (!found) fail('agent_invalid_catalog');
  return found.name;
}
function details(context, timing) {
  return { startTime: clockTime(timing.startMinute), endTime: clockTime(timing.endMinute), teacherCatalogId: timing.teacherId, classroomCatalogId: timing.classroomId,
    teacherName: catalog(context, 'teachers', timing.teacherId), classroomName: catalog(context, 'classrooms', timing.classroomId) };
}
function inheritedTiming(context, date) {
  const slots = context.weeklySlots.filter(row => row.weekday === weekday(date));
  return slots.length === 1 ? { startMinute: slots[0].startMinute, endMinute: slots[0].endMinute, teacherId: slots[0].teacherId, classroomId: slots[0].classroomId } : null;
}
function legacyRows(context) {
  // Never invent a billing period merely to make an empty plan appear editable.
  if (!rows(context.plan?.billingPeriods).length) return rows(context.plan?.sessions);
  const calculated = normalizedPlan(context).sessions;
  const saved = rows(context.plan?.sessions);
  return [
    ...calculated.filter(row => !saved.some(old => rowKey(old) === rowKey(row))),
    ...saved,
  ];
}
export function classWorkspace(context, window) {
  const normalized = context.storageMode === 'normalized';
  const source = normalized ? rows(context.sessions) : legacyRows(context);
  const lessons = source.filter(row => inWindow(normalized ? row.session_date : row.date, window)).map(row => {
    const date = normalized ? row.session_date : row.date;
    const state = normalized ? row.schedule_state : row.scheduleState || row.state || 'active';
    const inherited = inheritedTiming(context, date);
    const timing = normalized
      ? { startMinute: minutes(row.start_time), endMinute: minutes(row.end_time), teacherId: row.teacher_catalog_id, classroomId: row.classroom_catalog_id }
      : { startMinute: minutes(row.startTime) ?? inherited?.startMinute ?? null, endMinute: minutes(row.endTime) ?? inherited?.endMinute ?? null, teacherId: row.teacherCatalogId || (row.teacherName ? rows(context.catalogs.teachers).filter(x=>x.name===row.teacherName).length === 1 ? rows(context.catalogs.teachers).find(x=>x.name===row.teacherName).id : null : inherited?.teacherId || null), classroomId: row.classroomCatalogId || (row.classroomName ? rows(context.catalogs.classrooms).filter(x=>x.name===row.classroomName).length === 1 ? rows(context.catalogs.classrooms).find(x=>x.name===row.classroomName).id : null : inherited?.classroomId || null) };
    return { id: String(normalized || rows(context.plan?.sessions).some(x=>x.id === row.id) ? row.id : `virtual:${row.date}:${row.billingId}:${row.originalDate || ''}`), date, state: state === 'tbd' ? 'undecided' : state === 'skipped' ? 'skipped' : !normalized && state === 'exception' ? 'cancelled' : state === 'makeup' ? 'makeup' : 'scheduled', ...timing,
      sourceSlotId: normalized ? row.source_schedule_slot_id : null, makeupOfLessonId: normalized ? row.makeup_of_session_id : null,
      originalDate: normalized ? rows(context.sessions).find(x => x.id === row.makeup_of_session_id)?.session_date || null : row.originalDate || null,
      makeupDate: normalized ? rows(context.sessions).find(x => x.makeup_of_session_id === row.id && x.schedule_state === 'makeup')?.session_date || null : row.makeupDate || null,
      materialized: normalized || rows(context.plan?.sessions).some(x => x.id === row.id) };
  });
  // In normalized storage the dated record replaces the weekly occurrence.
  // Ambiguous multiple records are exposed, never collapsed into a guessed row.
  if (normalized) {
    for (let d = new Date(`${window.from}T00:00:00Z`); d.toISOString().slice(0,10) <= window.to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0,10);
      for (const slot of context.weeklySlots.filter(row => row.weekday === d.getUTCDay() && !lessons.some(lesson=>lesson.date === date && lesson.sourceSlotId === row.id))) lessons.push({ id: `virtual:${slot.id}:${date}`, date, state: 'scheduled', startMinute: slot.startMinute, endMinute: slot.endMinute, teacherId: slot.teacherId, classroomId: slot.classroomId, sourceSlotId: slot.id, makeupOfLessonId: null, originalDate: null, makeupDate: null, materialized: false });
    }
  }
  lessons.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const safe = { id: context.id, version: context.version, basic: context.basic, weeklySlots: context.weeklySlots, weeklyScheduleComplete: context.weeklyScheduleComplete, lessons, window,
    timezone: 'Asia/Seoul', capabilities: { basic: true, existingWeeklySlots: true, datedLessons: normalized || Boolean(rows(context.plan?.billingPeriods).length), pastChanges: false, approvalWorkflow: false } };
  return { ...safe, verificationHash: createHash('sha256').update(JSON.stringify({ basic: safe.basic, weeklySlots: safe.weeklySlots, lessons: safe.lessons })).digest('hex') };
}
function selectLesson(workspace, change) {
  const candidates = workspace.lessons.filter(row => row.date === change.date && (!change.lessonId || row.id === change.lessonId));
  if (candidates.length > 1) fail('agent_ambiguous_lesson');
  if (change.lessonId && !candidates.length) fail('agent_stale');
  if (candidates[0]?.state === 'makeup' || candidates[0]?.originalDate) fail('agent_edit_makeup_source');
  return candidates[0] || null;
}
const basicNames = { name:'name', classType:'class_type', subject:'subject', subjectAreaKey:'subject_area_key', grade:'grade', capacity:'capacity', fee:'fee' };
export function compileClassEdit(context, request, { today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date()), uuid = randomUUID } = {}) {
  if (context.version !== request.expectedVersion) fail('agent_stale');
  const workspace = classWorkspace(context, request.window);
  const patch = Object.fromEntries(Object.entries(request.basic || {}).map(([key,value]) => [basicNames[key],value]));
  const command = { reason: request.reason, window: request.window, requiredScopes: ['class-details:read', ...(request.basic ? ['class-info:write'] : []), ...(request.weeklySlots ? ['weekly-plan:write'] : []), ...(request.lessons ? ['lesson-plan:write'] : [])], patch };
  const effectiveContext = structuredClone(context);
  if (request.basic) Object.assign(effectiveContext.basic, request.basic);
  if (request.weeklySlots) {
    if (!context.weeklyScheduleComplete) fail('agent_incomplete_schedule');
    if (unique(request.weeklySlots.map(x => x.id)).length !== request.weeklySlots.length) fail('agent_invalid');
    const slots = structuredClone(context.weeklySlots);
    for (const edit of request.weeklySlots) {
      const index = slots.findIndex(row => row.id === edit.id);
      if (index < 0) fail('agent_stale');
      details(effectiveContext, edit);
      slots[index] = { ...slots[index], ...edit };
    }
    effectiveContext.weeklySlots = slots;
    if (context.storageMode === 'normalized') command.slots = slots.map(row => ({id:row.id,weekday:row.weekday,startTime:clockTime(row.startMinute),endTime:clockTime(row.endMinute),teacherCatalogId:row.teacherId,classroomCatalogId:row.classroomId,sortOrder:row.sortOrder}));
    else {
      const names = slots.map(row => details(effectiveContext,row));
      if (names.some(row => /[,()\n]/.test(row.teacherName + row.classroomName))) fail('agent_unsupported_catalog_label');
      patch.schedule = slots.map((row,i) => `${'일월화수목금토'[row.weekday]} ${names[i].startTime}-${names[i].endTime} (${names[i].teacherName}, ${names[i].classroomName})`).join('\n');
      patch.teacher = unique(names.map(row=>row.teacherName)).sort().join(', '); patch.room = unique(names.map(row=>row.classroomName)).sort().join(', ');
    }
  }
  if (!request.lessons) return command;
  if (!workspace.capabilities.datedLessons) fail('agent_missing_billing_period');
  const touched = new Set();
  for (const change of request.lessons) {
    if (change.date < today || change.makeup?.date < today) fail('agent_past_change');
    // Legacy overrides are keyed by date, so an ID cannot isolate one of two
    // lessons on that date. Reject instead of editing both behind the caller.
    if (context.storageMode !== 'normalized' && workspace.lessons.filter(row=>row.date === change.date).length > 1) fail('agent_ambiguous_lesson');
    selectLesson(workspace, change);
    touched.add(change.date);
    if (change.makeup) touched.add(change.makeup.date);
  }
  const makeupDates = request.lessons.filter(x=>x.makeup).map(x=>x.makeup.date);
  if (unique(makeupDates).length !== makeupDates.length || makeupDates.some(date=>request.lessons.some(x=>x.date === date))) fail('agent_makeup_date_occupied');
  command.changedDates = [...touched].sort();
  if (context.storageMode === 'normalized') {
    const changes = [];
    for (const change of request.lessons) {
      const old = selectLesson(workspace, change);
      const id = old?.materialized ? old.id : uuid();
      const child = rows(context.sessions).filter(row => row.makeup_of_session_id === id && row.schedule_state === 'makeup');
      if (child.length > 1) fail('agent_ambiguous_lesson');
      if (child[0] && (!inWindow(child[0].session_date, request.window) || child[0].session_date < today)) fail('agent_invalid_range');
      const timing = change.timing || old || inheritedTiming(effectiveContext, change.date);
      if (!timing || !Number.isInteger(timing.startMinute) || !Number.isInteger(timing.endMinute) || !timing.teacherId || !timing.classroomId) fail('agent_timing_required');
      const occupancy = details(effectiveContext,timing);
      changes.push({ id, date:change.date, state:{scheduled:'active',cancelled:'skipped',skipped:'skipped',undecided:'tbd'}[change.state], sourceSlotId:old?.sourceSlotId || null, makeupOf:null, ...occupancy });
      if (child[0]) {
        command.changedDates.push(child[0].session_date);
        if (change.state !== 'cancelled' || change.makeup !== undefined) changes.push({id:child[0].id,date:child[0].session_date,state:'skipped',sourceSlotId:null,makeupOf:id,startTime:child[0].start_time,endTime:child[0].end_time,teacherCatalogId:child[0].teacher_catalog_id,classroomCatalogId:child[0].classroom_catalog_id});
      }
      if (change.makeup) {
        if (workspace.lessons.some(row=>row.date === change.makeup.date && row.state !== 'skipped' && row.id !== child[0]?.id) || request.lessons.some(other=>other.date === change.makeup.date)) fail('agent_makeup_date_occupied');
        const makeupId = child[0]?.id || uuid();
        const existingIndex = changes.findIndex(row => row.id === makeupId);
        if (existingIndex >= 0) changes.splice(existingIndex,1);
        changes.push({id:makeupId,date:change.makeup.date,state:'makeup',sourceSlotId:null,makeupOf:id,...details(effectiveContext,change.makeup)});
      }
    }
    command.sessions = changes;
  } else {
    const saved = structuredClone(context.plan), draft = normalizedPlan(context);
    const affected = new Set(touched);
    for (const change of request.lessons) {
      if (!draft.billingPeriods.some(period=>change.date >= period.startDate && change.date <= period.endDate)) fail('agent_missing_billing_period');
      const old = selectLesson(workspace,change);
      const previous = draft.sessionStates[change.date] || {};
      const oldMakeup = previous.makeupDate || old?.makeupDate;
      if (oldMakeup) {
        if (!inWindow(oldMakeup,request.window) || oldMakeup < today) fail('agent_invalid_range');
        affected.add(oldMakeup);
      }
      const nextMakeup = change.state === 'cancelled' ? change.makeup === undefined ? oldMakeup || '' : change.makeup?.date || '' : '';
      if (oldMakeup && oldMakeup !== nextMakeup) {
        if (!inWindow(oldMakeup,request.window) || oldMakeup < today) fail('agent_invalid_range');
        affected.add(oldMakeup);
        draft.sessionStates[oldMakeup] = {...draft.sessionStates[oldMakeup],state:'skipped',makeupDate:''};
      }
      if (nextMakeup && workspace.lessons.some(row=>row.date === nextMakeup && row.state !== 'skipped' && row.originalDate !== change.date)) fail('agent_makeup_date_occupied');
      draft.sessionStates[change.date] = { ...previous, state: { scheduled: draft.selectedDays.includes(weekday(change.date)) ? 'active' : 'force_active', cancelled:'exception', skipped:'skipped', undecided:'tbd' }[change.state], makeupDate:nextMakeup };
      if (change.timing) draft.sessionSchedules[change.date] = details(effectiveContext,change.timing);
      else if (change.state === 'scheduled' && !draft.selectedDays.includes(weekday(change.date)) && !draft.sessionSchedules[change.date]) fail('agent_timing_required');
      if (change.makeup) draft.sessionSchedules[change.makeup.date] = details(effectiveContext,change.makeup);
    }
    const generated = buildSchedulePlanForSave(draft,defaults(effectiveContext));
    const owned = ['date','billingId','billingLabel','billingColor','sessionNumber','scheduleState','state','makeupDate','originalDate','isForced','startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'];
    const oldRows = rows(saved.sessions);
    const newRows = rows(generated.sessions).filter(row=>affected.has(row.date) || affected.has(row.originalDate)).map(row=>{
      const matches = oldRows.filter(old=>rowKey(old) === rowKey(row));
      if (matches.length > 1) fail('agent_ambiguous_lesson');
      const old = matches[0];
      // Planner sequence-based matching can copy learning content from a different
      // lesson. Only retain content for the exact same date/source identity.
      const result = old ? {...old} : {id:uuid(),sessionKey:uuid()};
      for (const field of owned) { if (Object.hasOwn(row,field)) result[field]=row[field]; }
      return result;
    });
    const removed = oldRows.filter(old=>(affected.has(old.date) || affected.has(old.originalDate)) && !newRows.some(row=>rowKey(row)===rowKey(old))).map(old=>({...old,state:'skipped',scheduleState:'skipped',makeupDate:''}));
    patch.schedule_plan = { ...saved, billingPeriods: rows(saved.billingPeriods).map(period=>{
      const computed=generated.billingPeriods.find(row=>row.id===period.id);
      return computed && [...affected].some(date=>date>=computed.startDate && date<=computed.endDate) ? {...period,totalSessions:computed.totalSessions} : period;
    }), sessionStates: { ...(saved.sessionStates || {}), ...Object.fromEntries([...affected].filter(date=>draft.sessionStates[date]).map(date=>[date,{...(saved.sessionStates?.[date] || {}),...draft.sessionStates[date]}])) },
      sessionSchedules: {...(saved.sessionSchedules || {}), ...Object.fromEntries([...affected].filter(date=>draft.sessionSchedules[date]).map(date=>[date,{...(saved.sessionSchedules?.[date] || {}),...draft.sessionSchedules[date]}])) },
      sessions:[...oldRows.filter(old=>!affected.has(old.date) && !affected.has(old.originalDate)),...newRows,...removed].sort((a,b)=>a.date.localeCompare(b.date)) };
    command.changedDates = [...affected].sort();
  }
  command.changedDates = unique(command.changedDates).sort();
  return command;
}
