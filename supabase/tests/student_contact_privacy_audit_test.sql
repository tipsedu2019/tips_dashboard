-- OWNED SYNTHETIC pgTAP ONLY; prerequisite fixture then exact draft first.
-- Tests roll back their own writes. Prerequisite rows survive until root removes
-- the owned container. All data is synthetic; output contains assertions/hashes.
begin;
set local timezone = 'UTC';
set local statement_timeout = '45s';
select no_plan();
create function pg_temp.privacy_sid(n integer) returns uuid language sql immutable as $$
  select ('99490000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.privacy_event(n integer) returns public.dashboard_audit_logs
language sql stable as $$
  select a from public.dashboard_audit_logs a
  where entity_table='students' and entity_id=pg_temp.privacy_sid(n)::text
  order by event_sequence desc nulls last limit 1
$$;

select ok(exists(select 1 from pg_attribute where attrelid='public.students'::regclass
  and attname='makeedu_detail_id' and not attnotnull and atttypid='text'::regtype),
  'new link field is nullable text');
select is((select count(*) from public.students where makeedu_detail_id is not null),0::bigint,
  'installation initializes no link mappings');
select ok(not exists(select 1 from privacy_audit_qa.baseline_students b
  join public.students s using(id) where to_jsonb(s)-'makeedu_detail_id' is distinct from b.snapshot),
  'installation leaves every old student field including phones unchanged');
select ok(not exists(select 1 from privacy_audit_qa.baseline_history b
  left join public.dashboard_audit_logs a using(id) where to_jsonb(a) is distinct from b.snapshot),
  'installation does not update or delete any old audit row');
select is((select count(*) from public.dashboard_audit_logs),
  (select count(*) from privacy_audit_qa.baseline_history), 'installation appends no historical audit event');
select ok(exists(select 1 from pg_proc p, privacy_audit_qa.baseline_writer b
  where p.oid='dashboard_private.log_dashboard_audit_event_v2()'::regprocedure
    and p.proowner=b.proowner and p.proacl is not distinct from b.proacl
    and p.proconfig is not distinct from b.proconfig and p.prosecdef=b.prosecdef
    and p.provolatile=b.provolatile and p.proparallel=b.proparallel
    and p.proisstrict=b.proisstrict and p.proleakproof=b.proleakproof and p.prolang=b.prolang
    and p.procost=b.procost and p.prorows=b.prorows and p.prosupport=b.prosupport
    and p.proretset=b.proretset and p.prorettype=b.prorettype),
  'writer owner ACL security config and execution attributes are preserved');
select ok(not exists(select 1 from privacy_audit_qa.baseline_helpers b join pg_proc p on p.oid=b.identity::regprocedure
  where encode(extensions.digest(p.prosrc,'sha256'),'hex')<>b.source_hash
    or p.proowner<>b.proowner or p.proacl is distinct from b.proacl or p.proconfig is distinct from b.proconfig
    or p.prosecdef<>b.prosecdef), 'generic forward/reverse helpers are unchanged');
select ok(not exists(select 1 from privacy_audit_qa.baseline_access b join pg_class c on c.oid=('public.'||b.relname)::regclass
  where c.relacl is distinct from b.relacl or c.relrowsecurity<>b.relrowsecurity
    or c.relforcerowsecurity<>b.relforcerowsecurity), 'table ACL and RLS flags are unchanged');
select ok(not exists((select * from privacy_audit_qa.baseline_policies except
  select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
    where schemaname='public' and tablename in('students','dashboard_audit_logs'))
  union all
  (select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
    where schemaname='public' and tablename in('students','dashboard_audit_logs')
    except select * from privacy_audit_qa.baseline_policies)), 'policy set is unchanged');
select ok(not has_function_privilege('authenticated','dashboard_private.log_dashboard_audit_event_v2()','EXECUTE')
  and not has_function_privilege('anon','dashboard_private.log_dashboard_audit_event_v2()','EXECUTE')
  and not has_function_privilege('service_role','dashboard_private.log_dashboard_audit_event_v2()','EXECUTE'),
  'no application role gains writer EXECUTE');
select is(pg_get_indexdef('public.dashboard_audit_logs_v2_entity_sequence_idx'::regclass),
  (select definition from privacy_audit_qa.baseline_v2_index), 'original nonstudent v2 index is unchanged');
select ok((select pg_get_expr(indpred,indrelid) like '%students%' and pg_get_expr(indpred,indrelid) like '%privacy_v3%'
  from pg_index where indexrelid='public.dashboard_audit_logs_student_privacy_v3_sequence_idx'::regclass),
  'student predecessor index covers v2 and privacy_v3');
select ok((select not convalidated from pg_constraint where conrelid='public.dashboard_audit_logs'::regclass
  and conname='dashboard_audit_logs_v2_shape_check'), 'shape extension does not validate or rewrite historical rows');
select ok((select attacl is null from pg_attribute where attrelid='public.students'::regclass
  and attname='makeedu_detail_id'), 'new optional field has no explicit column grant');
select ok((select not convalidated from pg_constraint where conrelid='public.students'::regclass
  and conname='students_makeedu_detail_id_shape_check'), 'mapping shape does not validate historical data');
select ok(exists(select 1 from privacy_audit_qa.baseline_security_catalog b
  where b.roles is not distinct from (select jsonb_agg(jsonb_build_object(
    'name', r.rolname, 'superuser', r.rolsuper, 'inherit', r.rolinherit,
    'createRole', r.rolcreaterole, 'createDb', r.rolcreatedb,
    'login', r.rolcanlogin, 'replication', r.rolreplication, 'bypassRls', r.rolbypassrls
  ) order by r.rolname) from pg_roles r)
  and b.memberships is not distinct from (select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor)
    from pg_auth_members m)
  and b.defaults is not distinct from (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d)),
  'roles memberships and default ACLs are unchanged');

