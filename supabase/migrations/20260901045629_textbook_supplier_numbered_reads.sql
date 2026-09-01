-- Task 6a owner settings: bounded projected reads and one atomic owner-draft save.
-- All public RPCs are SECURITY INVOKER and retain the existing textbook RLS.
create schema if not exists textbook_settings_private;
revoke all on schema textbook_settings_private from public, anon, authenticated;
grant usage on schema textbook_settings_private to authenticated;

create table if not exists textbook_settings_private.owner_draft_receipts (
  actor_id uuid not null,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
alter table textbook_settings_private.owner_draft_receipts enable row level security;
alter table textbook_settings_private.owner_draft_receipts force row level security;
drop policy if exists owner_draft_receipts_select_self on textbook_settings_private.owner_draft_receipts;
drop policy if exists owner_draft_receipts_insert_self on textbook_settings_private.owner_draft_receipts;
create policy owner_draft_receipts_select_self on textbook_settings_private.owner_draft_receipts
  for select to authenticated using (actor_id = auth.uid());
create policy owner_draft_receipts_insert_self on textbook_settings_private.owner_draft_receipts
  for insert to authenticated with check (actor_id = auth.uid());
revoke all on table textbook_settings_private.owner_draft_receipts from public, anon, authenticated;
grant select, insert on table textbook_settings_private.owner_draft_receipts to authenticated;

create or replace function textbook_settings_private.trim_v1(value text) returns text
language sql immutable security invoker set search_path = '' as $$
  select btrim(coalesce(value, ''))
$$;

create or replace function textbook_settings_private.guard_read_v1() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null
    or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff', 'teacher', 'assistant', 'viewer') then
    raise exception 'textbook_settings_forbidden' using errcode = '42501';
  end if;
end
$$;

create or replace function textbook_settings_private.guard_write_v1() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff') then
    raise exception 'textbook_settings_forbidden' using errcode = '42501';
  end if;
end
$$;

create or replace function textbook_settings_private.assert_page_v1(
  filters jsonb, sort_name text, page_number integer, page_size integer
) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare keys text[];
begin
  perform textbook_settings_private.guard_read_v1();
  if jsonb_typeof(filters) is distinct from 'object' then
    raise exception 'textbook_settings_page_invalid' using errcode = '22023';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(filters) key;
  if keys is distinct from array['search']
    or jsonb_typeof(filters -> 'search') is distinct from 'string'
    or sort_name is distinct from 'name'
    or page_number is null or page_number < 1
    or page_size is null or page_size not in (10, 15, 20) then
    raise exception 'textbook_settings_page_invalid' using errcode = '22023';
  end if;
end
$$;

create or replace function textbook_settings_private.assert_draft_v1(draft jsonb) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare operation jsonb; patch jsonb; keys text[]; operation_type text;
begin
  if draft is null then return; end if;
  if jsonb_typeof(draft) is distinct from 'object' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(draft) key;
  if keys is distinct from array['baseRevision', 'operations', 'version']
    or jsonb_typeof(draft -> 'version') is distinct from 'number'
    or draft -> 'version' is distinct from '1'::jsonb
    or jsonb_typeof(draft -> 'baseRevision') is distinct from 'string'
    or coalesce(draft ->> 'baseRevision', '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(draft -> 'operations') is distinct from 'array' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  for operation in select item.value from jsonb_array_elements(draft -> 'operations') item(value) loop
    if jsonb_typeof(operation) is distinct from 'object'
      or jsonb_typeof(operation -> 'type') is distinct from 'string'
      or jsonb_typeof(operation -> 'id') is distinct from 'string'
      or coalesce(operation ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
    operation_type := operation ->> 'type';
    if operation_type = 'publisher.add' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'name', 'subjects', 'supplierIds', 'type']
        or jsonb_typeof(operation -> 'name') is distinct from 'string'
        or textbook_settings_private.trim_v1(operation ->> 'name') = ''
        or jsonb_typeof(operation -> 'subjects') is distinct from 'array'
        or jsonb_typeof(operation -> 'supplierIds') is distinct from 'array'
        or exists (select 1 from jsonb_array_elements(operation -> 'subjects') item(value)
          where jsonb_typeof(item.value) is distinct from 'string')
        or exists (select 1 from jsonb_array_elements(operation -> 'supplierIds') item(value)
          where jsonb_typeof(item.value) is distinct from 'string'
            or item.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or jsonb_array_length(operation -> 'supplierIds') <> (select count(distinct lower(id))
          from jsonb_array_elements_text(operation -> 'supplierIds') id) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'publisher.patch' then
      patch := operation -> 'patch';
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'patch', 'type']
        or jsonb_typeof(patch) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(patch)) = 0
        or exists (select 1 from jsonb_object_keys(patch) key where key not in ('name', 'subjects', 'supplierIds'))
        or (patch ? 'name' and (jsonb_typeof(patch -> 'name') is distinct from 'string'
          or textbook_settings_private.trim_v1(patch ->> 'name') = ''))
        or (patch ? 'subjects' and (jsonb_typeof(patch -> 'subjects') is distinct from 'array'
          or exists (select 1 from jsonb_array_elements(patch -> 'subjects') item(value)
            where jsonb_typeof(item.value) is distinct from 'string')))
        or (patch ? 'supplierIds' and (jsonb_typeof(patch -> 'supplierIds') is distinct from 'array'
          or exists (select 1 from jsonb_array_elements(patch -> 'supplierIds') item(value)
            where jsonb_typeof(item.value) is distinct from 'string'
              or item.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          or jsonb_array_length(patch -> 'supplierIds') <> (select count(distinct lower(id))
            from jsonb_array_elements_text(patch -> 'supplierIds') id))) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'publisher.delete' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'type'] then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'supplier.add' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['contact', 'id', 'memo', 'name', 'type']
        or jsonb_typeof(operation -> 'name') is distinct from 'string'
        or jsonb_typeof(operation -> 'contact') is distinct from 'string'
        or jsonb_typeof(operation -> 'memo') is distinct from 'string'
        or textbook_settings_private.trim_v1(operation ->> 'name') = '' then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'supplier.patch' then
      patch := operation -> 'patch';
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'patch', 'type']
        or jsonb_typeof(patch) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(patch)) = 0
        or exists (select 1 from jsonb_object_keys(patch) key where key not in ('name', 'contact', 'memo'))
        or (patch ? 'name' and (jsonb_typeof(patch -> 'name') is distinct from 'string'
          or textbook_settings_private.trim_v1(patch ->> 'name') = ''))
        or (patch ? 'contact' and jsonb_typeof(patch -> 'contact') is distinct from 'string')
        or (patch ? 'memo' and jsonb_typeof(patch -> 'memo') is distinct from 'string') then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'supplier.delete' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'type'] then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
  end loop;
