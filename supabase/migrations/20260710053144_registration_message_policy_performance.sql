create index if not exists ops_registration_messages_sent_by_idx
  on public.ops_registration_messages(sent_by)
  where sent_by is not null;

drop policy if exists ops_registration_messages_select on public.ops_registration_messages;
create policy ops_registration_messages_select
  on public.ops_registration_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = task_id
        and (
          (select public.current_dashboard_role()) in ('admin', 'staff')
          or task.requested_by = (select auth.uid())
          or task.assignee_id = (select auth.uid())
          or task.secondary_assignee_id = (select auth.uid())
        )
    )
  );
