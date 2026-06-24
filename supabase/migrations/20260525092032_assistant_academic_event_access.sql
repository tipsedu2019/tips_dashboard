drop policy if exists academic_events_staff_write on public.academic_events;
create policy academic_events_staff_write
  on public.academic_events
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));
