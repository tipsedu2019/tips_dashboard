set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function public.handle_new_dashboard_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  normalized_login_id text;
  v_display_name text;
  teacher_display_name text;
  selected_teacher_team text;
  matched_profile_id uuid;
  profile_target_id uuid;
  linked_teacher_id uuid;
  teacher_name_attempt integer := 1;
begin
  normalized_email := lower(nullif(new.email, ''));
  -- External identities use the complete address. Only existing internal aliases
  -- retain their historical local-part login ID. Never merge external domains.
  normalized_login_id := case when normalized_email like '%@tipsedu.co.kr'
    then nullif(split_part(normalized_email, '@', 1), '') else normalized_email end;
  v_display_name := nullif(coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    nullif(split_part(coalesce(normalized_email, ''), '@', 1), '')
  ), '');
  teacher_display_name := coalesce(v_display_name, normalized_login_id, new.id::text);
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
    or (normalized_email like '%@tipsedu.co.kr' and lower(profiles.login_id) = normalized_login_id)
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
        name = coalesce(nullif(public.profiles.name, ''), v_display_name),
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
        v_display_name,
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
         or (normalized_email like '%@tipsedu.co.kr' and lower(public.profiles.login_id) = normalized_login_id)
      order by public.profiles.updated_at desc nulls last
      limit 1;

      profile_target_id := coalesce(profile_target_id, new.id);

      update public.profiles
      set
        name = coalesce(nullif(public.profiles.name, ''), v_display_name),
        login_id = coalesce(nullif(public.profiles.login_id, ''), normalized_login_id),
        email = coalesce(nullif(public.profiles.email, ''), normalized_email),
        role = coalesce(nullif(public.profiles.role, ''), 'viewer'),
        updated_at = now()
      where public.profiles.id = profile_target_id;
  end;

  -- A reverse link alone is not proof that the catalog belongs to this profile.
  select teacher.id into linked_teacher_id
  from public.profiles profile
  join public.teacher_catalogs teacher on teacher.id=profile.teacher_catalog_id
  where profile.id=profile_target_id and (
    teacher.profile_id=profile_target_id or (
      teacher.profile_id is null and new.email_confirmed_at is not null
      and normalized_email is not null and lower(teacher.account_email)=normalized_email
    )
  )
  limit 1 for update of teacher;

  if linked_teacher_id is null then
    select teacher.id into linked_teacher_id
    from public.teacher_catalogs teacher
    where teacher.profile_id=profile_target_id or (
      teacher.profile_id is null and new.email_confirmed_at is not null
      and normalized_email is not null and lower(teacher.account_email)=normalized_email
    )
    order by case when teacher.profile_id=profile_target_id then 0 else 1 end,
      teacher.updated_at desc nulls last, teacher.id
    limit 1 for update;
  end if;

  if linked_teacher_id is not null then
    update public.teacher_catalogs teacher
    set
      name=coalesce(nullif(teacher.name,''),teacher_display_name),
      subjects=case when coalesce(array_length(teacher.subjects,1),0)=0
        then array[selected_teacher_team] else teacher.subjects end,
      is_visible=case when teacher.profile_id=profile_target_id then teacher.is_visible else true end,
      profile_id=profile_target_id,
      account_email=coalesce(nullif(teacher.account_email,''),normalized_email),
      dashboard_role=case when teacher.profile_id=profile_target_id then teacher.dashboard_role
        else coalesce((select role from public.profiles where id=profile_target_id),'viewer') end,
      updated_at=now()
    where teacher.id=linked_teacher_id and (
      teacher.profile_id=profile_target_id or (
        teacher.profile_id is null and new.email_confirmed_at is not null
        and normalized_email is not null and lower(teacher.account_email)=normalized_email
      )
    )
    returning teacher.id into linked_teacher_id;
    -- A failed ownership check must never be published as a profile link.
  end if;

  if linked_teacher_id is null then
    -- Preserve the existing case-insensitive name key without treating names as identities.
    loop
      insert into public.teacher_catalogs
        (name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role,created_at,updated_at)
      values (case when teacher_name_attempt=1 then teacher_display_name
          else teacher_display_name || ' (' || teacher_name_attempt::text || ')' end,
        array[selected_teacher_team],true,
        coalesce((select max(sort_order)+1 from public.teacher_catalogs),0),
        profile_target_id,normalized_email,'viewer',now(),now())
      on conflict (lower(name)) do nothing
      returning id into linked_teacher_id;
      exit when linked_teacher_id is not null;
      teacher_name_attempt := teacher_name_attempt + 1;
      if teacher_name_attempt>100 then
        raise exception using errcode='23505',message='signup_teacher_name_conflict';
      end if;
    end loop;
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
