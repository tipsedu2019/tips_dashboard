begin;
select no_plan();

-- Owner-only synthetic seed. No production class, person, credential or note is
-- copied here. All exercised calls use the final migration's real RPCs/guards.
create function pg_temp.pid(n int) returns uuid language sql immutable as
$$select ('ad110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.past_day() returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date-1$$;
create function pg_temp.target_id() returns text language sql immutable as
$$select 'retained:target:skipped'::text$$;
create function pg_temp.lesson(n int) returns jsonb language sql stable as $$
 select jsonb_build_object('id',case when n=0 then pg_temp.target_id() else 'retained:'||n end,
   'sessionKey',case when n=0 then pg_temp.target_id() else 'retained:'||n end,
   'date',pg_temp.past_day()-n,'scheduleState',case when n=0 then 'skipped' else 'exception' end,
   'state',case when n=0 then 'skipped' else 'exception' end,'isForced',false,
   'originalDate','','makeupDate','','startTime','17:00','endTime','19:00',
   'teacherCatalogId',pg_temp.pid(101),'classroomCatalogId',pg_temp.pid(201),
   'teacherName','Synthetic target teacher','classroomName','Synthetic target room',
   'billingId','retained-period','sessionNumber',n+1,'memo','KEEP_SYNTHETIC_MEMO_'||n,
   'teacherNote','KEEP_SYNTHETIC_NOTE_'||n,'textbookEntries',jsonb_build_array(jsonb_build_object('id','retained-entry-'||n)),
   'customField',jsonb_build_object('retained',n))
$$;
create function pg_temp.seed_baseline() returns void language plpgsql as $$begin
 update dashboard_private.timetable_operating_write_baselines
 set reference=dashboard_private.read_timetable_operating_reference_v1()
 where transaction_id=txid_current();
 set constraints all immediate;
 set constraints all deferred;
end$$;
insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.pid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','past-correction-admin@test.invalid'),
 (pg_temp.pid(902),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','past-correction-teacher@test.invalid');
insert into public.profiles(id,role,name) values
 (pg_temp.pid(901),'admin','Synthetic correction administrator'),
 (pg_temp.pid(902),'teacher','Synthetic teacher') on conflict(id) do update set role=excluded.role;
insert into public.teacher_catalogs(id,name,subjects) values
 (pg_temp.pid(101),'Synthetic target teacher',array['영어']),
 (pg_temp.pid(102),'Synthetic other teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.pid(201),'Synthetic target room',array['영어']),
 (pg_temp.pid(202),'Synthetic other room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids)
select pg_temp.pid(301),'Synthetic sixty-row class','영어','수강','legacy',
 (array['일','월','화','수','목','금','토'])[extract(dow from pg_temp.past_day())::int+1]||' 17:00-19:00',
 'Synthetic target teacher','Synthetic target room',
 jsonb_build_object('version',2,'sessions',(select jsonb_agg(pg_temp.lesson(n) order by n) from generate_series(0,59) n),
   'sessionStates',jsonb_build_object(pg_temp.past_day()::text,jsonb_build_object('state','skipped','makeupDate','')),
   'sessionSchedules',jsonb_build_object(pg_temp.past_day()::text,jsonb_build_object('startTime','17:00','endTime','19:00','teacherCatalogId',pg_temp.pid(101),'classroomCatalogId',pg_temp.pid(201))),
   'history',jsonb_build_array(jsonb_build_object('retained','SYNTHETIC_HISTORY')),
   'privateNote','SYNTHETIC_PRIVATE','generatedAt','2001-01-01T00:00:00Z'), '[]'::jsonb;
-- Twenty-three historical NULL snapshots; present-day weekly metadata uses
-- different resources and cannot establish historical resource/time facts.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids)
select pg_temp.pid(400+n),'Synthetic uncertainty '||n,'영어','수강','legacy',
 '월 08:00-09:00','Synthetic other teacher','Synthetic other room',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','unknown-'||n,'date',pg_temp.past_day(),'scheduleState','active','state','active','isForced',false))), '[]'::jsonb
from generate_series(1,23) n;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
 on conflict(singleton) do update set version=1;
select pg_temp.seed_baseline();
create temp table before_class as select to_jsonb(c) row,schedule_plan plan from public.classes c where id=pg_temp.pid(301);
create temp table before_other as select id,to_jsonb(c) row from public.classes c where id between pg_temp.pid(401) and pg_temp.pid(423);
create temp table ev(k text primary key,v jsonb);
grant all on ev to authenticated,service_role;
grant select on before_class,before_other to authenticated,service_role;
create temp table no_send as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.student_class_enrollment_history) enrollments,
 (select count(*) from public.makeup_request_events) approvals;

-- Browser contracts use raw-plan compare-and-swap. Helper names below preserve
-- the full explicit argument list so an accidental API broadening is visible.
create function pg_temp.review(ack boolean default false,h text default null,reason text default 'Administrator confirmed the historical state') returns jsonb
language sql as $$select public.preview_past_lesson_state_correction_v1(
 pg_temp.pid(301),(select schedule_plan from public.classes where id=pg_temp.pid(301)),
 pg_temp.target_id(),pg_temp.past_day(),'skipped','active',reason,h,ack)$$;
create function pg_temp.next_plan() returns jsonb language sql as $$
 select jsonb_set(jsonb_set(plan,'{sessions,0}',(plan#>'{sessions,0}')||'{"state":"active","scheduleState":"active"}'::jsonb),
 array['sessionStates',pg_temp.past_day()::text],(plan#>array['sessionStates',pg_temp.past_day()::text])||'{"state":"active"}'::jsonb)
 from before_class
$$;
create function pg_temp.ordinary_save() returns jsonb language sql as $$
 select public.update_class_operational_v1(pg_temp.pid(301),jsonb_build_object('schedule_plan',pg_temp.next_plan()),pg_temp.pid(501),(select plan from before_class))
$$;
select is((select count(*)::int from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedUnresolvedOccupancies') b where b->>'date'=pg_temp.past_day()::text),23,'actual reader reproduces twenty-three historical incomplete blockers');
select ok((select bool_and(b->>'startMinute' is null and b->>'endMinute' is null and b->>'teacherId' is null and b->>'classroomId' is null)
 from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedUnresolvedOccupancies') b where b->>'date'=pg_temp.past_day()::text),'uncertainty fixture has no historical time or resource identity');
select set_config('request.jwt.claim.sub',pg_temp.pid(901)::text,true);
set local role authenticated;
select throws_ok('select pg_temp.ordinary_save()','23P01','timetable_resource_conflict','ordinary authenticated full-plan restoration remains fail closed');
insert into ev values('browser-review',pg_temp.review());
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),(select plan from before_class),'unacknowledged review cannot change the class');
select is((select to_jsonb(c) from public.classes c where id=pg_temp.pid(301)),(select row from before_class),'review leaves every class field unchanged');

select is((select (v->>'unknownOccupancyCount')::int from ev where k='browser-review'),23,'review reports the exact existing blockers');
select is((select v->>'reviewRequired' from ev where k='browser-review'),'true','unknown history requires explicit administrator review');
select ok((select jsonb_array_length(v->'warnings')>0 and v#>>'{warnings,0,code}'='unknown_occupancy'
 and (v#>>'{warnings,0,count}')::int=23 from ev where k='browser-review'),'public warning reports the count without exposing unrelated class records');
select ok((select nullif(v->>'unknownOccupancyReviewHash','') is not null from ev where k='browser-review'),'review returns a pinned blocker hash');
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),0::bigint,'review cannot create an applied attestation');
select set_config('request.jwt.claim.sub',pg_temp.pid(902)::text,true);
set local role authenticated;
select throws_ok('select pg_temp.review()','42501',null,'teacher cannot review an administrator correction');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok('select pg_temp.review()','42501',null,'missing authenticated actor cannot review a correction');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.pid(901)::text,true);
set local role authenticated;
select throws_ok('select pg_temp.review(true,null)','P0001','agent_review_stale','acknowledgment without the review hash fails');
select throws_ok($q$select pg_temp.review(true,repeat('f',64))$q$,'P0001','agent_review_stale','a different blocker hash cannot authorize the correction');
select throws_ok($q$select pg_temp.review(false,null,' ')$q$,'22023',null,'an empty historical correction reason fails');
insert into ev values('browser-preview',pg_temp.review(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')));
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),(select plan from before_class),'acknowledged browser preview also rolls back the business write');
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),0::bigint,'preview rolls back the correction audit');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.pid(901)),0::bigint,'preview rolls back ordinary domain receipts');
set local role authenticated;
select throws_ok($q$select public.save_past_lesson_state_correction_v1(pg_temp.pid(301),(select plan from before_class),
 pg_temp.target_id(),pg_temp.past_day(),'skipped','active','Synthetic missing acknowledgment',pg_temp.pid(510),null,false)$q$,
 '22023','agent_unknown_occupancy_ack_required','browser save cannot proceed without explicit acknowledgment');
select throws_ok($q$select public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),'{}',
 pg_temp.target_id(),pg_temp.past_day(),'skipped','active','Synthetic stale source',null,false)$q$,
 'P0001','agent_stale','browser correction requires the exact stored source plan');
reset role;

-- Malformed historical sources cannot acquire the exception. The fixture owner
-- temporarily seeds a historical shape in a pgTAP exception subtransaction;
-- each real preview call still performs its complete validation and locks.
create function pg_temp.review_bad_row(p_row jsonb,p_date date default pg_temp.past_day()) returns jsonb language plpgsql as $$begin
 update public.classes set schedule_plan=jsonb_set((select plan from before_class),'{sessions,0}',p_row)
 where id=pg_temp.pid(301);
 perform pg_temp.seed_baseline();
 return public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),
   (select schedule_plan from public.classes where id=pg_temp.pid(301)),
   coalesce(p_row->>'id',pg_temp.target_id()),p_date,'skipped','active','Synthetic boundary test',null,false);
