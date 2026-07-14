begin;

drop trigger if exists prevent_direct_student_roster_insert on public.students;
drop trigger if exists prevent_direct_student_roster_array_write on public.students;
drop trigger if exists prevent_direct_class_roster_insert on public.classes;
drop trigger if exists prevent_direct_class_roster_array_write on public.classes;

create or replace function dashboard_private.prevent_direct_student_roster_array_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_relid <> 'public.students'::regclass then
    raise exception 'student_roster_trigger_table_invalid' using errcode = '23514';
  end if;

  if tg_op not in ('INSERT', 'UPDATE') then
    raise exception 'student_roster_trigger_operation_invalid' using errcode = '23514';
  end if;

  if current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      if pg_catalog.jsonb_typeof(coalesce(new.class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(new.waitlist_class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_array_length(coalesce(new.class_ids, '[]'::jsonb)) <> 0
        or pg_catalog.jsonb_array_length(coalesce(new.waitlist_class_ids, '[]'::jsonb)) <> 0
      then
        raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
      end if;
    else
      raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

alter function dashboard_private.prevent_direct_student_roster_array_write() owner to postgres;
revoke execute on function dashboard_private.prevent_direct_student_roster_array_write()
  from public, anon, authenticated;

create or replace function dashboard_private.prevent_direct_class_roster_array_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_relid <> 'public.classes'::regclass then
    raise exception 'class_roster_trigger_table_invalid' using errcode = '23514';
  end if;

  if tg_op not in ('INSERT', 'UPDATE') then
    raise exception 'class_roster_trigger_operation_invalid' using errcode = '23514';
  end if;

  if current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      if pg_catalog.jsonb_typeof(coalesce(new.student_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(new.waitlist_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_array_length(coalesce(new.student_ids, '[]'::jsonb)) <> 0
        or pg_catalog.jsonb_array_length(coalesce(new.waitlist_ids, '[]'::jsonb)) <> 0
      then
        raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
      end if;
    else
      raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

alter function dashboard_private.prevent_direct_class_roster_array_write() owner to postgres;
revoke execute on function dashboard_private.prevent_direct_class_roster_array_write()
  from public, anon, authenticated;

create trigger prevent_direct_student_roster_insert
before insert on public.students
for each row execute function dashboard_private.prevent_direct_student_roster_array_write();

create trigger prevent_direct_student_roster_array_write
before update of class_ids, waitlist_class_ids on public.students
for each row execute function dashboard_private.prevent_direct_student_roster_array_write();

create trigger prevent_direct_class_roster_insert
before insert on public.classes
for each row execute function dashboard_private.prevent_direct_class_roster_array_write();

create trigger prevent_direct_class_roster_array_write
before update of student_ids, waitlist_ids on public.classes
for each row execute function dashboard_private.prevent_direct_class_roster_array_write();

drop function dashboard_private.prevent_direct_roster_array_write();

commit;
