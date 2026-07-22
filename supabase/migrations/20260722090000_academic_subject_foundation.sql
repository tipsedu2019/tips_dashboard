begin;

set local lock_timeout = '5s';

create schema if not exists dashboard_private;

create or replace function dashboard_private.academic_subject_grade_levels_valid_v1(
  p_subject text,
  p_grade_levels text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_subject in ('영어', '수학', '과학')
    and pg_catalog.array_ndims(p_grade_levels) = 1
    and pg_catalog.cardinality(p_grade_levels) > 0
    and pg_catalog.cardinality(p_grade_levels) = (
      select pg_catalog.count(distinct grade_level)::integer
      from pg_catalog.unnest(p_grade_levels) as grade_level
    )
    and case
      when p_subject = '과학' then
        p_grade_levels <@ array['고1', '고2', '고3']::text[]
      else
        p_grade_levels <@ array[
          '초1', '초2', '초3', '초4', '초5', '초6',
          '중1', '중2', '중3', '고1', '고2', '고3'
        ]::text[]
    end,
    false
  );
$$;

create table public.academic_subject_settings (
  subject text primary key
    constraint academic_subject_settings_subject_check
    check (subject in ('영어', '수학', '과학')),
  is_active boolean not null default true,
  registration_create_enabled boolean not null default false,
  grade_levels text[] not null,
  default_director_profile_id uuid
    references public.profiles(id) on delete set null,
  sort_order integer not null default 0
    constraint academic_subject_settings_sort_order_check
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_subject_settings_grade_levels_check
    check (
      dashboard_private.academic_subject_grade_levels_valid_v1(
        subject,
        grade_levels
      )
    )
);

create index academic_subject_settings_default_director_idx
  on public.academic_subject_settings(default_director_profile_id)
  where default_director_profile_id is not null;

create table public.academic_subject_areas (
  subject text not null
    constraint academic_subject_areas_subject_check
    check (subject = '과학')
    references public.academic_subject_settings(subject) on delete cascade,
  area_key text not null
    constraint academic_subject_areas_key_check
    check (
      area_key in ('integrated_science', 'physics', 'chemistry', 'life_science', 'earth_science')
    ),
  label text not null
    constraint academic_subject_areas_label_check
    check (pg_catalog.btrim(label) <> ''),
  sort_order integer not null default 0
    constraint academic_subject_areas_sort_order_check
    check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject, area_key),
  unique (subject, sort_order)
);

create trigger set_updated_at_academic_subject_settings
before update on public.academic_subject_settings
for each row
execute function public.set_updated_at();

create trigger set_updated_at_academic_subject_areas
before update on public.academic_subject_areas
for each row
execute function public.set_updated_at();

insert into public.academic_subject_settings(
  subject, is_active, registration_create_enabled, grade_levels, sort_order
) values
  ('영어', true, true, array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], 10),
  ('수학', true, true, array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], 20),
  ('과학', true, true, array['고1','고2','고3'], 30)
on conflict (subject) do update set
  is_active = excluded.is_active,
  registration_create_enabled = excluded.registration_create_enabled,
  grade_levels = excluded.grade_levels,
  sort_order = excluded.sort_order;

insert into public.academic_subject_areas(
  subject, area_key, label, sort_order, is_active
) values
  ('과학', 'integrated_science', '통합과학', 10, true),
  ('과학', 'physics', '물리학', 20, true),
  ('과학', 'chemistry', '화학', 30, true),
  ('과학', 'life_science', '생명과학', 40, true),
  ('과학', 'earth_science', '지구과학', 50, true)
on conflict (subject, area_key) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

create or replace function dashboard_private.academic_subject_director_candidate_is_active_v1(
  p_profile_id uuid,
  p_subject text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join auth.users as account
      on account.id = profile.id
    join public.teacher_catalogs as teacher
      on teacher.profile_id = profile.id
    where profile.id = p_profile_id
      and teacher.is_visible = true
      and account.deleted_at is null
      and (
        account.banned_until is null
        or account.banned_until <= pg_catalog.now()
      )
      and case p_subject
        when '영어' then teacher.subjects && array['영어', '영어팀']::text[]
        when '수학' then teacher.subjects && array['수학', '수학팀']::text[]
        when '과학' then '과학팀' = any(teacher.subjects)
        else false
      end
  );
