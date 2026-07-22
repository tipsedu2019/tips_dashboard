begin;

set local lock_timeout = '5s';

alter table public.classes
  add column if not exists subject_area_key text;

alter table public.textbooks
  add column if not exists subject_area_key text,
  add column if not exists subject_area_subject text
    generated always as (
      case when subject = 'science' then '과학'::text else null::text end
    ) stored;

alter table public.textbooks
  drop constraint if exists textbooks_subject_required;

alter table public.textbooks
  add constraint textbooks_subject_required
  check (
    subject is not null
    and subject in ('english', 'math', 'science', 'other')
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classes_subject_area_fkey'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_subject_area_fkey
      foreign key (subject, subject_area_key)
      references public.academic_subject_areas(subject, area_key)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbooks_subject_area_fkey'
      and conrelid = 'public.textbooks'::regclass
  ) then
    alter table public.textbooks
      add constraint textbooks_subject_area_fkey
      foreign key (subject_area_subject, subject_area_key)
      references public.academic_subject_areas(subject, area_key)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'classes_science_taxonomy_check'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_science_taxonomy_check
      check (
        (
          subject = '과학'
          and grade is not null
          and grade in ('고1', '고2', '고3')
          and subject_area_key is not null
        )
        or (
          subject is distinct from '과학'
          and subject_area_key is null
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbooks_science_taxonomy_check'
      and conrelid = 'public.textbooks'::regclass
  ) then
    alter table public.textbooks
      add constraint textbooks_science_taxonomy_check
      check (
        (
          subject = 'science'
          and school_levels = array['high']::text[]
          and grade_levels = array['h1', 'h2', 'h3']::text[]
          and subject_area_key is not null
        )
        or (
          subject is distinct from 'science'
          and subject_area_key is null
        )
      ) not valid;
  end if;
end
$$;

create or replace function dashboard_private.assert_science_subject_area_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_subject text;
  subject_area_label text;
begin
  mapped_subject := case
    when tg_table_name = 'classes' and new.subject = '과학' then '과학'
    when tg_table_name = 'textbooks' and new.subject = 'science' then '과학'
    else null
  end;

  if mapped_subject is null then
    if new.subject_area_key is not null then
      raise exception 'science_subject_area_non_science_forbidden'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.subject_area_key is null then
    raise exception 'science_subject_area_required'
      using errcode = '23514';
  end if;

  select area.label
  into subject_area_label
    from public.academic_subject_areas as area
    where area.subject = mapped_subject
      and area.area_key = new.subject_area_key
      and area.is_active = true;

  if subject_area_label is null then
    raise exception 'science_subject_area_inactive_or_unknown'
      using errcode = '23514';
  end if;

  if tg_table_name = 'textbooks' then
    new.sub_subject := subject_area_label;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_science_subject_area_on_classes
  on public.classes;
create trigger enforce_science_subject_area_on_classes
before insert or update of subject, subject_area_key
on public.classes
for each row
execute function dashboard_private.assert_science_subject_area_assignment_v1();

drop trigger if exists enforce_science_subject_area_on_textbooks
  on public.textbooks;
create trigger enforce_science_subject_area_on_textbooks
before insert or update of subject, subject_area_key, sub_subject
on public.textbooks
for each row
execute function dashboard_private.assert_science_subject_area_assignment_v1();

create or replace function public.list_active_science_subject_areas_v1()
returns table (
  subject text,
  area_key text,
  label text,
  sort_order integer,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'science_subject_areas_authentication_required'
      using errcode = '42501';
  end if;

  return query
  select
    area.subject,
    area.area_key,
    area.label,
    area.sort_order,
    area.is_active
  from public.academic_subject_areas as area
  where area.subject = '과학'
    and area.is_active = true
  order by area.sort_order, area.area_key;
end;
$$;

insert into public.textbook_sub_subject_settings(subject, name, sort_order)
values
  ('science', '통합과학', 10),
  ('science', '물리학', 20),
  ('science', '화학', 30),
  ('science', '생명과학', 40),
  ('science', '지구과학', 50)
on conflict (subject, name) do update set
  sort_order = excluded.sort_order;

alter function dashboard_private.assert_science_subject_area_assignment_v1()
  owner to postgres;
alter function public.list_active_science_subject_areas_v1()
  owner to postgres;

revoke all on function dashboard_private.assert_science_subject_area_assignment_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.list_active_science_subject_areas_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.list_active_science_subject_areas_v1()
  to authenticated;

notify pgrst, 'reload schema';

commit;