select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(102)$$,
  'v1-only student update starts an ordinary migration boundary');
select is((pg_temp.privacy_event(102)).chain_start_kind,'migration_boundary',
  'missing v2 predecessor does not manufacture a verified privacy boundary');
select ok((pg_temp.privacy_event(102)).chain_ordinal=1
  and (pg_temp.privacy_event(102)).predecessor_event_id is null
  and (pg_temp.privacy_event(102)).predecessor_after_hash is null,
  'v1-only migration boundary has no false predecessor link');
select lives_ok($$delete from public.students where id=pg_temp.privacy_sid(105)$$,
  'v1-only student delete also starts a projected migration boundary');
select is((pg_temp.privacy_event(105)).chain_start_kind,'migration_boundary',
  'v1-only delete records its unresolved predecessor scope');

set local app.class_schedule_request_key='99490000-0000-4000-8000-000000000801';
set local app.class_schedule_request_operation='__privacy_audit__ metadata only';
set local app.class_schedule_change_reason='__privacy_audit__ no contact reason';
select lives_ok($$update public.students set school='__privacy_audit__ changed' where id=pg_temp.privacy_sid(101)$$,
  'verified UTC v2 preimage accepts first projected update');
select is((pg_temp.privacy_event(101)).record_format,'privacy_v3','student update uses distinct projected format');
select is((pg_temp.privacy_event(101)).chain_start_kind,'privacy_boundary_v3','first v2 transition is explicit boundary');
select is((pg_temp.privacy_event(101)).chain_ordinal,1::bigint,'boundary starts one new projected chain');
select ok((pg_temp.privacy_event(101)).audit_chain_id<>(select (snapshot->>'audit_chain_id')::uuid
  from privacy_audit_qa.baseline_history where snapshot->>'entity_id'=pg_temp.privacy_sid(101)::text),
  'raw and projected hashes use different chain identities');
select is((pg_temp.privacy_event(101)).predecessor_event_id,(select id from privacy_audit_qa.baseline_history
  where snapshot->>'entity_id'=pg_temp.privacy_sid(101)::text),'boundary points to actual legacy predecessor');