end$$;
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)-'startTime')$q$,'22023',null,'inherited weekly time cannot establish an unknown historical target');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)-'teacherCatalogId')$q$,'22023',null,'historical name alone cannot authorize a resource identity');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)||'{"isForced":true}')$q$,'22023',null,'forced lessons are excluded');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)||'{"originalDate":"2001-01-01"}')$q$,'22023',null,'makeup-linked lessons are excluded');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)||'{"makeupDate":"2001-01-02"}')$q$,'22023',null,'a linked makeup date is excluded');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)||jsonb_build_object('date',pg_temp.past_day()+7),pg_temp.past_day()+7)$q$,'22023',null,'future dates do not receive the past-state exception');
select throws_ok($q$select pg_temp.review_bad_row(pg_temp.lesson(0)||'{"startTime":"17:00:01"}')$q$,'22023',null,'fractional or non-minute historical timing remains invalid');
select throws_ok($q$select public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),(select plan from before_class),'new-id',pg_temp.past_day(),'skipped','active','Synthetic new ID',null,false)$q$,'22023',null,'a new lesson identity cannot be created');
select throws_ok($q$select public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),(select plan from before_class),pg_temp.target_id(),pg_temp.past_day(),'skipped','makeup','Synthetic makeup',null,false)$q$,'22023',null,'makeup state cannot use a normal/holiday correction');
select throws_ok($q$select public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),(select plan from before_class),pg_temp.target_id(),pg_temp.past_day(),'active','active','Synthetic wrong prior state',null,false)$q$,'P0001',null,'the exact previous state is checked');
create function pg_temp.review_bad_plan(p jsonb) returns jsonb language plpgsql as $$begin
 update public.classes set schedule_plan=p where id=pg_temp.pid(301);
 perform pg_temp.seed_baseline();
 return pg_temp.review();
