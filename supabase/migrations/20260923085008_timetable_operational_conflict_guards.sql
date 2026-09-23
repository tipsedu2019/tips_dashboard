-- Operational timetable writes share a single transaction advisory lock.
-- Baselines are private and removed by their deferred final-state check.

CREATE OR REPLACE FUNCTION dashboard_private.read_timetable_weekly_reference_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; classes jsonb:='[]'; teachers jsonb; rooms jsonb; payload jsonb; count_parts int; invalid boolean; raw_state jsonb:='[]';
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into teachers from public.teacher_catalogs;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into rooms from public.classroom_catalogs;
 for c in select id,name,subject,grade,status,schedule_revision,schedule_storage_mode,schedule,teacher,room from public.classes
 where dashboard_private.academic_class_status_v1(status,nullif(btrim(start_date),'')::date,nullif(btrim(end_date),'')::date)='수강' order by id loop
 classes:=classes||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status','수강','revision',c.schedule_revision));
 raw_state:=raw_state||to_jsonb(c);
 count_parts:=0; invalid:=false;
 if c.schedule_storage_mode='normalized' then
 for s in select * from public.class_schedule_slots where class_id=c.id order by id loop
 count_parts:=count_parts+1;
 raw_state:=raw_state||jsonb_build_object('normalizedSlot',to_jsonb(s));
 if s.teacher_catalog_id is null or s.classroom_catalog_id is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0 then invalid:=true; continue; end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||s.id::text,'sourceSlotId',s.id,'classId',c.id,'weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'classRevision',c.schedule_revision));
 end loop;
 else
 -- Strict complete tokens only. Multi-resource legacy strings remain blocked
 -- unless each whole schedule line can resolve its exact catalog labels.
 for piece in select btrim(x) from regexp_split_to_table(coalesce(c.schedule,''), E'[\\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x loop
 parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]+),[[:space:]]*([^()]+)[)])?$');
 if parts is null then invalid:=true; continue; end if;
 select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(coalesce(parts[5],c.teacher)) having count(*)=1;
 select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(coalesce(parts[6],c.room)) having count(*)=1;
 if tid is null or rid is null then invalid:=true; continue; end if;
 startm:=split_part(parts[2],':',1)::int*60+split_part(parts[2],':',2)::int;
 endm:=split_part(parts[3],':',1)::int*60+split_part(parts[3],':',2)::int;
 if split_part(parts[2],':',2)::int>59 or split_part(parts[3],':',2)::int>59 or startm<0 or startm>=endm or endm>1440 then invalid:=true;continue;end if;
 days:=regexp_replace(parts[1],'[ /,]','','g');
 for d in select regexp_split_to_table(days,'') loop
 count_parts:=count_parts+1;
 sid:=md5(c.id::text||':'||piece||':'||d)::uuid;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||sid::text,'sourceSlotId',null,'classId',c.id,'weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 end loop;
 end if;
 if invalid or count_parts=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','occupancyFingerprint',md5(((to_jsonb(c)-array['name','subject','grade','schedule_revision'])||jsonb_build_object('slots',(select coalesce(jsonb_agg(jsonb_build_array(z.id,z.weekday,z.start_time,z.end_time,z.teacher_catalog_id,z.classroom_catalog_id) order by z.id),'[]') from public.class_schedule_slots z where z.class_id=c.id)))::text))); end if;
 end loop;
 payload:=jsonb_build_object('shadowSlots',slots,'shadowClasses',classes,'catalogs',jsonb_build_object('teachers',teachers,'classrooms',rooms),'unresolvedOccupancies',blockers,'complete',jsonb_array_length(blockers)=0);
 return payload||jsonb_build_object('shadowFingerprint',md5((payload||jsonb_build_object('source',raw_state))::text));
end $function$
;


-- Source-slot authority is explicit. Legacy sessions never infer a source slot.
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c record; s record; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; raw jsonb:='[]';
begin
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 for s in select lesson.*,class_row.name from public.class_lesson_sessions lesson join public.classes class_row on class_row.id=lesson.class_id where class_row.schedule_storage_mode='normalized' order by lesson.id loop
 raw:=raw||jsonb_build_array(jsonb_build_object('id',s.id,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'start',s.start_time,'end',s.end_time,'teacher',s.teacher_catalog_id,'room',s.classroom_catalog_id,'revision',s.revision));
 if s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or s.classroom_catalog_id is null or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0) then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'sessionId',s.id,'occupancyFingerprint',md5(jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)::text)));
 end if;
 dated:=dated||jsonb_build_array(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision));
 end loop;
 for c in select id,name,schedule_plan from public.classes where schedule_storage_mode<>'normalized' order by id loop
 if c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions')<>'array' then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null));continue;end if;
 for v in select value from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) loop
 -- Content-only fields are deliberately absent from the fingerprint.
 state:=coalesce(nullif(v->>'scheduleState',''),'active');
 if state in('skipped','tbd') then continue;end if;
 raw:=raw||jsonb_build_array(jsonb_build_object('classId',c.id,'session',v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent']));
 begin
 dt:=(v->>'date')::date;
 a:=extract(epoch from (v->>'startTime')::time)::int/60;b:=extract(epoch from (v->>'endTime')::time)::int/60;
 tid:=nullif(v->>'teacherCatalogId','')::uuid;rid:=nullif(v->>'classroomCatalogId','')::uuid;
 if tid is null then select min(id::text)::uuid into tid from public.teacher_catalogs where name=v->>'teacherName' having count(*)=1;end if;
 if rid is null then select min(id::text)::uuid into rid from public.classroom_catalogs where name=v->>'classroomName' having count(*)=1;end if;
 if dt is null or a is null or b is null or a>=b or tid is null or rid is null or state not in('active','exception','makeup') or not exists(select 1 from public.teacher_catalogs where id=tid) or not exists(select 1 from public.classroom_catalogs where id=rid) then raise exception 'unresolved';end if;
 ident:=coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''));
 if ident is null or (select count(*) from jsonb_array_elements(c.schedule_plan->'sessions') x where coalesce(x->>'id',x->>'sessionKey')=ident)>1 then raise exception 'unresolved';end if;
 dated:=dated||jsonb_build_array(jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0));
 exception when others then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null,'occupancyFingerprint',md5((v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent'])::text)));
 end;
 end loop;
 end loop;
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',md5((dated||blockers||raw)::text),'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||md5((dated||blockers||raw)::text)));
end $f$;

create or replace function public.get_timetable_operational_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
 if not public.can_read_timetable_operating_signal_v1() then raise exception using errcode='42501',message='timetable_forbidden';end if;
 return dashboard_private.read_timetable_operating_reference_v1();
end $f$;

-- Effective reservations for one date. Any matching source/date session replaces
-- its default, including skipped/tbd; source-less legacy sessions remain additive.
create or replace function dashboard_private.timetable_effective_date_v1(r jsonb, d date)
returns setof jsonb language sql stable set search_path='' as $f$
 select x||jsonb_build_object('date',d) from jsonb_array_elements(r->'shadowSlots') x
 where d>=(r->>'asOfDate')::date and (x->>'weekday')::int=extract(dow from d)::int and not exists(
 select 1 from jsonb_array_elements(r->'datedSessions') s where s->>'classId'=x->>'classId' and s->>'sourceSlotId'=x->>'sourceSlotId' and (s->>'date')::date=d)
 union all
 select s from jsonb_array_elements(r->'datedSessions') s where (s->>'date')::date=d and s->>'state' in('active','exception','makeup')
$f$;

create or replace function dashboard_private.timetable_occupancy_key_v1(s jsonb)
returns jsonb language sql immutable set search_path='' as $f$
 select jsonb_build_array(case when s->>'sourceSlotId' is not null then to_jsonb('live:'||(s->>'classId')||':'||(s->>'sourceSlotId')) else s->'id' end,s->'classId',case when s ? 'date' then to_jsonb(extract(dow from (s->>'date')::date)::int) else s->'weekday' end,s->'date',s->'startMinute',s->'endMinute',s->'teacherId',s->'classroomId')
$f$;
create or replace function dashboard_private.timetable_intersects_v1(a jsonb,b jsonb)
returns boolean language sql immutable set search_path='' as $f$
 select a->>'id'<>b->>'id' and (a->>'startMinute')::int<(b->>'endMinute')::int and (b->>'startMinute')::int<(a->>'endMinute')::int
 and (a->>'teacherId'=b->>'teacherId' or a->>'classroomId'=b->>'classroomId' or a->>'classId'=b->>'classId')
$f$;

create table dashboard_private.timetable_operating_write_baselines (
 transaction_id bigint primary key, reference jsonb not null, ready boolean not null default false
);
alter table dashboard_private.timetable_operating_write_baselines owner to postgres;
alter table dashboard_private.timetable_operating_write_baselines enable row level security;
revoke all on dashboard_private.timetable_operating_write_baselines from public,anon,authenticated;

