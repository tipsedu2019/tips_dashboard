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
begin
  normalized_email := lower(nullif(new.email, ''));
  normalized_login_id := nullif(split_part(coalesce(normalized_email, ''), '@', 1), '');
  display_name := nullif(coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    normalized_login_id
  ), '');

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
    new.id,
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_dashboard_user();

insert into public.profiles (
  id,
  name,
  login_id,
  email,
  role,
  created_at,
  updated_at
)
select
  users.id,
  nullif(coalesce(
    users.raw_user_meta_data ->> 'name',
    users.raw_user_meta_data ->> 'full_name',
    nullif(split_part(lower(coalesce(users.email, '')), '@', 1), '')
  ), '') as name,
  nullif(split_part(lower(coalesce(users.email, '')), '@', 1), '') as login_id,
  lower(nullif(users.email, '')) as email,
  'viewer' as role,
  coalesce(users.created_at, now()) as created_at,
  now() as updated_at
from auth.users
where not exists (
  select 1
  from public.profiles
  where profiles.id = users.id
)
on conflict (id) do nothing;

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid() and role = 'viewer');
