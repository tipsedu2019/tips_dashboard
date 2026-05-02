alter table public.textbooks
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_textbooks'
  ) then
    create trigger set_updated_at_textbooks
      before update on public.textbooks
      for each row
      execute function public.set_updated_at();
  end if;
end
$$;