create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where b->>'date' is null or ((b->>'date')::date >= (newref->>'asOfDate')::date and extract(dow from (b->>'date')::date)::int=(x->>'weekday')::int)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- All actual dates are checked, including sessions under closed/preparing classes.
 -- Comparing effective occupancy also detects a removed skipped override which
 -- newly exposes a weekly default at that date.
 for d in select distinct (value->>'date')::date from jsonb_array_elements((oldref->'datedSessions')||(newref->'datedSessions')) loop
 select coalesce(jsonb_agg(v),'[]') into oldday from dashboard_private.timetable_effective_date_v1(oldref,d) v;
 select coalesce(jsonb_agg(v),'[]') into newday from dashboard_private.timetable_effective_date_v1(newref,d) v;
 for x in select value from jsonb_array_elements(newday) loop
 if (select count(*) from jsonb_array_elements(oldday) b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) >= (select count(*) from jsonb_array_elements(newday) b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
end $f$;

create or replace function dashboard_private.timetable_operating_before_statement_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if not exists(select 1 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()) then
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
 values(txid_current(),dashboard_private.read_timetable_operating_reference_v1());
 end if;
 return null;
end $f$;
create or replace function dashboard_private.timetable_operating_after_statement_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 -- The UPDATE event (not the BEFORE capture INSERT) is the deferred finalizer.
 -- This also works with SET CONSTRAINTS IMMEDIATE and zero-row statements.
 update dashboard_private.timetable_operating_write_baselines set ready=true where transaction_id=txid_current();
 return null;
end $f$;
create or replace function dashboard_private.timetable_operating_finalize_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; r jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=new.transaction_id;
 if oldref is null then return null;end if;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
 r:=dashboard_private.read_timetable_operating_reference_v1();
 if oldref->>'shadowFingerprint' is distinct from r->>'shadowFingerprint' then
 update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
 end if;
 delete from dashboard_private.timetable_operating_write_baselines where transaction_id=new.transaction_id;
 return null;
end $f$;
create constraint trigger timetable_operating_finalize after update on dashboard_private.timetable_operating_write_baselines deferrable initially deferred for each row execute function dashboard_private.timetable_operating_finalize_v1();

create trigger timetable_operating_before before insert or delete or update of schedule,teacher,room,status,start_date,end_date,schedule_storage_mode,schedule_plan on public.classes for each statement execute function dashboard_private.timetable_operating_before_statement_v1();

create trigger timetable_operating_after after insert or delete or update of schedule,teacher,room,status,start_date,end_date,schedule_storage_mode,schedule_plan on public.classes for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

create trigger timetable_operating_before before insert or delete or update of weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id on public.class_schedule_slots for each statement execute function dashboard_private.timetable_operating_before_statement_v1();

create trigger timetable_operating_after after insert or delete or update of weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id on public.class_schedule_slots for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

create trigger timetable_operating_before before insert or delete or update of session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id,source_schedule_slot_id on public.class_lesson_sessions for each statement execute function dashboard_private.timetable_operating_before_statement_v1();

create trigger timetable_operating_after after insert or delete or update of session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id,source_schedule_slot_id on public.class_lesson_sessions for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

create trigger timetable_operating_before before insert or delete or update of name,is_visible,subjects on public.teacher_catalogs for each statement execute function dashboard_private.timetable_operating_before_statement_v1();

create trigger timetable_operating_after after insert or delete or update of name,is_visible,subjects on public.teacher_catalogs for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

create trigger timetable_operating_before before insert or delete or update of name,is_visible,subjects on public.classroom_catalogs for each statement execute function dashboard_private.timetable_operating_before_statement_v1();

create trigger timetable_operating_after after insert or delete or update of name,is_visible,subjects on public.classroom_catalogs for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

CREATE OR REPLACE FUNCTION dashboard_private.transition_makeup_request_v2_unguarded(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  actor_role text;
  before_row public.makeup_requests%rowtype;
  after_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
  event_type text;
  note text := nullif(pg_catalog.btrim(coalesce(p_patch ->> 'note', '')), '');
  next_status text;
  latest_refund_at timestamptz;
  latest_submit_or_approve_at timestamptz;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_command = 'approve' then
    if (select auth.role()) is distinct from 'service_role' then
      raise exception 'makeup_approval_server_required' using errcode = '42501';
    end if;
    actor_id := nullif(p_patch ->> 'actor_profile_id', '')::uuid;
    select profile.role into actor_role
    from public.profiles profile
    where profile.id = actor_id;
  else
    actor_id := (select auth.uid());
    actor_role := public.current_dashboard_role();
  end if;
  if actor_id is null or p_makeup_request_id is null or p_request_id is null
    or p_command is null
    or p_expected_status is null or p_patch is null
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or p_command not in (
      'approve', 'revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'resubmit', 'approval_canceled'
    )
  then
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

    if (p_command = 'approve' and p_patch - array[
      'actor_profile_id', 'final_note', 'schedule_plan_before', 'schedule_plan_after',
      'cancel_academic_event_id', 'makeup_academic_event_id',
      'makeup_academic_event_ids', 'calendar_events'
    ]::text[] <> '{}'::jsonb)
    or (p_command in ('revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'approval_canceled')
      and p_patch - array['note']::text[] <> '{}'::jsonb)
    or (p_command = 'resubmit' and p_patch - array[
      'request_kind', 'subject', 'approval_group', 'teacher_catalog_id',
      'teacher_profile_id', 'class_id', 'class_name', 'reason', 'cancel_date',
      'makeup_start_at', 'makeup_end_at', 'makeup_classroom', 'makeup_slots',
      'approver_teacher_catalog_id', 'approver_profile_id'
    ]::text[] <> '{}'::jsonb)
  then
    raise exception 'makeup_request_transition_patch_invalid' using errcode = '22023';
  end if;

  fingerprint := pg_catalog.md5((case
    when p_command = 'approve' then pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'final_note', p_patch ->> 'final_note',
      'expected_status', p_expected_status
    )
    else pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'patch', p_patch,
      'expected_status', p_expected_status
    )
  end)::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'transition_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  select request.* into before_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if before_row.status <> p_expected_status then
    raise exception 'makeup_request_stale_status' using errcode = '40001';
  end if;

  if p_command = 'approve' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    select pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type = 'refund_requested'
    ), pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type in ('submitted', 'resubmitted', 'approved')
    ) into latest_refund_at, latest_submit_or_approve_at
    from public.makeup_request_events event_row
    where event_row.request_id = before_row.id;
    next_status := case
      when latest_refund_at is not null
        and latest_refund_at > coalesce(latest_submit_or_approve_at, '-infinity'::timestamptz)
        then 'refund_pending'
      when before_row.request_kind in ('cancel_makeup', 'makeup_only') then 'completed'
      else 'makeup_pending'
    end;
    if next_status = 'refund_pending' then
      if p_patch - array['actor_profile_id', 'final_note']::text[] <> '{}'::jsonb then
        raise exception 'makeup_refund_approval_patch_invalid' using errcode = '22023';
      end if;
    else
      if not (
        p_patch ? 'schedule_plan_before'
        and p_patch ? 'schedule_plan_after'
        and p_patch ? 'makeup_academic_event_ids'
        and p_patch ? 'calendar_events'
      ) then
        raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
      end if;
      perform 1
      from public.classes class_row
      where class_row.id = before_row.class_id
      for update of class_row;
      if not found then
        raise exception 'makeup_request_source_changed' using errcode = '40001';
      end if;
      if not exists (
        select 1
        from public.classes class_row
        join public.teacher_catalogs teacher
          on teacher.id = before_row.teacher_catalog_id
        join public.teacher_catalogs approver
          on approver.id = before_row.approver_teacher_catalog_id
        where class_row.id = before_row.class_id
          and pg_catalog.btrim(class_row.name) = pg_catalog.btrim(before_row.class_name)
          and pg_catalog.btrim(class_row.subject) = pg_catalog.btrim(before_row.subject)
          and pg_catalog.btrim(teacher.name) = pg_catalog.btrim(class_row.teacher)
          and teacher.profile_id is not distinct from before_row.teacher_profile_id
          and approver.profile_id is not distinct from before_row.approver_profile_id
      ) then
        raise exception 'makeup_request_source_changed' using errcode = '40001';
      end if;
      perform dashboard_private.notification_assert_makeup_room_available_v1(
        before_row.id
      );
      perform dashboard_private.notification_apply_makeup_calendar_effects_v1(
        before_row.id,
        before_row.class_id,
        p_patch -> 'schedule_plan_before',
        p_patch -> 'schedule_plan_after',
        nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid,
        nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid,
        p_patch -> 'makeup_academic_event_ids',
        p_patch -> 'calendar_events'
      );
    end if;
    update public.makeup_requests request
    set status = next_status,
        approved_by = actor_id,
        approved_at = pg_catalog.clock_timestamp(),
        completed_by = case when next_status = 'completed' then actor_id else null end,
        completed_at = case when next_status = 'completed'
          then pg_catalog.clock_timestamp() else null end,
        final_note = nullif(p_patch ->> 'final_note', ''),
        returned_reason = null,
        rejected_reason = null,
        schedule_plan_before = case when next_status = 'refund_pending'
          then request.schedule_plan_before else p_patch -> 'schedule_plan_before' end,
        schedule_plan_after = case when next_status = 'refund_pending'
          then request.schedule_plan_after else p_patch -> 'schedule_plan_after' end,
        cancel_academic_event_id = case when next_status = 'refund_pending'
          then request.cancel_academic_event_id
          else nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid end,
        makeup_academic_event_id = case when next_status = 'refund_pending'
          then request.makeup_academic_event_id
          else nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid end,
        makeup_academic_event_ids = case when next_status = 'refund_pending'
          then request.makeup_academic_event_ids
          else p_patch -> 'makeup_academic_event_ids' end
    where request.id = before_row.id
    returning * into after_row;
    event_type := 'approved';
    note := nullif(p_patch ->> 'final_note', '');
  elsif p_command = 'revision_requested' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'revision_requested', returned_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'revision_requested';
  elsif p_command = 'reject' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'rejected', rejected_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'rejected';
  elsif p_command = 'refund_requested' then
    if before_row.status <> 'makeup_pending'
      or not (
        coalesce(before_row.requester_id = actor_id, false)
        or coalesce(actor_role in ('admin', 'staff'), false)
      )
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null,
        final_note = null,
        returned_reason = null,
        rejected_reason = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_requested';
  elsif p_command = 'refund_completed' then
    if before_row.status <> 'refund_pending'
      or coalesce(actor_role in ('admin', 'staff'), false) = false
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'completed',
        completed_by = actor_id,
        completed_at = pg_catalog.clock_timestamp(),
        final_note = coalesce(note, request.final_note)
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_completed';
  elsif p_command = 'resubmit' then
    if before_row.status <> 'revision_requested'
      or before_row.requester_id is distinct from actor_id
      or not coalesce(
        dashboard_private.notification_makeup_input_valid_v1(
          p_patch || pg_catalog.jsonb_build_object('requester_id', before_row.requester_id),
          before_row.created_at
        ),
        false
      )
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        request_kind = p_patch ->> 'request_kind',
        subject = p_patch ->> 'subject',
        approval_group = p_patch ->> 'approval_group',
        teacher_catalog_id = nullif(p_patch ->> 'teacher_catalog_id', '')::uuid,
        teacher_profile_id = nullif(p_patch ->> 'teacher_profile_id', '')::uuid,
        class_id = nullif(p_patch ->> 'class_id', '')::uuid,
        class_name = coalesce(p_patch ->> 'class_name', ''),
        reason = coalesce(p_patch ->> 'reason', ''),
        cancel_date = nullif(p_patch ->> 'cancel_date', '')::date,
        makeup_start_at = nullif(p_patch ->> 'makeup_start_at', '')::timestamptz,
        makeup_end_at = nullif(p_patch ->> 'makeup_end_at', '')::timestamptz,
        makeup_classroom = nullif(p_patch ->> 'makeup_classroom', ''),
        makeup_slots = coalesce(p_patch -> 'makeup_slots', '[]'::jsonb),
        approver_teacher_catalog_id = nullif(
          p_patch ->> 'approver_teacher_catalog_id', ''
        )::uuid,
        approver_profile_id = nullif(p_patch ->> 'approver_profile_id', '')::uuid,
        returned_reason = null,
        rejected_reason = null,
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'resubmitted';
  elsif p_command = 'approval_canceled' then
    if (
      (before_row.status = 'completed'
        and coalesce(before_row.approver_profile_id = actor_id, false))
      or (before_row.status = 'makeup_pending'
        and (
          coalesce(before_row.approver_profile_id = actor_id, false)
          or coalesce(actor_role in ('admin', 'staff'), false)
        ))
    ) is not true then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    perform dashboard_private.notification_revert_makeup_calendar_effects_v1(
      before_row.id,
      before_row.class_id,
      before_row.schedule_plan_before,
      before_row.schedule_plan_after,
      before_row.cancel_academic_event_id,
      before_row.makeup_academic_event_id,
      before_row.makeup_academic_event_ids
    );
    update public.makeup_requests request
    set status = 'canceled',
        canceled_by = actor_id,
        canceled_at = pg_catalog.clock_timestamp()
    where request.id = before_row.id returning * into after_row;
    event_type := 'approval_canceled';
  else
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    after_row.id,
    event_type,
    before_row.status,
    after_row.status,
    note,
    p_request_id,
    actor_id
  );
  if event_type = 'approval_canceled' then
    perform dashboard_private.cancel_makeup_unsent_deliveries_v1(
      after_row.id,
      (source_result ->> 'canonical_event_id')::uuid
    );
  end if;
  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(after_row),
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'transition_makeup_request_v2', fingerprint, response);
  return response;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.notification_revert_makeup_calendar_effects_legacy_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
  then
    raise exception 'makeup_calendar_revert_invalid' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_before
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) in (
      p_schedule_plan_before,
      p_schedule_plan_after
    );
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = '40001';
  end if;

  delete from public.academic_events event_row
  where pg_catalog.strpos(coalesce(event_row.note, ''), '[[TIPS_MAKEUP]]') > 0
    and pg_catalog.strpos(coalesce(event_row.note, ''), p_request_id::text) > 0
    and (
      event_row.id = p_cancel_academic_event_id
      or event_row.id = p_makeup_academic_event_id
      or event_row.id::text in (
        select item.value
        from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
      )
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.delete_makeup_request_v2_unguarded(p_makeup_request_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := public.current_dashboard_role();
  request_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if actor_id is null or p_makeup_request_id is null or p_request_id is null then
    raise exception 'makeup_request_delete_invalid' using errcode = '22023';
  end if;
  fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', actor_id,
    'makeup_request_id', p_makeup_request_id
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'delete_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  select request.* into request_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if actor_role <> 'admin'
    or request_row.status not in ('completed', 'rejected', 'canceled')
  then
    raise exception 'makeup_request_delete_forbidden' using errcode = '42501';
  end if;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    request_row.id,
    'deleted',
    request_row.status,
    'deleted',
    null,
    p_request_id,
    actor_id
  );
  perform dashboard_private.cancel_makeup_unsent_deliveries_v1(
    request_row.id,
    (source_result ->> 'canonical_event_id')::uuid
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind,
    entity_id,
    action,
    actor_profile_id,
    actor_kind,
    request_id,
    before_summary,
    after_summary,
    reason_code
  ) values (
    'makeup_request',
    request_row.id::text,
    'makeup_request_deleted',
    actor_id,
    'user',
    p_request_id,
    pg_catalog.jsonb_build_object('status', request_row.status),
    pg_catalog.jsonb_build_object('status', 'deleted'),
    'operator_hard_delete'
  );
  delete from public.makeup_requests request where request.id = request_row.id;

  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(request_row),
    'deleted', true,
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'delete_makeup_request_v2', fingerprint, response);
  return response;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_makeup_request_v2(p_input jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.create_makeup_request_v2_unguarded(
    p_input,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transition_makeup_request_v2(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(p_patch);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.transition_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_command,
    p_patch,
    p_expected_status,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_makeup_request_v2(p_makeup_request_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.delete_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id uuid, p_require_runtime_ready boolean DEFAULT true, p_require_normalized boolean DEFAULT true, p_allow_closed_correction boolean DEFAULT false, p_correction_reason text DEFAULT NULL::text)
 RETURNS classes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.classes%rowtype;
  v_actor uuid;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  select * into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;

  if p_require_runtime_ready
    and public.continuous_class_schedule_runtime_version() <> 1
  then
    raise exception 'continuous_class_schedule_runtime_not_ready' using errcode = 'P0001';
  end if;
  if p_require_normalized and v_class.schedule_storage_mode <> 'normalized' then
    raise exception 'class_schedule_not_normalized' using errcode = 'P0001';
  end if;
  if v_class.closed_at is not null then
    if not p_allow_closed_correction
      or public.current_dashboard_role() <> 'admin'
      or nullif(btrim(coalesce(p_correction_reason, '')), '') is null
    then
      raise exception 'class_schedule_closed' using errcode = '42501';
    end if;
  end if;
  return v_class;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.project_continuous_class_schedule_plan_v1(p_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan jsonb;
  v_sessions jsonb;
  v_index integer;
  v_item jsonb;
  v_patch jsonb;
  v_found boolean;
  v_session record;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select coalesce(schedule_plan, '{}'::jsonb) into v_plan
  from public.classes where id = p_class_id for update;
  if jsonb_typeof(v_plan -> 'sessions') <> 'array' then
    v_sessions := '[]'::jsonb;
  else
    v_sessions := v_plan -> 'sessions';
  end if;

  for v_session in
    select * from public.class_lesson_sessions
    where class_id = p_class_id
    order by session_date, start_time nulls last, session_key
  loop
    v_patch := jsonb_build_object(
      'id', v_session.session_key,
      'date', v_session.session_date,
      'scheduleState', v_session.schedule_state,
      'startTime', v_session.start_time,
      'endTime', v_session.end_time,
      'teacherCatalogId', v_session.teacher_catalog_id,
      'teacherName', v_session.teacher_name_snapshot,
      'classroomCatalogId', v_session.classroom_catalog_id,
      'classroomName', v_session.classroom_name_snapshot,
      'memo', v_session.memo,
      'publicNote', v_session.public_note,
      'teacherNote', v_session.teacher_note,
      'revision', v_session.revision,
      'legacyBillingId', v_session.legacy_billing_id,
      'legacyBillingLabel', v_session.legacy_billing_label,
      'legacyBillingColor', v_session.legacy_billing_color
    );
    v_found := false;
    for v_index in 0..greatest(jsonb_array_length(v_sessions) - 1, 0) loop
      exit when jsonb_array_length(v_sessions) = 0;
      v_item := v_sessions -> v_index;
      if coalesce(v_item ->> 'id', v_item ->> 'sessionKey', v_item ->> 'session_key') = v_session.session_key then
        v_sessions := jsonb_set(v_sessions, array[v_index::text], v_item || v_patch, false);
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_sessions := v_sessions || jsonb_build_array(v_patch);
    end if;
  end loop;

  v_plan := jsonb_set(v_plan, '{sessions}', v_sessions, true);
  update public.classes set schedule_plan = v_plan where id = p_class_id;
  return v_plan;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.save_continuous_schedule_defaults_rows_v1(p_class classes, p_slots jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_slot jsonb;
  v_slot_id uuid;
  v_weekday smallint;
  v_start_time time;
  v_end_time time;
  v_teacher_id uuid;
  v_classroom_id uuid;
  v_teacher_name text;
  v_classroom_name text;
  v_sort_order integer;
  v_seen uuid[] := '{}'::uuid[];
  v_seen_keys text[] := '{}'::text[];
  v_slot_key text;
  v_varied_resources boolean;
  v_projected_schedule text;
  v_projected_teacher text;
  v_projected_room text;
  v_updated integer;
  v_changed boolean := false;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 64 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  set constraints public.class_schedule_slots_class_time_key deferred;
  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(v_slot) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_slot) key
        where key not in ('id', 'weekday', 'startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'sortOrder')
      )
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    begin
      v_slot_id := nullif(v_slot ->> 'id', '')::uuid;
      v_weekday := (v_slot ->> 'weekday')::smallint;
      v_start_time := (v_slot ->> 'startTime')::time;
      v_end_time := (v_slot ->> 'endTime')::time;
      v_teacher_id := nullif(v_slot ->> 'teacherCatalogId', '')::uuid;
      v_classroom_id := nullif(v_slot ->> 'classroomCatalogId', '')::uuid;
      v_sort_order := (v_slot ->> 'sortOrder')::integer;
    exception when others then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end;
    if v_weekday is null or v_weekday not between 0 and 6
      or v_start_time is null or v_end_time is null or v_start_time >= v_end_time
      or v_sort_order is null or v_sort_order < 0 then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_slot_key := v_weekday::text || ':' || to_char(v_start_time, 'HH24:MI:SS')
      || ':' || to_char(v_end_time, 'HH24:MI:SS');
    if v_slot_key = any(v_seen_keys) then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_slot_key);
    v_teacher_name := dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher', v_teacher_id, p_class.subject);
    v_classroom_name := dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom', v_classroom_id, p_class.subject);
    if v_slot_id is null then
      insert into public.class_schedule_slots (
        class_id, weekday, start_time, end_time, teacher_catalog_id, teacher_name,
        classroom_catalog_id, classroom_name, sort_order
      ) values (
        p_class.id, v_weekday, v_start_time, v_end_time, v_teacher_id, v_teacher_name,
        v_classroom_id, v_classroom_name, v_sort_order
      ) returning id into v_slot_id;
      v_changed := true;
    else
      if v_slot_id = any(v_seen) then
        raise exception 'class_schedule_validation' using errcode = '22023';
      end if;
      update public.class_schedule_slots
      set weekday = v_weekday,
          start_time = v_start_time,
          end_time = v_end_time,
          teacher_catalog_id = v_teacher_id,
          teacher_name = v_teacher_name,
          classroom_catalog_id = v_classroom_id,
          classroom_name = v_classroom_name,
          sort_order = v_sort_order
      where id = v_slot_id and class_id = p_class.id
        and (weekday, start_time, end_time, teacher_catalog_id, teacher_name,
             classroom_catalog_id, classroom_name, sort_order)
          is distinct from
            (v_weekday, v_start_time, v_end_time, v_teacher_id, v_teacher_name,
             v_classroom_id, v_classroom_name, v_sort_order);
      if found then v_changed := true; end if;
      if not exists (select 1 from public.class_schedule_slots where id = v_slot_id and class_id = p_class.id) then
        raise exception 'class_schedule_slot_not_owned' using errcode = '22023';
      end if;
    end if;
    v_seen := array_append(v_seen, v_slot_id);
  end loop;

  delete from public.class_schedule_slots
  where class_id = p_class.id
    and not (id = any(v_seen));
  if found then v_changed := true; end if;

  -- Validate the final set and restore the normal immediate constraint mode.
  set constraints public.class_schedule_slots_class_time_key immediate;

  if v_changed then
    select count(distinct teacher_name) > 1
        or count(distinct classroom_name) > 1
    into v_varied_resources
    from public.class_schedule_slots where class_id = p_class.id;

    select coalesce(string_agg(
      (case weekday when 0 then '일' when 1 then '월' when 2 then '화'
        when 3 then '수' when 4 then '목' when 5 then '금' else '토' end)
      || ' ' || to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI')
      || case when v_varied_resources
        then ' (' || teacher_name
          || ', ' || classroom_name || ')'
        else '' end,
      E'\n' order by weekday, start_time, sort_order, id
    ), '') into v_projected_schedule
    from public.class_schedule_slots where class_id = p_class.id;

    select nullif(string_agg(distinct teacher_name, ', ' order by teacher_name), '')
    into v_projected_teacher
    from public.class_schedule_slots
    where class_id = p_class.id and teacher_name <> '';

    select case when count(distinct nullif(classroom_name, '')) <= 1
      then max(nullif(classroom_name, ''))
      else string_agg(
        nullif(classroom_name, '') || '(' ||
          (case weekday when 0 then '일' when 1 then '월' when 2 then '화'
            when 3 then '수' when 4 then '목' when 5 then '금' else '토' end) || ')',
        ', ' order by weekday, start_time, sort_order, id
      ) end into v_projected_room
    from public.class_schedule_slots where class_id = p_class.id;

    update public.classes
    set schedule_revision = schedule_revision + 1,
        schedule = v_projected_schedule,
        teacher = v_projected_teacher,
        room = v_projected_room
    where id = p_class.id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'class_schedule_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('changed', v_changed);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.initialize_new_class_schedule_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_expected_schedule_plan_hash text, p_slots jsonb, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'planHash', p_expected_schedule_plan_hash, 'slots', p_slots));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('initialize_new_class_schedule_v1', p_request_key, v_hash);
  if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  select * into v_class from public.classes where id = p_class_id for update;
  if not found or v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 then raise exception 'continuous_class_schedule_runtime_not_ready' using errcode = 'P0001'; end if;
  if v_class.schedule_storage_mode <> 'legacy' or exists(select 1 from public.class_lesson_sessions where class_id = p_class_id)
    or dashboard_private.continuous_class_schedule_hash_v1(coalesce(v_class.schedule_plan, '{}'::jsonb)) <> p_expected_schedule_plan_hash then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'initialize_new_class_schedule_v1');
  update public.classes set schedule_storage_mode = 'normalized' where id = p_class_id;
  perform dashboard_private.save_continuous_schedule_defaults_rows_v1(v_class, p_slots);
  select jsonb_build_object('changed', true, 'scheduleRevision', schedule_revision, 'slots', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.class_schedule_slots s where class_id = p_class_id)) into v_response from public.classes where id = p_class_id;
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('initialize_new_class_schedule_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_class_lesson_session_generation_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype;
begin
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, null);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  return (select jsonb_build_object('requestedCount', count(*), 'creatableCount', count(*) filter(where not existing), 'existingCount', count(*) filter(where existing), 'excludedCount', 0, 'resourceConflictCount', 0,
    'candidates', coalesce(jsonb_agg(jsonb_build_object('sessionKey', session_key, 'sessionDate', session_date, 'sourceScheduleSlotId', source_schedule_slot_id, 'status', case when existing then 'existing' else 'creatable' end) order by session_date, session_key), '[]'::jsonb))
    from dashboard_private.continuous_class_schedule_generation_candidates_v1(p_class_id, p_date_from, p_date_to));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_class_lesson_sessions_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_date_from date, p_date_to date, p_request_key uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_actor uuid; v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'dateFrom', p_date_from, 'dateTo', p_date_to, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('generate_class_lesson_sessions_v1', p_request_key, v_hash); if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, p_reason);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'generate_class_lesson_sessions_v1', p_reason);
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  insert into public.class_lesson_sessions (class_id, session_key, source_schedule_slot_id, session_date, schedule_state, start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin, legacy_billing_id, legacy_billing_label, legacy_billing_color, created_by, updated_by)
  select p_class_id, session_key, source_schedule_slot_id, session_date, 'active', start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, 'default',
    'period:' || to_char(session_date, 'YYYY-MM'), to_char(session_date, 'YYYY"년" FMMonth "월"'), '#3182f6', v_actor, v_actor
  from dashboard_private.continuous_class_schedule_generation_candidates_v1(p_class_id, p_date_from, p_date_to)
  where not existing;
  perform dashboard_private.project_continuous_class_schedule_plan_v1(p_class_id);
  select jsonb_build_object('generatedCount', count(*), 'scheduleRevision', v_class.schedule_revision) into v_response from public.class_lesson_sessions where class_id = p_class_id and session_date between p_date_from and p_date_to;
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('generate_class_lesson_sessions_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_class_lesson_session_v1(p_session_id uuid, p_expected_revision bigint, p_schedule_state text, p_session_date date, p_start_time time without time zone, p_end_time time without time zone, p_teacher_catalog_id uuid, p_classroom_catalog_id uuid, p_memo text, p_public_note text, p_teacher_note text, p_request_key uuid, p_correction_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session public.class_lesson_sessions%rowtype; v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_actor uuid; v_teacher text; v_room text; v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select * into v_session from public.class_lesson_sessions where id = p_session_id; if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('sessionId', p_session_id, 'revision', p_expected_revision, 'state', p_schedule_state, 'date', p_session_date, 'start', p_start_time, 'end', p_end_time, 'teacher', p_teacher_catalog_id, 'room', p_classroom_catalog_id, 'memo', p_memo, 'publicNote', p_public_note, 'teacherNote', p_teacher_note, 'reason', p_correction_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_lesson_session_v1', p_request_key, v_hash); if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(v_session.class_id, true, true, true, p_correction_reason);
  select * into v_session from public.class_lesson_sessions where id = p_session_id for update;
  if v_session.revision <> p_expected_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  if p_schedule_state not in ('active', 'exception', 'makeup', 'tbd', 'skipped') or p_session_date is null or (p_start_time is null) <> (p_end_time is null) or (p_start_time is not null and p_start_time >= p_end_time) then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  v_teacher := dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher', p_teacher_catalog_id, v_class.subject);
  v_room := dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom', p_classroom_catalog_id, v_class.subject);
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(v_class.id, p_request_key, 'save_class_lesson_session_v1', p_correction_reason);
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  update public.class_lesson_sessions set schedule_state = p_schedule_state, session_date = p_session_date, start_time = p_start_time, end_time = p_end_time, teacher_catalog_id = p_teacher_catalog_id, teacher_name_snapshot = v_teacher, classroom_catalog_id = p_classroom_catalog_id, classroom_name_snapshot = v_room, memo = coalesce(p_memo, ''), public_note = coalesce(p_public_note, ''), teacher_note = coalesce(p_teacher_note, ''), revision = revision + 1, updated_by = v_actor where id = p_session_id;
  perform dashboard_private.project_continuous_class_schedule_plan_v1(v_class.id);
  select to_jsonb(s) into v_response from public.class_lesson_sessions s where id = p_session_id;
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_lesson_session_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_class_lesson_content_v1(p_class_id uuid, p_expected_content_hash text, p_content_patch jsonb, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_plan jsonb; v_response jsonb; v_patch_sessions jsonb; v_merged_sessions jsonb; v_patch_session jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'contentHash', p_expected_content_hash, 'patch', p_content_patch));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_lesson_content_v1', p_request_key, v_hash); if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, null);
  if jsonb_typeof(p_content_patch) <> 'object'
    or p_content_patch - 'textbooks' - 'sessions' <> '{}'::jsonb
    or (p_content_patch ? 'textbooks' and jsonb_typeof(p_content_patch -> 'textbooks') <> 'array')
    or (p_content_patch ? 'sessions' and jsonb_typeof(p_content_patch -> 'sessions') <> 'array')
  then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  select coalesce(schedule_plan, '{}'::jsonb) into v_plan from public.classes where id = p_class_id for update;
  if dashboard_private.continuous_class_schedule_content_hash_v1(v_plan) <> p_expected_content_hash then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  v_patch_sessions := coalesce(p_content_patch -> 'sessions', '[]'::jsonb);
  for v_patch_session in select value from jsonb_array_elements(v_patch_sessions) loop
    if jsonb_typeof(v_patch_session) <> 'object'
      or v_patch_session - 'sessionKey' - 'textbookEntries' <> '{}'::jsonb
      or nullif(btrim(v_patch_session ->> 'sessionKey'), '') is null
      or jsonb_typeof(v_patch_session -> 'textbookEntries') is distinct from 'array'
      or (select count(*) from jsonb_array_elements(v_patch_sessions) duplicate
          where duplicate ->> 'sessionKey' = v_patch_session ->> 'sessionKey') > 1
      or not exists (
        select 1 from jsonb_array_elements(coalesce(v_plan -> 'sessions', '[]'::jsonb)) current_session
        where coalesce(current_session ->> 'sessionKey', current_session ->> 'session_key', current_session ->> 'id') = v_patch_session ->> 'sessionKey'
      )
    then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  end loop;
  select coalesce(jsonb_agg(
    current_session || coalesce((
      select jsonb_build_object('textbookEntries', patch_session -> 'textbookEntries')
      from jsonb_array_elements(v_patch_sessions) patch_session
      where patch_session ->> 'sessionKey' = coalesce(current_session ->> 'sessionKey', current_session ->> 'session_key', current_session ->> 'id')
    ), '{}'::jsonb)
  ), '[]'::jsonb)
  into v_merged_sessions
  from jsonb_array_elements(coalesce(v_plan -> 'sessions', '[]'::jsonb)) current_session;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'save_class_lesson_content_v1');
  update public.classes set schedule_plan = (v_plan || (p_content_patch - 'sessions')) || jsonb_build_object('sessions', v_merged_sessions) where id = p_class_id;
  select jsonb_build_object('contentHash', dashboard_private.continuous_class_schedule_content_hash_v1(schedule_plan)) into v_response from public.classes where id = p_class_id;
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_lesson_content_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deactivate_class_schedule_storage_v1(p_class_id uuid, p_request_key uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('deactivate_class_schedule_storage_v1', p_request_key, v_hash); if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  select * into v_class from public.classes where id = p_class_id for update; if not found or v_class.schedule_storage_mode <> 'normalized' then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'deactivate_class_schedule_storage_v1', p_reason);
  update public.classes set schedule_storage_mode = 'shadow' where id = p_class_id;
  update dashboard_private.class_schedule_cutovers set deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = p_reason, status = 'rolled_back' where class_id = p_class_id;
  v_response := jsonb_build_object('storageMode', 'shadow');
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('deactivate_class_schedule_storage_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.notification_apply_makeup_calendar_effects_legacy_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb, p_calendar_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  calendar_event jsonb;
  allowed_event_ids uuid[];
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
    or p_calendar_events is null
    or pg_catalog.jsonb_typeof(p_calendar_events) <> 'array'
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
    where item.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(distinct event_id), array[]::uuid[])
  into allowed_event_ids
  from (
    select p_cancel_academic_event_id as event_id
    union all
    select p_makeup_academic_event_id
    union all
    select item.value::uuid
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
  ) event_ids
  where event_id is not null;

  if pg_catalog.cardinality(allowed_event_ids) = 0
    or pg_catalog.jsonb_array_length(p_calendar_events)
      <> pg_catalog.cardinality(allowed_event_ids)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or item.value - array['id', 'title', 'date', 'type', 'grade', 'note']::text[]
          <> '{}'::jsonb
        or coalesce(item.value ->> 'id', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or nullif(pg_catalog.btrim(item.value ->> 'title'), '') is null
        or pg_catalog.length(item.value ->> 'title') > 200
        or coalesce(item.value ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(item.value ->> 'type', '') <> '팁스'
        or coalesce(item.value ->> 'grade', '') <> 'all'
        or nullif(pg_catalog.btrim(item.value ->> 'note'), '') is null
        or pg_catalog.length(item.value ->> 'note') > 4000
        or pg_catalog.strpos(item.value ->> 'note', '[[TIPS_MAKEUP]]') = 0
        or pg_catalog.strpos(item.value ->> 'note', p_request_id::text) = 0
    )
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    where not ((item.value ->> 'id')::uuid = any(allowed_event_ids))
  ) or (
    select pg_catalog.count(distinct (item.value ->> 'id')::uuid)
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
  ) <> pg_catalog.cardinality(allowed_event_ids)
  then
    raise exception 'makeup_calendar_effects_mismatch' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_after
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) = p_schedule_plan_before;
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = '40001';
  end if;

  for calendar_event in
    select item.value
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    order by item.value ->> 'id'
  loop
    insert into public.academic_events(id, title, date, type, grade, note)
    values (
      (calendar_event ->> 'id')::uuid,
      calendar_event ->> 'title',
      (calendar_event ->> 'date')::date,
      calendar_event ->> 'type',
      calendar_event ->> 'grade',
      calendar_event ->> 'note'
    )
    on conflict (id) do update
    set title = excluded.title,
        date = excluded.date,
        type = excluded.type,
        grade = excluded.grade,
        note = excluded.note
    where pg_catalog.strpos(
      coalesce(public.academic_events.note, ''), '[[TIPS_MAKEUP]]'
    ) > 0
      and pg_catalog.strpos(
        coalesce(public.academic_events.note, ''), p_request_id::text
      ) > 0;
    if not found then
      raise exception 'makeup_calendar_event_conflict' using errcode = '40001';
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.revert_normalized_makeup_effect_v1(p_request_id uuid, p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_request public.makeup_requests%rowtype; v_session public.class_lesson_sessions%rowtype;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.revision is distinct from v_request.makeup_effect_revision then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_request.makeup_lesson_session_ids) item
    join public.class_lesson_sessions session on session.id = item.value::uuid
    where session.revision <> 0) then raise exception 'makeup_lesson_session_stale' using errcode = '40001'; end if;
  update public.class_lesson_sessions set schedule_state = 'active', revision = revision + 1 where id = v_session.id;
  delete from public.class_lesson_sessions where id in (select value::uuid from jsonb_array_elements_text(v_request.makeup_lesson_session_ids));
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.notification_apply_makeup_calendar_effects_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb, p_calendar_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mode text; v_event jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select schedule_storage_mode into v_mode from public.classes where id = p_class_id;
  if v_mode <> 'normalized' then
    perform dashboard_private.notification_apply_makeup_calendar_effects_legacy_v1(p_request_id, p_class_id, p_schedule_plan_before, p_schedule_plan_after, p_cancel_academic_event_id, p_makeup_academic_event_id, p_makeup_academic_event_ids, p_calendar_events);
    return;
  end if;
  if p_calendar_events is null or jsonb_typeof(p_calendar_events) <> 'array' then raise exception 'makeup_calendar_effects_invalid' using errcode = '22023'; end if;
  perform dashboard_private.apply_normalized_makeup_effect_v1(p_request_id, p_class_id, p_calendar_events);
  for v_event in select value from jsonb_array_elements(p_calendar_events) loop
    insert into public.academic_events(id, title, date, type, grade, note)
    values ((v_event ->> 'id')::uuid, v_event ->> 'title', (v_event ->> 'date')::date, v_event ->> 'type', v_event ->> 'grade', v_event ->> 'note')
    on conflict (id) do update set title = excluded.title, date = excluded.date, type = excluded.type, grade = excluded.grade, note = excluded.note
    where strpos(coalesce(public.academic_events.note, ''), p_request_id::text) > 0;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.notification_revert_makeup_calendar_effects_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mode text;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select schedule_storage_mode into v_mode from public.classes where id = p_class_id;
  if v_mode <> 'normalized' then
    perform dashboard_private.notification_revert_makeup_calendar_effects_legacy_v1(p_request_id, p_class_id, p_schedule_plan_before, p_schedule_plan_after, p_cancel_academic_event_id, p_makeup_academic_event_id, p_makeup_academic_event_ids);
    return;
  end if;
  perform dashboard_private.revert_normalized_makeup_effect_v1(p_request_id, p_class_id);
  delete from public.academic_events event where strpos(coalesce(event.note, ''), '[[TIPS_MAKEUP]]') > 0 and strpos(coalesce(event.note, ''), p_request_id::text) > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.apply_normalized_makeup_effect_v1(p_request_id uuid, p_class_id uuid, p_calendar_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.makeup_requests%rowtype;
  v_session public.class_lesson_sessions%rowtype;
  v_slot jsonb;
  v_new_ids jsonb := '[]'::jsonb;
  v_new_id uuid;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.schedule_state not in ('active', 'makeup') then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  if v_request.original_lesson_session_revision is distinct from v_session.revision then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  update public.class_lesson_sessions set schedule_state = 'exception', revision = revision + 1
    where id = v_session.id;
  for v_slot in select value from jsonb_array_elements(v_request.makeup_slots) loop
    if ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date
       <> ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date
       and not (((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date = ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date + 1
         and ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::time = '00:00'::time) then
      raise exception using errcode='22023',message='class_schedule_validation';
    end if;
    insert into public.class_lesson_sessions(
      class_id, session_key, session_date, schedule_state, start_time, end_time,
      teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin,
      memo, created_by, updated_by
    ) values (
      p_class_id, 'makeup:' || p_request_id::text || ':' || (jsonb_array_length(v_new_ids) + 1)::text,
      ((v_slot ->> 'startAt')::timestamptz at time zone 'Asia/Seoul')::date, 'makeup',
      ((v_slot ->> 'startAt')::timestamptz at time zone 'Asia/Seoul')::time, case when ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date > ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date then '24:00'::time else ((v_slot ->> 'endAt')::timestamptz at time zone 'Asia/Seoul')::time end,
      v_session.teacher_catalog_id, v_session.teacher_name_snapshot, (select min(id::text)::uuid from public.classroom_catalogs where name = v_slot ->> 'classroom' having count(*)=1), v_slot ->> 'classroom', 'manual',
      coalesce(v_request.reason, ''), (select auth.uid()), (select auth.uid())
    ) returning id into v_new_id;
    v_new_ids := v_new_ids || jsonb_build_array(v_new_id);
  end loop;
  update public.makeup_requests set makeup_lesson_session_ids = v_new_ids,
    makeup_effect_revision = v_session.revision + 1 where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.create_makeup_request_v2_unguarded(p_input jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_input jsonb; v_result jsonb; v_request_id uuid; v_session_id uuid; v_mode text; v_cancel_date date;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_session_id := nullif(p_input ->> 'original_lesson_session_id', '')::uuid;
  v_input := p_input - 'original_lesson_session_id';
  select schedule_storage_mode into v_mode from public.classes where id = (v_input ->> 'class_id')::uuid;
  v_cancel_date := nullif(v_input ->> 'cancel_date', '')::date;
  if v_mode = 'normalized' and v_cancel_date is not null and v_session_id is null then raise exception 'makeup_lesson_session_required' using errcode = '22023'; end if;
  if v_session_id is not null and not exists (select 1 from public.class_lesson_sessions where id = v_session_id and class_id = (v_input ->> 'class_id')::uuid and session_date = v_cancel_date and schedule_state in ('active', 'makeup')) then raise exception 'makeup_lesson_session_invalid' using errcode = '22023'; end if;
  v_result := dashboard_private.create_makeup_request_v2_legacy_v1(v_input, p_request_id);
  v_request_id := (v_result -> 'request' ->> 'id')::uuid;
  if v_session_id is not null then
    update public.makeup_requests request set original_lesson_session_id = v_session_id,
      original_lesson_session_revision = session.revision
    from public.class_lesson_sessions session where request.id = v_request_id and session.id = v_session_id;
  end if;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.backfill_class_schedule_shadow_v1(p_class_id uuid, p_expected_source_hash text, p_slots jsonb, p_sessions jsonb, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.classes%rowtype;
  v_hash text;
  v_replay jsonb;
  v_actor uuid;
  v_slots jsonb;
  v_sessions jsonb;
  v_expected_sessions jsonb;
  v_actual jsonb;
  v_projection_hash text;
  v_source_defaults_hash text;
  v_source_schedule_plan_hash text;
  v_slot_rows_hash text;
  v_session_rows_hash text;
  v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  if nullif(btrim(coalesce(p_expected_source_hash, '')), '') is null
    or p_request_key is null
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_slots := dashboard_private.normalize_continuous_class_schedule_backfill_slots_v1(
    p_class_id,
    p_slots
  );
  v_sessions := dashboard_private.normalize_continuous_class_schedule_backfill_sessions_v1(
    p_class_id,
    p_sessions
  );
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'classId', p_class_id,
      'sourceHash', p_expected_source_hash,
      'slots', v_slots,
      'sessions', v_sessions
    )
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    'backfill_class_schedule_shadow_v1',
    p_request_key,
    v_hash
  );
  if v_replay is not null then
    declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
  end if;

  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;
  if v_class.schedule_storage_mode not in ('legacy', 'shadow')
    or dashboard_private.continuous_class_schedule_backfill_source_hash_v1(
      v_class
    ) <> p_expected_source_hash
  then
    raise exception 'class_schedule_stale' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from dashboard_private.class_schedule_cutovers cutover
    where cutover.class_id = p_class_id
      and cutover.activated_at is not null
  ) then
    raise exception 'class_schedule_already_activated' using errcode = '22023';
  end if;

  v_expected_sessions :=
    dashboard_private.continuous_class_schedule_legacy_sessions_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    );
  if v_sessions is distinct from v_expected_sessions then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    'backfill_class_schedule_shadow_v1'
  );

  insert into public.class_lesson_sessions as existing (
    class_id,
    session_key,
    source_schedule_slot_id,
    session_date,
    schedule_state,
    start_time,
    end_time,
    teacher_catalog_id,
    teacher_name_snapshot,
    classroom_catalog_id,
    classroom_name_snapshot,
    origin,
    makeup_of_session_id,
    legacy_billing_id,
    legacy_billing_label,
    legacy_billing_color,
    memo,
    public_note,
    teacher_note,
    revision,
    created_by,
    updated_by
  )
  select
    p_class_id,
    session ->> 'sessionKey',
    null,
    (session ->> 'sessionDate')::date,
    session ->> 'scheduleState',
    null,
    null,
    null,
    '',
    null,
    '',
    'legacy',
    null,
    session ->> 'legacyBillingId',
    session ->> 'legacyBillingLabel',
    session ->> 'legacyBillingColor',
    session ->> 'memo',
    '',
    '',
    0,
    v_actor,
    v_actor
  from jsonb_array_elements(v_sessions) session
  on conflict (class_id, session_key) do update
  set source_schedule_slot_id = null,
      session_date = excluded.session_date,
      schedule_state = excluded.schedule_state,
      start_time = null,
      end_time = null,
      teacher_catalog_id = null,
      teacher_name_snapshot = '',
      classroom_catalog_id = null,
      classroom_name_snapshot = '',
      origin = 'legacy',
      makeup_of_session_id = null,
      legacy_billing_id = excluded.legacy_billing_id,
      legacy_billing_label = excluded.legacy_billing_label,
      legacy_billing_color = excluded.legacy_billing_color,
      memo = excluded.memo,
      public_note = '',
      teacher_note = '',
      revision = 0,
      updated_by = excluded.updated_by
  where existing.source_schedule_slot_id is not null
    or existing.session_date is distinct from excluded.session_date
    or existing.schedule_state is distinct from excluded.schedule_state
    or existing.start_time is not null
    or existing.end_time is not null
    or existing.teacher_catalog_id is not null
    or existing.teacher_name_snapshot is distinct from ''
    or existing.classroom_catalog_id is not null
    or existing.classroom_name_snapshot is distinct from ''
    or existing.origin is distinct from 'legacy'
    or existing.makeup_of_session_id is not null
    or existing.legacy_billing_id is distinct from excluded.legacy_billing_id
    or existing.legacy_billing_label is distinct from excluded.legacy_billing_label
    or existing.legacy_billing_color is distinct from excluded.legacy_billing_color
    or existing.memo is distinct from excluded.memo
    or existing.public_note is distinct from ''
    or existing.teacher_note is distinct from ''
    or existing.revision is distinct from 0;

  delete from public.class_lesson_sessions session
  where session.class_id = p_class_id
    and not exists (
      select 1
      from jsonb_array_elements(v_sessions) expected
      where expected ->> 'sessionKey' = session.session_key
    );

  perform dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(p_class_id, v_slots);

  v_actual :=
    dashboard_private.read_continuous_class_schedule_shadow_rows_v1(p_class_id);
  if v_actual -> 'slots' is distinct from v_slots
    or v_actual -> 'sessions' is distinct from v_sessions
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_slot_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'slots'
  );
  v_session_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'sessions'
  );
  v_projection_hash := dashboard_private.continuous_class_schedule_hash_v1(
    dashboard_private.build_continuous_class_schedule_plan_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    )
  );
  v_source_schedule_plan_hash :=
    dashboard_private.continuous_class_schedule_hash_v1(
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    );
  v_source_defaults_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'schedule', coalesce(v_class.schedule, ''),
      'teacher', coalesce(v_class.teacher, ''),
      'room', coalesce(v_class.room, '')
    )
  );

  update public.classes
  set schedule_storage_mode = 'shadow'
  where id = p_class_id
    and schedule_storage_mode is distinct from 'shadow';

  insert into dashboard_private.class_schedule_cutovers (
    class_id,
    from_runtime_version,
    to_runtime_version,
    request_key,
    source_schedule_plan_hash,
    source_backfill_hash,
    projected_schedule_plan_hash,
    expected_slot_rows_hash,
    expected_session_rows_hash,
    slot_count,
    session_count,
    issue_codes,
    status,
    detail
  )
  values (
    p_class_id,
    public.continuous_class_schedule_runtime_version(),
    public.continuous_class_schedule_runtime_version(),
    p_request_key,
    v_source_schedule_plan_hash,
    p_expected_source_hash,
    v_projection_hash,
    v_slot_rows_hash,
    v_session_rows_hash,
    jsonb_array_length(v_actual -> 'slots'),
    jsonb_array_length(v_actual -> 'sessions'),
    '{}'::text[],
    'prepared',
    jsonb_build_object(
      'backfillOnly', true,
      'sourceDefaultsHash', v_source_defaults_hash
    )
  );

  v_response := jsonb_build_object(
    'storageMode', 'shadow',
    'sourceHash', p_expected_source_hash,
    'slotCount', jsonb_array_length(v_actual -> 'slots'),
    'sessionCount', jsonb_array_length(v_actual -> 'sessions'),
    'projectionHash', v_projection_hash,
    'issueCodes', '[]'::jsonb
  );
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1(
    'backfill_class_schedule_shadow_v1',
    p_request_key,
    v_hash,
    v_response
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_class_schedule_shadow_v1(p_class_id uuid, p_expected_source_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.classes%rowtype;
  v_cutover dashboard_private.class_schedule_cutovers%rowtype;
  v_source_hash text;
  v_source_defaults_hash text;
  v_actual jsonb;
  v_slot_rows_hash text;
  v_session_rows_hash text;
  v_projection_hash text;
  v_issue_codes text[] := '{}'::text[];
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;
  if v_class.schedule_storage_mode <> 'shadow' then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_source_hash :=
    dashboard_private.continuous_class_schedule_backfill_source_hash_v1(
      v_class
    );
  if v_source_hash <> p_expected_source_hash then
    raise exception 'class_schedule_stale' using errcode = 'P0001';
  end if;

  select *
  into v_cutover
  from dashboard_private.class_schedule_cutovers cutover
  where cutover.class_id = p_class_id
    and cutover.source_backfill_hash = p_expected_source_hash
    and cutover.activated_at is null
  order by cutover.created_at desc, cutover.id desc
  limit 1
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;

  v_actual :=
    dashboard_private.read_continuous_class_schedule_shadow_rows_v1(p_class_id);
  v_slot_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'slots'
  );
  v_session_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'sessions'
  );
  v_projection_hash := dashboard_private.continuous_class_schedule_hash_v1(
    dashboard_private.build_continuous_class_schedule_plan_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    )
  );
  v_source_defaults_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'schedule', coalesce(v_class.schedule, ''),
      'teacher', coalesce(v_class.teacher, ''),
      'room', coalesce(v_class.room, '')
    )
  );

  if jsonb_array_length(v_actual -> 'slots') <> v_cutover.slot_count then
    v_issue_codes := array_append(v_issue_codes, 'slot_count_mismatch');
  end if;
  if jsonb_array_length(v_actual -> 'sessions') <> v_cutover.session_count then
    v_issue_codes := array_append(v_issue_codes, 'session_count_mismatch');
  end if;
  if v_slot_rows_hash is distinct from v_cutover.expected_slot_rows_hash then
    v_issue_codes := array_append(v_issue_codes, 'slot_payload_mismatch');
  end if;
  if v_session_rows_hash is distinct from v_cutover.expected_session_rows_hash then
    v_issue_codes := array_append(v_issue_codes, 'session_payload_mismatch');
  end if;
  if v_projection_hash is distinct from v_cutover.projected_schedule_plan_hash then
    v_issue_codes := array_append(v_issue_codes, 'projection_mismatch');
  end if;
  if v_source_defaults_hash is distinct from
    (v_cutover.detail ->> 'sourceDefaultsHash')
  then
    v_issue_codes := array_append(v_issue_codes, 'source_defaults_mismatch');
  end if;

  update dashboard_private.class_schedule_cutovers
  set verified_at = now(),
      verified_by = auth.uid(),
      issue_codes = v_issue_codes,
      status = case
        when cardinality(v_issue_codes) = 0 then 'applied'
        else 'failed'
      end,
      detail = detail || jsonb_build_object(
        'lastVerifiedSlotRowsHash', v_slot_rows_hash,
        'lastVerifiedSessionRowsHash', v_session_rows_hash,
        'lastVerifiedProjectionHash', v_projection_hash,
        'lastVerifiedSourceDefaultsHash', v_source_defaults_hash
      )
  where id = v_cutover.id;

  return jsonb_build_object(
    'matches', cardinality(v_issue_codes) = 0,
    'sourceHash', v_source_hash,
    'projectionHash', v_projection_hash,
    'slotCount', jsonb_array_length(v_actual -> 'slots'),
    'sessionCount', jsonb_array_length(v_actual -> 'sessions'),
    'issueCodes', to_jsonb(v_issue_codes)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activate_class_schedule_storage_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_expected_source_hash text, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.classes%rowtype;
  v_hash text;
  v_replay jsonb;
  v_verification jsonb;
  v_cutover_id uuid;
  v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'classId', p_class_id,
      'revision', p_expected_schedule_revision,
      'sourceHash', p_expected_source_hash
    )
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    'activate_class_schedule_storage_v1',
    p_request_key,
    v_hash
  );
  if v_replay is not null then
    declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
  end if;

  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found
    or v_class.schedule_storage_mode <> 'shadow'
    or v_class.schedule_revision <> p_expected_schedule_revision
  then
    raise exception 'class_schedule_stale' using errcode = 'P0001';
  end if;
  if public.continuous_class_schedule_runtime_version() <> 1 then
    raise exception 'continuous_class_schedule_runtime_not_ready'
      using errcode = 'P0001';
  end if;

  v_verification := public.verify_class_schedule_shadow_v1(
    p_class_id,
    p_expected_source_hash
  );
  if (v_verification ->> 'matches')::boolean is distinct from true then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  select cutover.id
  into v_cutover_id
  from dashboard_private.class_schedule_cutovers cutover
  where cutover.class_id = p_class_id
    and cutover.source_backfill_hash = p_expected_source_hash
    and cutover.activated_at is null
    and cutover.status = 'applied'
    and cutover.verified_at is not null
    and cutover.issue_codes = '{}'::text[]
  order by cutover.created_at desc, cutover.id desc
  limit 1
  for update;
  if not found then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    'activate_class_schedule_storage_v1'
  );
  update public.classes
  set schedule_storage_mode = 'normalized'
  where id = p_class_id;
  update dashboard_private.class_schedule_cutovers
  set activated_at = now(),
      activated_by = auth.uid(),
      status = 'applied'
  where id = v_cutover_id;

  v_response := jsonb_build_object(
    'storageMode', 'normalized',
    'scheduleRevision', v_class.schedule_revision,
    'projectionHash', v_verification ->> 'projectionHash'
  );
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1(
    'activate_class_schedule_storage_v1',
    p_request_key,
    v_hash,
    v_response
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(p_class_id uuid, p_slots jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  update public.class_schedule_slots existing
  set teacher_catalog_id = null,
      teacher_name = expected.slot ->> 'teacherName',
      classroom_catalog_id = null,
      classroom_name = expected.slot ->> 'classroomName',
      sort_order = (expected.slot ->> 'sortOrder')::integer
  from jsonb_array_elements(p_slots) as expected(slot)
  where existing.class_id = p_class_id
    and (existing.weekday, existing.start_time, existing.end_time)
      = ((expected.slot ->> 'weekday')::smallint,
         (expected.slot ->> 'startTime')::time,
         (expected.slot ->> 'endTime')::time)
    and (existing.teacher_catalog_id, existing.teacher_name,
         existing.classroom_catalog_id, existing.classroom_name, existing.sort_order)
      is distinct from
        (null::uuid, expected.slot ->> 'teacherName', null::uuid,
         expected.slot ->> 'classroomName', (expected.slot ->> 'sortOrder')::integer);

  insert into public.class_schedule_slots (
    class_id, weekday, start_time, end_time, teacher_catalog_id, teacher_name,
    classroom_catalog_id, classroom_name, sort_order
  )
  select p_class_id, (expected.slot ->> 'weekday')::smallint,
    (expected.slot ->> 'startTime')::time, (expected.slot ->> 'endTime')::time,
    null, expected.slot ->> 'teacherName', null,
    expected.slot ->> 'classroomName', (expected.slot ->> 'sortOrder')::integer
  from jsonb_array_elements(p_slots) as expected(slot)
  where not exists (
    select 1 from public.class_schedule_slots existing
    where existing.class_id = p_class_id
      and (existing.weekday, existing.start_time, existing.end_time)
        = ((expected.slot ->> 'weekday')::smallint,
           (expected.slot ->> 'startTime')::time,
           (expected.slot ->> 'endTime')::time)
  );

  delete from public.class_schedule_slots existing
  where existing.class_id = p_class_id
    and not exists (
      select 1 from jsonb_array_elements(p_slots) as expected(slot)
      where (existing.weekday, existing.start_time, existing.end_time)
        = ((expected.slot ->> 'weekday')::smallint,
           (expected.slot ->> 'startTime')::time,
           (expected.slot ->> 'endTime')::time)
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_class_atomic_v1(p_class_id uuid, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid;
  v_operation constant text := 'close_class_atomic_v1';
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_class public.classes%rowtype;
  v_pre_status text;
  v_pre_class_students jsonb;
  v_pre_class_waitlists jsonb;
  v_pre_claims jsonb;
  v_current_claims jsonb;
  v_enrolled_student_ids uuid[] := '{}'::uuid[];
  v_waitlist_student_ids uuid[] := '{}'::uuid[];
  v_member_student_ids uuid[] := '{}'::uuid[];
  v_lock_student_ids uuid[] := '{}'::uuid[];
  v_parent_task_ids uuid[] := '{}'::uuid[];
  v_track_ids uuid[] := '{}'::uuid[];
  v_batch_ids uuid[] := '{}'::uuid[];
  v_recomputed_parent_ids uuid[] := '{}'::uuid[];
  v_released_enrollment_ids uuid[] := '{}'::uuid[];
  v_canceled_waitlist_ids uuid[] := '{}'::uuid[];
  v_student_id uuid;
  v_parent_id uuid;
  v_mode text;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_claim_found boolean;
  v_student_count integer;
  v_closed_at timestamptz;
  v_previous_class_close_context text := coalesce(
    pg_catalog.current_setting('app.class_close_mutation', true),
    ''
  );
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_actor_id := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  if p_class_id is null or p_request_key is null then
    raise exception 'class_close_input_invalid' using errcode = '22023';
  end if;

  v_request_hash := dashboard_private.continuous_class_schedule_hash_v1(
    pg_catalog.jsonb_build_object('classId', p_class_id)
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    v_operation,
    p_request_key,
    v_request_hash
  );
  if v_replay is not null then
    declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
  end if;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id;
  if not found then
    raise exception 'class_close_not_found' using errcode = 'P0002';
  end if;

  v_pre_status := v_class.status;
  v_pre_class_students := coalesce(v_class.student_ids, '[]'::jsonb);
  v_pre_class_waitlists := coalesce(v_class.waitlist_ids, '[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_pre_class_students) <> 'array'
    or pg_catalog.jsonb_typeof(v_pre_class_waitlists) <> 'array'
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from (
      select element.value
      from pg_catalog.jsonb_array_elements(v_pre_class_students) element(value)
      union all
      select element.value
      from pg_catalog.jsonb_array_elements(v_pre_class_waitlists) element(value)
    ) roster_element
    where pg_catalog.jsonb_typeof(roster_element.value) <> 'string'
      or (roster_element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(roster_id order by roster_id),
    '{}'::uuid[]
  )
  into v_enrolled_student_ids
  from (
    select (element.value #>> '{}')::uuid as roster_id
    from pg_catalog.jsonb_array_elements(v_pre_class_students) element(value)
  ) roster;
  select coalesce(
    pg_catalog.array_agg(roster_id order by roster_id),
    '{}'::uuid[]
  )
  into v_waitlist_student_ids
  from (
    select (element.value #>> '{}')::uuid as roster_id
    from pg_catalog.jsonb_array_elements(v_pre_class_waitlists) element(value)
  ) roster;

  if pg_catalog.cardinality(v_enrolled_student_ids)
      <> pg_catalog.cardinality(
        array(select distinct member_id from pg_catalog.unnest(v_enrolled_student_ids) member_id)
      )
    or pg_catalog.cardinality(v_waitlist_student_ids)
      <> pg_catalog.cardinality(
        array(select distinct member_id from pg_catalog.unnest(v_waitlist_student_ids) member_id)
      )
    or exists (
      select 1
      from pg_catalog.unnest(v_enrolled_student_ids) enrolled_id
      where enrolled_id = any(v_waitlist_student_ids)
    )
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(member_id order by member_id),
    '{}'::uuid[]
  )
  into v_member_student_ids
  from (
    select member_id from pg_catalog.unnest(v_enrolled_student_ids) member_id
    union
    select member_id from pg_catalog.unnest(v_waitlist_student_ids) member_id
  ) members;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id),
    '[]'::jsonb
  )
  into v_pre_claims
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id;

  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    '{}'::uuid[]
  ), coalesce(
    pg_catalog.array_agg(distinct enrollment.track_id order by enrollment.track_id),
    '{}'::uuid[]
  ), coalesce(
    pg_catalog.array_agg(distinct enrollment.admission_batch_id order by enrollment.admission_batch_id)
      filter (where enrollment.admission_batch_id is not null),
    '{}'::uuid[]
  )
  into v_parent_task_ids, v_track_ids, v_batch_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.class_id = p_class_id;

  select coalesce(
    pg_catalog.array_agg(student_id order by student_id),
    '{}'::uuid[]
  )
  into v_lock_student_ids
  from (
    select member_id as student_id
    from pg_catalog.unnest(v_member_student_ids) member_id
    union
    select enrollment.student_id
    from public.ops_registration_enrollments enrollment
    where enrollment.class_id = p_class_id
      and enrollment.roster_active
      and enrollment.student_id is not null
    union
    select student.id
    from public.students student
    where coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
  ) students_to_lock;

  perform 1
  from public.ops_tasks task
  where task.id = any(v_parent_task_ids)
  order by task.id
  for update;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
  order by track.id
  for update;
  perform 1
  from public.students student
  where student.id = any(v_lock_student_ids)
  order by student.id
  for update;
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.id = any(v_batch_ids)
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id
  order by enrollment.id
  for update;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id
  for update;
  if not found then
    raise exception 'class_close_not_found' using errcode = 'P0002';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id),
    '[]'::jsonb
  )
  into v_current_claims
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id;

  if v_class.status is distinct from v_pre_status
    or coalesce(v_class.student_ids, '[]'::jsonb) is distinct from v_pre_class_students
    or coalesce(v_class.waitlist_ids, '[]'::jsonb) is distinct from v_pre_class_waitlists
    or v_current_claims is distinct from v_pre_claims
  then
    raise exception 'class_close_refresh_required' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.students student
    where (
      coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
    )
      and not (student.id = any(v_member_student_ids))
  ) then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;
  if v_class.closed_at is not null or v_class.closed_by is not null then
    raise exception 'class_already_closed' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    left join public.ops_registration_admission_batches batch
      on batch.id = enrollment.admission_batch_id
    where enrollment.class_id = p_class_id
      and (
        enrollment.status = 'planned'
        or (
          enrollment.admission_batch_id is not null
          and batch.status not in ('completed', 'canceled')
        )
      )
  ) then
    raise exception 'class_close_open_admission_batch' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer
  into v_student_count
  from public.students student
  where student.id = any(v_member_student_ids);
  if v_student_count <> pg_catalog.cardinality(v_member_student_ids)
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.class_id = p_class_id
        and enrollment.roster_active
        and (
          enrollment.student_id is null
          or not (enrollment.student_id = any(v_member_student_ids))
        )
    )
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    v_operation,
    'class_closed'
  );
  perform pg_catalog.set_config('app.class_close_mutation', 'v1', true);

  foreach v_student_id in array v_member_student_ids
  loop
    v_mode := case
      when v_student_id = any(v_enrolled_student_ids) then 'enrolled'
      else 'waitlist'
    end;

    if not exists (
      select 1
      from public.students student
      where student.id = v_student_id
        and pg_catalog.jsonb_typeof(coalesce(student.class_ids, '[]'::jsonb)) = 'array'
        and pg_catalog.jsonb_typeof(coalesce(student.waitlist_class_ids, '[]'::jsonb)) = 'array'
        and (
          (
            v_mode = 'enrolled'
            and coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
            and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text)
          )
          or (
            v_mode = 'waitlist'
            and coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
            and not (coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text)
          )
        )
    ) then
      raise exception 'class_close_roster_invalid' using errcode = '23514';
    end if;

    select enrollment.*
    into v_claim
    from public.ops_registration_enrollments enrollment
    where enrollment.class_id = p_class_id
      and enrollment.student_id = v_student_id
      and enrollment.roster_active;
    v_claim_found := found;
    if v_claim_found
      and (
        (v_mode = 'enrolled' and v_claim.status <> 'enrolled')
        or (v_mode = 'waitlist' and v_claim.status <> 'waitlisted')
      )
    then
      raise exception 'class_close_roster_invalid' using errcode = '23514';
    end if;

    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id,
      p_class_id,
      'removed',
      v_mode,
      case when v_claim_found then v_claim.id else null end,
      'class_closed',
      v_actor_id
    );

    if v_claim_found and v_mode = 'enrolled' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'enrolled',
        roster_active = false,
        roster_released_at = pg_catalog.now(),
        roster_release_reason = 'class_closed',
        roster_release_source_task_id = null,
        roster_release_kind = 'class_close',
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim.id
        and enrollment.status = 'enrolled'
        and enrollment.roster_active;
      if not found then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      v_released_enrollment_ids := pg_catalog.array_append(
        v_released_enrollment_ids,
        v_claim.id
      );
      select track.*
      into v_track
      from public.ops_registration_subject_tracks track
      where track.id = v_claim.track_id;
      perform dashboard_private.write_registration_track_event(
        v_track.task_id,
        v_track.id,
        'registration_enrollment_roster_released',
        v_track.pipeline_status,
        v_track.pipeline_status,
        'class_closed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim.id,
          'sourceTaskId', null,
          'releaseKind', 'class_close',
          'enrollmentSnapshot', pg_catalog.jsonb_build_object(
            'id', v_claim.id,
            'classId', v_claim.class_id,
            'textbookId', v_claim.textbook_id,
            'admissionBatchId', v_claim.admission_batch_id,
            'classStartDate', v_claim.class_start_date,
            'classStartSessionKey', v_claim.class_start_session_key,
            'classStartSession', v_claim.class_start_session,
            'status', v_claim.status,
            'sortOrder', v_claim.sort_order
          )
        )
      );
      v_recomputed_parent_ids := pg_catalog.array_append(
        v_recomputed_parent_ids,
        v_track.task_id
      );
    elsif v_claim_found and v_mode = 'waitlist' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        roster_released_at = null,
        roster_release_reason = null,
        roster_release_source_task_id = null,
        roster_release_kind = null,
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active;
      if not found then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      v_canceled_waitlist_ids := pg_catalog.array_append(
        v_canceled_waitlist_ids,
        v_claim.id
      );
      select track.*
      into v_track
      from public.ops_registration_subject_tracks track
      where track.id = v_claim.track_id;
      if v_track.pipeline_status <> 'waiting'
        or v_track.waiting_kind <> 'current_class'
      then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'not_registered',
        null,
        null,
        false
      );
      perform dashboard_private.write_registration_track_event(
        v_track.task_id,
        v_track.id,
        'registration_waitlist_canceled_by_class_close',
        'waiting',
        'not_registered',
        'class_closed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim.id,
          'releaseKind', 'class_close'
        )
      );
      v_recomputed_parent_ids := pg_catalog.array_append(
        v_recomputed_parent_ids,
        v_track.task_id
      );
    end if;
  end loop;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id;
  if pg_catalog.jsonb_array_length(coalesce(v_class.student_ids, '[]'::jsonb)) <> 0
    or pg_catalog.jsonb_array_length(coalesce(v_class.waitlist_ids, '[]'::jsonb)) <> 0
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct parent_id order by parent_id),
    '{}'::uuid[]
  )
  into v_recomputed_parent_ids
  from pg_catalog.unnest(v_recomputed_parent_ids) parent_id;
  foreach v_parent_id in array v_recomputed_parent_ids
  loop
    perform dashboard_private.recompute_registration_parent(v_parent_id);
  end loop;

  v_closed_at := pg_catalog.now();
  update public.classes
  set
    status = '종강',
    closed_at = v_closed_at,
    closed_by = v_actor_id
  where id = p_class_id
    and closed_at is null
    and closed_by is null
  returning * into v_class;
  if not found then
    raise exception 'class_already_closed' using errcode = '23514';
  end if;
  perform pg_catalog.set_config(
    'app.class_close_mutation',
    v_previous_class_close_context,
    true
  );

  v_response := pg_catalog.jsonb_build_object(
    'id', p_class_id,
    'classId', p_class_id,
    'status', '종강',
    'closedAt', v_closed_at,
    'removedStudentCount', pg_catalog.cardinality(v_member_student_ids),
    'removedEnrolledCount', pg_catalog.cardinality(v_enrolled_student_ids),
    'removedWaitlistCount', pg_catalog.cardinality(v_waitlist_student_ids),
    'releasedEnrollmentIds', pg_catalog.to_jsonb(v_released_enrollment_ids),
    'canceledWaitlistEnrollmentIds', pg_catalog.to_jsonb(v_canceled_waitlist_ids)
  );
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1(
    v_operation,
    p_request_key,
    v_request_hash,
    v_response
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_class_schedule_defaults_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_slots jsonb, p_request_key uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_change jsonb; v_response jsonb;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'slots', p_slots, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_schedule_defaults_v1', p_request_key, v_hash);
  if v_replay is not null then declare timetable_result jsonb; begin timetable_result := v_replay; perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, p_reason);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'save_class_schedule_defaults_v1', p_reason);
  v_change := dashboard_private.save_continuous_schedule_defaults_rows_v1(v_class, p_slots);
  select jsonb_build_object('changed', v_change -> 'changed', 'scheduleRevision', schedule_revision,
    'projectionHash', dashboard_private.continuous_class_schedule_hash_v1(coalesce(schedule_plan, '{}'::jsonb)),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'weekday', weekday, 'startTime', to_char(start_time, 'HH24:MI'), 'endTime', to_char(end_time, 'HH24:MI'), 'teacherCatalogId', teacher_catalog_id, 'teacherName', teacher_name, 'classroomCatalogId', classroom_catalog_id, 'classroomName', classroom_name, 'sortOrder', sort_order) order by weekday, start_time, sort_order), '[]'::jsonb) from public.class_schedule_slots where class_id = p_class_id)
  ) into v_response from public.classes where id = p_class_id;
  declare timetable_result jsonb; begin timetable_result := dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_schedule_defaults_v1', p_request_key, v_hash, v_response); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.validate_timetable_item_slots_v1(p_plan uuid, p_item uuid, p_subject text, p_slots jsonb, p_reference jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb; other jsonb; old public.timetable_plan_slots; changed boolean; tid uuid; rid uuid; sid uuid; day int; a int; b int; target_from date; target_to date; dt date;
