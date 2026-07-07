create table if not exists public.google_chat_webhook_settings (
  channel text primary key check (channel in ('executive', 'admin', 'math', 'english')),
  webhook_url text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.google_chat_webhook_settings
  add column if not exists webhook_url text not null default '',
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_google_chat_webhook_settings'
  ) then
    create trigger set_updated_at_google_chat_webhook_settings
    before update on public.google_chat_webhook_settings
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

alter table public.google_chat_webhook_settings enable row level security;

grant select, insert, update on public.google_chat_webhook_settings to service_role;
