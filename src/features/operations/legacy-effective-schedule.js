// Pure draft projection, parity-tested against the private SQL resolver.
// Resolved values are presentation/validation only; never serialize them into raw plans.
const fields = ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId'];
const own = (o, k) => Object.hasOwn(o || {}, k) && o[k] !== undefined;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const text = x => typeof x === 'string' ? x.trim() : '';
const dateValid = x => /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
const timeValue = (x, end) => {
  if (!/^[0-9]{1,2}:[0-5][0-9](?::00(?:[.]0+)?)?$/.test(x)) return null;
  const [hour, minute] = x.split(':');
  if (Number(hour) > 23 && !(end && Number(hour) === 24 && minute === '00')) return null;
  return `${hour.padStart(2, '0')}:${minute}`;
};
// Same preservation-tag shape as the existing planner; never authorization.
function requestOwned(row) {
  const id = row.makeupRequestId;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return false;
  if (row.makeupRequestRole === 'cancel' && typeof (row.id || row.sessionKey) === 'string') return true;
  if (row.id === `makeup-cancel:${id}` && row.sessionKey === row.id) return true;
  const prefix = `makeup-request:${id}:`;
  return typeof row.id === 'string' && row.id.startsWith(prefix) && /^[0-9]+$/.test(row.id.slice(prefix.length)) && row.sessionKey === row.id;
}

export function resolveEffectiveSchedule(input) {
  const row = object(input.session) ? input.session : {};
  const date = text(row.date), state = text(row.scheduleState || row.state) || 'active';
  const out = { date, state, kind: 'unresolved', values: {}, provenance: {}, missing: [], errors: [] };
  if (!object(input.session)) out.errors.push('invalid_session');
  if (!text(row.id || row.sessionKey) || (input.identityCount ?? 1) !== 1) out.errors.push('ambiguous_identity');
  if (!dateValid(date)) out.errors.push('invalid_date');
  if (!['active', 'makeup', 'exception', 'skipped', 'tbd'].includes(state)) out.errors.push('invalid_state');
  if (out.errors.length) return out;
  if (['exception', 'skipped', 'tbd'].includes(state)) { out.kind = 'cancelled'; return out; }

  // Explicit dates are authoritative. A weekday is only a basic-slot selector.
  // For a date outside all basic weekdays, inherit only each unanimously known
  // component, never invent a choice between different basic times/resources.
  const allSlots = (input.basicSlots || []).filter(object);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  let slots, basicSource;
  if (own(row, 'sourceSlotId')) {
    slots = allSlots.filter(s => text(row.sourceSlotId) && s.id === row.sourceSlotId);
    basicSource = 'basic_bound_slot';
  } else {
    slots = allSlots.filter(s => s.weekday === weekday);
    basicSource = slots.length ? 'basic_weekday' : 'basic_shared';
    if (!slots.length) slots = allSlots;
  }
  // normalizeSessionSchedules replaces the ordinary row's entire override
  // object with its date map. Request-owned rows bypass that shared map.
  const sources = !requestOwned(row) && object(input.dateOverride)
    ? [{ name: 'date_override', value: input.dateOverride }]
    : [{ name: 'session', value: row }];
  if (object(input.approvedOverride)) sources.push({ name: 'approved_override', value: input.approvedOverride });
  const pick = keys => {
    for (const source of sources) {
      if (!keys.some(key => own(source.value, key))) continue;
      if (source.name === 'date_override' && (input.sessionCountOnDate ?? 1) !== 1) return { source: source.name, error: 'ambiguous_date_override' };
      if (source.name === 'approved_override' && input.approvedOverrideVerified !== true) return { source: source.name, error: 'unverified_approved_override' };
      return { source: source.name, value: source.value };
    }
    const values = slots.map(slot => keys[0] in slot ? slot[keys[0]] : null);
    return { source: basicSource, value: values.length && values.every(v => v === values[0]) ? { [keys[0]]: values[0] } : {}, basic: true };
  };
  for (const key of fields) {
    const resource = key === 'teacherCatalogId' ? { name: 'teacherName', catalog: input.catalogs?.teachers || [] }
      : key === 'classroomCatalogId' ? { name: 'classroomName', catalog: input.catalogs?.rooms || [] } : null;
    const chosen = pick(resource ? [key, resource.name] : [key]);
    out.provenance[key] = chosen.source;
    let value = null;
    if (chosen.error) out.errors.push(`${key}:${chosen.error}`);
    else if (resource) {
      if (own(chosen.value, key)) {
        const id = text(chosen.value[key]);
        if (id && resource.catalog.filter(r => r.id === id).length === 1) value = id;
      } else if (own(chosen.value, resource.name)) {
        const name = text(chosen.value[resource.name]);
        const matches = name ? resource.catalog.filter(r => text(r.name) === name) : [];
        if (matches.length === 1 && text(matches[0].id)) value = matches[0].id;
      }
    } else {
      const time = text(chosen.value[key]);
      value = timeValue(time, key === 'endTime');
    }
    out.values[key] = value;
    if (value === null) out.missing.push(key);
  }
  if (out.values.startTime !== null && out.values.endTime !== null && out.values.startTime >= out.values.endTime) out.errors.push('invalid_time_range');
  out.kind = out.missing.length || out.errors.length ? 'unresolved' : 'resolved';
  return out;
}

