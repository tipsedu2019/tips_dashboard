begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.create_class_with_group_memberships_v1(
  p_class jsonb,
  p_group_ids uuid[]
)
returns public.classes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_class_id uuid;
  v_group_ids uuid[];
  v_group_count integer;
  v_status text;
begin
  if (select auth.uid()) is null
    or public.current_dashboard_role() not in ('admin', 'staff') then
    raise exception 'class_create_access_denied' using errcode = '42501';
  end if;

  if p_class is null or pg_catalog.jsonb_typeof(p_class) <> 'object' then
    raise exception 'class_create_input_invalid' using errcode = '22023';
  end if;

  if p_class - array[
    'id', 'name', 'class_type', 'subject', 'subject_area_key', 'grade',
    'teacher', 'schedule', 'room', 'capacity', 'fee', 'status', 'textbook_ids'
  ]::text[] <> '{}'::jsonb then
    raise exception 'class_create_input_invalid' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_class -> 'textbook_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'class_textbook_ids_invalid' using errcode = '22023';
  end if;

  if nullif(pg_catalog.btrim(p_class ->> 'name'), '') is null then
    raise exception 'class_name_required' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(group_input.group_id order by group_input.sort_order),
    '{}'::uuid[]
  )
  into v_group_ids
  from (
    select input.group_id, pg_catalog.min(input.ordinality) as sort_order
    from pg_catalog.unnest(coalesce(p_group_ids, '{}'::uuid[])) with ordinality
      as input(group_id, ordinality)
    where input.group_id is not null
    group by input.group_id
  ) as group_input;

  select pg_catalog.count(*)::integer
  into v_group_count
  from public.class_schedule_sync_groups as class_group
  where class_group.id = any(v_group_ids);

  if v_group_count <> pg_catalog.cardinality(v_group_ids) then
    raise exception 'class_group_not_found' using errcode = '23503';
  end if;

  v_class_id := coalesce(
    nullif(pg_catalog.btrim(p_class ->> 'id'), '')::uuid,
    pg_catalog.gen_random_uuid()
  );
  v_status := coalesce(nullif(pg_catalog.btrim(p_class ->> 'status'), ''), '수강');

  if v_status not in ('수강', '개강 준비', '종강') then
    raise exception 'class_status_invalid' using errcode = '22023';
  end if;

  insert into public.classes (
    id,
    name,
    class_type,
    subject,
    subject_area_key,
    grade,
    teacher,
    schedule,
    room,
    capacity,
    fee,
    status,
    student_ids,
    waitlist_ids,
    textbook_ids
  )
  values (
    v_class_id,
    nullif(pg_catalog.btrim(p_class ->> 'name'), ''),
    coalesce(nullif(pg_catalog.btrim(p_class ->> 'class_type'), ''), '정규'),
    coalesce(p_class ->> 'subject', ''),
    nullif(pg_catalog.btrim(p_class ->> 'subject_area_key'), ''),
    coalesce(p_class ->> 'grade', ''),
    coalesce(p_class ->> 'teacher', ''),
    coalesce(p_class ->> 'schedule', ''),
    coalesce(p_class ->> 'room', ''),
    coalesce(nullif(p_class ->> 'capacity', '')::integer, 0),
    coalesce(nullif(p_class ->> 'fee', '')::numeric, 0),
    v_status,
    '[]'::jsonb,
    '[]'::jsonb,
    coalesce(p_class -> 'textbook_ids', '[]'::jsonb)
  )
  returning * into v_class;

  insert into public.class_schedule_sync_group_members (
    group_id,
    class_id,
    sort_order
  )
  select
    input.group_id,
    v_class.id,
    input.ordinality - 1
  from pg_catalog.unnest(v_group_ids) with ordinality as input(group_id, ordinality);

  return v_class;
end;
$$;

create or replace function public.replace_class_group_memberships_v1(
  p_class_id uuid,
  p_group_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_ids uuid[];
  v_group_count integer;
begin
  if (select auth.uid()) is null
    or public.current_dashboard_role() not in ('admin', 'staff') then
    raise exception 'class_group_update_access_denied' using errcode = '42501';
  end if;

  if p_class_id is null then
    raise exception 'class_group_class_id_required' using errcode = '22023';
  end if;

  perform 1
  from public.classes as class_row
  where class_row.id = p_class_id
  for update;

  if not found then
    raise exception 'class_group_class_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.array_agg(group_input.group_id order by group_input.sort_order),
    '{}'::uuid[]
  )
  into v_group_ids
  from (
    select input.group_id, pg_catalog.min(input.ordinality) as sort_order
    from pg_catalog.unnest(coalesce(p_group_ids, '{}'::uuid[])) with ordinality
      as input(group_id, ordinality)
    where input.group_id is not null
    group by input.group_id
  ) as group_input;

  select pg_catalog.count(*)::integer
  into v_group_count
  from public.class_schedule_sync_groups as class_group
  where class_group.id = any(v_group_ids);

  if v_group_count <> pg_catalog.cardinality(v_group_ids) then
    raise exception 'class_group_not_found' using errcode = '23503';
  end if;

  delete from public.class_schedule_sync_group_members
  where class_id = p_class_id;

  insert into public.class_schedule_sync_group_members (
    group_id,
    class_id,
    sort_order
  )
  select
    input.group_id,
    p_class_id,
    input.ordinality - 1
  from pg_catalog.unnest(v_group_ids) with ordinality as input(group_id, ordinality);

  return pg_catalog.jsonb_build_object(
    'classId', p_class_id,
    'groupIds', pg_catalog.to_jsonb(v_group_ids)
  );
end;
$$;

-- Period membership is optional for continuously operated classes. Retire only
-- the invariant triggers; existing groups, memberships, and history remain.
drop trigger if exists class_active_group_membership_required_on_classes
  on public.classes;
drop trigger if exists class_active_group_membership_required_on_members
  on public.class_schedule_sync_group_members;

alter function public.create_class_with_group_memberships_v1(jsonb, uuid[])
  owner to postgres;
alter function public.replace_class_group_memberships_v1(uuid, uuid[])
  owner to postgres;

revoke all on function public.create_class_with_group_memberships_v1(jsonb, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.replace_class_group_memberships_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;

grant execute on function public.create_class_with_group_memberships_v1(jsonb, uuid[])
  to authenticated;
grant execute on function public.replace_class_group_memberships_v1(uuid, uuid[])
  to authenticated;

notify pgrst, 'reload schema';

commit;
