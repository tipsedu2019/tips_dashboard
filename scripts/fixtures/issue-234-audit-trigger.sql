-- Synthetic prerequisite schema and whole-trigger cases. The runner installs
-- the UNMODIFIED 20260814115116 migration between these two sections, then runs
-- the same cases before/after the reviewed forward migration. This is not the
-- full Supabase schema, auth bootstrap, or a production permission test.
-- @section setup
create schema dashboard_private;
create schema extensions;
create schema issue234_fixture;
create extension pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

-- Deliberately synthetic actor helper: only the audit trigger, writer role and
-- audit RLS below come from the real migration. Never use this helper as auth.
create function public.current_dashboard_role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb#>>'{app_metadata,role}','viewer')
$$;
create table public.dashboard_audit_logs (
 id uuid primary key default gen_random_uuid(), actor_profile_id uuid,
 actor_email text, actor_role text,
 action text not null check(action in('INSERT','UPDATE','DELETE')),
 entity_table text not null, entity_id text, entity_label text,
 before_record jsonb, after_record jsonb, changed_at timestamptz not null default now(),
 class_id uuid, request_key uuid, request_operation text, change_reason text
);
alter table public.dashboard_audit_logs enable row level security;

-- Nullable text IDs deliberately exercise trigger branches that UUID business
-- tables normally cannot reach. Row shape is fixed between both versions.
create table public.classes(id text,name text,payload jsonb);
create table public.teacher_catalogs(like public.classes);
create table public.profiles(like public.classes);
create table public.students(like public.classes);
create table public.textbooks(like public.classes);
create table public.class_schedule_slots(like public.classes);
create table public.class_lesson_sessions(like public.classes);

-- @section scenarios
grant usage on schema public to authenticated,anon;
grant select,insert,update,delete on public.classes to authenticated;
alter table public.classes enable row level security;
create policy fixture_admin_rows on public.classes to authenticated
 using(public.current_dashboard_role()='admin')
 with check(public.current_dashboard_role()='admin');

create table issue234_fixture.results(label text primary key);
create function issue234_fixture.check_case(label text, passed boolean)
returns void language plpgsql as $$begin
 if passed is distinct from true then raise exception 'issue234 whole-trigger assertion failed: %',label;end if;
 insert into issue234_fixture.results values(label);
end$$;
create function issue234_fixture.expect_error(label text,statement text,expected_state text)
returns void language plpgsql as $$declare actual text;begin
 begin execute statement;exception when others then get stacked diagnostics actual=returned_sqlstate;end;
 perform issue234_fixture.check_case(label,actual=expected_state);
end$$;
grant usage on schema issue234_fixture to authenticated,anon;
grant insert on issue234_fixture.results to authenticated,anon;

create function issue234_fixture.run_cases() returns jsonb language plpgsql as $$
declare first_event public.dashboard_audit_logs; previous_event public.dashboard_audit_logs;
 latest public.dashboard_audit_logs; before_value jsonb; after_value jsonb;
 before_count bigint; before_sequence bigint; after_sequence bigint;
 original_hash text; summary jsonb;
