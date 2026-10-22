-- Synthetic rollback-only preset policy. No production identifiers or providers.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.oid(n int) returns uuid language sql immutable as $$
 select ('a7261022-0410-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,instance_id,aud,role,email)
values(pg_temp.oid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','owned-preset@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.oid(901),'admin','Synthetic preset actor') on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.oid(101),'Synthetic owned teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.oid(201),'Synthetic owned room',array['영어']);
insert into public.classes(id,name,subject,grade,status,schedule,teacher,room)
values(pg_temp.oid(501),'Synthetic occupied class','영어','중2','수강','화 10:00-11:00','Synthetic owned teacher','Synthetic owned room'),
 (pg_temp.oid(502),'Synthetic import source','영어','중2','개강 준비','화 10:00-11:00','Synthetic owned teacher','Synthetic owned room');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub',pg_temp.oid(901)::text,true);
insert into public.timetable_plans(id,name,created_by)
select pg_temp.oid(n),'Synthetic preset '||n,pg_temp.oid(901) from generate_series(1,6) n;
insert into public.timetable_plan_items(id,plan_id,name,subject)
values(pg_temp.oid(301),pg_temp.oid(1),'Synthetic source','영어'),
 (pg_temp.oid(302),pg_temp.oid(3),'Synthetic applied','영어');
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
values(pg_temp.oid(401),pg_temp.oid(1),pg_temp.oid(301),2,600,660,pg_temp.oid(101),pg_temp.oid(201),'Synthetic owned teacher','Synthetic owned room'),
 (pg_temp.oid(402),pg_temp.oid(3),pg_temp.oid(302),2,600,660,pg_temp.oid(101),pg_temp.oid(201),'Synthetic owned teacher','Synthetic owned room');
insert into dashboard_private.timetable_plan_transfers(id,request_key,actor_id,source_plan_id,result)
values(pg_temp.oid(601),'synthetic-owned-applied',pg_temp.oid(901),pg_temp.oid(3),'{}');
update public.timetable_plan_items set state='applied',applied_transfer_id=pg_temp.oid(601),applied_at=now() where id=pg_temp.oid(302);
-- Transaction-local instrumentation keeps the production reader body/metadata
-- intact and requires no SET privilege or server configuration change. Sequence
-- increments remain visible across pgTAP's exception savepoints.
create temporary sequence owned_reader_calls;
create temporary table owned_reader_definition as
select pg_get_functiondef('dashboard_private.read_timetable_operating_reference_v1()'::regprocedure) definition;
do $instrument$
declare original text; instrumented text;
begin
 select definition into original from owned_reader_definition;
 instrumented:=regexp_replace(original,E'\n[Bb][Ee][Gg][Ii][Nn]\n',E'\nbegin\n perform nextval(''pg_temp.owned_reader_calls'');\n');
 if original=instrumented then raise exception 'reader instrumentation boundary missing'; end if;
 execute instrumented;
end $instrument$;
do $control$ begin perform dashboard_private.read_timetable_operating_reference_v1(); end $control$;
select is((select last_value from owned_reader_calls),1::bigint,'instrumented real operating reader has a positive call counter');
create temp table owned_before as select jsonb_agg(to_jsonb(c) order by id) value from public.classes c;
create temp table owned_catalog_before as select public.get_timetable_plan_revision_v1(pg_temp.oid(1)) value;
create temp table owned_reader_before as select case when is_called then last_value else 0 end calls from owned_reader_calls;
create temp table owned_receipts(key text primary key,command jsonb,result jsonb);
grant all on owned_receipts to authenticated;
grant select on owned_before,owned_catalog_before,owned_reader_before to authenticated;
create function pg_temp.otransfer(target int) returns jsonb language sql as $$
 select jsonb_build_object('source',jsonb_build_object('kind','plan','planId',pg_temp.oid(1)),
 'target',case when target=0 then '{"kind":"operational"}'::jsonb else jsonb_build_object('kind','plan','planId',pg_temp.oid(target)) end,
 'mode','copy','itemIds',jsonb_build_array(pg_temp.oid(301)),'onConflict','reject')
$$;
create function pg_temp.osave(p int,i int,a int default 600,b int default 660) returns jsonb language sql as $$
 select jsonb_build_object('operation','save','expectedItemRevision',null,
 'item',jsonb_build_object('id',pg_temp.oid(i),'planId',pg_temp.oid(p),'name','Synthetic new item','subject','영어','subjectAreaKey',null,'grade','중2','capacity',null,'tuition',null,'defaultTeacherId',pg_temp.oid(101),'defaultClassroomId',pg_temp.oid(201),'durationMinutes',60,'pendingSlots','[]'::jsonb),
 'slots',jsonb_build_array(jsonb_build_object('id',pg_temp.oid(i+100),'planId',pg_temp.oid(p),'itemId',pg_temp.oid(i),'weekday',2,'startMinute',a,'endMinute',b,'teacherId',pg_temp.oid(101),'classroomId',pg_temp.oid(201),'sourceSlotId',null)))
$$;
create function pg_temp.ocommand(p int,i int,batch boolean default false,a int default 600,b int default 660) returns jsonb language sql as $$
 select jsonb_build_object('planId',pg_temp.oid(p),'expectedMetaRevision',(v->>'metaRevision')::int,'expectedShadowFingerprint',v->>'shadowFingerprint','requestKey','owned-'||p||'-'||i)
 ||case when batch then jsonb_build_object('operation','save_batch','expectedChangeSequence',(v->>'changeSequence')::int,'edits',jsonb_build_array(pg_temp.osave(p,i,a,b))) else pg_temp.osave(p,i,a,b) end
 from (select public.get_timetable_plan_revision_v1(pg_temp.oid(p)) v) x
$$;
set local role authenticated;
select is(jsonb_array_length(public.get_timetable_plan_v1(pg_temp.oid(2))->'shadowSlots'),0,'empty preset contains no operating blocks');
select is(jsonb_array_length(public.get_timetable_plan_v1(pg_temp.oid(2))->'slots'),0,'empty preset has no owned draft slots');
select is(jsonb_array_length(public.get_timetable_plan_v1(pg_temp.oid(3))->'appliedSnapshots'),1,'unlinked applied item retains owned snapshot');
select is(public.get_timetable_plan_v1(pg_temp.oid(3))#>>'{appliedSnapshots,0,slots,0,id}',pg_temp.oid(402)::text,'applied slot identity is unchanged');
select is(public.get_timetable_plan_v1(pg_temp.oid(3))#>>'{capacity,slotCount}','1','capacity counts applied placement');
select is(jsonb_array_length(public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(2))->'blockers'),0,'plan target ignores overlapping operating class');
select is(public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(3))#>>'{blockers,0,code}','conflict','target applied placement still blocks actual internal collision');
insert into owned_receipts values('transfer',jsonb_build_object('request',pg_temp.otransfer(2),'previewFingerprint',public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(2))->>'fingerprint','requestKey','owned-transfer'),null);
insert into owned_receipts values('single',pg_temp.ocommand(4,304),null),('batch',pg_temp.ocommand(5,305,true),null);
select lives_ok($q$update owned_receipts set result=public.mutate_timetable_plan_item_v1(command) where key='single'$q$,'single save is independent of operating collision');
select lives_ok($q$update owned_receipts set result=public.mutate_timetable_plan_item_v1(command) where key='batch'$q$,'batch save is independent of operating collision');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.ocommand(3,306))$q$,'23P01','timetable_resource_conflict','single changed slot cannot overlap owned applied placement');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.ocommand(3,306,true))$q$,'23P01','timetable_resource_conflict','batch changed slot cannot overlap owned applied placement');
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.ocommand(3,306,true,660,720))$q$,'adjacent applied placement permits batch');
insert into owned_receipts
select 'import',jsonb_build_object('source',v->'source','sourceFingerprint',v->>'sourceFingerprint','name','Owned import','requestKey','owned-import'),null
from (select public.preview_timetable_plan_import_v1(jsonb_build_object('kind','preparation','classIds',jsonb_build_array(pg_temp.oid(502)))) v) x;
select lives_ok($q$update owned_receipts set result=public.commit_timetable_plan_import_v1(command) where key='import'$q$,'import selected source independently of operating overlap');
select is(jsonb_array_length(public.get_timetable_plan_v1((select (result#>>'{plan,id}')::uuid from owned_receipts where key='import'))->'slots'),1,'import retains placed slot instead of conflict pending');
select is(public.get_timetable_plan_v1((select (result#>>'{plan,id}')::uuid from owned_receipts where key='import'))#>'{items,0,pendingSlots}','[]'::jsonb,'import has no invented pending blocker');
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c),(select value from owned_before),'preset edits and import preserve operating rows exactly');
reset role;
select is((select case when is_called then last_value else 0 end from owned_reader_calls),(select calls from owned_reader_before),'reads single batch and import do not call full operating reader');
-- A real unrelated operating change must not stale an already previewed plan copy.
update public.classes set schedule='화 10:30-11:30' where id=pg_temp.oid(501);
set constraints all immediate;
set constraints all deferred;
update owned_reader_before set calls=(select case when is_called then last_value else 0 end from owned_reader_calls);
set local role authenticated;
select is(public.get_timetable_plan_revision_v1(pg_temp.oid(1)),(select value from owned_catalog_before),'operating change leaves preset revision and catalog fingerprint unchanged');
select lives_ok($q$update owned_receipts set result=public.commit_timetable_plan_transfer_v1(command) where key='transfer'$q$,'plan copy preview survives unrelated operating change');
select is(public.commit_timetable_plan_transfer_v1((select command from owned_receipts where key='transfer')),(select result from owned_receipts where key='transfer'),'plan copy receipt is immutable');
select is(jsonb_array_length(public.get_timetable_plan_v1(pg_temp.oid(2))->'slots'),1,'copy creates exactly one target placement');
select is(public.get_timetable_plan_v1(pg_temp.oid(2))#>>'{slots,0,startMinute}','600','copy retains exact input minutes');
reset role;
select is((select case when is_called then last_value else 0 end from owned_reader_calls),(select calls from owned_reader_before),'plan copy and replay do not call full operating reader');
do $restore$ begin execute (select definition from owned_reader_definition); end $restore$;
select is(pg_get_functiondef('dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),(select definition from owned_reader_definition),'operating reader definition and metadata are exactly restored');
set local role authenticated;
select is(public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(0))#>>'{blockers,0,code}','conflict','operational target retains real conflict policy');
select throws_ok($q$select public.commit_timetable_plan_transfer_v1(jsonb_build_object('request',pg_temp.otransfer(0),'previewFingerprint',public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(0))->>'fingerprint','requestKey','owned-operational-conflict'))$q$,'23P01','timetable_resource_conflict','operational conflict SQLSTATE unchanged');
reset role;
update public.timetable_plan_slots set weekday=4 where id=pg_temp.oid(401);
set local role authenticated;
insert into owned_receipts values('operational',jsonb_build_object('request',pg_temp.otransfer(0),'previewFingerprint',public.preview_timetable_plan_transfer_v1(pg_temp.otransfer(0))->>'fingerprint','requestKey','owned-operational-success'),null);
select lives_ok($q$update owned_receipts set result=public.commit_timetable_plan_transfer_v1(command) where key='operational'$q$,'safe operational copy still creates the requested active class');
select is((select c.status from public.classes c where c.id=(select (result#>>'{mappings,0,targetClassId}')::uuid from owned_receipts where key='operational')),'수강','default operational status is unchanged');
select is((select result#>>'{snapshot,appliedSnapshots,0,slots,0,id}' from owned_receipts where key='operational'),pg_temp.oid(401)::text,'operational copy returns owned applied slot identity');
select is((select result->'addedShadowSlots' from owned_receipts where key='operational'),'[]'::jsonb,'operational receipt does not inject operating shadows into preset');
savepoint catalog_cas;
insert into owned_receipts values('catalog-stale',pg_temp.ocommand(6,308),null);
reset role;
update public.classroom_catalogs set is_visible=false where id=pg_temp.oid(201);
set local role authenticated;
select throws_ok($q$select public.mutate_timetable_plan_item_v1((select command from owned_receipts where key='catalog-stale'))$q$,'P0001','timetable_stale','real catalog change invalidates stale preset command');
rollback to catalog_cas;
-- Removing the last retained tombstone changes display catalogs, not the external
-- catalog CAS token. The unchanged wire contract must accept its batch receipt.
reset role;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.oid(102),'Synthetic removed teacher',array['영어']);
insert into public.timetable_plans(id,name,created_by) values(pg_temp.oid(7),'Synthetic tombstone',pg_temp.oid(901));
insert into public.timetable_plan_items(id,plan_id,name,subject) values(pg_temp.oid(307),pg_temp.oid(7),'Synthetic removed-resource slot','영어');
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
values(pg_temp.oid(407),pg_temp.oid(7),pg_temp.oid(307),1,600,660,pg_temp.oid(102),pg_temp.oid(201),'Synthetic removed teacher','Synthetic owned room');
delete from public.teacher_catalogs where id=pg_temp.oid(102);
set local role authenticated;
insert into owned_receipts select 'tombstone',jsonb_build_object('operation','save_batch','planId',pg_temp.oid(7),'expectedMetaRevision',0,'expectedChangeSequence',0,'expectedShadowFingerprint',public.get_timetable_plan_revision_v1(pg_temp.oid(7))->>'shadowFingerprint','requestKey','owned-tombstone','edits',jsonb_build_array(jsonb_build_object('operation','delete','itemId',pg_temp.oid(307),'expectedItemRevision',1))),null;
select lives_ok($q$update owned_receipts set result=public.mutate_timetable_plan_item_v1(command) where key='tombstone'$q$,'last tombstone removal commits normally');
select is((select result#>>'{snapshot,shadowFingerprint}' from owned_receipts where key='tombstone'),(select command->>'expectedShadowFingerprint' from owned_receipts where key='tombstone'),'own tombstone removal does not change catalog CAS fingerprint');
-- SQL producer outputs are passed to the real JS consumers by the local runner.
select jsonb_build_object('presetOwnedConsumer',true,'empty',public.get_timetable_plan_v1(pg_temp.oid(6)),
 'applied',public.get_timetable_plan_v1(pg_temp.oid(3)),
 'batchCommand',(select command from owned_receipts where key='batch'),'batch',(select result from owned_receipts where key='batch'),
 'tombstoneCommand',(select command from owned_receipts where key='tombstone'),'tombstone',(select result from owned_receipts where key='tombstone'),
 'transfer',(select result from owned_receipts where key='transfer'),
 'operational',(select result from owned_receipts where key='operational'));
reset role;
select * from finish();
rollback;
