alter table public.textbooks
  add column if not exists school_level text not null default '',
  add column if not exists grade_level text not null default '',
  add column if not exists sub_subject text not null default '';

create table if not exists public.textbook_sub_subject_settings (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  name text not null,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_sub_subject_settings_subject_name_key
  on public.textbook_sub_subject_settings (subject, name);

insert into public.textbook_sub_subject_settings (subject, name, sort_order)
values
  ('english', '단어', 10),
  ('english', '독해', 20),
  ('english', '듣기', 30),
  ('english', '문법', 40),
  ('english', '모고', 50),
  ('english', '내신', 60),
  ('math', '공통수학1', 10),
  ('math', '공통수학2', 20),
  ('math', '대수', 30),
  ('math', '미적분', 40),
  ('math', '확률과 통계', 50),
  ('math', '기하', 60),
  ('math', '수1', 70),
  ('math', '수2', 80),
  ('math', '내신', 90),
  ('other', '기타', 10)
on conflict (subject, name) do nothing;

update public.textbooks
set school_level = case
    when coalesce(school_level, '') <> '' then school_level
    when coalesce(category, '') like '%초등%' then 'elementary'
    when coalesce(category, '') like '%중등%' then 'middle'
    when coalesce(category, '') like '%고등%' then 'high'
    else school_level
  end,
  sub_subject = case
    when coalesce(sub_subject, '') <> '' then sub_subject
    when coalesce(category, '') <> '' then trim(regexp_replace(category, '^(초등|중등|고등)\s*', ''))
    else sub_subject
  end;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (
      select 1 from pg_trigger where tgname = 'set_updated_at_textbook_sub_subject_settings'
    ) then
      create trigger set_updated_at_textbook_sub_subject_settings
        before update on public.textbook_sub_subject_settings
        for each row execute function public.set_updated_at();
    end if;
  end if;
end
$$;

alter table public.textbook_sub_subject_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'textbook_sub_subject_settings'
      and policyname = 'textbook_sub_subject_settings_authenticated_select'
  ) then
    create policy textbook_sub_subject_settings_authenticated_select
      on public.textbook_sub_subject_settings
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'textbook_sub_subject_settings'
      and policyname = 'textbook_sub_subject_settings_staff_write'
  ) then
    create policy textbook_sub_subject_settings_staff_write
      on public.textbook_sub_subject_settings
      for all to authenticated
      using (public.current_dashboard_role() in ('admin', 'staff'))
      with check (public.current_dashboard_role() in ('admin', 'staff'));
  end if;
end
$$;

notify pgrst, 'reload schema';