select is((pg_temp.privacy_event(101)).predecessor_after_hash,(select snapshot->>'after_hash'
  from privacy_audit_qa.baseline_history where snapshot->>'entity_id'=pg_temp.privacy_sid(101)::text),
  'boundary preserves verified legacy hash link');
select ok(not ((pg_temp.privacy_event(101)).change_patch ?| array['contact','parent_contact']),
  'projected update patch omits physical contact keys');
select ok((select dashboard_private.dashboard_audit_forward_patch_v2(
    snapshot->'after_record',(pg_temp.privacy_event(101)).change_patch)->'contact'
      is not distinct from snapshot->'after_record'->'contact'
  from privacy_audit_qa.baseline_history where snapshot->>'entity_id'=pg_temp.privacy_sid(101)::text),
  'unchanged generic v2 helper retains old base contact: format dispatch is required');
select ok((pg_temp.privacy_event(101)).request_key=pg_temp.privacy_sid(801)
  and (pg_temp.privacy_event(101)).request_operation='__privacy_audit__ metadata only'
  and (pg_temp.privacy_event(101)).change_reason='__privacy_audit__ no contact reason',
  'student branch preserves audit request context without adding replay authority');
set local app.class_schedule_request_key='invalid';
select throws_ok($$update public.students set grade='blocked' where id=pg_temp.privacy_sid(101)$$,
  '22023','invalid continuous class schedule audit context','existing invalid audit context SQLSTATE is preserved');
set local app.class_schedule_request_key='';
set local app.class_schedule_request_operation='';
set local app.class_schedule_change_reason='';
select lives_ok($$update public.students set contact='010-0000-0991',parent_contact='010-0000-0992'
  where id=pg_temp.privacy_sid(101)$$,'later phone-only write keeps projected continuity');
select is((pg_temp.privacy_event(101)).change_patch,'{}'::jsonb,'phone-only write has empty projected diff');
select is((pg_temp.privacy_event(101)).before_hash,(pg_temp.privacy_event(101)).after_hash,
  'phone-only projected before and after hashes are equal');
select is((pg_temp.privacy_event(101)).chain_ordinal,2::bigint,'projected continuation advances one ordinal');
set local timezone='Asia/Seoul';
select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(101)$$,
  'projected chain continues across session TimeZone');
set local timezone='UTC';
select lives_ok($$update public.students set grade='중3' where id=pg_temp.privacy_sid(101)$$,
  'projected chain continues after switching back to UTC');

select throws_ok($$update public.students set school='blocked' where id=pg_temp.privacy_sid(111)$$,
  '55000','audit_chain_continuity_invalid','unverified old v2 TimeZone fails closed');
select is((select school from public.students where id=pg_temp.privacy_sid(111)),
  '__privacy_audit__ school','blocked TimeZone write leaves student unchanged');
set local timezone='Asia/Seoul';
select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(111)$$,
  'same historical Seoul TimeZone validates real legacy hash');
set local timezone='UTC';
select lives_ok($$update public.students set grade='중3' where id=pg_temp.privacy_sid(111)$$,
  'new projected chain needs no old TimeZone after boundary');
select throws_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(103)$$,
  '55000','audit_chain_continuity_invalid','corrupt v2 hash is never bypassed');
select throws_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(108)$$,
  '55000','student_privacy_created_at_unrepresentable','unsupported finite year fails closed');

select lives_ok($$insert into public.students(id,name,uid,school,grade,contact,parent_contact,created_at)
  values(pg_temp.privacy_sid(201),'__privacy_audit__ new','PRIVACY-SYN-201','__privacy_audit__ school','중1',
    '010-0000-0201','010-0000-0202','2026-01-02 03:04:05.123456+00')$$,
  'new student writes contact-free projected insertion');
select is((pg_temp.privacy_event(201)).record_format,'privacy_v3','insert uses projected format');
select is((pg_temp.privacy_event(201)).chain_start_kind,'insert','insert chain has ordinary start');
select ok(not ((pg_temp.privacy_event(201)).after_record ?| array['contact','parent_contact']),
  'insert snapshot omits contacts');
select is((pg_temp.privacy_event(201)).after_record->>'created_at','2026-01-02T03:04:05.123456Z',
  'created_at preserves UTC microseconds');
