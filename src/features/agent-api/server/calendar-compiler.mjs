import { createHash, randomUUID } from 'node:crypto';
import { buildAcademicEventNote, extractAcademicEventNoteMetadata } from '../../operations/academic-event-utils.js';
import { getGradeOptionsForSchoolCategory, parseGradeSelection, serializeGradeSelection } from '../../../app/admin/calendar/utils/calendar-grid.js';

export class CalendarError extends Error {}
const fail = code => { throw new CalendarError(code); };
const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
const normalizeGrade = value => serializeGradeSelection(parseGradeSelection(value).sort());
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const publicEvent = row => {
  const meta = extractAcademicEventNoteMetadata(row.note);
  return {id:row.id,title:row.title,type:row.type,start:row.date,end:meta.rangeEnd || row.date,grade:row.grade || 'all',examTerm:meta.examTerm || null,scienceAreaKey:meta.scienceAreaKey || null,source:row.source || null};
};
export function calendarWorkspace(context) {
  const events=context.events.map(publicEvent).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  const visible={school:context.school,schoolYear:context.schoolYear,events};
  return {...visible,version:context.version,verificationHash:digest(visible),timezone:'Asia/Seoul',scienceAreas:context.scienceAreas};
}
export function compileCalendarChange(context, input, {now=Date.now(),newId=randomUUID}={}) {
  if(context.school.id!==input.schoolId || context.schoolYear!==input.schoolYear) fail('agent_invalid');
  if(context.version!==input.expectedVersion) fail('agent_stale');
  const lower=`${input.schoolYear}-03-01`, upper=`${input.schoolYear+1}-03-01`;
  const targets=new Set(), events=[], diff={added:[],changed:[],unchanged:[]};
  const allowedGrades=getGradeOptionsForSchoolCategory(context.school.category).map(row=>row.value);
  for(const raw of input.events) {
    const grades=parseGradeSelection(raw.grade).sort();
    if(grades.some(grade=>!allowedGrades.includes(grade))) fail('agent_invalid_catalog');
    const item={...raw,grade:serializeGradeSelection(grades)};
    if(item.start<lower || item.end>=upper) fail('agent_invalid_range');
    const checked=Date.parse(item.source.checkedAt);
    if(!Number.isFinite(checked) || checked>now+300000 || checked<now-30*86400000) fail('agent_calendar_source_stale');
    if(item.source.publishedOn && item.source.publishedOn>new Date(now+300000).toISOString().slice(0,10)) fail('agent_invalid');
    if(item.type==='과학시험일' && (grades.some(grade=>!['고1','고2','고3'].includes(grade)) || !context.scienceAreas.includes(item.scienceAreaKey))) fail('agent_invalid_catalog');
    if(item.type!=='과학시험일' && item.scienceAreaKey) fail('agent_invalid');
    let row=item.id ? context.events.find(value=>value.id===item.id) : undefined;
    if(item.id && !row) fail('agent_not_found');
    const candidates=context.events.filter(value=>normalize(value.title)===normalize(item.title) && value.type===item.type && normalizeGrade(value.grade)===item.grade);
    if(!item.id) {
      const exact=candidates.filter(value=>value.date===item.start);
      if(exact.length>1 || (!exact.length && candidates.length)) fail('agent_calendar_match_required');
      row=exact[0];
    }
    const identity=`${normalize(item.title)}:${item.type}:${item.grade}:${item.start}`;
    if(targets.has(identity) || (row && targets.has(row.id))) fail('agent_calendar_duplicate');
    targets.add(identity);
    const id=row?.id || newId(); targets.add(id);
    if(row?.note?.includes('[[TIPS_MAKEUP]]')) fail('agent_approval_workflow_required');
    if(row?.note?.includes('[[TIPS_META]]')) {
      try {
        const meta=JSON.parse(row.note.slice(row.note.indexOf('[[TIPS_META]]')+'[[TIPS_META]]'.length).trim());
        if(!meta || typeof meta!=='object' || Array.isArray(meta)) throw new Error('metadata');
      } catch { fail('agent_calendar_metadata_invalid'); }
    }
    if(context.events.some(value=>value.id!==id && normalize(value.title)===normalize(item.title) && value.type===item.type && normalizeGrade(value.grade)===item.grade && value.date===item.start)) fail('agent_calendar_duplicate');
    const oldSource=row?.source;
    if(oldSource && ((oldSource.authority==='official_school' && item.source.authority!=='official_school') || (oldSource.publishedOn && item.source.publishedOn && item.source.publishedOn<oldSource.publishedOn) || Date.parse(item.source.checkedAt)<Date.parse(oldSource.checkedAt)) && !item.conflictResolution) fail('agent_calendar_source_conflict');
    const metadata={rangeEnd:item.end===item.start?'':item.end,academicYear:String(input.schoolYear)};
    if(item.examTerm!==undefined) metadata.examTerm=item.examTerm;
    if(item.scienceAreaKey!==undefined) metadata.scienceAreaKey=item.scienceAreaKey;
    const patch={title:item.title,date:item.start,type:item.type,grade:item.grade,note:buildAcademicEventNote(row?.note,metadata)};
    const source={...item.source,...(item.conflictResolution?{conflictResolution:item.conflictResolution}:{})};
    const after=publicEvent({...row,...patch,id,source});
    const before=row?publicEvent(row):null;
    const kind=!row?'added':digest(before)===digest(after)?'unchanged':'changed';
    diff[kind].push({id,before,after});
    if(kind!=='unchanged') events.push({id,insert:!row,patch,source});
  }
  if(!events.length) fail('agent_no_change');
  return {schoolId:input.schoolId,schoolYear:input.schoolYear,reason:input.reason,events,diff};
}
