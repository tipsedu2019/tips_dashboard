-- Nullable secondary assignees must not produce a nullable access decision.
-- Preserve every allow condition; unknown visibility fails closed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.dashboard_conflict_task_visible_v1(
  p_task public.ops_tasks,
  p_actor uuid,
  p_role text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_task.id is not null and (
    coalesce(p_role, '') in ('admin', 'staff', 'assistant')
    or p_actor = p_task.requested_by
    or p_actor = p_task.assignee_id
    or p_actor = p_task.secondary_assignee_id
    or dashboard_private.is_ops_word_retest_teacher(p_task.id)
  ), false);
$$;

commit;