end
$$;

create or replace function textbook_settings_private.revision_v1() returns text
language sql stable security invoker set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'publishers', coalesce((select jsonb_agg(to_jsonb(p)
      || jsonb_build_object(
        'created_at', case when p.created_at is null then null else to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'updated_at', case when p.updated_at is null then null else to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
      order by p.id) from public.textbook_publishers p), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(to_jsonb(s)
      || jsonb_build_object(
        'created_at', case when s.created_at is null then null else to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'updated_at', case when s.updated_at is null then null else to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
      order by s.id) from public.textbook_suppliers s), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l)
      || jsonb_build_object(
        'created_at', case when l.created_at is null then null else to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'updated_at', case when l.updated_at is null then null else to_char(l.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
      order by l.id) from public.textbook_publisher_supplier_links l), '[]'::jsonb)
  )::text, 'utf8')), 'hex')
$$;

create or replace function textbook_settings_private.subjects_v1(value jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(normalized.name order by normalized.first_ordinal), '[]'::jsonb)
  from (select textbook_settings_private.trim_v1(subject_value) name, min(subject_ordinal) first_ordinal
    from jsonb_array_elements_text(coalesce(value, '[]'::jsonb)) with ordinality subjects(subject_value, subject_ordinal)
    where textbook_settings_private.trim_v1(subject_value) <> ''
    group by textbook_settings_private.trim_v1(subject_value)) normalized
$$;