begin
 truncate public.classes,public.dashboard_audit_logs,issue234_fixture.results;
 alter sequence dashboard_private.dashboard_audit_event_sequence_v2 restart with 1;
 perform set_config('request.jwt.claim.sub','a2340000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"a2340000-0000-4000-8000-000000000001","email":"SYNTHETIC@EXAMPLE.INVALID","app_metadata":{"role":"admin"}}',true);
 perform set_config('app.class_schedule_class_id','a2340000-0000-4000-8000-000000000002',true);
 perform set_config('app.class_schedule_request_key','a2340000-0000-4000-8000-000000000003',true);
 perform set_config('app.class_schedule_request_operation','synthetic_trigger_case',true);
 perform set_config('app.class_schedule_change_reason','synthetic',true);

 perform issue234_fixture.check_case('writer has actual restricted role and audit RLS',
  (select not rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit
   from pg_roles where rolname='dashboard_audit_writer_v2')
  and (select relrowsecurity from pg_class where oid='public.dashboard_audit_logs'::regclass)
  and (select count(*)=2 from pg_policy where polrelid='public.dashboard_audit_logs'::regclass));
 perform issue234_fixture.check_case('caller lacks direct audit mutation and sequence and trigger privileges',
  not has_table_privilege('authenticated','public.dashboard_audit_logs','INSERT')
  and not has_table_privilege('authenticated','public.dashboard_audit_logs','UPDATE')
  and not has_table_privilege('authenticated','public.dashboard_audit_logs','DELETE')
  and not has_sequence_privilege('authenticated','dashboard_private.dashboard_audit_event_sequence_v2','USAGE')
  and not has_function_privilege('authenticated','dashboard_private.log_dashboard_audit_event_v2()','EXECUTE')
  and not has_function_privilege('anon','dashboard_private.log_dashboard_audit_event_v2()','EXECUTE'));

 set local role authenticated;
 insert into public.classes values('normal','Synthetic original','{"n":0,"nullable":null}');
 reset role;
 select * into first_event from public.dashboard_audit_logs where entity_id='normal';
 perform issue234_fixture.check_case('INSERT records first full chain',first_event.action='INSERT'
  and first_event.record_format='full_v2' and first_event.chain_ordinal=1 and first_event.chain_start_kind='insert'
  and first_event.predecessor_event_id is null and first_event.before_record is null
  and first_event.after_hash=encode(extensions.digest(first_event.after_record::text,'sha256'),'hex'));
 perform issue234_fixture.check_case('actor and request context retained',
  first_event.actor_profile_id='a2340000-0000-4000-8000-000000000001'::uuid
  and first_event.actor_email='synthetic@example.invalid' and first_event.actor_role='admin'
  and first_event.class_id='a2340000-0000-4000-8000-000000000002'::uuid
  and first_event.request_key='a2340000-0000-4000-8000-000000000003'::uuid
  and first_event.request_operation='synthetic_trigger_case' and first_event.change_reason='synthetic');
 select to_jsonb(c) into before_value from public.classes c where id='normal';
 set local role authenticated;
 update public.classes set name='Synthetic changed',payload='{"n":1,"nullable":"value"}' where id='normal';
 reset role;
 select to_jsonb(c) into after_value from public.classes c where id='normal';
 select * into latest from public.dashboard_audit_logs where entity_id='normal' order by event_sequence desc limit 1;
 perform issue234_fixture.check_case('UPDATE patch, hashes, predecessor and ordinal',latest.record_format='diff_v2'
  and latest.chain_ordinal=2 and latest.audit_chain_id=first_event.audit_chain_id
  and latest.predecessor_event_id=first_event.id and latest.predecessor_after_hash=first_event.after_hash
  and latest.before_hash=encode(extensions.digest(before_value::text,'sha256'),'hex')
  and latest.after_hash=encode(extensions.digest(after_value::text,'sha256'),'hex')
  and latest.before_record is null and latest.after_record is null
  and dashboard_private.dashboard_audit_forward_patch_v2(before_value,latest.change_patch)=after_value
  and dashboard_private.dashboard_audit_reverse_patch_v2(after_value,latest.change_patch)=before_value);
 previous_event:=latest;
 set local role authenticated;
 update public.classes set name=name where id='normal';
 reset role;
 select * into latest from public.dashboard_audit_logs where entity_id='normal' order by event_sequence desc limit 1;
 perform issue234_fixture.check_case('no-op UPDATE is audited',latest.change_patch='{}'::jsonb
  and latest.before_hash=latest.after_hash and latest.chain_ordinal=3 and latest.predecessor_event_id=previous_event.id);
 previous_event:=latest;
 set local role authenticated;
 delete from public.classes where id='normal';
 reset role;
 select * into latest from public.dashboard_audit_logs where entity_id='normal' order by event_sequence desc limit 1;
 perform issue234_fixture.check_case('DELETE keeps full preimage and chain',latest.action='DELETE'
  and latest.record_format='full_v2' and latest.before_record=after_value and latest.after_record is null
  and latest.after_hash is null and latest.chain_ordinal=4 and latest.predecessor_event_id=previous_event.id
  and latest.predecessor_after_hash=latest.before_hash);
 set local role authenticated;
 insert into public.classes values('normal','Recreated','{}');
 reset role;
 select * into latest from public.dashboard_audit_logs where entity_id='normal' order by event_sequence desc limit 1;
 perform issue234_fixture.check_case('INSERT after DELETE starts a new chain',latest.chain_ordinal=1
  and latest.chain_start_kind='insert' and latest.predecessor_event_id is null and latest.audit_chain_id<>first_event.audit_chain_id);

 set local role authenticated;
 insert into public.classes values(null,'NULL entity','{}'),('','Empty entity','{}');
 update public.classes set payload='{"step":1}' where id is null;
 update public.classes set payload='{"step":2}' where id='';
 reset role;
 perform issue234_fixture.check_case('NULL and empty IDs keep distinct predecessor chains',
  (select count(*)=4 and count(distinct audit_chain_id)=2 from public.dashboard_audit_logs where entity_id is null or entity_id='')
  and not exists(select 1 from public.dashboard_audit_logs c join public.dashboard_audit_logs p on p.id=c.predecessor_event_id
   where (c.entity_id is null or c.entity_id='') and c.entity_id is distinct from p.entity_id));

 -- Seed only source rows without audit as a pre-migration history boundary.
 alter table public.classes disable trigger dashboard_audit_classes;
 insert into public.classes values('missing-update','Before missing UPDATE','{}'),('missing-delete','Before missing DELETE','{}'),('legacy-only','Legacy boundary','{}');
 alter table public.classes enable trigger dashboard_audit_classes;
 insert into public.dashboard_audit_logs(action,entity_table,entity_id,record_format,after_record)
 values('INSERT','classes','legacy-only','full_v1','{}');
 set local role authenticated;
 update public.classes set payload='{"changed":true}' where id='missing-update';
 delete from public.classes where id='missing-delete';
 update public.classes set payload='{"changed":true}' where id='legacy-only';
 reset role;
 perform issue234_fixture.check_case('no predecessor UPDATE preserves FOUND=false boundary',
  (select chain_start_kind='migration_boundary' and chain_ordinal=1 and predecessor_event_id is null
   from public.dashboard_audit_logs where entity_id='missing-update'));
 perform issue234_fixture.check_case('no predecessor DELETE preserves FOUND=false boundary',
  (select chain_start_kind='migration_boundary' and chain_ordinal=1 and predecessor_event_id is null
   from public.dashboard_audit_logs where entity_id='missing-delete'));
 perform issue234_fixture.check_case('full_v1 is excluded from predecessor lookup',
  (select chain_start_kind='migration_boundary' and chain_ordinal=1 and predecessor_event_id is null
   from public.dashboard_audit_logs where entity_id='legacy-only' and record_format='diff_v2'));

 select count(*) into before_count from public.dashboard_audit_logs;
 select last_value into before_sequence from dashboard_private.dashboard_audit_event_sequence_v2;
 begin
  set local role authenticated;
  update public.classes set name='must roll back' where id='normal';
  raise exception 'intentional local rollback';
 exception when raise_exception then null;end;
 reset role;
 select last_value into after_sequence from dashboard_private.dashboard_audit_event_sequence_v2;
 perform issue234_fixture.check_case('rollback removes business and audit rows but keeps sequence gap',
  (select name='Recreated' from public.classes where id='normal')
  and (select count(*)=before_count from public.dashboard_audit_logs) and after_sequence=before_sequence+1);
 set local role authenticated;
 update public.classes set payload='{"afterRollback":true}' where id='normal';
 reset role;
 select * into latest from public.dashboard_audit_logs where entity_id='normal' order by event_sequence desc limit 1;
 perform issue234_fixture.check_case('next successful event keeps contiguous ordinal across sequence gap',
  latest.chain_ordinal=2 and latest.event_sequence=after_sequence+1
  and (select p.event_sequence<latest.event_sequence-1 from public.dashboard_audit_logs p where p.id=latest.predecessor_event_id));

 -- Corrupt only an isolated synthetic audit head, then require atomic rejection.
 set local role authenticated;
 insert into public.classes values('corrupt','Hash protected','{}');
 reset role;
 select after_hash into original_hash from public.dashboard_audit_logs where entity_id='corrupt';
 update public.dashboard_audit_logs set after_hash=repeat('0',64) where entity_id='corrupt';
 select count(*) into before_count from public.dashboard_audit_logs;
 set local role authenticated;
 perform issue234_fixture.expect_error('hash mismatch rejects with SQLSTATE 55000',
  $q$update public.classes set name='must fail' where id='corrupt'$q$,'55000');
 reset role;
 perform issue234_fixture.check_case('rejected hash write is atomic',
  (select name='Hash protected' from public.classes where id='corrupt') and (select count(*)=before_count from public.dashboard_audit_logs));
 update public.dashboard_audit_logs set after_hash=original_hash where entity_id='corrupt';
 set local role authenticated;
 delete from public.classes where id='corrupt';
 reset role;
 alter table public.classes disable trigger dashboard_audit_classes;
 insert into public.classes values('corrupt','Hash protected','{}');
 alter table public.classes enable trigger dashboard_audit_classes;
 set local role authenticated;
 perform issue234_fixture.expect_error('prior DELETE cannot be silently continued',
  $q$update public.classes set name='must also fail' where id='corrupt'$q$,'55000');
 reset role;

 select last_value into before_sequence from dashboard_private.dashboard_audit_event_sequence_v2;
 perform set_config('app.class_schedule_request_key','invalid-uuid',true);
 set local role authenticated;
 perform issue234_fixture.expect_error('invalid audit context stays SQLSTATE 22023',
  $q$update public.classes set name='invalid context' where id='normal'$q$,'22023');
 reset role;
 perform issue234_fixture.check_case('invalid context does not allocate event sequence',
  (select last_value=before_sequence from dashboard_private.dashboard_audit_event_sequence_v2));
 perform set_config('app.class_schedule_request_key','',true);
 perform set_config('request.jwt.claim.sub','malformed-uuid',true);
 set local role authenticated;
 insert into public.classes values('malformed-actor','Malformed synthetic actor','{}');
 reset role;
 perform issue234_fixture.check_case('malformed actor preserves original fallback',
  (select actor_profile_id is null and actor_email='' from public.dashboard_audit_logs where entity_id='malformed-actor'));
 perform set_config('request.jwt.claim.sub','a2340000-0000-4000-8000-000000000001',true);

 set local role anon;
 perform issue234_fixture.expect_error('anon cannot write fixture business rows',
  $q$insert into public.classes values('anon-denied','Denied','{}')$q$,'42501');
 reset role;
 perform set_config('request.jwt.claims','{"app_metadata":{"role":"viewer"}}',true);
 set local role authenticated;
 perform issue234_fixture.expect_error('synthetic caller policy denies viewer insert',
  $q$insert into public.classes values('viewer-denied','Denied','{}')$q$,'42501');
 perform issue234_fixture.expect_error('authenticated cannot insert audit directly',
  $q$insert into public.dashboard_audit_logs(action,entity_table) values('INSERT','classes')$q$,'42501');
 perform issue234_fixture.expect_error('authenticated cannot advance audit sequence',
  $q$select nextval('dashboard_private.dashboard_audit_event_sequence_v2')$q$,'42501');
 reset role;
 perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
 select count(*) into before_count from public.dashboard_audit_logs;
 set local role authenticated;
 update public.classes set name='absent' where id='does-not-exist';
 delete from public.classes where id='does-not-exist';
 reset role;
 perform issue234_fixture.check_case('nonexistent source UPDATE and DELETE produce no audit event',
  (select count(*)=before_count from public.dashboard_audit_logs));

 perform issue234_fixture.check_case('all recorded predecessor edges preserve hash chain and ordinal',
  not exists(select 1 from public.dashboard_audit_logs c left join public.dashboard_audit_logs p on p.id=c.predecessor_event_id
   where c.chain_ordinal>1 and (p.id is null or c.audit_chain_id is distinct from p.audit_chain_id
    or c.chain_ordinal<>p.chain_ordinal+1 or c.predecessor_after_hash is distinct from p.after_hash
    or c.before_hash is distinct from p.after_hash or c.entity_id is distinct from p.entity_id)));
 select jsonb_build_object('assertions',(select count(*) from issue234_fixture.results),
  'labels',(select jsonb_agg(label order by label) from issue234_fixture.results),
  'events',(select jsonb_agg((to_jsonb(a)-array['id','changed_at','audit_chain_id','predecessor_event_id'])
    ||jsonb_build_object('chainAnchorSequence',(select min(b.event_sequence) from public.dashboard_audit_logs b where b.audit_chain_id=a.audit_chain_id),
      'predecessorSequence',(select b.event_sequence from public.dashboard_audit_logs b where b.id=a.predecessor_event_id))
    order by a.event_sequence nulls last,a.entity_id)
   from public.dashboard_audit_logs a),'sequence',(select last_value from dashboard_private.dashboard_audit_event_sequence_v2)) into summary;
 return summary;
end$$;
