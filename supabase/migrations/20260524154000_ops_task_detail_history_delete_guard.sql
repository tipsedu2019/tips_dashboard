drop policy if exists ops_registration_details_write on public.ops_registration_details;
drop policy if exists ops_withdrawal_details_write on public.ops_withdrawal_details;
drop policy if exists ops_transfer_details_write on public.ops_transfer_details;
drop policy if exists ops_word_retests_write on public.ops_word_retests;

create policy ops_registration_details_insert
  on public.ops_registration_details
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_registration_details_update
  on public.ops_registration_details
  for update
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_registration_details_delete
  on public.ops_registration_details
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = task_id
        and (
          public.current_dashboard_role() = 'admin'
          or (
            public.current_dashboard_role() = 'staff'
            and ops_tasks.status not in ('done', 'canceled')
          )
        )
    )
  );

create policy ops_withdrawal_details_insert
  on public.ops_withdrawal_details
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_withdrawal_details_update
  on public.ops_withdrawal_details
  for update
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_withdrawal_details_delete
  on public.ops_withdrawal_details
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = task_id
        and (
          public.current_dashboard_role() = 'admin'
          or (
            public.current_dashboard_role() = 'staff'
            and ops_tasks.status not in ('done', 'canceled')
          )
        )
    )
  );

create policy ops_transfer_details_insert
  on public.ops_transfer_details
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_transfer_details_update
  on public.ops_transfer_details
  for update
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_transfer_details_delete
  on public.ops_transfer_details
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = task_id
        and (
          public.current_dashboard_role() = 'admin'
          or (
            public.current_dashboard_role() = 'staff'
            and ops_tasks.status not in ('done', 'canceled')
          )
        )
    )
  );

create policy ops_word_retests_insert
  on public.ops_word_retests
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_word_retests_update
  on public.ops_word_retests
  for update
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

create policy ops_word_retests_delete
  on public.ops_word_retests
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = task_id
        and (
          public.current_dashboard_role() = 'admin'
          or (
            public.current_dashboard_role() = 'staff'
            and ops_tasks.status not in ('done', 'canceled')
          )
        )
    )
  );