begin
 select target_start_date,target_end_date into target_from,target_to from public.timetable_plans where id=p_plan;
 if jsonb_typeof(p_slots) is distinct from 'array' then raise exception using errcode='22023',message='timetable_invalid';end if;
 if jsonb_array_length(p_slots)>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
 if (select count(*)<>count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_slots) x) then raise exception using errcode='22023',message='timetable_invalid';end if;
 for v in select value from jsonb_array_elements(p_slots) loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in('id','itemId','planId','weekday','startMinute','endMinute','teacherId','classroomId','sourceSlotId','teacherName','classroomName')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 sid:=(v->>'id')::uuid;tid:=(v->>'teacherId')::uuid;rid:=(v->>'classroomId')::uuid;day:=(v->>'weekday')::int;a:=(v->>'startMinute')::int;b:=(v->>'endMinute')::int;
 if sid is null or tid is null or rid is null or (v->>'planId')::uuid is distinct from p_plan or (v->>'itemId')::uuid is distinct from p_item or day is null or day not between 0 and 6 or a is null or b is null or a<0 or b>1440 or a>=b then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into old from public.timetable_plan_slots where id=sid;
 if found and (old.plan_id<>p_plan or old.item_id<>p_item) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if (v->>'sourceSlotId')::uuid is distinct from old.source_slot_id then raise exception using errcode='22023',message='timetable_invalid';end if;
 changed:=old.id is null or (old.weekday,old.start_minute,old.end_minute,old.teacher_catalog_id,old.classroom_catalog_id) is distinct from (day,a,b,tid,rid);
 if not changed then continue;end if;
 if not exists(select 1 from public.teacher_catalogs where id=tid and is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(p_subject,subjects)) or not exists(select 1 from public.classroom_catalogs where id=rid and is_visible and (cardinality(subjects)=0 or p_subject=any(subjects))) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if not coalesce((p_reference->>'complete')::boolean,false) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_slots) x where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan and s.item_id<>p_item and i.state='draft' and s.weekday=day and s.start_minute<b and s.end_minute>a and (s.teacher_catalog_id=tid or s.classroom_catalog_id=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_reference->'shadowSlots') x where (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if target_from is not null and target_to is not null then
 if exists(select 1 from jsonb_array_elements(p_reference->'datedUnresolvedOccupancies') z where z->>'date' is null or (z->>'date')::date between target_from and target_to) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for dt in select distinct (value->>'date')::date from jsonb_array_elements(p_reference->'datedSessions') where (value->>'date')::date between target_from and target_to loop
 if extract(dow from dt)::int=day and exists(select 1 from jsonb_array_elements(p_reference->'datedSessions') x where x->>'state' in('active','exception','makeup') and (x->>'date')::date=dt and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end if;
 end loop;
end $function$
;

do $acl$ declare r record; begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dashboard_private' and p.proname=any(array['read_timetable_weekly_reference_v1','read_timetable_operating_reference_v1','timetable_effective_date_v1','timetable_occupancy_key_v1','timetable_intersects_v1','assert_timetable_operational_conflicts_v1','timetable_operating_before_statement_v1','timetable_operating_after_statement_v1','timetable_operating_finalize_v1']) loop execute format('alter function %s owner to postgres',r.signature);execute format('revoke all on function %s from public,anon,authenticated',r.signature);end loop;end $acl$;

alter function public.get_timetable_operational_reference_v1() owner to postgres; revoke all on function public.get_timetable_operational_reference_v1() from public,anon; grant execute on function public.get_timetable_operational_reference_v1() to authenticated;
-- Atomic class metadata/status/legacy schedule gateway. Closing keeps the
-- existing close RPC's student -> class row-lock order inside the global lock.
create or replace function public.update_class_operational_v1(p_class_id uuid,p_patch jsonb,p_request_key uuid,p_expected_schedule_plan jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldrow public.classes; nextrow public.classes; result jsonb; receipt jsonb; h text; closure jsonb;
begin
 perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if p_class_id is null or p_request_key is null or p_patch='{}'::jsonb or jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in('name','class_type','subject','subject_area_key','grade','teacher','schedule','room','capacity','fee','status','textbook_ids','textbook_usage','schedule_plan')) then raise exception using errcode='22023',message='class_schedule_validation';end if;
 h:=dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId',p_class_id,'patch',p_patch,'expectedSchedulePlan',p_expected_schedule_plan));
 receipt:=dashboard_private.continuous_class_schedule_request_replay_v1('update_class_operational_v1',p_request_key,h);
 if receipt is not null then return receipt;end if;
 if p_patch->>'status'='종강' then closure:=public.close_class_atomic_v1(p_class_id,p_request_key);end if;
 select * into oldrow from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='class_schedule_not_found';end if;
 if p_patch ? 'schedule_plan' then
 if oldrow.schedule_storage_mode='normalized' then raise exception using errcode='22023',message='class_schedule_validation';end if;
 if p_expected_schedule_plan is null or coalesce(oldrow.schedule_plan,'{}') is distinct from p_expected_schedule_plan then raise exception using errcode='P0001',message='class_schedule_stale';end if;
 end if;
 if oldrow.schedule_storage_mode='normalized' and (p_patch ?| array['teacher','schedule','room']) then raise exception using errcode='22023',message='class_schedule_validation';end if;
 if p_patch ? 'status' and p_patch->>'status' not in('수강','개강 준비','종강') then raise exception using errcode='22023',message='class_schedule_validation';end if;
 nextrow:=jsonb_populate_record(oldrow,p_patch);
 -- Dynamic SET list is restricted above; omitted operating columns never fire
 -- their statement triggers for a genuine metadata-only request.
 execute format('update public.classes set %s where id=$2 returning to_jsonb(classes)',(select string_agg(format('%I=($1).%I',k,k),', ' order by k) from jsonb_object_keys(p_patch) k)) using nextrow,p_class_id into result;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
 if not exists(select 1 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()) and (oldrow.name,oldrow.subject,oldrow.grade) is distinct from (nextrow.name,nextrow.subject,nextrow.grade) then
 update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';end if;
 return dashboard_private.record_continuous_class_schedule_receipt_v1('update_class_operational_v1',p_request_key,h,jsonb_build_object('classRow',result,'closeResult',closure));
end $f$;
alter function public.update_class_operational_v1(uuid,jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.update_class_operational_v1(uuid,jsonb,uuid,jsonb) from public,anon;
grant execute on function public.update_class_operational_v1(uuid,jsonb,uuid,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.get_timetable_plan_v1(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.timetable_plans; ref jsonb; items jsonb; slots jsonb; applied jsonb; members jsonb; total_items int; total_slots int; manage boolean; edit boolean;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 ref:=dashboard_private.read_timetable_operating_reference_v1();
 if p.target_start_date is not null and exists(select 1 from jsonb_array_elements(ref->'datedUnresolvedOccupancies') b where b->>'date' is null or (b->>'date')::date between p.target_start_date and p.target_end_date) then ref:=jsonb_set(ref,'{complete}','false');end if;
 -- Display-only tombstones retain the original UUID and last saved label.
 ref:=jsonb_set(ref,'{catalogs,teachers}',(ref#>'{catalogs,teachers}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.teacher_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.teacher_catalog_id) from (select s.teacher_catalog_id,max(s.teacher_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.teacher_catalogs t where t.id=s.teacher_catalog_id) group by s.teacher_catalog_id) x),'[]'::jsonb));
 ref:=jsonb_set(ref,'{catalogs,classrooms}',(ref#>'{catalogs,classrooms}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.classroom_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.classroom_catalog_id) from (select s.classroom_catalog_id,max(s.classroom_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.classroom_catalogs t where t.id=s.classroom_catalog_id) group by s.classroom_catalog_id) x),'[]'::jsonb));
 select count(*),coalesce(jsonb_agg(dashboard_private.timetable_item_json_v1(i) order by i.id),'[]') into total_items,items from public.timetable_plan_items i where plan_id=p_plan_id;
 select count(*) into total_slots from public.timetable_plan_slots where plan_id=p_plan_id;
 select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') into slots from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan_id and i.state='draft';
 select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'slots',(select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') from public.timetable_plan_slots s where s.item_id=i.id)) order by i.id),'[]') into applied from public.timetable_plan_items i where i.plan_id=p_plan_id and state='applied';
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(profile.name,''),'access',m.access) order by m.user_id),'[]') into members from public.timetable_plan_members m join public.profiles profile on profile.id=m.user_id where m.plan_id=p_plan_id;
 manage:=dashboard_private.timetable_actor_role_v1() in('admin','staff');
 edit:=manage or exists(select 1 from public.timetable_plan_members where plan_id=p_plan_id and user_id=auth.uid() and access='editor');
 return ref||jsonb_build_object('plan',dashboard_private.timetable_plan_json_v1(p),'items',items,'slots',slots,'appliedSnapshots',applied,'members',members,'permissions',jsonb_build_object('canManage',manage,'canEdit',edit and p.state='draft','canTransfer',manage and p.state='draft'),'capacity',jsonb_build_object('itemCount',total_items,'slotCount',total_slots,'maxItems',500,'maxSlots',2000,'exceeded',total_items>500 or total_slots>2000),'complete',(ref->>'complete')::boolean and total_items<=500 and total_slots<=2000);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_timetable_plan_revision_v1(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; p public.timetable_plans;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 r:=dashboard_private.read_timetable_operating_reference_v1();
 if p.target_start_date is not null and exists(select 1 from jsonb_array_elements(r->'datedUnresolvedOccupancies') b where b->>'date' is null or (b->>'date')::date between p.target_start_date and p.target_end_date) then r:=jsonb_set(r,'{complete}','false');end if;
 return jsonb_build_object('planId',p.id,'metaRevision',p.meta_revision,'changeSequence',p.change_sequence,'shadowFingerprint',r->>'shadowFingerprint','complete',(r->>'complete')::boolean and (select count(*)<=500 from public.timetable_plan_items where plan_id=p.id) and (select count(*)<=2000 from public.timetable_plan_slots where plan_id=p.id));
end $function$
;

CREATE OR REPLACE FUNCTION public.mutate_timetable_plan_v1(p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op text:=p_command->>'operation'; pid uuid:=(p_command->>'planId')::uuid; sourceid uuid:=(p_command->>'sourcePlanId')::uuid; p public.timetable_plans; src public.timetable_plans; response jsonb; m jsonb; i public.timetable_plan_items; ni uuid;
begin
 if ((p_command ? 'targetStartDate') <> (p_command ? 'targetEndDate')) or ((p_command->>'targetStartDate' is null) <> (p_command->>'targetEndDate' is null)) then raise exception using errcode='22023',message='timetable_invalid';end if;
 perform dashboard_private.timetable_require_v1(pid,false,true);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 perform 1 from public.timetable_plans where id in(pid,sourceid) order by id for update;
 perform dashboard_private.timetable_require_v1(pid,false,true);
 response:=dashboard_private.timetable_receipt_v1('plan.'||op,p_command);if response is not null then return response;end if;
 if pid is null or op is null or op not in('create','rename','clone','share','archive','restore') or exists(select 1 from jsonb_object_keys(p_command) k where k not in('operation','planId','sourcePlanId','expectedMetaRevision','name','targetStartDate','targetEndDate','members','requestKey')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into p from public.timetable_plans where id=pid;
 if op in('create','clone') then
 if p.id is not null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if op='clone' then
 select * into src from public.timetable_plans where id=sourceid;
 if src.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if src.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 perform dashboard_private.timetable_check_capacity_v1(src.id);
 end if;
 insert into public.timetable_plans(id,name,target_start_date,target_end_date,created_by,updated_by) values(pid,p_command->>'name',coalesce((p_command->>'targetStartDate')::date,src.target_start_date),coalesce((p_command->>'targetEndDate')::date,src.target_end_date),auth.uid(),auth.uid()) returning * into p;
 if op='clone' then
 for i in select * from public.timetable_plan_items where plan_id=src.id order by id loop
 ni:=gen_random_uuid();
 insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes,source_class_id,pending_slots)
 values(ni,pid,i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,i.default_teacher_id,i.default_classroom_id,i.duration_minutes,coalesce(i.source_class_id,i.applied_class_id),case when i.state='draft' then i.pending_slots else '[]'::jsonb end);
 if i.state='draft' then
 insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
 select gen_random_uuid(),pid,ni,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,coalesce(source_slot_id,id) from public.timetable_plan_slots where item_id=i.id;
 end if;end loop;end if;
 else
 if p.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if p.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 perform dashboard_private.timetable_check_capacity_v1(pid);
 if p.state='archived' and op not in('restore','share') then raise exception using errcode='42501',message='timetable_forbidden';end if;
 if op='share' then
 if jsonb_typeof(p_command->'members') is distinct from 'array' or (select count(*)<>count(distinct value->>'userId') from jsonb_array_elements(p_command->'members')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 for m in select value from jsonb_array_elements(p_command->'members') loop
 if not dashboard_private.timetable_teacher_eligible_v1((m->>'userId')::uuid) or m->>'access' is null or m->>'access' not in('viewer','editor') or exists(select 1 from jsonb_object_keys(m) k where k not in('userId','access')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 end loop;
 delete from public.timetable_plan_members where plan_id=pid;
 insert into public.timetable_plan_members(plan_id,user_id,access) select pid,(value->>'userId')::uuid,value->>'access' from jsonb_array_elements(p_command->'members');
 end if;
 update public.timetable_plans set name=case when op='rename' then p_command->>'name' else name end,
 target_start_date=case when p_command?'targetStartDate' then (p_command->>'targetStartDate')::date else target_start_date end,
 target_end_date=case when p_command?'targetEndDate' then (p_command->>'targetEndDate')::date else target_end_date end,
 state=case when op='archive' then 'archived' when op='restore' then 'draft' else state end,
 meta_revision=meta_revision+1,change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=pid returning * into p;
 end if;
 response:=jsonb_build_object('plan',dashboard_private.timetable_plan_json_v1(p));
 perform dashboard_private.timetable_record_receipt_v1('plan.'||op,p_command,response);return response;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or check_violation or not_null_violation then raise exception using errcode='22023',message='timetable_invalid';
end $function$
;
alter table public.timetable_plans add constraint timetable_plan_target_date_pair check ((target_start_date is null)=(target_end_date is null));
-- A lock cannot refresh a snapshot already pinned by RR/Serializable.
-- Fail closed rather than turning a domain condition into SQLSTATE 40001.
create or replace function dashboard_private.lock_timetable_operating_resources_v1()
returns void language plpgsql volatile security definer set search_path='' as $f$
begin
 if current_setting('transaction_isolation') not in('read committed','read uncommitted') then
 raise exception using errcode='25001',message='timetable_isolation_not_supported';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tips:timetable:operational',0));
end $f$;
