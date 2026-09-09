begin;
select plan(26);
set local search_path = public, extensions, pg_temp;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select hasnt_trigger('public', 'ops_registration_enrollments',
  'create_registration_first_consultation_task_v1', 'enrollment no longer creates a first-consultation task');
select hasnt_trigger('public', 'class_lesson_sessions',
  'sync_registration_first_consultation_task_v1', 'schedule edits no longer rewrite historical consultation tasks');
select hasnt_trigger('public', 'ops_registration_enrollments',
  'cancel_registration_followup_task_v1', 'cancellation no longer rewrites historical consultation tasks');

select ok(
  pg_catalog.pg_get_functiondef(function_name::regprocedure) ~* 'return new;'
  and pg_catalog.pg_get_functiondef(function_name::regprocedure) !~* '(insert into|update public[.]|delete from)',
  function_name || ' is inert even if an old trigger is restored'
)
from (values
  ('dashboard_private.create_registration_first_consultation_task_v1()'),
  ('dashboard_private.sync_registration_first_consultation_task_v1()'),
  ('dashboard_private.cancel_registration_followup_task_v1()')
) functions(function_name);

select ok(
  not pg_catalog.has_function_privilege('public', function_name, 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', function_name, 'EXECUTE'),
  function_name || ' preserves the private ACL boundary'
)
from (values
  ('dashboard_private.create_registration_first_consultation_task_v1()'),
  ('dashboard_private.sync_registration_first_consultation_task_v1()'),
  ('dashboard_private.cancel_registration_followup_task_v1()')
) functions(function_name);

select has_table('dashboard_private', 'registration_first_consultation_task_links',
  'historical first-consultation links are retained');
select is((select count(*) from public.ops_task_automation_rules
  where enabled and kind = 'trigger' and action ->> 'type' = 'create_follow_up_task'
    and (target, trigger_key) in (
      ('registration', 'registration.completed'), ('transfer', 'transfer.completed'),
      ('withdrawal', 'withdrawal.completed'), ('word_retest', 'word_retest.completed')
    )), 0::bigint, 'the four retired follow-up rules are disabled');

select lives_ok($$insert into public.ops_task_automation_rules(id, name, kind, target, trigger_key, enabled, action)
  values
    ('99709000-0000-4000-8000-000000000001', 'retired registration history', 'trigger', 'registration', 'registration.completed', false, '{"type":"create_follow_up_task"}'),
    ('99709000-0000-4000-8000-000000000002', 'retired transfer history', 'trigger', 'transfer', 'transfer.completed', false, '{"type":"create_follow_up_task"}'),
    ('99709000-0000-4000-8000-000000000003', 'retired withdrawal history', 'trigger', 'withdrawal', 'withdrawal.completed', false, '{"type":"create_follow_up_task"}'),
    ('99709000-0000-4000-8000-000000000004', 'retired retest history', 'trigger', 'word_retest', 'word_retest.completed', false, '{"type":"create_follow_up_task"}')$$,
  'disabled retired rule records remain writable for historical retention');

select throws_ok(format('update public.ops_task_automation_rules set enabled = true where id = %L::uuid', rule_id),
  '23514', 'new row for relation "ops_task_automation_rules" violates check constraint "ops_task_automation_retired_followup_disabled"',
  label || ' cannot reactivate the retired task generator')
from (values
  ('99709000-0000-4000-8000-000000000001', 'registration'),
  ('99709000-0000-4000-8000-000000000002', 'transfer'),
  ('99709000-0000-4000-8000-000000000003', 'withdrawal'),
  ('99709000-0000-4000-8000-000000000004', 'word retest')
) rules(rule_id, label);

select lives_ok($$insert into public.ops_task_automation_rules(name, kind, target, trigger_key, enabled, action)
  values ('unrelated curriculum rule', 'trigger', 'curriculum', 'curriculum.plan_saved', true, '{"type":"create_follow_up_task"}')$$,
  'an unrelated follow-up rule is outside the retirement scope');
select lives_ok($$insert into public.ops_task_automation_rules(name, kind, target, trigger_key, enabled, action)
  values ('registration Chat action', 'trigger', 'registration', 'registration.completed', true, '{"type":"send_google_chat"}')$$,
  'the same registration event may use a different future action');
select lives_ok($$insert into public.ops_task_automation_rules(name, kind, enabled, action)
  values ('unrelated schedule rule', 'recurring', true, '{"type":"create_follow_up_task"}')$$,
  'a distinct kind and nullable target remain outside the retirement scope');
select lives_ok($$update public.ops_task_automation_rules set name = 'retained historic configuration'
  where id = '99709000-0000-4000-8000-000000000001'$$,
  'the disabled historical configuration can still be maintained');

insert into public.ops_tasks(id, title, type, status, priority)
values
  ('99709000-0000-4000-8000-000000000011', 'retired generated open task', 'general', 'requested', 'normal'),
  ('99709000-0000-4000-8000-000000000012', 'retired generated completed task', 'general', 'done', 'normal'),
  ('99709000-0000-4000-8000-000000000013', 'manual task', 'general', 'requested', 'normal');
insert into public.ops_task_automation_runs(rule_id, source_id, source_key, source_type, task_id)
values
  ('99709000-0000-4000-8000-000000000001', 'retirement-open', 'retirement-open', 'registration', '99709000-0000-4000-8000-000000000011'),
  ('99709000-0000-4000-8000-000000000001', 'retirement-done', 'retirement-done', 'registration', '99709000-0000-4000-8000-000000000012');
create temporary table retirement_preserved_tasks on commit drop as
select task.id, pg_catalog.to_jsonb(task) as task_row from public.ops_tasks task
where id in ('99709000-0000-4000-8000-000000000012', '99709000-0000-4000-8000-000000000013');
create function pg_temp.retirement_notification_counts() returns jsonb language sql as $$
  select jsonb_build_object(
    'events', (select count(*) from dashboard_private.notification_events),
    'fanout', (select count(*) from dashboard_private.notification_event_fanout_jobs),
    'deliveries', (select count(*) from dashboard_private.notification_deliveries),
    'legacyDeliveries', (select count(*) from public.ops_task_notification_deliveries),
    'customerMessages', (select count(*) from public.ops_registration_messages)
  );
$$;
create temporary table retirement_notifications_before on commit drop as
select pg_temp.retirement_notification_counts() as state;
select is(dashboard_private.retire_registration_followup_tasks_v1(), 1,
  'owner maintenance cancels only the proven generated open task');
select ok((select status = 'canceled' from public.ops_tasks where id = '99709000-0000-4000-8000-000000000011')
  and (select count(*) = 1 from public.ops_task_events where task_id = '99709000-0000-4000-8000-000000000011'
    and event_type = 'registration_followup_task_retired' and before_value = 'requested' and after_value = 'canceled')
  and (select count(*) = 2 from public.ops_task_automation_runs where rule_id = '99709000-0000-4000-8000-000000000001'),
  'cancellation retains task and automation-run history with a system audit event');
select ok((select bool_and(before.task_row = pg_catalog.to_jsonb(task))
  from retirement_preserved_tasks before join public.ops_tasks task on task.id = before.id),
  'completed generated tasks and manual tasks remain byte-for-byte unchanged');
select is(dashboard_private.retire_registration_followup_tasks_v1(), 0,
  'replaying maintenance is a no-op');
select is(pg_temp.retirement_notification_counts(), (select state from retirement_notifications_before),
  'maintenance creates no notification event, fanout, customer message, or delivery');
select ok(not pg_catalog.has_function_privilege('public', 'dashboard_private.retire_registration_followup_tasks_v1()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'dashboard_private.retire_registration_followup_tasks_v1()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'dashboard_private.retire_registration_followup_tasks_v1()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'dashboard_private.retire_registration_followup_tasks_v1()', 'EXECUTE'),
  'maintenance has no user or service role execution escape hatch');

select * from finish();
rollback;
