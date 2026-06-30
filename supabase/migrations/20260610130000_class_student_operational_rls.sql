do $$
begin
  if to_regclass('public.classes') is not null then
    alter table public.classes enable row level security;

    drop policy if exists classes_authenticated_select on public.classes;
    create policy classes_authenticated_select
      on public.classes
      for select
      to authenticated
      using (true);

    drop policy if exists classes_authenticated_write on public.classes;
    drop policy if exists classes_teacher_write on public.classes;
    drop policy if exists classes_staff_write on public.classes;
    create policy classes_staff_write
      on public.classes
      for all
      to authenticated
      using (public.current_dashboard_role() in ('admin', 'staff'))
      with check (public.current_dashboard_role() in ('admin', 'staff'));
  end if;

  if to_regclass('public.students') is not null then
    alter table public.students enable row level security;

    drop policy if exists students_authenticated_select on public.students;
    create policy students_authenticated_select
      on public.students
      for select
      to authenticated
      using (true);

    drop policy if exists students_authenticated_write on public.students;
    drop policy if exists students_teacher_write on public.students;
    drop policy if exists students_staff_write on public.students;
    create policy students_staff_write
      on public.students
      for all
      to authenticated
      using (public.current_dashboard_role() in ('admin', 'staff'))
      with check (public.current_dashboard_role() in ('admin', 'staff'));
  end if;
end
$$;
