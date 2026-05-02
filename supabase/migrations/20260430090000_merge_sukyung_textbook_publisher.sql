-- merge_sukyung_textbook_publisher
do $$
declare
  keeper_id uuid;
  duplicate_id uuid;
  duplicate_subjects text[] := '{}'::text[];
  duplicate_source_notion_url text;
  duplicate_source_notion_urls text[] := '{}'::text[];
begin
  select id
    into keeper_id
  from public.textbook_publishers
  where name = '수경출판사'
  limit 1;

  select id, subjects, source_notion_url, source_notion_urls
    into duplicate_id, duplicate_subjects, duplicate_source_notion_url, duplicate_source_notion_urls
  from public.textbook_publishers
  where name = '수경출판'
  limit 1;

  if keeper_id is null and duplicate_id is not null then
    update public.textbook_publishers
    set name = '수경출판사',
        updated_at = now()
    where id = duplicate_id;

    keeper_id := duplicate_id;
    duplicate_id := null;
  end if;

  if keeper_id is not null then
    update public.textbook_publishers
    set subjects = (
          select coalesce(array_agg(distinct subject order by subject), '{}'::text[])
          from unnest(
            coalesce(public.textbook_publishers.subjects, '{}'::text[])
            || coalesce(duplicate_subjects, '{}'::text[])
            || array['english', 'math']::text[]
          ) as subject
          where subject is not null and subject <> ''
        ),
        source_notion_url = coalesce(public.textbook_publishers.source_notion_url, duplicate_source_notion_url),
        source_notion_urls = (
          select coalesce(array_agg(distinct url order by url), '{}'::text[])
          from unnest(
            coalesce(public.textbook_publishers.source_notion_urls, '{}'::text[])
            || array_remove(array[nullif(public.textbook_publishers.source_notion_url, '')]::text[], null)
            || coalesce(duplicate_source_notion_urls, '{}'::text[])
            || array_remove(array[nullif(duplicate_source_notion_url, '')]::text[], null)
          ) as url
          where url is not null and url <> ''
        ),
        updated_at = now()
    where id = keeper_id;

    update public.textbooks
    set publisher_id = keeper.id,
        publisher = '수경출판사'
    from public.textbook_publishers keeper
    where keeper.id = keeper_id
      and (
        public.textbooks.publisher_id = duplicate_id
        or public.textbooks.publisher in ('수경출판', '수경출판사')
      );

    update public.textbook_supplier_links
    set publisher_id = keeper.id,
        updated_at = now()
    from public.textbook_publishers keeper
    where keeper.id = keeper_id
      and public.textbook_supplier_links.publisher_id = duplicate_id;

    if duplicate_id is not null then
      insert into public.textbook_publisher_supplier_links (publisher_id, supplier_id, priority, is_primary, memo)
      select keeper_id, supplier_id, priority, is_primary, memo
      from public.textbook_publisher_supplier_links
      where publisher_id = duplicate_id
      on conflict (publisher_id, supplier_id) do update
      set priority = least(public.textbook_publisher_supplier_links.priority, excluded.priority),
          is_primary = public.textbook_publisher_supplier_links.is_primary or excluded.is_primary,
          memo = case
            when public.textbook_publisher_supplier_links.memo = '' then excluded.memo
            when excluded.memo = '' then public.textbook_publisher_supplier_links.memo
            when public.textbook_publisher_supplier_links.memo = excluded.memo then public.textbook_publisher_supplier_links.memo
            else public.textbook_publisher_supplier_links.memo || E'\n' || excluded.memo
          end,
          updated_at = now();

      delete from public.textbook_publisher_supplier_links
      where publisher_id = duplicate_id;

      delete from public.textbook_publishers
      where id = duplicate_id;
    end if;
  end if;
end
$$;
