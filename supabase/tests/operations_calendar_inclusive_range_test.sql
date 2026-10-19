-- Authorized isolated synthetic DB only. Every fixture rolls back.
begin;
select no_plan();
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000005';
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000005');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000005','admin') on conflict(id) do update set role=excluded.role;
create temporary table calendar_range_cases (
  ordinal integer primary key,
  title text not null,
  event_type text not null default '시험기간',
  starts_on date not null,
  metadata jsonb not null,
  expected_end text not null,
  expected_date_label text not null
) on commit drop;
insert into calendar_range_cases(ordinal, title, starts_on, metadata, expected_end, expected_date_label)
values
  (1, 'inclusive range', '2196-10-06', '{"rangeEnd":"2196-10-08"}', '2196-10-08', '2196-10-06 ~ 2196-10-08'),
  (2, 'missing end', '2196-10-06', '{}', '2196-10-06', '2196-10-06'),
  (3, 'same end', '2196-10-06', '{"rangeEnd":"2196-10-06"}', '2196-10-06', '2196-10-06'),
  (4, 'end before start', '2196-10-06', '{"rangeEnd":"2196-10-05"}', '2196-10-06', '2196-10-06'),
  (5, 'invalid day', '2196-02-28', '{"rangeEnd":"2196-02-30"}', '2196-02-28', '2196-02-28'),
  (6, 'invalid format', '2196-02-28', '{"rangeEnd":"2196-2-29"}', '2196-02-28', '2196-02-28'),
  (7, 'null end', '2196-10-06', '{"rangeEnd":null}', '2196-10-06', '2196-10-06'),
  (8, 'numeric end', '2196-10-06', '{"rangeEnd":21961008}', '2196-10-06', '2196-10-06'),
  (9, 'month boundary', '2196-09-30', '{"rangeEnd":"2196-10-02"}', '2196-10-02', '2196-09-30 ~ 2196-10-02'),
  (10, 'year boundary', '2196-12-31', '{"rangeEnd":"2197-01-02"}', '2197-01-02', '2196-12-31 ~ 2197-01-02'),
  (11, 'valid leap day', '2196-02-28', '{"rangeEnd":"2196-02-29"}', '2196-02-29', '2196-02-28 ~ 2196-02-29');
insert into calendar_range_cases(ordinal, title, event_type, starts_on, metadata, expected_end, expected_date_label)
values (12, 'actual subject range', '수학시험일', '2196-10-06', '{"rangeEnd":"2196-10-08"}', '2196-10-08', '2196-10-06 ~ 2196-10-08');

insert into public.academic_schools(id, name, category)
values ('93990000-0000-4000-8000-000000000001', '__calendar_range_synthetic__', 'high');
insert into public.academic_events(id, title, school_id, type, date, grade, note)
select
  ('93991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0'))::uuid,
  cases.title,
  '93990000-0000-4000-8000-000000000001',
  cases.event_type,
  cases.starts_on,
  '고1, 고2, 고3',
  E'합성 메모\n\n[[TIPS_META]] ' || cases.metadata::text
from calendar_range_cases as cases;

