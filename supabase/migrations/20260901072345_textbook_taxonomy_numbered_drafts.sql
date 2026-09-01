create or replace function textbook_settings_private.taxonomy_subject_v1(value text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case lower(textbook_settings_private.trim_v1(value))
    when 'english' then 'english' when '영어' then 'english'
    when 'math' then 'math' when '수학' then 'math'
    when 'science' then 'science' when '과학' then 'science'
    when 'other' then 'other' when '기타' then 'other'
    else 'other' end
$$;

create or replace function textbook_settings_private.taxonomy_defaults_v1()
returns table(virtual_id text, subject text, name text, sort_order integer, is_visible boolean)
language sql immutable security invoker set search_path = '' as $$
  values
    ('english-단어','english','단어',10,true),
    ('english-독해','english','독해',20,true),
    ('english-듣기','english','듣기',30,true),
    ('english-문법','english','문법',40,true),
    ('english-모고','english','모고',50,true),
    ('english-내신','english','내신',60,true),
    ('math-공통수학1','math','공통수학1',10,true),
    ('math-공통수학2','math','공통수학2',20,true),
    ('math-대수','math','대수',30,true),
    ('math-미적분','math','미적분',40,true),
    ('math-확률과 통계','math','확률과 통계',50,true),
    ('math-기하','math','기하',60,true),
    ('math-수1','math','수1',70,true),
    ('math-수2','math','수2',80,true),
    ('math-내신','math','내신',90,true),
    ('science-통합과학','science','통합과학',10,true),
    ('science-물리학','science','물리학',20,true),
    ('science-화학','science','화학',30,true),
    ('science-생명과학','science','생명과학',40,true),
    ('science-지구과학','science','지구과학',50,true),
    ('other-기타','other','기타',10,true)
$$;

create or replace function textbook_settings_private.taxonomy_revision_v1() returns text
language sql stable security invoker set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'defaultDefinitionVersion', 'textbook-subsubjects-v1-21',
    'rows', coalesce((select jsonb_agg(to_jsonb(setting)
      || jsonb_build_object(
        'created_at', case when setting.created_at is null then null else to_char(setting.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'updated_at', case when setting.updated_at is null then null else to_char(setting.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
      order by setting.id) from public.textbook_sub_subject_settings setting), '[]'::jsonb)
  )::text, 'utf8')), 'hex')
$$;

create or replace function textbook_settings_private.assert_sub_subject_draft_v1(draft jsonb) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare operation jsonb; patch jsonb; keys text[]; operation_type text;
begin
  if draft is null or draft = 'null'::jsonb then return; end if;
  if jsonb_typeof(draft) is distinct from 'object' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(draft) key;
  if keys is distinct from array['baseRevision','operations','version']
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
      or textbook_settings_private.trim_v1(operation ->> 'id') = '' then
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
    operation_type := operation ->> 'type';
    if operation_type = 'add' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id','isVisible','name','subject','type']
        or coalesce(operation ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(operation -> 'subject') is distinct from 'string'
        or operation ->> 'subject' not in ('english','math','science','other')
        or jsonb_typeof(operation -> 'name') is distinct from 'string'
        or jsonb_typeof(operation -> 'isVisible') is distinct from 'boolean' then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'patch' then
      patch := operation -> 'patch';
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id','patch','type']
        or jsonb_typeof(patch) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(patch)) = 0
        or exists (select 1 from jsonb_object_keys(patch) key where key not in ('name','isVisible'))
        or (patch ? 'name' and jsonb_typeof(patch -> 'name') is distinct from 'string')
        or (patch ? 'isVisible' and jsonb_typeof(patch -> 'isVisible') is distinct from 'boolean') then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'delete' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id','type'] then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'move' then
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['direction','id','type']
        or jsonb_typeof(operation -> 'direction') is distinct from 'string'
        or operation ->> 'direction' not in ('up','down') then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
  end loop;
end
$$;

