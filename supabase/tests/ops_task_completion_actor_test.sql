begin;

select plan(16);

insert into public.profiles(id, role, name, login_id)
values
  ('00000000-0000-4000-8000-00000000c101', 'staff', '처리자 A', 'actor-a'),
  ('00000000-0000-4000-8000-00000000c102', 'staff', '처리자 B', 'actor-b'),
  ('00000000-0000-4000-8000-00000000c103', 'staff', '클라이언트 위조값', 'spoofed');

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000c101',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, completed_by, completed_by_label
)
values (
  '00000000-0000-4000-8000-00000000c104',
  '완료자 기록 테스트',
  'general',
  'requested',
  'normal',
  '00000000-0000-4000-8000-00000000c101',
  '00000000-0000-4000-8000-00000000c103',
  '클라이언트 위조값'
);

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  null::uuid,
  'a non-completed task never retains a supplied completion actor'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  null::text,
  'a non-completed task never retains a supplied completion actor label'
);

update public.ops_tasks
set status = 'done',
    completed_by = '00000000-0000-4000-8000-00000000c103',
    completed_by_label = '클라이언트 위조값'
where id = '00000000-0000-4000-8000-00000000c104';

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '00000000-0000-4000-8000-00000000c101'::uuid,
  'the authenticated completion actor replaces a client-supplied value'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '처리자 A',
  'the authenticated completion actor label replaces a client-supplied value'
);

update public.ops_tasks
set memo = 'client tried to rewrite the actor',
    completed_by = '00000000-0000-4000-8000-00000000c103',
    completed_by_label = '클라이언트 위조값'
where id = '00000000-0000-4000-8000-00000000c104';

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '00000000-0000-4000-8000-00000000c101'::uuid,
  'later edits cannot rewrite the recorded completion actor'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '처리자 A',
  'later edits cannot rewrite the recorded completion actor label'
);

update public.ops_tasks
set status = 'requested',
    completed_by = '00000000-0000-4000-8000-00000000c101',
    completed_by_label = '처리자 A'
where id = '00000000-0000-4000-8000-00000000c104';

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  null::uuid,
  'reopening clears the completion actor'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  null::text,
  'reopening clears the completion actor label'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000c102',
  true
);

update public.ops_tasks
set status = 'done'
where id = '00000000-0000-4000-8000-00000000c104';

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '00000000-0000-4000-8000-00000000c102'::uuid,
  'a later completion records the later authenticated actor'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c104'),
  '처리자 B',
  'a later completion records the later authenticated actor label'
);

select is(
  (
    select page.row_data ->> 'completedByLabel'
    from public.list_ops_task_page_v2(
      'general',
      pg_catalog.jsonb_build_object(
        'taskType', 'general',
        'search', '완료자 기록 테스트',
        'statuses', pg_catalog.jsonb_build_array(),
        'queue', 'completed',
        'requestedById', null,
        'requestedTeam', null,
        'assigneeId', null,
        'assigneeTeam', null,
        'focus', 'none',
        'sort', 'due'
      ),
      null,
      null,
      30
    ) page
    where page.id = '00000000-0000-4000-8000-00000000c104'
  ),
  '처리자 B',
  'the paged task response exposes the safe completion actor label'
);

-- The migration backfill runs before the new audit triggers exist. Reproduce
-- that historical shape with the old transfer/withdrawal source trigger live,
-- no JWT actor, and the same deferred-details setting used by the migration.
alter table public.ops_tasks disable trigger write_ops_transition_task_source_v1;
alter table public.ops_tasks disable trigger v_normalize_ops_task_completion_actor_input;
alter table public.ops_tasks disable trigger zz_set_ops_task_completion_actor;
alter table public.ops_tasks disable trigger prevent_ops_roster_completion_bypass;

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by
)
values (
  '00000000-0000-4000-8000-00000000c105',
  '이력 보정 전학 업무',
  'transfer',
  'requested',
  'normal',
  '00000000-0000-4000-8000-00000000c101'
);

update public.ops_tasks
set status = 'done',
    completed_at = pg_catalog.clock_timestamp()
where id = '00000000-0000-4000-8000-00000000c105';

insert into public.ops_task_events(task_id, actor_id, event_type, created_at)
values (
  '00000000-0000-4000-8000-00000000c105',
  '00000000-0000-4000-8000-00000000c101',
  'transfer.completed',
  pg_catalog.clock_timestamp()
);

alter table public.ops_tasks enable trigger write_ops_transition_task_source_v1;
alter table public.ops_tasks enable trigger prevent_ops_roster_completion_bypass;

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select is((select auth.uid()), null::uuid, 'historical backfill runs without a JWT actor');
select pg_catalog.set_config('app.ops_transition_defer_details', 'true', true);

update public.ops_tasks
set completed_by = '00000000-0000-4000-8000-00000000c101',
    completed_by_label = '처리자 A'
where id = '00000000-0000-4000-8000-00000000c105';

select pg_catalog.set_config('app.ops_transition_defer_details', '', true);
select pg_catalog.set_config('app.ops_transition_parent_details_changed', '', true);
alter table public.ops_tasks enable trigger v_normalize_ops_task_completion_actor_input;
alter table public.ops_tasks enable trigger zz_set_ops_task_completion_actor;

select is(
  (select completed_by from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c105'),
  '00000000-0000-4000-8000-00000000c101'::uuid,
  'historical transfer completion actor is backfilled without a JWT'
);

select is(
  (select completed_by_label from public.ops_tasks where id = '00000000-0000-4000-8000-00000000c105'),
  '처리자 A',
  'historical transfer completion actor label is backfilled'
);

select is(
  (select count(*)::integer from public.ops_task_events
   where task_id = '00000000-0000-4000-8000-00000000c105'
     and event_type = 'transfer.details_changed'),
  0,
  'historical completion actor repair does not create a transfer details event'
);

create temporary table completion_actor_profile_delete_result(
  blocked boolean not null
) on commit drop;

do $$
begin
  delete from public.profiles
  where id = '00000000-0000-4000-8000-00000000c102';
  insert into completion_actor_profile_delete_result(blocked) values (false);
exception when foreign_key_violation then
  insert into completion_actor_profile_delete_result(blocked) values (true);
end;
$$;

select ok(
  (select blocked from completion_actor_profile_delete_result),
  'a completed task retains its immutable actor audit link when a profile is deleted'
);

select * from finish();

rollback;
