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
  matched_profile_id uuid;
begin
  normalized_email := lower(nullif(new.email, ''));
  normalized_login_id := nullif(split_part(coalesce(normalized_email, ''), '@', 1), '');
  display_name := nullif(coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    normalized_login_id
  ), '');

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

  if matched_profile_id is not null then
    update public.profiles
    set
      name = coalesce(nullif(public.profiles.name, ''), display_name),
      login_id = coalesce(nullif(public.profiles.login_id, ''), normalized_login_id),
      email = coalesce(nullif(public.profiles.email, ''), normalized_email),
      role = coalesce(nullif(public.profiles.role, ''), 'viewer'),
      updated_at = now()
    where public.profiles.id = matched_profile_id;

    return new;
  end if;

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
exception
  when unique_violation then
    update public.profiles
    set updated_at = now()
    where (normalized_email is not null and lower(public.profiles.email) = normalized_email)
       or (normalized_login_id is not null and lower(public.profiles.login_id) = normalized_login_id);

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_dashboard_user();

with auth_profile_defaults as (
  select
    users.id,
    nullif(coalesce(
      users.raw_user_meta_data ->> 'name',
      users.raw_user_meta_data ->> 'full_name',
      nullif(split_part(lower(coalesce(users.email, '')), '@', 1), '')
    ), '') as name,
    nullif(split_part(lower(coalesce(users.email, '')), '@', 1), '') as login_id,
    lower(nullif(users.email, '')) as email
  from auth.users
)
update public.profiles
set
  name = coalesce(nullif(public.profiles.name, ''), auth_profile_defaults.name),
  login_id = coalesce(nullif(public.profiles.login_id, ''), auth_profile_defaults.login_id),
  email = coalesce(nullif(public.profiles.email, ''), auth_profile_defaults.email),
  role = coalesce(nullif(public.profiles.role, ''), 'viewer'),
  updated_at = now()
from auth_profile_defaults
where public.profiles.id <> auth_profile_defaults.id
  and (
    (
      auth_profile_defaults.email is not null
      and public.profiles.email is not null
      and lower(public.profiles.email) = auth_profile_defaults.email
    )
    or (
      auth_profile_defaults.login_id is not null
      and public.profiles.login_id is not null
      and lower(public.profiles.login_id) = auth_profile_defaults.login_id
    )
  );

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
    or (
      users.email is not null
      and profiles.email is not null
      and lower(profiles.email) = lower(users.email)
    )
    or (
      users.email is not null
      and profiles.login_id is not null
      and lower(profiles.login_id) = nullif(split_part(lower(users.email), '@', 1), '')
    )
)
on conflict (id) do nothing;

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid() and role = 'viewer');

drop policy if exists profiles_self_identity_select on public.profiles;
create policy profiles_self_identity_select
  on public.profiles
  for select
  to authenticated
  using (
    lower(public.profiles.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (
      lower(coalesce(auth.jwt() ->> 'email', '')) like '%@tipsedu.co.kr'
      and lower(public.profiles.login_id) = split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1)
    )
  );