create or replace function textbook_settings_private.sort_sub_subject_projection_v1(projection jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(item.value order by
    case item.value ->> 'subject' when 'english' then 1 when 'math' then 2 when 'science' then 3 else 4 end,
    (item.value ->> 'sortOrder')::integer,
    (item.value ->> 'name') collate dashboard_private.textbook_reference_ko_numeric,
    item.value ->> 'id'), '[]'::jsonb)
  from jsonb_array_elements(projection) item(value)
$$;

create or replace function textbook_settings_private.project_sub_subject_v1(draft jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  projection jsonb; operation jsonb; patch jsonb; default_row record;
  operation_type text; target_id text; canonical_id text; current_subject text; neighbor_subject text; neighbor_id text;
  current_ordinal bigint; neighbor_ordinal bigint; current_subject_ordinal bigint; neighbor_subject_ordinal bigint;
  current_rank integer; neighbor_rank integer; maximum_rank integer;
  seen_ids text[];
begin
  perform textbook_settings_private.assert_sub_subject_draft_v1(draft);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', setting.id::text,
    'subject', textbook_settings_private.taxonomy_subject_v1(setting.subject),
    'name', textbook_settings_private.trim_v1(setting.name),
    'sortOrder', setting.sort_order,
    'isVisible', setting.is_visible,
    'kind', 'persisted') order by
      case textbook_settings_private.taxonomy_subject_v1(setting.subject) when 'english' then 1 when 'math' then 2 when 'science' then 3 else 4 end,
      setting.sort_order,
      textbook_settings_private.trim_v1(setting.name) collate dashboard_private.textbook_reference_ko_numeric,
      setting.id), '[]'::jsonb)
  into projection
  from public.textbook_sub_subject_settings setting
  where textbook_settings_private.trim_v1(setting.name) <> '';

  for default_row in select * from textbook_settings_private.taxonomy_defaults_v1() loop
    if not exists (select 1 from jsonb_array_elements(projection) item(value)
        where item.value ->> 'subject' = default_row.subject and item.value ->> 'name' = default_row.name) then
      projection := projection || jsonb_build_array(jsonb_build_object(
        'id', default_row.virtual_id,
        'subject', default_row.subject,
        'name', default_row.name,
        'sortOrder', default_row.sort_order,
        'isVisible', default_row.is_visible,
        'kind', 'default'));
    end if;
  end loop;
  projection := textbook_settings_private.sort_sub_subject_projection_v1(projection);
  if draft is null or draft = 'null'::jsonb then return projection; end if;

  select coalesce(array_agg(lower(item.value ->> 'id')), '{}'::text[]) into seen_ids
  from jsonb_array_elements(projection) item(value);
  for operation in select item.value from jsonb_array_elements(draft -> 'operations') item(value) loop
    operation_type := operation ->> 'type'; target_id := operation ->> 'id'; patch := operation -> 'patch';
    if operation_type = 'add' then
      canonical_id := ((target_id)::uuid)::text;
      if lower(canonical_id) = any(seen_ids) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      seen_ids := array_append(seen_ids, lower(canonical_id));
      select coalesce(max((item.value ->> 'sortOrder')::integer), 0) into maximum_rank
      from jsonb_array_elements(projection) item(value)
      where item.value ->> 'subject' = operation ->> 'subject';
      projection := projection || jsonb_build_array(jsonb_build_object(
        'id', canonical_id,
        'subject', operation ->> 'subject',
        'name', textbook_settings_private.trim_v1(operation ->> 'name'),
        'sortOrder', maximum_rank + 10,
        'isVisible', (operation ->> 'isVisible')::boolean,
        'kind', 'added'));
    elsif operation_type = 'patch' then
      if not exists (select 1 from jsonb_array_elements(projection) item(value)
          where lower(item.value ->> 'id') = lower(target_id)) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(case when lower(item.value ->> 'id') = lower(target_id) then item.value
        || jsonb_strip_nulls(jsonb_build_object(
          'name', case when patch ? 'name' then textbook_settings_private.trim_v1(patch ->> 'name') end,
          'isVisible', case when patch ? 'isVisible' then patch -> 'isVisible' end))
        else item.value end order by item.ordinality), '[]'::jsonb) into projection
      from jsonb_array_elements(projection) with ordinality item(value, ordinality);
    elsif operation_type = 'delete' then
      if not exists (select 1 from jsonb_array_elements(projection) item(value)
          where lower(item.value ->> 'id') = lower(target_id)) then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb) into projection
      from jsonb_array_elements(projection) with ordinality item(value, ordinality)
      where lower(item.value ->> 'id') <> lower(target_id);
    else
      projection := textbook_settings_private.sort_sub_subject_projection_v1(projection);
      select item.ordinality, item.value ->> 'subject', (item.value ->> 'sortOrder')::integer
      into current_ordinal, current_subject, current_rank
      from jsonb_array_elements(projection) with ordinality item(value, ordinality)
      where lower(item.value ->> 'id') = lower(target_id);
      if not found then raise exception 'textbook_settings_draft_invalid' using errcode = '22023'; end if;
      neighbor_ordinal := current_ordinal + case when operation ->> 'direction' = 'up' then -1 else 1 end;
      select item.value ->> 'id', item.value ->> 'subject', (item.value ->> 'sortOrder')::integer
      into neighbor_id, neighbor_subject, neighbor_rank
      from jsonb_array_elements(projection) with ordinality item(value, ordinality)
      where item.ordinality = neighbor_ordinal;
      if found and neighbor_subject = current_subject then
        if current_rank = neighbor_rank then
          with scoped as (
            select item.value, item.ordinality,
              row_number() over (partition by item.value ->> 'subject' order by item.ordinality) subject_ordinal
            from jsonb_array_elements(projection) with ordinality item(value, ordinality)
          )
          select max(subject_ordinal) filter (where lower(value ->> 'id') = lower(target_id)),
            max(subject_ordinal) filter (where value ->> 'id' = neighbor_id)
          into current_subject_ordinal, neighbor_subject_ordinal from scoped;
          with scoped as (
            select item.value, item.ordinality,
              row_number() over (partition by item.value ->> 'subject' order by item.ordinality) subject_ordinal
            from jsonb_array_elements(projection) with ordinality item(value, ordinality)
          )
          select coalesce(jsonb_agg(case when value ->> 'subject' = current_subject then
            jsonb_set(value, '{sortOrder}', to_jsonb((case
              when lower(value ->> 'id') = lower(target_id) then neighbor_subject_ordinal
              when value ->> 'id' = neighbor_id then current_subject_ordinal
              else subject_ordinal end * 10)::integer))
            else value end order by ordinality), '[]'::jsonb) into projection from scoped;
        else
          select coalesce(jsonb_agg(case
            when lower(item.value ->> 'id') = lower(target_id) then jsonb_set(item.value, '{sortOrder}', to_jsonb(neighbor_rank))
            when item.value ->> 'id' = neighbor_id then jsonb_set(item.value, '{sortOrder}', to_jsonb(current_rank))
            else item.value end order by item.ordinality), '[]'::jsonb) into projection
          from jsonb_array_elements(projection) with ordinality item(value, ordinality);
        end if;
      end if;
    end if;
  end loop;
  return textbook_settings_private.sort_sub_subject_projection_v1(projection);
