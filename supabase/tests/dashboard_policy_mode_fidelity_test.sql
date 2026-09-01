-- Regression: omitting AS RESTRICTIVE broadens non-assistant reads and leaks
-- assistant-participant history. All fixtures are local and rolled back.
begin;
select no_plan();

create function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('ae000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.pid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.pid(n), 'role', 'authenticated')::text, true);
end
$$;

-- Independent literal expectations from the approved seven-policy metadata
-- read (2026-08-31T09:13:31.679913+00:00), not the replay producer's output.
create temporary table policy_mode_expected(identity text primary key, fingerprint_sha256 text);
insert into policy_mode_expected values
  ('dashboard_notifications.dashboard_notifications_assistant_makeup_hard_deny', '243f2687b65fa33b35c21334da926cdc84bd844a07619847492b5e7df07b7799'),
  ('makeup_notification_deliveries.makeup_notification_deliveries_assistant_hard_deny', 'fc21249b58924e9c3e24b6aa057180617322852876df9b0714ae54544148ce40'),
  ('makeup_notification_settings.makeup_notification_settings_assistant_hard_deny', 'a8d2b36ac741cdee24f738aee4749dcda71ddf82d5c267157151c12ac0a09cce'),
  ('makeup_request_events.makeup_request_events_assistant_hard_deny', 'fc21249b58924e9c3e24b6aa057180617322852876df9b0714ae54544148ce40'),
  ('makeup_requests.makeup_requests_assistant_hard_deny', 'fc21249b58924e9c3e24b6aa057180617322852876df9b0714ae54544148ce40'),
  ('science_consultation_rate_limits.No direct client access', '6f9d6941c2746356e0cd1b1c6af14b76bbb2a58f435981faeb05a3651628442e'),
  ('science_consultation_requests.No direct client access', '6f9d6941c2746356e0cd1b1c6af14b76bbb2a58f435981faeb05a3651628442e');
select is((select p.permissive from pg_policies p where p.schemaname = 'public'
  and p.tablename || '.' || p.policyname = e.identity), 'RESTRICTIVE', e.identity || ': restrictive mode')
from policy_mode_expected e order by e.identity;
select is((select encode(extensions.digest(jsonb_build_object(
    'command', p.polcmd, 'roles', (select jsonb_agg(case when r.role_oid = 0 then 'public'
      else pg_get_userbyid(r.role_oid) end order by r.ordinality)
      from unnest(p.polroles) with ordinality r(role_oid, ordinality)),
    'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid),
    'permissive', p.polpermissive)::text, 'sha256'), 'hex')
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname || '.' || p.polname = e.identity),
  e.fingerprint_sha256, e.identity || ': exact roles, command, predicates and mode parity')
from policy_mode_expected e order by e.identity;

-- Characterize the OR/AND distinction behind this reconstruction bug.
create table public.policy_mode_fidelity_fixture(id integer primary key);
alter table public.policy_mode_fidelity_fixture enable row level security;
revoke all on public.policy_mode_fidelity_fixture from public, anon, authenticated;
grant select on public.policy_mode_fidelity_fixture to authenticated;
insert into public.policy_mode_fidelity_fixture values (1);
create policy allow_fixture on public.policy_mode_fidelity_fixture as permissive for select to authenticated using (true);
create policy deny_fixture_or on public.policy_mode_fidelity_fixture as permissive for select to authenticated using (false);
set local role authenticated;
select is((select count(*) from public.policy_mode_fidelity_fixture), 1::bigint, 'permissive false does not constrain permissive true');
reset role;
create policy deny_fixture_and on public.policy_mode_fidelity_fixture as restrictive for select to authenticated using (false);
set local role authenticated;
select is((select count(*) from public.policy_mode_fidelity_fixture), 0::bigint, 'restrictive false AND permissive true hides every fixture row');
reset role;

-- Snapshot side effects separately before seeding and before read assertions.
create function pg_temp.effects() returns jsonb language sql as $$
  select jsonb_build_object(
    'events', (select count(*) from dashboard_private.notification_events),
    'fanoutJobs', (select count(*) from dashboard_private.notification_event_fanout_jobs),
    'ruleJobs', (select count(*) from dashboard_private.notification_rule_reconciliation_jobs),
    'targetJobs', (select count(*) from dashboard_private.notification_target_reconciliation_jobs),
    'deliveries', (select count(*) from dashboard_private.notification_deliveries),
    'makeupDeliveries', (select count(*) from public.makeup_notification_deliveries),
    'dashboardNotifications', (select count(*) from public.dashboard_notifications))
$$;
create temporary table policy_mode_effect_snapshots(phase text primary key, counts jsonb);
insert into policy_mode_effect_snapshots values ('beforeSeed', pg_temp.effects());

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.pid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'policy-mode-' || n || '@test.invalid', crypt('local-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(801, 804) n;
insert into public.profiles(id, role, name, email, created_at, updated_at)
select pg_temp.pid(n), case when n = 804 then 'admin' when n = 803 then 'assistant' else 'teacher' end,
  'Policy Actor ' || n, 'policy-mode-' || n || '@test.invalid', now(), now()
from generate_series(801, 804) n
on conflict(id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

-- The real assistant-write guard remains enabled: an admin seeds historical
-- assistant participation. This does not grant assistants write permission.
select pg_temp.actor(804);
insert into public.makeup_requests(id, status, subject, approval_group, requester_id, teacher_profile_id,
  approver_profile_id, class_name, request_kind, reason, makeup_start_at, makeup_end_at, makeup_classroom, created_at)
select pg_temp.pid(n), 'approval_pending', '영어', 'english', pg_temp.pid(800 + n), pg_temp.pid(800 + n),
  pg_temp.pid(804), 'Policy fixture ' || n, 'makeup_only', 'Local policy fixture',
  '2026-08-31T09:00:00+09:00', '2026-08-31T10:00:00+09:00', 'A', now()
from generate_series(1, 3) n;
insert into public.makeup_request_events(id, request_id, actor_id, event_type, note, created_at)
select pg_temp.pid(500 + n), pg_temp.pid(n), pg_temp.pid(804), 'approved', 'Local policy fixture', now()
from generate_series(1, 3) n;
set constraints all immediate;
select is((select count(*) from public.makeup_requests where id in (pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3))), 3::bigint, 'three valid requests seeded with real constraints and triggers');
select is((select count(*) from public.makeup_request_events where id in (pg_temp.pid(501), pg_temp.pid(502), pg_temp.pid(503))), 3::bigint, 'three valid history events seeded');
insert into policy_mode_effect_snapshots values ('beforeReads', pg_temp.effects());
select is((select counts from policy_mode_effect_snapshots where phase = 'beforeReads'),
  (select counts from policy_mode_effect_snapshots where phase = 'beforeSeed'), 'seeding has zero notification event, job or delivery delta');
select diag('seed notification baselines: ' || counts::text) from policy_mode_effect_snapshots where phase = 'beforeSeed';

select pg_temp.actor(801);
set local role authenticated;
select is((select role from public.profiles where id = auth.uid()), 'teacher', 'involved teacher sees own authorization profile');
select is((select count(*) from public.makeup_requests where id = pg_temp.pid(1)), 1::bigint, 'involved teacher reads its request');
select is((select count(*) from public.makeup_request_events where id = pg_temp.pid(501)), 1::bigint, 'involved teacher reads its event');
select is((select count(*) from public.makeup_requests where id in (pg_temp.pid(2), pg_temp.pid(3))), 0::bigint, 'teacher cannot read unrelated requests');
select is((select count(*) from public.makeup_request_events where id in (pg_temp.pid(502), pg_temp.pid(503))), 0::bigint, 'teacher cannot read unrelated events');
reset role;
select pg_temp.actor(802);
set local role authenticated;
select is((select role from public.profiles where id = auth.uid()), 'teacher', 'second teacher sees own authorization profile');
select is((select count(*) from public.makeup_requests where id = pg_temp.pid(2)), 1::bigint, 'second teacher reads its request');
select is((select count(*) from public.makeup_request_events where id = pg_temp.pid(502)), 1::bigint, 'second teacher reads its event');
select is((select count(*) from public.makeup_requests where id = pg_temp.pid(1)), 0::bigint, 'unrelated teacher cannot read first request');
select is((select count(*) from public.makeup_request_events where id = pg_temp.pid(501)), 0::bigint, 'unrelated teacher cannot read first event');
reset role;
select pg_temp.actor(803);
set local role authenticated;
select is((select role from public.profiles where id = auth.uid()), 'assistant', 'assistant sees own authorization profile');
select is((select count(*) from public.makeup_requests where id = pg_temp.pid(3)), 0::bigint, 'assistant participant remains denied its request');
select is((select count(*) from public.makeup_request_events where id = pg_temp.pid(503)), 0::bigint, 'assistant participant remains denied its event history');
reset role;
select pg_temp.actor(804);
set local role authenticated;
select is((select role from public.profiles where id = auth.uid()), 'admin', 'manager sees own authorization profile');
select is((select count(*) from public.makeup_requests where id in (pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3))), 3::bigint, 'manager reads all synthetic requests through RLS');
select is((select count(*) from public.makeup_request_events where id in (pg_temp.pid(501), pg_temp.pid(502), pg_temp.pid(503))), 3::bigint, 'manager reads all synthetic events through RLS');
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select id from public.makeup_requests where id = 'ae000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anon request read fails with exact insufficient_privilege SQLSTATE');
select throws_ok($$select id from public.makeup_request_events where id = 'ae000000-0000-4000-8000-000000000501'$$,
  '42501', null, 'anon event read fails with exact insufficient_privilege SQLSTATE');
reset role;
insert into policy_mode_effect_snapshots values ('afterReads', pg_temp.effects());
select is((select counts from policy_mode_effect_snapshots where phase = 'afterReads'),
  (select counts from policy_mode_effect_snapshots where phase = 'beforeReads'), 'role reads have zero notification event, job or delivery delta');
select diag('read notification final counts: ' || counts::text) from policy_mode_effect_snapshots where phase = 'afterReads';
select is((select count(*) from public.makeup_requests where id in (pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3))), 3::bigint, 'reads preserve all seeded requests');
select is((select count(*) from public.makeup_request_events where id in (pg_temp.pid(501), pg_temp.pid(502), pg_temp.pid(503))), 3::bigint, 'reads preserve all seeded history events');
select * from finish();
rollback;