export function occupancyOf(result, classId, id) {
  if (result.kind === 'cancelled') return null;
  const minutes = t => t === null || t === undefined ? null : Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const invalidRange = result.errors.includes('invalid_time_range');
  return { id, classId, date: result.date, state: result.state,
    startMinute: invalidRange ? null : minutes(result.values.startTime), endMinute: invalidRange ? null : minutes(result.values.endTime),
    teacherId: result.values.teacherCatalogId ?? null, classroomId: result.values.classroomCatalogId ?? null };
}

const bindingFields = ['id', 'date', 'scheduleState', 'state', 'originalDate', 'makeupDate', 'isForced', 'sourceSlotId', 'makeupRequestId', 'makeupRequestRole'];
const binding = row => Object.fromEntries(bindingFields.filter(k => own(row, k)).map(k => [k, row[k]]));
const ordered = value => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))));

export function effectiveInputForLesson(plan, session, context) {
  const rows = Array.isArray(plan?.sessions) ? plan.sessions : [];
  const identity = row => text(row?.id) || text(row?.sessionKey);
  const source = context?.approvedByIdentity?.[session.id];
  return { session, basicSlots: context?.basicSlots || [], catalogs: context?.catalogs || {},
    identityCount: rows.filter(row => identity(row) === identity(session)).length,
    sessionCountOnDate: rows.filter(row => row.date === session.date).length,
    ...(object(plan?.sessionSchedules?.[session.date]) ? { dateOverride: plan.sessionSchedules[session.date] } : {}),
    ...(source && ordered(source.binding) === ordered(binding(session))
      ? { approvedOverride: source.approvedOverride, approvedOverrideVerified: source.approvedOverrideVerified } : {}),
  };
}

export function projectLegacyEffectivePlan(plan, context) {
  if (context?.version !== 1 || !Array.isArray(plan?.sessions)) return plan;
  return { ...plan, sessions: plan.sessions.map(session => {
    const resolved = resolveEffectiveSchedule(effectiveInputForLesson(plan, session, context));
    return { ...session, ...resolved.values,
      teacherNameSnapshot: context.catalogs?.teachers?.find(r => r.id === resolved.values.teacherCatalogId)?.name || '',
      classroomNameSnapshot: context.catalogs?.rooms?.find(r => r.id === resolved.values.classroomCatalogId)?.name || '',
      effectiveSchedule: resolved };
  }) };
}

// The field editor emits its entire displayed value. Persist only fields that
// the operator actually changed, retaining preexisting explicit values.
export function setLegacyLessonOverride(plan, date, next, displayed) {
  const onDate = (plan.sessions || []).filter(row => row.date === date);
  if (onDate.length !== 1 || requestOwned(onDate[0])) return plan;
  const keys = [...fields, 'teacherName', 'classroomName'];
  const previous = object(plan.sessionSchedules?.[date]) ? plan.sessionSchedules[date] : onDate[0];
  const details = Object.fromEntries(keys.filter(k => own(previous, k)).map(k => [k, previous[k]]));
  for (const key of fields) if (next[key] !== displayed[key]) {
    details[key] = next[key];
    if (key === 'teacherCatalogId') delete details.teacherName;
    if (key === 'classroomCatalogId') delete details.classroomName;
  }
  return { ...plan, sessionSchedules: { ...plan.sessionSchedules, [date]: details } };
}

export function resetLegacyLessonToBasics(plan, date) {
  const onDate = (plan.sessions || []).filter(row => row.date === date);
  if (onDate.length !== 1 || requestOwned(onDate[0])) return plan;
  return { ...plan, sessionSchedules: { ...plan.sessionSchedules, [date]: {} } };
}