select throws_ok($$update public.dashboard_audit_logs set chain_start_kind='migration_boundary'
  where id=(pg_temp.privacy_event(201)).id$$,'23514',null,
  'INSERT cannot be relabeled as UPDATE or DELETE migration boundary');
select throws_ok($$update public.dashboard_audit_logs set after_hash=after_hash||E'\n'
  where id=(pg_temp.privacy_event(201)).id$$,'23514',null,
  'hash shape requires exactly 64 hexadecimal characters');
select lives_ok($$update public.students set makeedu_detail_id='Ab_/+Q==' where id=pg_temp.privacy_sid(201)$$,
  'bounded decoded opaque identifier accepts supported alphabet');
select lives_ok($$update public.students set makeedu_detail_id=repeat('A',256) where id=pg_temp.privacy_sid(201)$$,
  '256 character identifier is accepted');
select throws_ok($$update public.students set makeedu_detail_id=repeat('A',257) where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'overlong identifier is a check violation');
select throws_ok($$update public.students set makeedu_detail_id='' where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'empty identifier is rejected');
select throws_ok($$update public.students set makeedu_detail_id='https://school.makeedu.co.kr/member/student/list_detail.do?studNo=x'
  where id=pg_temp.privacy_sid(201)$$,'23514',null,'full URL is not stored as opaque identifier');
select throws_ok($$update public.students set makeedu_detail_id='id&phone=value' where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'query separator is rejected');
select throws_ok($$update public.students set makeedu_detail_id=E'Id\n' where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'trailing newline is rejected without dollar-anchor ambiguity');
select throws_ok($$update public.students set makeedu_detail_id='외부ID' where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'unverified non-ASCII alphabet is rejected');
select throws_ok($$update public.students set makeedu_detail_id='01000000201' where id=pg_temp.privacy_sid(201)$$,
  '23514',null,'conservative phone-shaped token policy is enforced');
select lives_ok($$update public.students set makeedu_detail_id='1234567' where id=pg_temp.privacy_sid(201)$$,
  'numeric opaque value remains distinct from displayed UID');
select is((select uid from public.students where id=pg_temp.privacy_sid(201)),'PRIVACY-SYN-201',
  'mapping never changes displayed UID');
select lives_ok($$update public.students set makeedu_detail_id=null where id=pg_temp.privacy_sid(201)$$,
  'unknown mapping remains nullable');

select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(106)$$,
  'positive infinity legacy boundary is preserved');
select is((pg_temp.privacy_event(106)).before_hash,
  encode(extensions.digest(((select to_jsonb(s)-array['contact','parent_contact']
    from public.students s where id=pg_temp.privacy_sid(106))||jsonb_build_object('grade','중1'))::text,'sha256'),'hex'),
  'positive infinity projection keeps its exact JSON literal');
select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(107)$$,
  'negative infinity legacy boundary is preserved');
select lives_ok($$insert into public.students(id,name,uid,created_at)
  values(pg_temp.privacy_sid(202),'__privacy_audit__ null time','PRIVACY-SYN-202',null)$$,
  'nullable created_at has a projected insertion');
select is((pg_temp.privacy_event(202)).after_record->'created_at','null'::jsonb,
  'SQL NULL created_at remains JSON null');
select lives_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(202)$$,
  'nullable created_at has stable projected continuity');
select lives_ok($$delete from public.students where id=pg_temp.privacy_sid(104)$$,
  'first write may be a verified contact-free delete boundary');
select is((pg_temp.privacy_event(104)).action,'DELETE','legacy-to-private deletion records action');
select ok(not ((pg_temp.privacy_event(104)).before_record ?| array['contact','parent_contact']),
  'delete snapshot omits contacts');
select lives_ok($$delete from public.students where id=pg_temp.privacy_sid(201)$$,
  'projected chain accepts later delete');
select is((pg_temp.privacy_event(201)).record_format,'privacy_v3','later delete stays projected');
select ok(not ((pg_temp.privacy_event(201)).before_record ?| array['contact','parent_contact']),
  'later delete snapshot cannot restore contact fields');
