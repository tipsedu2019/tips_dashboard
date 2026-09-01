-- Task 6a review fix: retain blank preview rows and preserve native name conflicts.
-- This additive migration replaces only the final effective trim/draft/save definitions.
create or replace function textbook_settings_private.trim_v1(value text) returns text
language sql immutable security invoker set search_path = '' as $$
  select btrim(coalesce(value, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
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
        or (patch ? 'name' and jsonb_typeof(patch -> 'name') is distinct from 'string')
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
        or jsonb_typeof(operation -> 'memo') is distinct from 'string' then
        raise exception 'textbook_settings_draft_invalid' using errcode = '22023';
      end if;
    elsif operation_type = 'supplier.patch' then
      patch := operation -> 'patch';
      if (select array_agg(key order by key) from jsonb_object_keys(operation) key)
          is distinct from array['id', 'patch', 'type']
        or jsonb_typeof(patch) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(patch)) = 0
        or exists (select 1 from jsonb_object_keys(patch) key where key not in ('name', 'contact', 'memo'))
        or (patch ? 'name' and jsonb_typeof(patch -> 'name') is distinct from 'string')
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

  -- Only blank dirty names and impossible submitted references are domain input errors.
  -- Real raw-name UNIQUE constraints remain authoritative and preserve native 23505.
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
  public.save_textbook_settings_draft_v1(uuid, jsonb)
from public, anon;
grant execute on function
  public.save_textbook_settings_draft_v1(uuid, jsonb)
to authenticated;

revoke all on function
  textbook_settings_private.trim_v1(text),
  textbook_settings_private.assert_draft_v1(jsonb)
from public, anon, authenticated;
grant execute on function
  textbook_settings_private.trim_v1(text),
  textbook_settings_private.assert_draft_v1(jsonb)
to authenticated;