end
$$;

create or replace function textbook_settings_private.assert_sub_subject_page_v1(
  filters jsonb, draft jsonb, page_number integer, page_size integer
) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare keys text[];
begin
  perform textbook_settings_private.guard_read_v1();
  if jsonb_typeof(filters) is distinct from 'object' then
    raise exception 'textbook_settings_page_invalid' using errcode = '22023';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(filters) key;
  if keys is distinct from array['search','subject']
    or jsonb_typeof(filters -> 'search') is distinct from 'string'
    or jsonb_typeof(filters -> 'subject') is distinct from 'string'
    or filters ->> 'subject' not in ('english','math','science','other')
    or page_number is null or page_number < 1
    or page_size is null or page_size not in (10,15,20) then
    raise exception 'textbook_settings_page_invalid' using errcode = '22023';
  end if;
  perform textbook_settings_private.assert_sub_subject_draft_v1(draft);
end
$$;

create or replace function public.list_textbook_sub_subject_numbered_page_v1(
  p_filters jsonb, p_draft jsonb, p_page integer, p_page_size integer
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  projection jsonb; revision text; rows jsonb; total_count integer; visible_count integer;
  subject_counts jsonb; search_text text;
begin
  perform textbook_settings_private.assert_sub_subject_page_v1(p_filters, p_draft, p_page, p_page_size);
  revision := textbook_settings_private.taxonomy_revision_v1();
  if p_draft is not null and p_draft <> 'null'::jsonb and p_draft ->> 'baseRevision' <> revision then
    raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
  end if;
  projection := textbook_settings_private.project_sub_subject_v1(p_draft);
  search_text := lower(textbook_settings_private.trim_v1(p_filters ->> 'search'));
  select jsonb_build_object(
    'english', count(*) filter (where item.value ->> 'subject' = 'english'),
    'math', count(*) filter (where item.value ->> 'subject' = 'math'),
    'science', count(*) filter (where item.value ->> 'subject' = 'science'),
    'other', count(*) filter (where item.value ->> 'subject' = 'other')),
    count(*) filter (where (item.value ->> 'isVisible')::boolean)
  into subject_counts, visible_count
  from jsonb_array_elements(projection) item(value);

  with ordered as (
    select item.value, item.ordinality,
      row_number() over (partition by item.value ->> 'subject' order by item.ordinality) subject_ordinal,
      count(*) over (partition by item.value ->> 'subject') subject_total
    from jsonb_array_elements(projection) with ordinality item(value, ordinality)
  ), filtered as (
    select value, ordinality, subject_ordinal, subject_total
    from ordered
    where value ->> 'subject' = p_filters ->> 'subject'
      and (search_text = '' or strpos(lower(value ->> 'name'), search_text) > 0)
  ), counted as (
    select *, count(*) over () matching_total from filtered
  ), page_rows as (
    select value || jsonb_build_object(
      'canMoveUp', subject_ordinal > 1,
      'canMoveDown', subject_ordinal < subject_total) row_value,
      ordinality, matching_total
    from counted
    order by ordinality
    offset (p_page::bigint - 1) * p_page_size limit p_page_size
  )
  select coalesce((select jsonb_agg(row_value order by ordinality) from page_rows), '[]'::jsonb),
    coalesce((select max(matching_total)::integer from counted), 0)
  into rows, total_count;

  return jsonb_build_object(
    'rows', rows,
    'page', p_page,
    'pageSize', p_page_size,
    'totalCount', total_count,
    'baseRevision', revision,
    'visibleCount', visible_count,
    'subjectCounts', subject_counts);
end
$$;

create or replace function public.save_textbook_settings_draft_v1(p_request_id uuid, p_draft jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_request_hash text;
  stored_receipt textbook_settings_private.owner_draft_receipts%rowtype;
  prior_lock_timeout text := current_setting('lock_timeout');
  owners_included boolean; taxonomy_included boolean;
  owner_base_revision text; owner_new_revision text; target jsonb; operation jsonb; operation_type text;
  owner_id uuid; owner_row jsonb; owner_result jsonb := 'null'::jsonb; v_result jsonb;
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
  taxonomy_base_revision text; taxonomy_new_revision text; taxonomy_target jsonb;
  taxonomy_result jsonb := 'null'::jsonb; taxonomy_row jsonb; taxonomy_planned jsonb := '[]'::jsonb;
  taxonomy_materialized_ids jsonb := '{}'::jsonb; taxonomy_materialized_id uuid; taxonomy_id uuid;
  taxonomy_add_ids uuid[] := '{}'::uuid[]; taxonomy_delete_ids uuid[] := '{}'::uuid[];
  taxonomy_changed_ids uuid[] := '{}'::uuid[]; taxonomy_deleted_ids uuid[] := '{}'::uuid[];
  taxonomy_setting record; taxonomy_default record;
begin
  perform textbook_settings_private.guard_write_v1();
  if p_request_id is null or jsonb_typeof(p_draft) is distinct from 'object' then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(p_draft) key)
      is distinct from array['owners','subSubjects','version']
    or jsonb_typeof(p_draft -> 'version') is distinct from 'number'
    or p_draft -> 'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_draft -> 'owners') not in ('object','null')
    or jsonb_typeof(p_draft -> 'subSubjects') not in ('object','null')
    or (p_draft -> 'owners' = 'null'::jsonb and p_draft -> 'subSubjects' = 'null'::jsonb) then
    raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
  end if;
  owners_included := p_draft -> 'owners' <> 'null'::jsonb;
  taxonomy_included := p_draft -> 'subSubjects' <> 'null'::jsonb;
  if owners_included then perform textbook_settings_private.assert_draft_v1(p_draft -> 'owners'); end if;
  if taxonomy_included then perform textbook_settings_private.assert_sub_subject_draft_v1(p_draft -> 'subSubjects'); end if;
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

  if owners_included then
    lock table public.textbook_publishers in share row exclusive mode;
    lock table public.textbook_suppliers in share row exclusive mode;
    lock table public.textbook_publisher_supplier_links in share row exclusive mode;
  end if;
  if taxonomy_included then
    lock table public.textbook_sub_subject_settings in share row exclusive mode;
  end if;

  if owners_included then
    owner_base_revision := textbook_settings_private.revision_v1();
    if p_draft -> 'owners' ->> 'baseRevision' <> owner_base_revision then
      raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
    end if;
    target := textbook_settings_private.project_v1(p_draft -> 'owners');
  end if;
  if taxonomy_included then
    taxonomy_base_revision := textbook_settings_private.taxonomy_revision_v1();
    if p_draft -> 'subSubjects' ->> 'baseRevision' <> taxonomy_base_revision then
      raise exception 'textbook_settings_revision_conflict' using errcode = '55000';
    end if;
    taxonomy_target := textbook_settings_private.project_sub_subject_v1(p_draft -> 'subSubjects');
  end if;

  -- Resolve and validate every included section before the first DML statement.
  if owners_included then
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

    if exists (select 1 from jsonb_array_elements(target -> 'publishers') dirty(value)
        where (dirty.value ->> 'id')::uuid = any(publisher_name_ids)
          and textbook_settings_private.trim_v1(dirty.value ->> 'name') = '')
      or exists (select 1 from jsonb_array_elements(target -> 'suppliers') dirty(value)
        where (dirty.value ->> 'id')::uuid = any(supplier_name_ids)
          and textbook_settings_private.trim_v1(dirty.value ->> 'name') = '')
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
  end if;

  if taxonomy_included then
    for operation in select item.value from jsonb_array_elements(p_draft -> 'subSubjects' -> 'operations') item(value) loop
      if operation ->> 'type' = 'add' then
        taxonomy_add_ids := array_append(taxonomy_add_ids, (operation ->> 'id')::uuid);
      elsif operation ->> 'type' = 'delete'
        and operation ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        taxonomy_delete_ids := array_append(taxonomy_delete_ids, (operation ->> 'id')::uuid);
      end if;
    end loop;

    for taxonomy_setting in select setting.* from public.textbook_sub_subject_settings setting order by setting.id loop
      if taxonomy_setting.id = any(taxonomy_delete_ids) then continue; end if;
      select item.value into taxonomy_row from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'persisted' and item.value ->> 'id' = taxonomy_setting.id::text;
      if found and textbook_settings_private.trim_v1(taxonomy_row ->> 'name') <> '' then
        taxonomy_planned := taxonomy_planned || jsonb_build_array(jsonb_build_object(
          'id', taxonomy_setting.id::text,
          'subject', textbook_settings_private.taxonomy_subject_v1(taxonomy_setting.subject),
          'name', textbook_settings_private.trim_v1(taxonomy_row ->> 'name'),
          'sortOrder', (taxonomy_row ->> 'sortOrder')::integer,
          'isVisible', (taxonomy_row ->> 'isVisible')::boolean));
      else
        taxonomy_planned := taxonomy_planned || jsonb_build_array(jsonb_build_object(
          'id', taxonomy_setting.id::text,
          'subject', textbook_settings_private.taxonomy_subject_v1(taxonomy_setting.subject),
          'name', textbook_settings_private.trim_v1(taxonomy_setting.name),
          'sortOrder', taxonomy_setting.sort_order,
          'isVisible', taxonomy_setting.is_visible));
      end if;
    end loop;

    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'added'
        and textbook_settings_private.trim_v1(item.value ->> 'name') <> '' loop
      taxonomy_planned := taxonomy_planned || jsonb_build_array(taxonomy_row);
    end loop;

    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'default' loop
      select * into taxonomy_default from textbook_settings_private.taxonomy_defaults_v1() default_value
      where default_value.virtual_id = taxonomy_row ->> 'id';
      if not found then raise exception 'textbook_settings_draft_invalid' using errcode = '22023'; end if;
      if textbook_settings_private.trim_v1(taxonomy_row ->> 'name') <> '' and (
          taxonomy_row ->> 'name' is distinct from taxonomy_default.name
          or (taxonomy_row ->> 'sortOrder')::integer is distinct from taxonomy_default.sort_order
          or (taxonomy_row ->> 'isVisible')::boolean is distinct from taxonomy_default.is_visible) then
        taxonomy_materialized_id := gen_random_uuid();
        taxonomy_materialized_ids := jsonb_set(
          taxonomy_materialized_ids,
          array[taxonomy_row ->> 'id'],
          to_jsonb(taxonomy_materialized_id::text),
          true);
        taxonomy_planned := taxonomy_planned || jsonb_build_array(taxonomy_row);
      end if;
    end loop;

    if exists (select 1 from jsonb_array_elements(taxonomy_target) item(value)
        where textbook_settings_private.trim_v1(item.value ->> 'name') <> ''
        group by item.value ->> 'subject', textbook_settings_private.trim_v1(item.value ->> 'name')
        having count(*) > 1)
      or exists (select 1 from jsonb_array_elements(taxonomy_planned) item(value)
        where textbook_settings_private.trim_v1(item.value ->> 'name') <> ''
        group by item.value ->> 'subject', textbook_settings_private.trim_v1(item.value ->> 'name')
        having count(*) > 1) then
      raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
    end if;
  end if;

  if owners_included then
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
  end if;

  if taxonomy_included then
    foreach taxonomy_id in array taxonomy_delete_ids loop
      delete from public.textbook_sub_subject_settings where id = taxonomy_id;
      if found then taxonomy_deleted_ids := array_append(taxonomy_deleted_ids, taxonomy_id); end if;
    end loop;

    -- Free real raw-name UNIQUE slots before applying validated persisted renames.
    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'persisted'
        and textbook_settings_private.trim_v1(item.value ->> 'name') <> '' loop
      taxonomy_id := (taxonomy_row ->> 'id')::uuid;
      update public.textbook_sub_subject_settings
      set name = '__textbook_settings_' || replace(taxonomy_id::text, '-', '')
      where id = taxonomy_id
        and textbook_settings_private.trim_v1(name) is distinct from textbook_settings_private.trim_v1(taxonomy_row ->> 'name');
    end loop;

    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'persisted'
        and textbook_settings_private.trim_v1(item.value ->> 'name') <> '' loop
      taxonomy_id := (taxonomy_row ->> 'id')::uuid;
      update public.textbook_sub_subject_settings set
        name = case when textbook_settings_private.trim_v1(name) is distinct from textbook_settings_private.trim_v1(taxonomy_row ->> 'name')
          then textbook_settings_private.trim_v1(taxonomy_row ->> 'name') else name end,
        sort_order = (taxonomy_row ->> 'sortOrder')::integer,
        is_visible = (taxonomy_row ->> 'isVisible')::boolean
      where id = taxonomy_id and (
        textbook_settings_private.trim_v1(name) is distinct from textbook_settings_private.trim_v1(taxonomy_row ->> 'name')
        or sort_order is distinct from (taxonomy_row ->> 'sortOrder')::integer
        or is_visible is distinct from (taxonomy_row ->> 'isVisible')::boolean);
      if found then taxonomy_changed_ids := array_append(taxonomy_changed_ids, taxonomy_id); end if;
    end loop;

    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'added'
        and textbook_settings_private.trim_v1(item.value ->> 'name') <> '' loop
      taxonomy_id := (taxonomy_row ->> 'id')::uuid;
      insert into public.textbook_sub_subject_settings(id, subject, name, sort_order, is_visible) values (
        taxonomy_id,
        taxonomy_row ->> 'subject',
        textbook_settings_private.trim_v1(taxonomy_row ->> 'name'),
        (taxonomy_row ->> 'sortOrder')::integer,
        (taxonomy_row ->> 'isVisible')::boolean);
      taxonomy_changed_ids := array_append(taxonomy_changed_ids, taxonomy_id);
    end loop;

    for taxonomy_row in select item.value from jsonb_array_elements(taxonomy_target) item(value)
      where item.value ->> 'kind' = 'default'
        and taxonomy_materialized_ids ? (item.value ->> 'id') loop
      taxonomy_id := (taxonomy_materialized_ids ->> (taxonomy_row ->> 'id'))::uuid;
      insert into public.textbook_sub_subject_settings(id, subject, name, sort_order, is_visible) values (
        taxonomy_id,
        taxonomy_row ->> 'subject',
        textbook_settings_private.trim_v1(taxonomy_row ->> 'name'),
        (taxonomy_row ->> 'sortOrder')::integer,
        (taxonomy_row ->> 'isVisible')::boolean);
      taxonomy_changed_ids := array_append(taxonomy_changed_ids, taxonomy_id);
    end loop;
  end if;

  if owners_included then
    owner_new_revision := textbook_settings_private.revision_v1();
    owner_result := jsonb_build_object(
      'baseRevision', owner_base_revision,
      'newRevision', owner_new_revision,
      'changedPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_publishers) id), '{}'::uuid[])),
      'deletedPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(deleted_publishers) id), '{}'::uuid[])),
      'changedSupplierIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_suppliers) id), '{}'::uuid[])),
      'deletedSupplierIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(deleted_suppliers) id), '{}'::uuid[])),
      'changedLinkPublisherIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(changed_link_publishers) id), '{}'::uuid[])));
  end if;
  if taxonomy_included then
    taxonomy_new_revision := textbook_settings_private.taxonomy_revision_v1();
    taxonomy_result := jsonb_build_object(
      'baseRevision', taxonomy_base_revision,
      'newRevision', taxonomy_new_revision,
      'changedIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(taxonomy_changed_ids) id), '{}'::uuid[])),
      'deletedIds', to_jsonb(coalesce((select array_agg(distinct id order by id) from unnest(taxonomy_deleted_ids) id), '{}'::uuid[])),
      'materializedIds', taxonomy_materialized_ids);
  end if;

  v_result := jsonb_build_object(
    'requestId', p_request_id,
    'owners', owner_result,
    'subSubjects', taxonomy_result);
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
  public.list_textbook_sub_subject_numbered_page_v1(jsonb,jsonb,integer,integer),
  public.save_textbook_settings_draft_v1(uuid,jsonb)
from public, anon;
grant execute on function
  public.list_textbook_sub_subject_numbered_page_v1(jsonb,jsonb,integer,integer),
  public.save_textbook_settings_draft_v1(uuid,jsonb)
to authenticated;

revoke all on function
  textbook_settings_private.taxonomy_subject_v1(text),
  textbook_settings_private.taxonomy_defaults_v1(),
  textbook_settings_private.taxonomy_revision_v1(),
  textbook_settings_private.assert_sub_subject_draft_v1(jsonb),
  textbook_settings_private.sort_sub_subject_projection_v1(jsonb),
  textbook_settings_private.project_sub_subject_v1(jsonb),
  textbook_settings_private.assert_sub_subject_page_v1(jsonb,jsonb,integer,integer)
from public, anon, authenticated;
grant execute on function
  textbook_settings_private.taxonomy_subject_v1(text),
  textbook_settings_private.taxonomy_defaults_v1(),
  textbook_settings_private.taxonomy_revision_v1(),
  textbook_settings_private.assert_sub_subject_draft_v1(jsonb),
  textbook_settings_private.sort_sub_subject_projection_v1(jsonb),
  textbook_settings_private.project_sub_subject_v1(jsonb),
  textbook_settings_private.assert_sub_subject_page_v1(jsonb,jsonb,integer,integer)
to authenticated;

notify pgrst, 'reload schema';