end$$;
select throws_ok($q$select pg_temp.review_bad_plan(jsonb_set((select plan from before_class),'{sessions}',
 (select plan->'sessions' from before_class)||jsonb_build_array(pg_temp.lesson(0)||jsonb_build_object('id','duplicate-date','sessionKey','duplicate-date'))))$q$,
 '22023','agent_ambiguous_lesson','duplicate dates cannot identify one existing historical lesson');
select throws_ok($q$select pg_temp.review_bad_plan(jsonb_set((select plan from before_class),'{sessions}',
 (select plan->'sessions' from before_class)||jsonb_build_array(pg_temp.lesson(0)||jsonb_build_object('date',pg_temp.past_day()-90))))$q$,
 '22023','agent_ambiguous_lesson','duplicate identities cannot identify one existing historical lesson');
select throws_ok($q$select pg_temp.review_bad_plan(jsonb_set((select plan from before_class),
 array['sessionSchedules',pg_temp.past_day()::text,'endTime'],'"18:00"'))$q$,
 '22023','agent_timing_required','conflicting dated resource details must be repaired outside the state-only exception');

create function pg_temp.known_overlap_review(room_only boolean default false) returns jsonb language plpgsql as $$begin
 update public.classes set schedule_plan=jsonb_build_object('sessions',jsonb_build_array(
   pg_temp.lesson(0)||jsonb_build_object('id','known-overlap','sessionKey','known-overlap','state','active','scheduleState','active',
     'startTime','18:00','endTime','20:00',
     'teacherCatalogId',case when room_only then pg_temp.pid(102) else pg_temp.pid(101) end,
     'classroomCatalogId',case when room_only then pg_temp.pid(201) else pg_temp.pid(202) end)))
 where id=pg_temp.pid(401);
 perform pg_temp.seed_baseline();
 return pg_temp.review(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review'));
end$$;
select throws_ok('select pg_temp.known_overlap_review(false)','23P01','timetable_resource_conflict','known teacher overlap remains blocked even with acknowledgment');
select throws_ok('select pg_temp.known_overlap_review(true)','23P01','timetable_resource_conflict','known room overlap remains blocked even with acknowledgment');

-- Synthetic service-only credentials use the existing issuer, read/write scopes
-- and explicit class grants. No new scope or implicit authority is introduced.
set local role authenticated;
insert into ev values('write',public.create_agent_credential_v1('Synthetic correction',array['classes:read','class-details:read','lesson-plan:write'],array[pg_temp.pid(301)],now()+interval '1 day'));
insert into ev values('read',public.create_agent_credential_v1('Synthetic read',array['classes:read','class-details:read'],array[pg_temp.pid(301)],now()+interval '1 day'));
insert into ev values('outside',public.create_agent_credential_v1('Synthetic outside',array['classes:read','class-details:read','lesson-plan:write'],array[pg_temp.pid(401)],now()+interval '1 day'));
insert into ev values('other',public.create_agent_credential_v1('Synthetic second executor',array['classes:read','class-details:read','lesson-plan:write'],array[pg_temp.pid(301)],now()+interval '1 day'));
reset role;
create function pg_temp.api2(action text,input jsonb default '{}',label text default 'write') returns jsonb language sql as $$
 select public.agent_api_v2(encode(sha256(convert_to((select v->>'token' from ev where k=label),'UTF8')),'hex'),action,input)
$$;
create function pg_temp.command(ack boolean default false,h text default null) returns jsonb language sql as $$
 select jsonb_build_object('kind','past_lesson_state_correction','lessonId',pg_temp.target_id(),'date',pg_temp.past_day(),
 'expectedState','skipped','state','active','reason','Administrator confirmed the historical state',
 'window',jsonb_build_object('from',pg_temp.past_day(),'to',pg_temp.past_day()))
 ||case when ack then jsonb_build_object('unknownOccupancyReviewHash',h,'acknowledgeUnknownOccupancy',true) else '{}'::jsonb end
$$;
create function pg_temp.preview_input(cmd jsonb) returns jsonb language sql as $$
 select jsonb_build_object('classId',pg_temp.pid(301),'expectedVersion',
   pg_temp.api2('context',jsonb_build_object('classId',pg_temp.pid(301)))#>>'{data,version}','command',cmd)
$$;
create function pg_temp.commit_input(label text,key int) returns jsonb language sql as $$
 select jsonb_build_object('previewToken',(select v#>>'{data,previewToken}' from ev where k=label),
 'requestKey',pg_temp.pid(key),'sourceReference','synthetic historical confirmation')
$$;
set local role authenticated;
select throws_ok($q$select public.agent_api_v2(repeat('a',64),'preview','{}')$q$,'42501',null,'authenticated cannot invoke the service gateway');
reset role;
set local role service_role;
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()),'read')$q$,'42501','agent_scope_forbidden','read-only credential cannot correct historical state');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()),'outside')$q$,'42501','agent_scope_forbidden','explicit class grant is enforced');
-- A full-plan historical write is still the ordinary prohibited command.
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(jsonb_build_object(
 'reason','Synthetic ordinary past edit','window',jsonb_build_object('from',pg_temp.past_day(),'to',pg_temp.past_day()),
 'changedDates',jsonb_build_array(pg_temp.past_day()),'patch',jsonb_build_object('schedule_plan',pg_temp.next_plan()))))$q$,
 '22023','agent_past_change','ordinary agent past-plan writes remain prohibited');