select is((pg_temp.privacy_event(201)).before_record->>'created_at','2026-01-02T03:04:05.123456Z',
  'delete snapshot has canonical created_at');

select lives_ok($$update public.students set makeedu_detail_id='SharedOpaque' where id=pg_temp.privacy_sid(109);
  update public.students set makeedu_detail_id='SharedOpaque' where id=pg_temp.privacy_sid(110)$$,
  'schema does not falsely assert unverified external one-to-one uniqueness');
update public.dashboard_audit_logs set after_hash=repeat('f',64)
where id=(pg_temp.privacy_event(109)).id;
select throws_ok($$update public.students set grade='중2' where id=pg_temp.privacy_sid(109)$$,
  '55000','audit_chain_continuity_invalid','corrupt projected predecessor also fails closed');

select lives_ok($$update public.textbooks set name='__privacy_audit__ textbook changed'
  where id=pg_temp.privacy_sid(901)$$,'nonstudent update retains strict v2 writer');
select is((select record_format from public.dashboard_audit_logs where entity_table='textbooks'
  and entity_id=pg_temp.privacy_sid(901)::text order by event_sequence desc limit 1),'diff_v2',
  'nonstudent update remains diff_v2');
select is((select audit_chain_id from public.dashboard_audit_logs where entity_table='textbooks'
  and entity_id=pg_temp.privacy_sid(901)::text order by event_sequence desc limit 1),
  (select (snapshot->>'audit_chain_id')::uuid from privacy_audit_qa.baseline_history
    where snapshot->>'entity_table'='textbooks' and snapshot->>'entity_id'=pg_temp.privacy_sid(901)::text),
  'nonstudent chain identity is preserved');
select lives_ok($$delete from public.textbooks where id=pg_temp.privacy_sid(901)$$,
  'nonstudent delete retains v2 snapshot behavior');
select is((select record_format from public.dashboard_audit_logs where entity_table='textbooks'
  and entity_id=pg_temp.privacy_sid(901)::text order by event_sequence desc limit 1),'full_v2',
  'nonstudent delete remains full_v2');

select throws_ok($$update public.dashboard_audit_logs set record_format='privacy_v3'
  where entity_table='textbooks' and entity_id=pg_temp.privacy_sid(901)::text and action='DELETE'$$,
  '23514',null,'privacy shape cannot be attached to nonstudent row');
select throws_ok($$update public.dashboard_audit_logs set before_record=before_record||jsonb_build_object('contact','PRIVATE_SYNTHETIC')
  where id=(pg_temp.privacy_event(104)).id$$,'23514',null,'privacy snapshot check rejects physical contact key');
select throws_ok($$update public.dashboard_audit_logs set change_patch=change_patch||jsonb_build_object('parent_contact',
  jsonb_build_object('before','PRIVATE_SYNTHETIC','after',null))
  where id=(pg_temp.privacy_event(101)).id$$,'23514',null,'privacy patch check rejects physical parent contact key');
select throws_ok($$update public.dashboard_audit_logs set chain_start_kind=null
  where id=(pg_temp.privacy_event(104)).id$$,'23514',null,'NULL cannot bypass boundary metadata check');
select throws_ok($$update public.dashboard_audit_logs set predecessor_after_hash='invalid'
  where id=(pg_temp.privacy_event(104)).id$$,'23514',null,'boundary hash link has strict shape');
select ok(not exists(select 1 from privacy_audit_qa.baseline_history b
  left join public.dashboard_audit_logs a using(id) where to_jsonb(a) is distinct from b.snapshot),
  'all original history rows remain byte-equivalent after future writes');
select ok(not exists(select 1 from public.dashboard_audit_logs where record_format='privacy_v3'
  and (coalesce(before_record,'{}') ?| array['contact','parent_contact']
    or coalesce(after_record,'{}') ?| array['contact','parent_contact']
    or coalesce(change_patch,'{}') ?| array['contact','parent_contact'])),
  'all actual new student audit payloads exclude contact fields');
select * from finish();
rollback;
