create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.textbook_sub_subject_settings') is not null then
    update public.textbook_sub_subject_settings
    set id = gen_random_uuid()
    where id is null;

    alter table public.textbook_sub_subject_settings
      alter column id set default gen_random_uuid(),
      alter column id set not null;
  end if;
end
$$;

notify pgrst, 'reload schema';