insert into ev values('agent-review',pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command())));
reset role;
select is((select v#>>'{data,reviewOnly}' from ev where k='agent-review'),'true','unacknowledged agent request returns review only');
select is((select v#>'{data,previewToken}' from ev where k='agent-review'),'null'::jsonb,'review only cannot issue a commit token');
select is((select count(*) from dashboard_private.agent_edit_previews),0::bigint,'review only creates no consumable preview');
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),(select plan from before_class),'agent review leaves the full legacy plan unchanged');

set local role service_role;
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('startTime','18:00')))$q$,
 '22023',null,'state correction cannot smuggle a time change');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('teacherCatalogId',pg_temp.pid(102))))$q$,
 '22023',null,'state correction cannot smuggle a teacher change');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('classroomCatalogId',pg_temp.pid(202))))$q$,
 '22023',null,'state correction cannot smuggle a room change');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('patch',jsonb_build_object('schedule_plan',pg_temp.next_plan()))))$q$,
 '22023',null,'state correction cannot carry an unrestricted replacement plan');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('state','deleted')))$q$,
 '22023',null,'state correction cannot delete a lesson');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||jsonb_build_object('lessonId','new-session')))$q$,
 '22023',null,'agent state correction cannot create a lesson');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()-'state'))$q$,
 '22023','agent_invalid','missing next-state field is rejected before any business mutation');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command()||'{"state":null}'))$q$,
 '22023','agent_invalid','JSON null next-state field is rejected before any business mutation');