create or replace function textbook_settings_private.ids_v1(value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare entry text; canonical text; result jsonb := '[]'::jsonb; seen text[] := '{}'::text[];
begin
  if jsonb_typeof(value) is distinct from 'array' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  for entry in select item.value from jsonb_array_elements_text(value) item(value) loop
    if entry !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
    canonical := (entry::uuid)::text;
    if canonical = any(seen) then raise exception 'textbook_settings_draft_invalid' using errcode = '22023'; end if;
    seen := array_append(seen, canonical);
    result := result || jsonb_build_array(canonical);
  end loop;
  return result;
end
$$;

create or replace function textbook_settings_private.project_v1(draft jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  publishers jsonb; suppliers jsonb; operation jsonb; patch jsonb;
  owner_id text; operation_type text; seen_publisher_ids text[]; seen_supplier_ids text[];
begin
  perform textbook_settings_private.assert_draft_v1(draft);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', textbook_settings_private.trim_v1(p.name),
    'subjects', textbook_settings_private.subjects_v1(to_jsonb(p.subjects)),
    'supplierIds', coalesce((select jsonb_agg(l.supplier_id::text order by l.is_primary desc, l.priority, l.id)
      from public.textbook_publisher_supplier_links l where l.publisher_id = p.id), '[]'::jsonb),
    'textbookCount', (select count(*) from public.textbooks t
      where (t.publisher_id is not null and t.publisher_id = p.id)
        or (t.publisher_id is null and p.id = (select fallback.id from public.textbook_publishers fallback
          where textbook_settings_private.trim_v1(fallback.name) = textbook_settings_private.trim_v1(t.publisher)
          order by fallback.name desc, fallback.id desc limit 1))),
    'isNew', false
  ) order by p.name, p.id), '[]'::jsonb) into publishers from public.textbook_publishers p;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', textbook_settings_private.trim_v1(s.name),
    'contact', textbook_settings_private.trim_v1(s.contact),
    'memo', textbook_settings_private.trim_v1(s.memo), 'isNew', false
  ) order by s.name, s.id), '[]'::jsonb) into suppliers from public.textbook_suppliers s;
  if draft is null then return jsonb_build_object('publishers', publishers, 'suppliers', suppliers); end if;
  select coalesce(array_agg(item.value ->> 'id'), '{}'::text[]) into seen_publisher_ids
    from jsonb_array_elements(publishers) item(value);
  select coalesce(array_agg(item.value ->> 'id'), '{}'::text[]) into seen_supplier_ids
    from jsonb_array_elements(suppliers) item(value);
  for operation in select item.value from jsonb_array_elements(draft -> 'operations') item(value) loop
    operation_type := operation ->> 'type'; owner_id := ((operation ->> 'id')::uuid)::text; patch := operation -> 'patch';
    if operation_type = 'publisher.add' then
      if owner_id = any(seen_publisher_ids) or exists (select 1
        from jsonb_array_elements_text(operation -> 'supplierIds') requested(value)
        where not exists (select 1 from jsonb_array_elements(suppliers) supplier(value)
          where supplier.value ->> 'id' = (requested.value::uuid)::text)) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      seen_publisher_ids := array_append(seen_publisher_ids, owner_id);
      publishers := jsonb_build_array(jsonb_build_object(
        'id', owner_id, 'name', textbook_settings_private.trim_v1(operation ->> 'name'),
        'subjects', textbook_settings_private.subjects_v1(operation -> 'subjects'),
        'supplierIds', textbook_settings_private.ids_v1(operation -> 'supplierIds'),
        'textbookCount', 0, 'isNew', true)) || publishers;
    elsif operation_type = 'publisher.patch' then
      if not exists (select 1 from jsonb_array_elements(publishers) publisher(value)
          where publisher.value ->> 'id' = owner_id)
        or (patch ? 'supplierIds' and exists (select 1
          from jsonb_array_elements_text(patch -> 'supplierIds') requested(value)
          where not exists (select 1 from jsonb_array_elements(suppliers) supplier(value)
            where supplier.value ->> 'id' = (requested.value::uuid)::text))) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(case when item.value ->> 'id' = owner_id then item.value
        || jsonb_strip_nulls(jsonb_build_object(
          'name', case when patch ? 'name' then textbook_settings_private.trim_v1(patch ->> 'name') end,
          'subjects', case when patch ? 'subjects' then textbook_settings_private.subjects_v1(patch -> 'subjects') end,
          'supplierIds', case when patch ? 'supplierIds' then textbook_settings_private.ids_v1(patch -> 'supplierIds') end))
        else item.value end order by item.ordinality), '[]'::jsonb) into publishers
      from jsonb_array_elements(publishers) with ordinality item(value, ordinality);
    elsif operation_type = 'publisher.delete' then
      if not exists (select 1 from jsonb_array_elements(publishers) item(value) where item.value ->> 'id' = owner_id) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb) into publishers
        from jsonb_array_elements(publishers) with ordinality item(value, ordinality)
        where item.value ->> 'id' <> owner_id;
    elsif operation_type = 'supplier.add' then
      if owner_id = any(seen_supplier_ids) then raise exception 'textbook_settings_draft_invalid' using errcode = '22023'; end if;
      seen_supplier_ids := array_append(seen_supplier_ids, owner_id);
      suppliers := jsonb_build_array(jsonb_build_object(
        'id', owner_id, 'name', textbook_settings_private.trim_v1(operation ->> 'name'),
        'contact', textbook_settings_private.trim_v1(operation ->> 'contact'),
        'memo', textbook_settings_private.trim_v1(operation ->> 'memo'), 'isNew', true)) || suppliers;
    elsif operation_type = 'supplier.patch' then
      if not exists (select 1 from jsonb_array_elements(suppliers) item(value) where item.value ->> 'id' = owner_id) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(case when item.value ->> 'id' = owner_id then item.value
        || jsonb_strip_nulls(jsonb_build_object(
          'name', case when patch ? 'name' then textbook_settings_private.trim_v1(patch ->> 'name') end,
          'contact', case when patch ? 'contact' then textbook_settings_private.trim_v1(patch ->> 'contact') end,
          'memo', case when patch ? 'memo' then textbook_settings_private.trim_v1(patch ->> 'memo') end))
        else item.value end order by item.ordinality), '[]'::jsonb) into suppliers
      from jsonb_array_elements(suppliers) with ordinality item(value, ordinality);
    elsif operation_type = 'supplier.delete' then
      if not exists (select 1 from jsonb_array_elements(suppliers) item(value) where item.value ->> 'id' = owner_id) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb) into suppliers
        from jsonb_array_elements(suppliers) with ordinality item(value, ordinality)
        where item.value ->> 'id' <> owner_id;
      select coalesce(jsonb_agg(jsonb_set(item.value, '{supplierIds}', coalesce((
        select jsonb_agg(link.value order by link.ordinality)
        from jsonb_array_elements(item.value -> 'supplierIds') with ordinality link(value, ordinality)
        where link.value #>> '{}' <> owner_id), '[]'::jsonb)) order by item.ordinality), '[]'::jsonb)
      into publishers from jsonb_array_elements(publishers) with ordinality item(value, ordinality);
    end if;
  end loop;
  return jsonb_build_object('publishers', publishers, 'suppliers', suppliers);
end
$$;

create or replace function textbook_settings_private.publisher_row_v1(projection jsonb, owner jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', owner ->> 'id', 'name', owner ->> 'name', 'subjects', owner -> 'subjects',
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', supplier.value ->> 'id', 'name', supplier.value ->> 'name') order by requested.ordinality)
      from jsonb_array_elements_text(owner -> 'supplierIds') with ordinality requested(id, ordinality)
      join lateral (select candidate.value from jsonb_array_elements(projection -> 'suppliers') candidate(value)
        where candidate.value ->> 'id' = requested.id) supplier on true), '[]'::jsonb),
    'textbookCount', (owner ->> 'textbookCount')::integer,
    'isNew', (owner ->> 'isNew')::boolean)
$$;

create or replace function textbook_settings_private.publisher_haystack_v1(projection jsonb, owner jsonb) returns text
language sql stable security invoker set search_path = '' as $$
  select lower((owner ->> 'name') || ' '
    || case when jsonb_array_length(owner -> 'subjects') = 0 then '미설정' else
      (select string_agg(case subject.value #>> '{}'
        when 'english' then '영어' when 'math' then '수학' when 'science' then '과학'
        when 'other' then '기타' else subject.value #>> '{}' end, ', ' order by subject.ordinality)
       from jsonb_array_elements(owner -> 'subjects') with ordinality subject(value, ordinality)) end
    || ' ' || coalesce((select string_agg(supplier.value ->> 'name', ' ' order by requested.ordinality)
      from jsonb_array_elements_text(owner -> 'supplierIds') with ordinality requested(id, ordinality)
      join lateral (select candidate.value from jsonb_array_elements(projection -> 'suppliers') candidate(value)
        where candidate.value ->> 'id' = requested.id) supplier on true), ''))
$$;

create or replace function textbook_settings_private.supplier_row_v1(projection jsonb, owner jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', owner ->> 'id', 'name', owner ->> 'name', 'contact', owner ->> 'contact', 'memo', owner ->> 'memo',
    'linkedPublisherCount', (select count(*) from jsonb_array_elements(projection -> 'publishers') publisher(value)
      where publisher.value -> 'supplierIds' ? (owner ->> 'id')),
    'linkedPublisherNames', coalesce((select jsonb_agg(linked.name
        order by linked.name collate dashboard_private.textbook_reference_ko_numeric, linked.id)
      from (select publisher.value ->> 'name' name, publisher.value ->> 'id' id
        from jsonb_array_elements(projection -> 'publishers') publisher(value)
        where publisher.value -> 'supplierIds' ? (owner ->> 'id')
        order by (publisher.value ->> 'name') collate dashboard_private.textbook_reference_ko_numeric,
          publisher.value ->> 'id' limit 3) linked), '[]'::jsonb),
    'isNew', (owner ->> 'isNew')::boolean)
$$;

create or replace function textbook_settings_private.supplier_haystack_v1(projection jsonb, owner jsonb) returns text
language sql stable security invoker set search_path = '' as $$
  select lower((owner ->> 'name') || ' ' || coalesce((select string_agg(
      publisher.value ->> 'name', ' ' order by publisher.ordinality)
    from jsonb_array_elements(projection -> 'publishers') with ordinality publisher(value, ordinality)
    where publisher.value -> 'supplierIds' ? (owner ->> 'id')), ''))
$$;

create or replace function textbook_settings_private.page_v1(
  kind text, filters jsonb, draft jsonb, sort_name text, page_number integer, page_size integer
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare projection jsonb; revision text; rows jsonb; total_count integer;
  owner_counts jsonb; search_text text;
begin
  perform textbook_settings_private.assert_page_v1(filters, sort_name, page_number, page_size);
  if kind not in ('publisher', 'supplier', 'picker') then
    raise exception 'textbook_settings_page_invalid' using errcode = '22023';
  end if;
  revision := textbook_settings_private.revision_v1();
  perform textbook_settings_private.assert_draft_v1(draft);
  if draft is not null and draft ->> 'baseRevision' <> revision then
    raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
  end if;
  projection := textbook_settings_private.project_v1(draft);
  owner_counts := jsonb_build_object('publishers', jsonb_array_length(projection -> 'publishers'),
    'suppliers', jsonb_array_length(projection -> 'suppliers'));
  search_text := lower(textbook_settings_private.trim_v1(filters ->> 'search'));
  if kind = 'publisher' then
    with source as (select item.value owner, item.ordinality source_ordinal
      from jsonb_array_elements(projection -> 'publishers') with ordinality item(value, ordinality)),
    filtered as (select source.owner, row_number() over (order by source.source_ordinal) filtered_ordinal
      from source where strpos(
        textbook_settings_private.publisher_haystack_v1(projection, source.owner), search_text) > 0)
    select count(*), coalesce(jsonb_agg(textbook_settings_private.publisher_row_v1(projection, filtered.owner)
      order by filtered.filtered_ordinal) filter (where filtered.filtered_ordinal > (page_number::bigint - 1) * page_size
        and filtered.filtered_ordinal <= page_number::bigint * page_size), '[]'::jsonb)
    into total_count, rows from filtered;
  elsif kind = 'supplier' then
    with source as (select item.value owner, item.ordinality source_ordinal
      from jsonb_array_elements(projection -> 'suppliers') with ordinality item(value, ordinality)),
    filtered as (select source.owner, row_number() over (order by source.source_ordinal) filtered_ordinal
      from source where strpos(
        textbook_settings_private.supplier_haystack_v1(projection, source.owner), search_text) > 0)
    select count(*), coalesce(jsonb_agg(textbook_settings_private.supplier_row_v1(projection, filtered.owner)
      order by filtered.filtered_ordinal) filter (where filtered.filtered_ordinal > (page_number::bigint - 1) * page_size
        and filtered.filtered_ordinal <= page_number::bigint * page_size), '[]'::jsonb)
    into total_count, rows from filtered;
  else
    with source as (select item.value owner, item.ordinality source_ordinal
      from jsonb_array_elements(projection -> 'suppliers') with ordinality item(value, ordinality)),
    filtered as (select source.owner, row_number() over (order by source.source_ordinal) filtered_ordinal
      from source where strpos(lower(source.owner ->> 'name'), search_text) > 0)
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', filtered.owner ->> 'id',
      'name', filtered.owner ->> 'name') order by filtered.filtered_ordinal)
      filter (where filtered.filtered_ordinal > (page_number::bigint - 1) * page_size
        and filtered.filtered_ordinal <= page_number::bigint * page_size), '[]'::jsonb)
    into total_count, rows from filtered;
  end if;
  return jsonb_build_object('rows', rows, 'page', page_number, 'pageSize', page_size,
    'totalCount', total_count, 'baseRevision', revision, 'ownerCounts', owner_counts);
end
$$;

create or replace function public.list_textbook_publisher_page_v1(
  p_filters jsonb, p_draft jsonb, p_sort text, p_page integer, p_page_size integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select textbook_settings_private.page_v1('publisher', p_filters, p_draft, p_sort, p_page, p_page_size)
$$;
create or replace function public.list_textbook_supplier_page_v1(
  p_filters jsonb, p_draft jsonb, p_sort text, p_page integer, p_page_size integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select textbook_settings_private.page_v1('supplier', p_filters, p_draft, p_sort, p_page, p_page_size)
$$;
create or replace function public.list_textbook_supplier_setting_picker_page_v1(
  p_filters jsonb, p_draft jsonb, p_sort text, p_page integer, p_page_size integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select textbook_settings_private.page_v1('picker', p_filters, p_draft, p_sort, p_page, p_page_size)
$$;

create or replace function textbook_settings_private.detail_v1(kind text, owner_id uuid, draft jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare projection jsonb; revision text; owner_counts jsonb; selected_owner jsonb; row_result jsonb;
begin
  perform textbook_settings_private.guard_read_v1();
  if owner_id is null or kind not in ('publisher', 'supplier') then
    raise exception 'textbook_settings_detail_invalid' using errcode = '22023';
  end if;
  revision := textbook_settings_private.revision_v1(); perform textbook_settings_private.assert_draft_v1(draft);
  if draft is not null and draft ->> 'baseRevision' <> revision then
    raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
  end if;
  projection := textbook_settings_private.project_v1(draft);
  owner_counts := jsonb_build_object('publishers', jsonb_array_length(projection -> 'publishers'),
    'suppliers', jsonb_array_length(projection -> 'suppliers'));
  if kind = 'publisher' then
    select item.value into selected_owner from jsonb_array_elements(projection -> 'publishers') item(value)
      where item.value ->> 'id' = owner_id::text;
    if found then row_result := textbook_settings_private.publisher_row_v1(projection, selected_owner); end if;
  else
    select item.value into selected_owner from jsonb_array_elements(projection -> 'suppliers') item(value)
      where item.value ->> 'id' = owner_id::text;
    if found then row_result := textbook_settings_private.supplier_row_v1(projection, selected_owner); end if;
  end if;
  return jsonb_build_object('row', row_result, 'baseRevision', revision, 'ownerCounts', owner_counts);
end
$$;

create or replace function public.get_textbook_publisher_setting_detail_v1(p_id uuid, p_draft jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select textbook_settings_private.detail_v1('publisher', p_id, p_draft)
$$;
create or replace function public.get_textbook_supplier_setting_detail_v1(p_id uuid, p_draft jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select textbook_settings_private.detail_v1('supplier', p_id, p_draft)
$$;

create or replace function public.save_textbook_settings_draft_v1(p_request_id uuid, p_draft jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_request_hash text;
  stored_receipt textbook_settings_private.owner_draft_receipts%rowtype;
  prior_lock_timeout text := current_setting('lock_timeout');
  base_revision text; new_revision text; target jsonb; operation jsonb; operation_type text;
  owner_id uuid; owner_row jsonb; v_result jsonb;
  publisher_add_ids uuid[] := '{}'::uuid[]; publisher_delete_ids uuid[] := '{}'::uuid[];
  publisher_dirty_ids uuid[] := '{}'::uuid[]; publisher_name_ids uuid[] := '{}'::uuid[];
  publisher_subject_ids uuid[] := '{}'::uuid[]; explicit_link_ids uuid[] := '{}'::uuid[];
  supplier_add_ids uuid[] := '{}'::uuid[]; supplier_delete_ids uuid[] := '{}'::uuid[];
  supplier_dirty_ids uuid[] := '{}'::uuid[]; supplier_name_ids uuid[] := '{}'::uuid[];
  supplier_contact_ids uuid[] := '{}'::uuid[]; supplier_memo_ids uuid[] := '{}'::uuid[];
  supplier_delete_link_ids uuid[] := '{}'::uuid[];
  changed_publishers uuid[] := '{}'::uuid[]; deleted_publishers uuid[] := '{}'::uuid[];
  changed_suppliers uuid[] := '{}'::uuid[]; deleted_suppliers uuid[] := '{}'::uuid[];
  changed_link_publishers uuid[] := '{}'::uuid[];
  desired_links text[]; current_links text[]; desired_link text; link_position integer;
  link_changed boolean; force_normalize boolean;
begin
  perform textbook_settings_private.guard_write_v1();
  if p_request_id is null or jsonb_typeof(p_draft) is distinct from 'object' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(p_draft) key)
      is distinct from array['owners', 'subSubjects', 'version']
    or jsonb_typeof(p_draft -> 'version') is distinct from 'number'
    or p_draft -> 'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_draft -> 'owners') is distinct from 'object'
    or p_draft -> 'subSubjects' is distinct from 'null'::jsonb then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  perform textbook_settings_private.assert_draft_v1(p_draft -> 'owners');
  v_request_hash := encode(pg_catalog.sha256(convert_to(p_draft::text, 'utf8')), 'hex');

  perform set_config('lock_timeout', '1s', true);
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text || ':' || p_request_id::text, 0));
  select receipt.* into stored_receipt from textbook_settings_private.owner_draft_receipts receipt
    where receipt.actor_id = v_actor_id and receipt.request_id = p_request_id;
  if found then
    if stored_receipt.request_hash <> v_request_hash then
      raise exception 'textbook_settings_request_mismatch' using errcode = '22023';
    end if;
    perform set_config('lock_timeout', prior_lock_timeout, true);
    return stored_receipt.result;
  end if;

  lock table public.textbook_publishers in share row exclusive mode;
  lock table public.textbook_suppliers in share row exclusive mode;
  lock table public.textbook_publisher_supplier_links in share row exclusive mode;
  base_revision := textbook_settings_private.revision_v1();
  if p_draft -> 'owners' ->> 'baseRevision' <> base_revision then
    raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
  end if;
  target := textbook_settings_private.project_v1(p_draft -> 'owners');

  for operation in select item.value from jsonb_array_elements(p_draft -> 'owners' -> 'operations') item(value) loop
    operation_type := operation ->> 'type'; owner_id := (operation ->> 'id')::uuid;
    if operation_type = 'publisher.add' then
      publisher_add_ids := array_append(publisher_add_ids, owner_id);
      publisher_dirty_ids := array_append(publisher_dirty_ids, owner_id);
      publisher_name_ids := array_append(publisher_name_ids, owner_id);
      publisher_subject_ids := array_append(publisher_subject_ids, owner_id);
      explicit_link_ids := array_append(explicit_link_ids, owner_id);
    elsif operation_type = 'publisher.patch' then
      publisher_dirty_ids := array_append(publisher_dirty_ids, owner_id);
      if operation -> 'patch' ? 'name' then publisher_name_ids := array_append(publisher_name_ids, owner_id); end if;
      if operation -> 'patch' ? 'subjects' then publisher_subject_ids := array_append(publisher_subject_ids, owner_id); end if;
      if operation -> 'patch' ? 'supplierIds' then explicit_link_ids := array_append(explicit_link_ids, owner_id); end if;
    elsif operation_type = 'publisher.delete' then publisher_delete_ids := array_append(publisher_delete_ids, owner_id);
    elsif operation_type = 'supplier.add' then
      supplier_add_ids := array_append(supplier_add_ids, owner_id);
      supplier_dirty_ids := array_append(supplier_dirty_ids, owner_id);
      supplier_name_ids := array_append(supplier_name_ids, owner_id);
      supplier_contact_ids := array_append(supplier_contact_ids, owner_id);
      supplier_memo_ids := array_append(supplier_memo_ids, owner_id);
    elsif operation_type = 'supplier.patch' then
      supplier_dirty_ids := array_append(supplier_dirty_ids, owner_id);
      if operation -> 'patch' ? 'name' then supplier_name_ids := array_append(supplier_name_ids, owner_id); end if;
      if operation -> 'patch' ? 'contact' then supplier_contact_ids := array_append(supplier_contact_ids, owner_id); end if;
      if operation -> 'patch' ? 'memo' then supplier_memo_ids := array_append(supplier_memo_ids, owner_id); end if;
    elsif operation_type = 'supplier.delete' then supplier_delete_ids := array_append(supplier_delete_ids, owner_id);
    end if;
  end loop;

  -- Validate only submitted dirty retained owners, plus all submitted final references, before DML.
  if exists (select 1 from jsonb_array_elements(target -> 'publishers') dirty(value)
      where (dirty.value ->> 'id')::uuid = any(publisher_name_ids) and (
        textbook_settings_private.trim_v1(dirty.value ->> 'name') = '' or exists (
          select 1 from jsonb_array_elements(target -> 'publishers') other(value)
          where other.value ->> 'id' <> dirty.value ->> 'id'
            and textbook_settings_private.trim_v1(other.value ->> 'name')
              = textbook_settings_private.trim_v1(dirty.value ->> 'name'))))
    or exists (select 1 from jsonb_array_elements(target -> 'suppliers') dirty(value)
      where (dirty.value ->> 'id')::uuid = any(supplier_name_ids) and (
        textbook_settings_private.trim_v1(dirty.value ->> 'name') = '' or exists (
          select 1 from jsonb_array_elements(target -> 'suppliers') other(value)
          where other.value ->> 'id' <> dirty.value ->> 'id'
            and textbook_settings_private.trim_v1(other.value ->> 'name')
              = textbook_settings_private.trim_v1(dirty.value ->> 'name'))))
    or exists (select 1 from jsonb_array_elements(target -> 'publishers') publisher(value),
        jsonb_array_elements_text(publisher.value -> 'supplierIds') reference(value)
      where not exists (select 1 from jsonb_array_elements(target -> 'suppliers') supplier(value)
        where supplier.value ->> 'id' = reference.value)) then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct link.publisher_id order by link.publisher_id), '{}'::uuid[])
  into supplier_delete_link_ids from public.textbook_publisher_supplier_links link
  where link.supplier_id = any(supplier_delete_ids)
    and not (link.publisher_id = any(publisher_delete_ids));

  foreach owner_id in array publisher_delete_ids loop
    delete from public.textbook_publishers where id = owner_id;
    if found then deleted_publishers := array_append(deleted_publishers, owner_id); end if;
  end loop;
  foreach owner_id in array supplier_delete_ids loop
    delete from public.textbook_suppliers where id = owner_id;
    if found then deleted_suppliers := array_append(deleted_suppliers, owner_id); end if;
  end loop;

  for owner_row in select item.value from jsonb_array_elements(target -> 'suppliers') item(value)
      where (item.value ->> 'id')::uuid = any(supplier_add_ids) loop
    insert into public.textbook_suppliers(id, name, contact, memo) values (
      (owner_row ->> 'id')::uuid, owner_row ->> 'name', owner_row ->> 'contact', owner_row ->> 'memo');
    changed_suppliers := array_append(changed_suppliers, (owner_row ->> 'id')::uuid);
  end loop;
  for owner_row in select item.value from jsonb_array_elements(target -> 'publishers') item(value)
      where (item.value ->> 'id')::uuid = any(publisher_add_ids) loop
    insert into public.textbook_publishers(id, name, subjects) values (
      (owner_row ->> 'id')::uuid, owner_row ->> 'name',
      array(select value from jsonb_array_elements_text(owner_row -> 'subjects') value));
    changed_publishers := array_append(changed_publishers, (owner_row ->> 'id')::uuid);
  end loop;

  for owner_id in select distinct id from unnest(supplier_dirty_ids) id
      where not (id = any(supplier_add_ids)) loop
    select item.value into owner_row from jsonb_array_elements(target -> 'suppliers') item(value)
      where (item.value ->> 'id')::uuid = owner_id;
    update public.textbook_suppliers set
      name = case when owner_id = any(supplier_name_ids)
        and textbook_settings_private.trim_v1(name) is distinct from owner_row ->> 'name'
        then owner_row ->> 'name' else name end,
      contact = case when owner_id = any(supplier_contact_ids)
        and textbook_settings_private.trim_v1(contact) is distinct from owner_row ->> 'contact'
        then owner_row ->> 'contact' else contact end,
      memo = case when owner_id = any(supplier_memo_ids)
        and textbook_settings_private.trim_v1(memo) is distinct from owner_row ->> 'memo'
        then owner_row ->> 'memo' else memo end
    where id = owner_id and (
      (owner_id = any(supplier_name_ids) and textbook_settings_private.trim_v1(name) is distinct from owner_row ->> 'name')
      or (owner_id = any(supplier_contact_ids) and textbook_settings_private.trim_v1(contact) is distinct from owner_row ->> 'contact')
      or (owner_id = any(supplier_memo_ids) and textbook_settings_private.trim_v1(memo) is distinct from owner_row ->> 'memo'));
    if found then changed_suppliers := array_append(changed_suppliers, owner_id); end if;
  end loop;

  for owner_id in select distinct id from unnest(publisher_dirty_ids) id
      where not (id = any(publisher_add_ids)) loop
    select item.value into owner_row from jsonb_array_elements(target -> 'publishers') item(value)
      where (item.value ->> 'id')::uuid = owner_id;
    update public.textbook_publishers set
      name = case when owner_id = any(publisher_name_ids)
        and textbook_settings_private.trim_v1(name) is distinct from owner_row ->> 'name'
        then owner_row ->> 'name' else name end,
      subjects = case when owner_id = any(publisher_subject_ids)
        and textbook_settings_private.subjects_v1(to_jsonb(subjects)) is distinct from owner_row -> 'subjects'
        then array(select value from jsonb_array_elements_text(owner_row -> 'subjects') value) else subjects end
    where id = owner_id and (
      (owner_id = any(publisher_name_ids) and textbook_settings_private.trim_v1(name) is distinct from owner_row ->> 'name')
      or (owner_id = any(publisher_subject_ids)
        and textbook_settings_private.subjects_v1(to_jsonb(subjects)) is distinct from owner_row -> 'subjects'));
    if found then changed_publishers := array_append(changed_publishers, owner_id); end if;
  end loop;

  changed_link_publishers := changed_link_publishers || supplier_delete_link_ids;
  for owner_id in select distinct scoped_id from unnest(explicit_link_ids || supplier_delete_link_ids) scoped_id
    where exists (select 1 from jsonb_array_elements(target -> 'publishers') item(value)
      where (item.value ->> 'id')::uuid = scoped_id) order by scoped_id loop
    select item.value into owner_row from jsonb_array_elements(target -> 'publishers') item(value)
      where (item.value ->> 'id')::uuid = owner_id;
    desired_links := array(select value from jsonb_array_elements_text(owner_row -> 'supplierIds') value);
    current_links := array(select link.supplier_id::text from public.textbook_publisher_supplier_links link
      where link.publisher_id = owner_id order by link.is_primary desc, link.priority, link.id);
    force_normalize := owner_id = any(supplier_delete_link_ids);
    link_changed := current_links is distinct from desired_links;
    if force_normalize and exists (select 1 from (select link.is_primary, link.priority,
        row_number() over (order by link.is_primary desc, link.priority, link.id) ordinal
      from public.textbook_publisher_supplier_links link where link.publisher_id = owner_id) ordered
      where ordered.is_primary is distinct from (ordered.ordinal = 1)
        or ordered.priority is distinct from ordered.ordinal) then link_changed := true; end if;
    if link_changed then
      delete from public.textbook_publisher_supplier_links
        where publisher_id = owner_id and not (supplier_id::text = any(desired_links));
      link_position := 0;
      foreach desired_link in array desired_links loop
        link_position := link_position + 1;
        update public.textbook_publisher_supplier_links set
          is_primary = (link_position = 1), priority = link_position
        where publisher_id = owner_id and supplier_id = desired_link::uuid
          and (is_primary is distinct from (link_position = 1) or priority is distinct from link_position);
        if not exists (select 1 from public.textbook_publisher_supplier_links
            where publisher_id = owner_id and supplier_id = desired_link::uuid) then
          insert into public.textbook_publisher_supplier_links(publisher_id, supplier_id, is_primary, priority)
          values (owner_id, desired_link::uuid, link_position = 1, link_position);
        end if;
      end loop;
      changed_link_publishers := array_append(changed_link_publishers, owner_id);
    end if;
  end loop;

  new_revision := textbook_settings_private.revision_v1();
  v_result := jsonb_build_object('requestId', p_request_id, 'owners', jsonb_build_object(
    'baseRevision', base_revision, 'newRevision', new_revision,
    'changedPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_publishers) id), '{}'::uuid[])),
    'deletedPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(deleted_publishers) id), '{}'::uuid[])),
    'changedSupplierIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_suppliers) id), '{}'::uuid[])),
    'deletedSupplierIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(deleted_suppliers) id), '{}'::uuid[])),
    'changedLinkPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_link_publishers) id), '{}'::uuid[]))),
    'subSubjects', null);
  insert into textbook_settings_private.owner_draft_receipts(actor_id, request_id, request_hash, result)
    values (v_actor_id, p_request_id, v_request_hash, v_result);
  perform set_config('lock_timeout', prior_lock_timeout, true);
  return v_result;
exception when others then
  perform set_config('lock_timeout', prior_lock_timeout, true);
  raise;
end
$$;

revoke all on function
  public.list_textbook_publisher_page_v1(jsonb, jsonb, text, integer, integer),
  public.list_textbook_supplier_page_v1(jsonb, jsonb, text, integer, integer),
  public.list_textbook_supplier_setting_picker_page_v1(jsonb, jsonb, text, integer, integer),
  public.get_textbook_publisher_setting_detail_v1(uuid, jsonb),
  public.get_textbook_supplier_setting_detail_v1(uuid, jsonb),
  public.save_textbook_settings_draft_v1(uuid, jsonb)
from public, anon;
grant execute on function
  public.list_textbook_publisher_page_v1(jsonb, jsonb, text, integer, integer),
  public.list_textbook_supplier_page_v1(jsonb, jsonb, text, integer, integer),
  public.list_textbook_supplier_setting_picker_page_v1(jsonb, jsonb, text, integer, integer),
  public.get_textbook_publisher_setting_detail_v1(uuid, jsonb),
  public.get_textbook_supplier_setting_detail_v1(uuid, jsonb),
  public.save_textbook_settings_draft_v1(uuid, jsonb)
to authenticated;

revoke all on all functions in schema textbook_settings_private from public, anon, authenticated;
grant execute on function
  textbook_settings_private.trim_v1(text),
  textbook_settings_private.guard_read_v1(),
  textbook_settings_private.guard_write_v1(),
  textbook_settings_private.assert_page_v1(jsonb, text, integer, integer),
  textbook_settings_private.assert_draft_v1(jsonb),
  textbook_settings_private.revision_v1(),
  textbook_settings_private.subjects_v1(jsonb),
  textbook_settings_private.ids_v1(jsonb),
  textbook_settings_private.project_v1(jsonb),
  textbook_settings_private.publisher_row_v1(jsonb, jsonb),
  textbook_settings_private.publisher_haystack_v1(jsonb, jsonb),
  textbook_settings_private.supplier_row_v1(jsonb, jsonb),
  textbook_settings_private.supplier_haystack_v1(jsonb, jsonb),
  textbook_settings_private.page_v1(text, jsonb, jsonb, text, integer, integer),
  textbook_settings_private.detail_v1(text, uuid, jsonb)
to authenticated;
