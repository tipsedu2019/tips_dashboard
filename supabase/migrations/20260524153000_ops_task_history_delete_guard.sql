drop policy if exists ops_tasks_delete on public.ops_tasks;
create policy ops_tasks_delete
  on public.ops_tasks
  for delete
  to authenticated
  using (
    public.current_dashboard_role() = 'admin'
    or (
      type = 'general'
      and (
        requested_by = auth.uid()
        or assignee_id = auth.uid()
        or secondary_assignee_id = auth.uid()
      )
    )
    or (
      requested_by = auth.uid()
      and status not in ('done', 'canceled')
    )
    or (
      public.current_dashboard_role() = 'staff'
      and (
        type = 'general'
        or status not in ('done', 'canceled')
      )
    )
  );
