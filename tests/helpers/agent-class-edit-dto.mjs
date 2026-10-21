import assert from 'node:assert/strict';
import { classWorkspace, compileClassEdit } from '../../src/features/agent-api/server/class-edit-compiler.mjs';

// Pure SQL-fixture builder and assertions shared by the guarded canonical probe
// and focused owned-container checks; this module opens no connection.
export function buildClassEditDtoProbeSql(fixture) {
const end=fixture.indexOf('-- Existing approval work owns its transition');assert.ok(end>0);
return fixture.slice(0,end).replace('begin;','begin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;')+`
reset role;
create temp table api_dto_probe_capture(v jsonb);
grant all on api_dto_probe_capture to service_role;
set local role service_role;
insert into api_dto_probe_capture select jsonb_build_object(
 'legacy',pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(3)))->'data',
 'normalized',pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(30)))->'data',
 'legacyPreview',(select v->'data' from ev where k='legacy'),
 'legacyReceipt',(select v->'data' from ev where k='saved'),
 'normalizedPreview',(select v->'data' from ev where k='normalized'),
 'normalizedReceipt',pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.eid(502)))->'data'
);
reset role;
-- Read-only consumption fixtures: all local writes roll back with this probe.
-- Resources are unique to these synthetic classes. NULL/empty are intentional.
insert into public.teacher_catalogs(id,name,subjects) values('10000000-0000-4000-8000-000000000001','Probe Teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values('20000000-0000-4000-8000-000000000001','Probe Room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan)
select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Authored API probe '||n,'영어','수강','legacy','수 14:00-15:00','Probe Teacher','Probe Room',
 jsonb_build_object('billingPeriods','[]'::jsonb,'sessions',jsonb_build_array(
  jsonb_build_object('id','ordinary','date','2026-10-21','state','active','startTime','14:00','endTime','15:00')
  || case n when 1 then jsonb_build_object('teacherCatalogId','10000000-0000-4000-8000-000000000001','classroomCatalogId',null)
    when 2 then jsonb_build_object('teacherCatalogId','','classroomCatalogId','20000000-0000-4000-8000-000000000001') else '{}'::jsonb end),
 'sessionSchedules',jsonb_build_object('2026-10-21',jsonb_build_object('startTime','14:00','endTime','15:00',
  'teacherCatalogId','10000000-0000-4000-8000-000000000001','classroomCatalogId','20000000-0000-4000-8000-000000000001')))
from generate_series(1,3) n;
with reference as materialized (select dashboard_private.read_timetable_operating_reference_v1() v)
select (select v from api_dto_probe_capture) || jsonb_build_object('authoredCases',(
 select jsonb_agg(jsonb_build_object('case',n,'context',dashboard_private.agent_edit_context_v2(cid),
  'operating',(select row from reference,jsonb_array_elements((v->'datedSessions')||(v->'datedUnresolvedOccupancies')) row where row->>'classId'=cid::text and row->>'date'='2026-10-21')) order by n)
 from (select n,('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid cid from generate_series(1,3) n) c));
rollback;
`;
}

export function assertClassEditDtoProbe(dto) {
const window={from:'2099-10-01',to:'2099-10-31'};
for(const mode of ['legacy','normalized']) {
 const context=dto[mode];const workspace=classWorkspace(context,window);
 assert.equal(workspace.basic.subject,'영어');assert.ok(workspace.lessons.length>0);assert.ok(workspace.weeklySlots.length>0);
 assert.ok(context.catalogs.teachers.some(row=>row.name==='T' && row.isVisible===true));
 assert.doesNotMatch(JSON.stringify(workspace),/SECRET_|KEEP_PRIVATE_NOTE|KEEP_STUDENT|teacher_note|schedule_plan/);
 const preview=dto[mode+'Preview'],receipt=dto[mode+'Receipt'];assert.equal(receipt.state,'applied');
 const expected=classWorkspace(preview.afterContext,preview.window),actual=classWorkspace(receipt.classContext,receipt.window);
 assert.equal(actual.id,expected.id);assert.equal(actual.verificationHash,expected.verificationHash,`${mode} saved meaning must match actual preview`);
 const command=compileClassEdit(context,{expectedVersion:workspace.version,window,reason:'DTO probe',basic:{grade:'고2'}});
 assert.deepEqual(command.patch,{grade:'고2'});
}
assert.equal(dto.authoredCases.length,3);
for (const item of dto.authoredCases) {
 const projected=classWorkspace(item.context,{from:'2026-10-21',to:'2026-10-21'}).lessons.find(row=>row.id==='ordinary');
 assert.ok(projected && item.operating,'actual SQL context and operating reader both contain the lesson');
 for (const key of ['startMinute','endMinute','teacherId','classroomId']) assert.equal(projected[key],item.operating[key],`authored case ${item.case}: ${key}`);
 assert.equal(projected.classroomId,item.case===1?null:'20000000-0000-4000-8000-000000000001');
 assert.equal(projected.teacherId,item.case===2?null:'10000000-0000-4000-8000-000000000001');
}
return {status:'passed',actualGatewayContextsConsumed:2,authoredContextsConsumed:3,previewReceiptHashesMatch:true,privateFieldsExcluded:true};
}
