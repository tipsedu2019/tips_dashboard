do $$
begin
  if to_regclass('public.textbooks') is null then
    return;
  end if;

  alter table public.textbooks enable row level security;

  drop policy if exists textbooks_authenticated_select on public.textbooks;
  create policy textbooks_authenticated_select
    on public.textbooks
    for select
    to authenticated
    using (true);

  drop policy if exists textbooks_teacher_write on public.textbooks;
  create policy textbooks_teacher_write
    on public.textbooks
    for all
    to authenticated
    using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
    with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
end
$$;
