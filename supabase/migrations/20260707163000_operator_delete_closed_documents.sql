grant select, insert, update, delete on public.approval_requests to authenticated;
grant select, insert, update, delete on public.makeup_requests to authenticated;

drop policy if exists approval_requests_delete_operator_closed on public.approval_requests;
create policy approval_requests_delete_operator_closed
on public.approval_requests
for delete
to authenticated
using (
  status in ('approved', 'returned', 'canceled')
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists makeup_requests_delete_operator_closed on public.makeup_requests;
create policy makeup_requests_delete_operator_closed
  on public.makeup_requests
  for delete
  to authenticated
  using (
    public.current_dashboard_role() = 'admin'
    and status in ('completed', 'rejected', 'canceled')
  );