$$;

create or replace function public.list_registration_subject_capabilities_v1()
returns table (
  subject text,
  is_active boolean,
  registration_create_enabled boolean,
  grade_levels text[],
  default_director_profile_id uuid,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'academic_subject_settings_authentication_required'
      using errcode = '42501';
  end if;

  return query
  select
    setting.subject,
    setting.is_active,
    setting.registration_create_enabled,
    setting.grade_levels,
    case
      when setting.default_director_profile_id is not null
        and dashboard_private.academic_subject_director_candidate_is_active_v1(
          setting.default_director_profile_id,
          setting.subject
        )
      then setting.default_director_profile_id
      else null
    end as default_director_profile_id,
    setting.sort_order,
    setting.created_at,
    setting.updated_at
  from public.academic_subject_settings as setting
  order by setting.sort_order, setting.subject;
end;
$$;

create or replace function public.update_academic_subject_setting_v1(
  p_subject text,
  p_is_active boolean,
  p_registration_create_enabled boolean,
  p_grade_levels text[],
  p_default_director_profile_id uuid
)
returns table (
  subject text,
  is_active boolean,
  registration_create_enabled boolean,
  grade_levels text[],
  default_director_profile_id uuid,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or public.current_dashboard_role() is distinct from 'admin'
  then
    raise exception 'academic_subject_setting_admin_required'
      using errcode = '42501';
  end if;

  if p_subject is null or p_subject not in ('영어', '수학', '과학') then
    raise exception 'academic_subject_setting_invalid_subject'
      using errcode = '22023';
  end if;

  if p_is_active is null
    or p_registration_create_enabled is null
    or not dashboard_private.academic_subject_grade_levels_valid_v1(
      p_subject,
      p_grade_levels
    )
  then
    raise exception 'academic_subject_setting_invalid_payload'
      using errcode = '22023';
  end if;

  if p_default_director_profile_id is not null
    and not dashboard_private.academic_subject_director_candidate_is_active_v1(
      p_default_director_profile_id,
      p_subject
    )
  then
    raise exception 'academic_subject_setting_invalid_director'
      using errcode = '22023';
  end if;

  return query
  update public.academic_subject_settings as setting
  set is_active = p_is_active,
      registration_create_enabled = p_registration_create_enabled,
      grade_levels = p_grade_levels,
      default_director_profile_id = p_default_director_profile_id
  where setting.subject = p_subject
  returning
    setting.subject,
    setting.is_active,
    setting.registration_create_enabled,
    setting.grade_levels,
    setting.default_director_profile_id,
    setting.sort_order,
    setting.created_at,
    setting.updated_at;

  if not found then
    raise exception 'academic_subject_setting_not_found'
      using errcode = 'P0002';
  end if;
end;
$$;

alter function dashboard_private.academic_subject_grade_levels_valid_v1(text, text[])
  owner to postgres;
alter function dashboard_private.academic_subject_director_candidate_is_active_v1(uuid, text)
  owner to postgres;
alter function public.list_registration_subject_capabilities_v1()
  owner to postgres;
alter function public.update_academic_subject_setting_v1(text, boolean, boolean, text[], uuid)
  owner to postgres;

alter table public.academic_subject_settings enable row level security;
alter table public.academic_subject_areas enable row level security;

revoke all on table public.academic_subject_settings
  from public, anon, authenticated, service_role;
revoke all on table public.academic_subject_areas
  from public, anon, authenticated, service_role;

revoke all on function dashboard_private.academic_subject_grade_levels_valid_v1(text, text[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.academic_subject_director_candidate_is_active_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_registration_subject_capabilities_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.update_academic_subject_setting_v1(text, boolean, boolean, text[], uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.list_registration_subject_capabilities_v1()
  to authenticated;
grant execute on function public.update_academic_subject_setting_v1(text, boolean, boolean, text[], uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
