do $isolated_fixture$
begin
  if exists (select 1 from public.class_schedule_sync_groups limit 1) then
    raise exception 'isolated_supabase_db_prerequisite_state_not_empty' using errcode = '55000';
  end if;
  insert into public.class_schedule_sync_groups (id, name, sort_order, is_default)
  values ('00000000-0000-4000-8000-000000000001'::uuid, 'Isolated schema contract default period', 0, true);
  if (select count(*) from public.class_schedule_sync_groups) <> 1
    or not exists (
      select 1
      from public.class_schedule_sync_groups
      where id = '00000000-0000-4000-8000-000000000001'::uuid
        and name = 'Isolated schema contract default period'
        and sort_order = 0
        and is_default
    ) then
    raise exception 'isolated_supabase_db_prerequisite_postcondition_failed' using errcode = '55000';
  end if;
end
$isolated_fixture$;
