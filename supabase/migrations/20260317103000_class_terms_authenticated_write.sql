do $$
begin
  if to_regclass('public.class_terms') is not null then
    alter table public.class_terms enable row level security;

    drop policy if exists class_terms_staff_write on public.class_terms;
    drop policy if exists class_terms_authenticated_write on public.class_terms;

    create policy class_terms_authenticated_write
      on public.class_terms
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;