insert into public.academic_events(id,title,school_id,type,date,grade,note) values
('93991000-0000-4000-8000-000000000013','separate single grade','93990000-0000-4000-8000-000000000001','시험기간','2196-10-02','고2','합성 메모'),
('93991000-0000-4000-8000-000000000014','long range','93990000-0000-4000-8000-000000000001','시험기간','2196-10-01','all','[[TIPS_META]] {"rangeEnd":"9999-12-31"}');
create temporary table calendar_stored_before as select id,date,grade,note from public.academic_events where school_id='93990000-0000-4000-8000-000000000001';
select is(public.get_academic_event_detail_v1(('93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid)->>'endsAt',expected_end,title || ' exact detail inclusive end') from calendar_range_cases;
select is((select row->>'endsAt' from jsonb_array_elements(public.get_operations_calendar_range_v1(starts_on,starts_on)->'rows') row where row->>'id'='93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0')),expected_end,title || ' calendar inclusive end') from calendar_range_cases;
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000001'),1,'end equals viewport start remains visible');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-09','2196-10-09')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000001'),0,'day after inclusive end is absent');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2197-01-01','2197-01-02')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000010'),1,'prior year start overlaps January viewport');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-01','2196-10-02')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000009'),1,'prior month start overlaps October viewport');
select is(public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000001')->>'grade','고1, 고2, 고3','multi-grade identity is preserved');
select is(public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000013')->>'grade','고2','separate single grade identity is preserved');
select is(public.get_operations_calendar_range_v1('2196-10-01','2196-11-11')->>'ok','true','42 inclusive days allowed');
select throws_ok($$select public.get_operations_calendar_range_v1('2196-10-01','2196-11-12')$$,'22023','operations_visible_range_invalid','43 days rejected with exact SQLSTATE');
create temporary table calendar_snapshot as select public.get_operations_calendar_range_v1('2196-09-25','2196-11-05') as payload;
select diag('CALENDAR_RANGE_CAPTURE=' || jsonb_build_object('calendar',(select payload from calendar_snapshot),'details',(select jsonb_agg(public.get_academic_event_detail_v1(id) order by id) from calendar_stored_before))::text);
set local timezone = 'America/Los_Angeles';
select is(public.get_operations_calendar_range_v1('2196-09-25','2196-11-05'),(select payload from calendar_snapshot),'date-only output independent of timezone');
select is((select jsonb_agg(to_jsonb(e) order by id) from (select id,date,grade,note from public.academic_events where school_id='93990000-0000-4000-8000-000000000001') e),(select jsonb_agg(to_jsonb(e) order by id) from calendar_stored_before e),'reads never mutate saved data');
create temporary table calendar_role_results(actor text, calendar jsonb, detail jsonb, visible_ids jsonb) on commit drop;
grant insert on calendar_role_results to authenticated, anon;
create function pg_temp.calendar_capture(p_detail boolean) returns jsonb language plpgsql security invoker as $capture$
begin
  if p_detail then return public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000001'); end if;
  return public.get_operations_calendar_range_v1('2196-09-25','2196-11-05');
exception when others then return jsonb_build_object('sqlstate',sqlstate);
end $capture$;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000001');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000001','viewer') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000002');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000002','teacher') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000003');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000003','assistant') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000004');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000004','staff') on conflict(id) do update set role=excluded.role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000001';
insert into calendar_role_results values ('viewer',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000002';
insert into calendar_role_results values ('teacher',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000003';
insert into calendar_role_results values ('assistant',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000004","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000004';
insert into calendar_role_results values ('staff',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000005';
insert into calendar_role_results values ('admin',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role anon;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
insert into calendar_role_results values ('anon',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),null);
reset role;
select is(calendar->>'sqlstate','42501','anon calendar denied') from calendar_role_results where actor='anon';
select is(detail->>'sqlstate','42501','anon detail denied') from calendar_role_results where actor='anon';
select is((select coalesce(jsonb_agg(row->>'id' order by row->>'id'),'[]'::jsonb) from jsonb_array_elements(calendar->'rows') row where row->>'schoolId'='93990000-0000-4000-8000-000000000001'),visible_ids,actor || ' calendar matches RLS visible source identities') from calendar_role_results where actor<>'anon';
select is(detail->>'endsAt',case when visible_ids @> '["93991000-0000-4000-8000-000000000001"]'::jsonb then '2196-10-08' else null end,actor || ' exact detail respects visible source') from calendar_role_results where actor<>'anon';
select is(public.get_academic_event_detail_v1(('93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid)->>'durationLabel',case when expected_end=starts_on::text then '하루 일정' else expected_date_label end,title || ' detail duration label') from calendar_range_cases;
insert into public.academic_events(id,title,school_id,type,date,grade,note)
select ('93994000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'overlap dense ' || n,'93990000-0000-4000-8000-000000000001','팁스','2196-09-01','all','[[TIPS_META]] {"rangeEnd":"2196-10-08"}' from generate_series(1,2001) n;
select is(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->>'code','visible_range_too_dense','2001 overlapping prior starts preserve density rejection');
select is(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->'rows','[]'::jsonb,'dense response never returns partial rows');

-- Atomic calendar move regression: the original inclusive-range checks above remain intact.
-- Self-contained, rollback-only accounts; no external auth fixture is required.
SET LOCAL search_path = public, pg_catalog;
INSERT INTO auth.users(id)
SELECT ('9812bbbb-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
FROM generate_series(1,5) n;
INSERT INTO public.profiles(id,role)
SELECT ('9812bbbb-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, actor_role
FROM (VALUES (1,'admin'),(2,'staff'),(3,'teacher'),(4,'assistant'),(5,'viewer')) actors(n,actor_role)
ON CONFLICT (id) DO UPDATE SET role=excluded.role;
CREATE TEMP TABLE am_no_send_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM dashboard_private.notification_events) events,
       (SELECT count(*) FROM dashboard_private.notification_deliveries) deliveries,
       (SELECT count(*) FROM public.ops_task_notification_deliveries) task_deliveries,
       (SELECT count(*) FROM public.makeup_notification_deliveries) makeup_deliveries,
       (SELECT count(*) FROM net.http_request_queue) http_queue;
SELECT ok(to_regprocedure('public.move_academic_event_dates_v1(uuid,date,date,text,date,date)') IS NOT NULL,
  'exact RPC signature exists');
SELECT ok((SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='move_academic_event_dates_v1'), 'no extra RPC overload exists');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' FROM pg_proc
  WHERE oid='public.move_academic_event_dates_v1(uuid,date,date,text,date,date)'::regprocedure), 'RPC owner is postgres');
SELECT ok((SELECT NOT prosecdef AND provolatile='v' AND NOT proisstrict AND prorettype='jsonb'::regtype
  FROM pg_proc WHERE oid='public.move_academic_event_dates_v1(uuid,date,date,text,date,date)'::regprocedure),
  'RPC is volatile security invoker, accepts nulls for validation, and returns jsonb');
SELECT ok((SELECT cardinality(proconfig)=2 AND 'search_path=""'=ANY(proconfig) AND 'lock_timeout=2s'=ANY(proconfig)
  FROM pg_proc WHERE oid='public.move_academic_event_dates_v1(uuid,date,date,text,date,date)'::regprocedure),
  'RPC has exactly empty search path and bounded lock timeout');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.move_academic_event_dates_v1(uuid,date,date,text,date,date)'::regprocedure
    AND (a.grantee NOT IN (p.proowner,'authenticated'::regrole::oid) OR a.privilege_type<>'EXECUTE'
         OR (a.grantee='authenticated'::regrole::oid AND a.is_grantable))), 'RPC ACL has only owner and non-grantable authenticated execution');
SELECT ok(has_function_privilege('authenticated','public.move_academic_event_dates_v1(uuid,date,date,text,date,date)','EXECUTE'), 'authenticated has RPC execution');
SELECT ok(NOT has_function_privilege('anon','public.move_academic_event_dates_v1(uuid,date,date,text,date,date)','EXECUTE'), 'anon has no RPC execution');
SELECT ok(NOT has_function_privilege('service_role','public.move_academic_event_dates_v1(uuid,date,date,text,date,date)','EXECUTE'), 'service role has no RPC execution');
SELECT ok((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.academic_events'::regclass),
  'existing table RLS remains enabled with its original force flag');

CREATE TEMP TABLE am_fixture (
  n integer PRIMARY KEY, id uuid UNIQUE NOT NULL,
  old_date date NOT NULL, old_end date NOT NULL,
  original_note text, moved_note text
) ON COMMIT DROP;
CREATE TEMP TABLE am_setup (ready boolean NOT NULL) ON COMMIT DROP;
-- Synthetic payloads remain internal: never SELECT them or include them in test labels.
DO $seed$
BEGIN
  INSERT INTO am_fixture(n,id,old_date,old_end,original_note,moved_note)
  SELECT n,('9812aaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,DATE '2196-10-06',
    CASE WHEN n IN (3,8) THEN DATE '2196-10-08' ELSE DATE '2196-10-06' END,
    CASE WHEN n IN (1,5,7) THEN NULL WHEN n=4 THEN ''
      WHEN n IN (3,8) THEN E'  합성 e\u0301 🧪\n[[TIPS_META]] { "unknown" : 1.2300e+4, "rangeEnd" : "2196-10-08", "nested" : [true,{"a":"b"}] }  '
      ELSE E'  합성 e\u0301 🧪\n보존  ' END,
    CASE WHEN n IN (1,5,7) THEN NULL WHEN n=4 THEN ''
      WHEN n IN (3,8) THEN E'  합성 e\u0301 🧪\n[[TIPS_META]] { "unknown" : 1.2300e+4, "rangeEnd" : "2196-10-15", "nested" : [true,{"a":"b"}] }  '
      ELSE E'  합성 e\u0301 🧪\n보존  ' END
  FROM generate_series(1,8) n;
  INSERT INTO public.academic_events(id,date,note,title,type,grade,content)
    SELECT id,old_date,original_note,'012 focused synthetic fixture','시험기간','고1','synthetic preserved content' FROM am_fixture;
  INSERT INTO am_setup VALUES (true);
EXCEPTION WHEN OTHERS THEN
  -- Do not propagate server DETAIL, CONTEXT, row values, or SQLERRM.
  INSERT INTO am_setup VALUES (false);
END;
$seed$;
SELECT ok((SELECT ready FROM am_setup) AND (SELECT count(*)=8 FROM public.academic_events
  WHERE id IN (SELECT id FROM am_fixture)), 'eight isolated fixtures were created');

-- These helpers are test-only invoker functions in this session's temporary schema.
-- No helper changes roles or grants access to the product RPC/table.
CREATE FUNCTION pg_temp.am_context(p_actor integer, p_method text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $ctx$
DECLARE v_actor text := CASE WHEN p_actor IS NULL THEN '' ELSE '9812bbbb-0000-4000-8000-'||lpad(p_actor::text,12,'0') END;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',v_actor,true);
  PERFORM set_config('request.jwt.claim.role',current_user,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role',current_user,'sub',nullif(v_actor,''))::text,true);
  PERFORM set_config('request.method',coalesce(p_method,''),true);
END;
$ctx$;

CREATE FUNCTION pg_temp.am_probe(p_n integer, p_expected_state text, p_variant text DEFAULT 'valid')
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $probe$
DECLARE
  f pg_temp.am_fixture%ROWTYPE;
  v_id uuid; v_old date; v_end date; v_next date; v_next_end date; v_hash text;
  v_before jsonb; v_after jsonb; v_receipt jsonb; v_state text := '00000';
BEGIN
  SELECT * INTO STRICT f FROM pg_temp.am_fixture WHERE n=p_n;
  v_id:=f.id; v_old:=f.old_date; v_end:=f.old_end; v_next:=f.old_date+7; v_next_end:=f.old_end+7;
  v_hash:=CASE WHEN f.original_note IS NULL THEN NULL ELSE encode(sha256(convert_to(f.original_note,'UTF8')),'hex') END;
  CASE p_variant
    WHEN 'valid' THEN NULL;
    WHEN 'null_id' THEN v_id:=NULL;
    WHEN 'null_old' THEN v_old:=NULL;
    WHEN 'null_end' THEN v_end:=NULL;
    WHEN 'null_next' THEN v_next:=NULL;
    WHEN 'null_next_end' THEN v_next_end:=NULL;
    WHEN 'invalid_hash' THEN v_hash:=repeat('g',64);
    WHEN 'short_hash' THEN v_hash:='0';
    WHEN 'upper_hash' THEN v_hash:=repeat('A',64);
    WHEN 'old_backward' THEN v_end:=v_old-1;
    WHEN 'next_backward' THEN v_next_end:=v_next-1;
    WHEN 'duration_change' THEN v_next_end:=v_next_end+1;
    WHEN 'infinite_day' THEN v_old:='infinity'::date;
    WHEN 'outside_year' THEN v_next:=DATE '10000-01-01'; v_next_end:=DATE '10000-01-01';
    WHEN 'wrong_source_end' THEN v_end:=v_end+1; v_next_end:=v_next_end+1;
    WHEN 'missing' THEN v_id:='9812aaaa-0000-4000-8000-000000000999'::uuid;
    WHEN 'stale_hash' THEN v_hash:=repeat('0',64);
    WHEN 'empty_hash_for_null' THEN v_hash:=encode(sha256(convert_to('','UTF8')),'hex');
    WHEN 'null_hash_for_text' THEN v_hash:=NULL;
    WHEN 'stale_date' THEN v_old:=v_old-1; v_end:=v_end-1;
    ELSE RETURN false;
  END CASE;
  -- Snapshot the actual target under the same effective role. Nothing is emitted.
  SELECT to_jsonb(e) INTO v_before FROM public.academic_events e WHERE e.id=v_id;
  BEGIN
    v_receipt:=public.move_academic_event_dates_v1(v_id,v_old,v_end,v_hash,v_next,v_next_end);
  EXCEPTION
    WHEN query_canceled THEN v_state:=SQLSTATE;
    WHEN OTHERS THEN v_state:=SQLSTATE;
  END;
  SELECT to_jsonb(e) INTO v_after FROM public.academic_events e WHERE e.id=v_id;
  IF v_state<>p_expected_state THEN RETURN false; END IF;
  IF v_state<>'00000' THEN RETURN v_after IS NOT DISTINCT FROM v_before; END IF;
  RETURN v_before IS NOT NULL AND v_after IS NOT NULL
    AND (v_after->>'date')::date=v_next
    AND (v_after->>'note') COLLATE "C" IS NOT DISTINCT FROM f.moved_note COLLATE "C"
    AND (v_after - ARRAY['date','note'])=(v_before - ARRAY['date','note'])
    AND v_receipt=jsonb_build_object('id',v_id,'date',to_char(v_next,'YYYY-MM-DD'),'endsAt',to_char(v_next_end,'YYYY-MM-DD'),
      'noteSha256',CASE WHEN f.moved_note IS NULL THEN NULL ELSE encode(sha256(convert_to(f.moved_note,'UTF8')),'hex') END);
EXCEPTION
  WHEN query_canceled THEN RETURN false;
  WHEN OTHERS THEN RETURN false;
END;
$probe$;

CREATE FUNCTION pg_temp.am_intervene(p_n integer, p_field text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $change$
DECLARE v_rows bigint;
BEGIN
  IF p_field='note' THEN
    UPDATE public.academic_events SET note=note||' ' WHERE id=(SELECT id FROM pg_temp.am_fixture WHERE n=p_n);
  ELSIF p_field='date' THEN
    UPDATE public.academic_events SET date=date+1 WHERE id=(SELECT id FROM pg_temp.am_fixture WHERE n=p_n);
  ELSIF p_field='title' THEN
    UPDATE public.academic_events SET title='012 concurrent synthetic title' WHERE id=(SELECT id FROM pg_temp.am_fixture WHERE n=p_n);
  ELSE RETURN false;
  END IF;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  RETURN v_rows=1;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$change$;

DO $temp_acl$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon, service_role',pg_my_temp_schema()::regnamespace::text);
END;
$temp_acl$;
GRANT SELECT ON am_fixture TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.am_context(integer,text), pg_temp.am_probe(integer,text,text), pg_temp.am_intervene(integer,text)
  TO authenticated, anon, service_role;

SET LOCAL ROLE authenticated;
DO $$BEGIN PERFORM pg_temp.am_context(1,'POST'); END$$;
SELECT ok(current_user='authenticated' AND auth.uid()='9812bbbb-0000-4000-8000-000000000001'::uuid
  AND current_dashboard_role()='admin' AND row_security_active('public.academic_events'), 'admin fixture uses authenticated role and active RLS');
SELECT ok(pg_temp.am_probe(1,'00000'), 'admin POST moves null-note day with exact receipt and other fields preserved');
SELECT ok(pg_temp.am_probe(3,'00000'), 'admin POST moves range with only date and end token changed and exact receipt');
SELECT ok(pg_temp.am_probe(4,'00000'), 'empty note remains distinct from null in row and receipt');
SELECT ok(pg_temp.am_probe(3,'PT409'), 'repeating a changed move from the same old snapshot conflicts and preserves row');
DO $$BEGIN PERFORM pg_temp.am_context(2,'POST'); END$$;
SELECT ok(current_user='authenticated' AND current_dashboard_role()='staff' AND row_security_active('public.academic_events'), 'staff fixture uses authenticated role and active RLS');
SELECT ok(pg_temp.am_probe(2,'00000'), 'staff POST preserves ordinary note bytes and all unrelated fields');
DO $$BEGIN PERFORM pg_temp.am_context(4,'POST'); END$$;
SELECT ok(current_dashboard_role()='assistant' AND pg_temp.am_probe(5,'42501'), 'assistant is denied despite broader existing table write RLS');
DO $$BEGIN PERFORM pg_temp.am_context(3,'POST'); END$$;
SELECT ok(current_dashboard_role()='teacher' AND pg_temp.am_probe(5,'42501'), 'teacher is denied and row preserved');
DO $$BEGIN PERFORM pg_temp.am_context(5,'POST'); END$$;
SELECT ok(current_dashboard_role()='viewer' AND pg_temp.am_probe(5,'42501'), 'viewer is denied and row preserved');
DO $$BEGIN PERFORM pg_temp.am_context(NULL,'POST'); END$$;
SELECT ok(auth.uid() IS NULL AND pg_temp.am_probe(5,'42501'), 'authenticated role without an actor is denied');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$BEGIN PERFORM pg_temp.am_context(NULL,'POST'); END$$;
SELECT ok(current_user='anon' AND pg_temp.am_probe(5,'42501'), 'anon role is denied by RPC ACL');
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$BEGIN PERFORM pg_temp.am_context(1,'POST'); END$$;
SELECT ok(current_user='service_role' AND auth.uid()='9812bbbb-0000-4000-8000-000000000001'::uuid
  AND pg_temp.am_probe(5,'42501'), 'service role is denied by RPC ACL even with an admin actor claim');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$BEGIN PERFORM pg_temp.am_context(1,'GET'); END$$;
SELECT ok(pg_temp.am_probe(5,'22023'), 'GET is rejected before mutation');
DO $$BEGIN PERFORM pg_temp.am_context(1,NULL); END$$;
SELECT ok(pg_temp.am_probe(5,'22023'), 'empty request method is rejected before mutation');
DO $$BEGIN PERFORM pg_temp.am_context(1,'POST'); END$$;

-- Fourteen separate fixed-label assertions, no argument values are printed.
SELECT ok(pg_temp.am_probe(5,'22023',variant), label)
FROM (VALUES
  (1,'null_id','null id rejected with 22023'),
  (2,'null_old','null expected date rejected with 22023'),
  (3,'null_end','null expected end rejected with 22023'),
  (4,'null_next','null next date rejected with 22023'),
  (5,'null_next_end','null next end rejected with 22023'),
  (6,'invalid_hash','non-hex fingerprint rejected with 22023'),
  (7,'short_hash','short fingerprint rejected with 22023'),
  (8,'upper_hash','noncanonical uppercase fingerprint rejected with 22023'),
  (9,'old_backward','backward source interval rejected with 22023'),
  (10,'next_backward','backward destination interval rejected with 22023'),
  (11,'duration_change','changed interval length rejected with 22023'),
  (12,'infinite_day','infinite date rejected with 22023'),
  (13,'outside_year','out-of-contract year rejected with 22023'),
  (14,'wrong_source_end','source end mismatch rejected with 22023')
) cases(ordinal,variant,label) ORDER BY ordinal;
SELECT ok(pg_temp.am_probe(5,'PT409','missing'), 'missing row returns PT409 without mutation');
SELECT ok(pg_temp.am_probe(5,'PT409','stale_hash'), 'changed note fingerprint returns PT409 without mutation');
SELECT ok(pg_temp.am_probe(5,'PT409','empty_hash_for_null'), 'empty-string fingerprint cannot match a null note');
SELECT ok(pg_temp.am_probe(6,'PT409','null_hash_for_text'), 'null fingerprint cannot match an ordinary note');
SELECT ok(pg_temp.am_probe(5,'PT409','stale_date'), 'stale date returns PT409 without mutation');
SELECT ok(pg_temp.am_intervene(6,'note'), 'synthetic intervening note update completed');
SELECT ok(pg_temp.am_probe(6,'PT409'), 'old snapshot rejects intervening note update and retains it');
SELECT ok(pg_temp.am_intervene(7,'date'), 'synthetic intervening date update completed');
SELECT ok(pg_temp.am_probe(7,'PT409'), 'old snapshot rejects intervening date update and retains it');
SELECT ok(pg_temp.am_intervene(8,'title'), 'synthetic intervening title update completed');
SELECT ok(pg_temp.am_probe(8,'00000'), 'title-only intervention allows date move and preserves updated title and other fields');
SELECT ok((SELECT e.date=f.old_date AND e.note IS NOT DISTINCT FROM f.original_note
  AND e.title='012 focused synthetic fixture' AND e.content='synthetic preserved content'
  FROM public.academic_events e JOIN pg_temp.am_fixture f ON f.id=e.id WHERE f.n=5),
  'all denied and invalid requests left their shared error fixture unchanged');
RESET ROLE;
SELECT ok((SELECT count(*) FROM dashboard_private.notification_events)=(SELECT events FROM am_no_send_before)
  AND (SELECT count(*) FROM dashboard_private.notification_deliveries)=(SELECT deliveries FROM am_no_send_before)
  AND (SELECT count(*) FROM public.ops_task_notification_deliveries)=(SELECT task_deliveries FROM am_no_send_before)
  AND (SELECT count(*) FROM public.makeup_notification_deliveries)=(SELECT makeup_deliveries FROM am_no_send_before)
  AND (SELECT count(*) FROM net.http_request_queue)=(SELECT http_queue FROM am_no_send_before),
  'RPC success, conflict, and rejection sequence creates no notification or HTTP queue rows');
select * from finish();
rollback;