insert into ev values('source-stale-preview',pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')))));
reset role;
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),0::bigint,'an acknowledged agent preview rolls back audit writes');
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),(select plan from before_class),'an acknowledged agent preview rolls back state changes');
-- An intervening source-plan change causes a durable failure, without losing
-- the final source-plan edit or applying any historical correction.
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{privateNote}','"SYNTHETIC_CONCURRENT_NOTE"') where id=pg_temp.pid(301);
select pg_temp.seed_baseline();
set local role service_role;
insert into ev values('source-stale-result',pg_temp.api2('commit',pg_temp.commit_input('source-stale-preview',601)));
select is((select v#>>'{data,state}' from ev where k='source-stale-result'),'failed','stale source produces a durable failed operation');
select is((select v#>>'{data,error,code}' from ev where k='source-stale-result'),'agent_stale','stale source retains its typed domain error');
select is(pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.pid(601)))#>>'{data,state}','failed','failed source outcome is available through operation lookup');
select is(pg_temp.api2('commit',pg_temp.commit_input('source-stale-preview',601))#>>'{data,replayed}','true','failed outcomes replay under the original key');
reset role;
select is((select schedule_plan#>>'{sessions,0,scheduleState}' from public.classes where id=pg_temp.pid(301)),'skipped','failed source commit preserves the historical state');
select is((select schedule_plan->>'privateNote' from public.classes where id=pg_temp.pid(301)),'SYNTHETIC_CONCURRENT_NOTE','failed correction preserves the intervening edit');
update public.classes set schedule_plan=(select plan from before_class) where id=pg_temp.pid(301);
select pg_temp.seed_baseline();

-- Only reviewed pre-existing blockers can be acknowledged. A blocker changing
-- after preview is not covered by the old hash, even if the target is unchanged.
set local role service_role;
insert into ev values('unknown-drift-preview',pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')))));
reset role;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,customField}','"SYNTHETIC_CHANGED_OCCUPANCY"') where id=pg_temp.pid(401);
select pg_temp.seed_baseline();
set local role service_role;
insert into ev values('unknown-drift-result',pg_temp.api2('commit',pg_temp.commit_input('unknown-drift-preview',602)));
select is((select v#>>'{data,state}' from ev where k='unknown-drift-result'),'failed','unknown-occupancy drift fails durably');
select is((select v#>>'{data,error,code}' from ev where k='unknown-drift-result'),'agent_review_stale','unknown drift requires a new explicit review');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),(select plan from before_class),'unknown-drift failure leaves target unchanged');
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),0::bigint,'failed review drift cannot create an applied audit');
update public.classes set schedule_plan=(select row->'schedule_plan' from before_other where id=pg_temp.pid(401)) where id=pg_temp.pid(401);
select pg_temp.seed_baseline();

set local role service_role;
insert into ev values('known-race-preview',pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')))));
reset role;
update public.classes set schedule_plan=jsonb_build_object('sessions',jsonb_build_array(
 pg_temp.lesson(0)||jsonb_build_object('id','new-known-collision','sessionKey','new-known-collision',
 'state','active','scheduleState','active','startTime','18:00','endTime','20:00','classroomCatalogId',pg_temp.pid(202)))) where id=pg_temp.pid(401);
select pg_temp.seed_baseline();
set local role service_role;
insert into ev values('known-race-result',pg_temp.api2('commit',pg_temp.commit_input('known-race-preview',603)));
select is((select v#>>'{data,state}' from ev where k='known-race-result'),'failed','a real overlap appearing after preview fails durably');
select is((select v#>>'{data,error,sqlstate}' from ev where k='known-race-result'),'23P01','commit rechecks known collision under the resource lock');
select is((select v#>>'{data,error,code}' from ev where k='known-race-result'),'timetable_resource_conflict','known overlap remains a typed conflict');
reset role;
update public.classes set schedule_plan=(select row->'schedule_plan' from before_other where id=pg_temp.pid(401)) where id=pg_temp.pid(401);
select pg_temp.seed_baseline();

set local role service_role;
insert into ev values('approved-preview',pg_temp.api2('preview',pg_temp.preview_input(pg_temp.command(true,(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')))));
select throws_ok($q$select pg_temp.api2('commit',pg_temp.commit_input('approved-preview',604),'other')$q$,'P0002','agent_not_found','preview token is bound to its exact executor credential');
select throws_ok($q$select pg_temp.api2('commit',pg_temp.commit_input('approved-preview',601))$q$,'22023','agent_idempotency_key_reused','a failed request key cannot be reused with another preview');
insert into ev values('applied',pg_temp.api2('commit',pg_temp.commit_input('approved-preview',604)));
select is((select v#>>'{data,state}' from ev where k='applied'),'applied','acknowledged status-only historical correction applies');
select is(pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.pid(604)))#>>'{data,state}','applied','operation lookup recovers the applied result');
select is(pg_temp.api2('commit',pg_temp.commit_input('approved-preview',604))#>>'{data,replayed}','true','same preview and request key replays the original applied result');
select throws_ok($q$select pg_temp.api2('commit',pg_temp.commit_input('approved-preview',605))$q$,'22023','agent_preview_consumed','a new key cannot execute a consumed preview again');
select throws_ok($q$select pg_temp.api2('commit',pg_temp.commit_input('approved-preview',604)||'{"sourceReference":"changed source"}')$q$,'22023','agent_idempotency_key_reused','replay cannot change the source reference');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),pg_temp.next_plan(),'only the selected row and corresponding existing state entry change');
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.pid(301)),60,'existing sixty lesson identities are retained');
select is((select jsonb_agg(s order by ord) from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions') with ordinality t(s,ord) where c.id=pg_temp.pid(301) and ord>1),
 (select jsonb_agg(s order by ord) from before_class,jsonb_array_elements(plan->'sessions') with ordinality t(s,ord) where ord>1),'all other fifty-nine rows remain byte-for-byte identical');
select is((select (schedule_plan#>'{sessions,0}')-array['state','scheduleState'] from public.classes where id=pg_temp.pid(301)),
 (select (plan#>'{sessions,0}')-array['state','scheduleState'] from before_class),'target identity/date/time/resources/notes/custom content are preserved');
select is((select schedule_plan-array['sessions','sessionStates'] from public.classes where id=pg_temp.pid(301)),
 (select plan-array['sessions','sessionStates'] from before_class),'the complete remaining plan root and dated resource map are preserved');
select ok(not exists(select 1 from before_other b join public.classes c using(id) where b.row<>to_jsonb(c)),'no historical blocker class is rewritten');
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),1::bigint,'one applied correction has exactly one durable attestation');
select ok((select actor_profile_id=pg_temp.pid(901) and class_id=pg_temp.pid(301) and lesson_id=pg_temp.target_id()
 and session_date=pg_temp.past_day() and previous_state='skipped' and next_state='active'
 and reason='Administrator confirmed the historical state' and jsonb_array_length(reviewed_blockers)=23
 and review_hash=(select v->>'unknownOccupancyReviewHash' from ev where k='browser-review')
 and before_plan_hash is distinct from after_plan_hash
 from dashboard_private.past_lesson_state_correction_attestations),'audit pins administrator, reason, exact existing lesson, states, before/after hashes and reviewed blockers');
select is((select v#>>'{data,notifications,state}' from ev where k='applied'),'not_requested','correction never implies a notification was sent');

-- Authorization survives until deferred checks. Public GUC values cannot mint
-- the private, baseline-bound attestation context or broaden its saved change.
select set_config('app.past_lesson_state_correction','true',true);
select set_config('app.allow_unknown_occupancy','true',true);
select set_config('app.class_schedule_mutation','release2-rpc',true);
set local role authenticated;
select throws_ok($q$select * from dashboard_private.past_lesson_state_correction_contexts$q$,'42501',null,'authenticated cannot inspect private guard context');
select throws_ok($q$insert into dashboard_private.past_lesson_state_correction_contexts default values$q$,'42501',null,'authenticated cannot manufacture a guard context');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.pid(301),
 jsonb_build_object('schedule_plan',jsonb_set(schedule_plan,'{sessions,0,startTime}','"18:00"')),pg_temp.pid(606),schedule_plan)
 from public.classes where id=pg_temp.pid(301)$q$,'23P01','timetable_resource_conflict','an applied correction and public GUC cannot authorize a later time edit');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.pid(301),
 jsonb_build_object('schedule_plan',jsonb_set(schedule_plan,'{sessions,0}',(schedule_plan#>'{sessions,0}')-'teacherCatalogId'-'teacherName')),
 pg_temp.pid(607),schedule_plan) from public.classes where id=pg_temp.pid(301)$q$,'23P01','timetable_resource_conflict','the narrow exception never permits a newly unknown occupancy');
reset role;
set constraints all immediate;
select is((select schedule_plan from public.classes where id=pg_temp.pid(301)),pg_temp.next_plan(),'deferred guard accepts exactly the attested state-only correction');
select is((select count(*) from dashboard_private.past_lesson_state_correction_contexts),0::bigint,'deferred baseline cleanup removes its transient guard capability');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'no notification event is produced');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'no external notification delivery is produced');
select is((select count(*) from public.student_class_enrollment_history),(select enrollments from no_send),'student enrollment history is unchanged');
select is((select count(*) from public.makeup_request_events),(select approvals from no_send),'makeup approval history is unchanged');
select ok(not has_function_privilege('anon','public.preview_past_lesson_state_correction_v1(uuid,jsonb,text,date,text,text,text,text,boolean)','execute'),'anonymous cannot review past-state corrections');
select ok(not has_function_privilege('anon','public.save_past_lesson_state_correction_v1(uuid,jsonb,text,date,text,text,text,uuid,text,boolean)','execute'),'anonymous cannot save past-state corrections');
select ok(not has_function_privilege('authenticated','public.agent_api_v2(text,text,jsonb)','execute'),'service gateway remains inaccessible to authenticated clients');

-- The browser writer supports the reverse, explicitly reviewed holiday state
-- with the same raw-plan CAS and ordinary durable request-key receipt contract.
set constraints all deferred;
insert into ev values('browser-cancel-before',(select schedule_plan from public.classes where id=pg_temp.pid(301)));
set local role authenticated;
insert into ev values('browser-cancel-review',public.preview_past_lesson_state_correction_v1(pg_temp.pid(301),
 (select v from ev where k='browser-cancel-before'),pg_temp.target_id(),pg_temp.past_day(),'active','exception','Synthetic confirmed historical holiday',null,false));
insert into ev values('browser-cancel-applied',public.save_past_lesson_state_correction_v1(pg_temp.pid(301),
 (select v from ev where k='browser-cancel-before'),pg_temp.target_id(),pg_temp.past_day(),'active','exception','Synthetic confirmed historical holiday',pg_temp.pid(620),
 (select v->>'unknownOccupancyReviewHash' from ev where k='browser-cancel-review'),true));
select is((select v->>'outcome' from ev where k='browser-cancel-applied'),'applied','browser explicit normal-to-holiday correction applies');
select is(public.save_past_lesson_state_correction_v1(pg_temp.pid(301),
 (select v from ev where k='browser-cancel-before'),pg_temp.target_id(),pg_temp.past_day(),'active','exception','Synthetic confirmed historical holiday',pg_temp.pid(620),
 (select v->>'unknownOccupancyReviewHash' from ev where k='browser-cancel-review'),true),
 (select v from ev where k='browser-cancel-applied'),'browser same key replays exactly the durable receipt');
select throws_ok($q$select public.save_past_lesson_state_correction_v1(pg_temp.pid(301),
 (select v from ev where k='browser-cancel-before'),pg_temp.target_id(),pg_temp.past_day(),'active','exception','Changed reason',pg_temp.pid(620),
 (select v->>'unknownOccupancyReviewHash' from ev where k='browser-cancel-review'),true)$q$,
 '22023',null,'browser same key cannot change the correction payload');
reset role;
set constraints all immediate;
select is((select schedule_plan#>>'{sessions,0,scheduleState}' from public.classes where id=pg_temp.pid(301)),'exception','holiday reads back under the original stored lesson ID');
select is((select schedule_plan#>>'{sessions,0,id}' from public.classes where id=pg_temp.pid(301)),pg_temp.target_id(),'status changes do not regenerate a state-encoded lesson ID');
select is((select count(*) from dashboard_private.past_lesson_state_correction_attestations),2::bigint,'browser replay cannot duplicate its historical-state audit');
select is((select jsonb_agg(s order by ord) from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions') with ordinality t(s,ord) where c.id=pg_temp.pid(301) and ord>1),
 (select jsonb_agg(s order by ord) from before_class,jsonb_array_elements(plan->'sessions') with ordinality t(s,ord) where ord>1),'browser holiday also preserves all fifty-nine unrelated lessons');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'browser correction produces no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'browser correction produces no external delivery');

select * from finish();
rollback;
