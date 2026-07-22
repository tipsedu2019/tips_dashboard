begin;

create or replace function public.handle_new_dashboard_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  normalized_login_id text;
  display_name text;
  teacher_display_name text;
  selected_teacher_team text;
  matched_profile_id uuid;
  profile_target_id uuid;
  linked_teacher_id uuid;
begin
  normalized_email := lower(nullif(new.email, ''));
  normalized_login_id := nullif(split_part(coalesce(normalized_email, ''), '@', 1), '');
  display_name := nullif(coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    normalized_login_id
  ), '');
  teacher_display_name := coalesce(display_name, normalized_login_id, new.id::text);
  selected_teacher_team := case trim(coalesce(
    new.raw_user_meta_data ->> 'teacher_team',
    new.raw_user_meta_data ->> 'team',
    ''
  ))
    when '수학팀' then '수학팀'
    when '과학팀' then '과학팀'
    when '관리팀' then '관리팀'
    when '조교팀' then '조교팀'
    else '영어팀'
  end;

  select profiles.id
  into matched_profile_id
  from public.profiles
  where profiles.id = new.id
    or (normalized_email is not null and lower(profiles.email) = normalized_email)
    or (normalized_login_id is not null and lower(profiles.login_id) = normalized_login_id)
  order by
    case
      when profiles.id = new.id then 0
      when normalized_email is not null and lower(profiles.email) = normalized_email then 1
      else 2
    end
  limit 1;

  profile_target_id := coalesce(matched_profile_id, new.id);

  begin
    if matched_profile_id is not null then
      update public.profiles
      set
        name = coalesce(nullif(public.profiles.name, ''), display_name),
        login_id = coalesce(nullif(public.profiles.login_id, ''), normalized_login_id),
        email = coalesce(nullif(public.profiles.email, ''), normalized_email),
        role = coalesce(nullif(public.profiles.role, ''), 'viewer'),
        updated_at = now()
      where public.profiles.id = profile_target_id;
    else
      insert into public.profiles (
        id,
        name,
        login_id,
        email,
        role,
        created_at,
        updated_at
      )
      values (
        profile_target_id,
        display_name,
        normalized_login_id,
        normalized_email,
        'viewer',
        now(),
        now()
      )
      on conflict (id) do update
      set
        name = coalesce(nullif(public.profiles.name, ''), excluded.name),
        login_id = coalesce(nullif(public.profiles.login_id, ''), excluded.login_id),
        email = coalesce(nullif(public.profiles.email, ''), excluded.email),
        updated_at = now();
    end if;
  exception
    when unique_violation then
      select profiles.id
      into profile_target_id
      from public.profiles
      where (normalized_email is not null and lower(public.profiles.email) = normalized_email)
         or (normalized_login_id is not null and lower(public.profiles.login_id) = normalized_login_id)
      order by public.profiles.updated_at desc nulls last
      limit 1;

      profile_target_id := coalesce(profile_target_id, new.id);

      update public.profiles
      set
        name = coalesce(nullif(public.profiles.name, ''), display_name),
        login_id = coalesce(nullif(public.profiles.login_id, ''), normalized_login_id),
        email = coalesce(nullif(public.profiles.email, ''), normalized_email),
        role = coalesce(nullif(public.profiles.role, ''), 'viewer'),
        updated_at = now()
      where public.profiles.id = profile_target_id;
  end;

  select profiles.teacher_catalog_id
  into linked_teacher_id
  from public.profiles
  where profiles.id = profile_target_id
    and profiles.teacher_catalog_id is not null
  limit 1;

  if linked_teacher_id is null then
    select teacher_catalogs.id
    into linked_teacher_id
    from public.teacher_catalogs
    where teacher_catalogs.profile_id = profile_target_id
       or (
        normalized_email is not null
        and lower(teacher_catalogs.account_email) = normalized_email
        and (teacher_catalogs.profile_id is null or teacher_catalogs.profile_id = profile_target_id)
       )
       or (
        display_name is not null
        and lower(teacher_catalogs.name) = lower(display_name)
        and (teacher_catalogs.profile_id is null or teacher_catalogs.profile_id = profile_target_id)
       )
    order by
      case
        when teacher_catalogs.profile_id = profile_target_id then 0
        when normalized_email is not null and lower(teacher_catalogs.account_email) = normalized_email then 1
        else 2
      end,
      teacher_catalogs.updated_at desc nulls last
    limit 1;
  end if;

  if linked_teacher_id is null then
    insert into public.teacher_catalogs (
      name,
      subjects,
      is_visible,
      sort_order,
      profile_id,
      account_email,
      dashboard_role,
      created_at,
      updated_at
    )
    values (
      teacher_display_name,
      array[selected_teacher_team],
      true,
      coalesce((select max(sort_order) + 1 from public.teacher_catalogs), 0),
      profile_target_id,
      normalized_email,
      'viewer',
      now(),
      now()
    )
    returning id into linked_teacher_id;
  else
    update public.teacher_catalogs
    set
      name = coalesce(nullif(public.teacher_catalogs.name, ''), teacher_display_name),
      subjects = case
        when coalesce(array_length(public.teacher_catalogs.subjects, 1), 0) = 0
          then array[selected_teacher_team]
        else public.teacher_catalogs.subjects
      end,
      is_visible = true,
      profile_id = profile_target_id,
      account_email = coalesce(normalized_email, nullif(public.teacher_catalogs.account_email, '')),
      dashboard_role = 'viewer',
      updated_at = now()
    where public.teacher_catalogs.id = linked_teacher_id;
  end if;

  update public.profiles
  set
    teacher_catalog_id = linked_teacher_id,
    updated_at = now()
  where public.profiles.id = profile_target_id
    and public.profiles.teacher_catalog_id is distinct from linked_teacher_id;

  return new;
end;
$$;

alter table public.classroom_catalogs
  drop constraint if exists classroom_catalogs_subjects_membership_check;

update public.classroom_catalogs
set subjects = (
  select pg_catalog.array_agg(value order by sort_order)
  from (
    select distinct member.value,
      case member.value when '영어' then 10 when '수학' then 20 when '과학' then 30 else 99 end as sort_order
    from pg_catalog.unnest(coalesce(subjects, array[]::text[]) || array['과학']) member(value)
  ) ordered
)
where pg_catalog.btrim(name) = '별관 4강';

alter table public.classroom_catalogs
  add constraint classroom_catalogs_subjects_membership_check
  check (
    pg_catalog.array_ndims(subjects) = 1
    and pg_catalog.cardinality(subjects) > 0
    and subjects <@ array['영어', '수학', '과학']::text[]
  ) not valid;

commit;
