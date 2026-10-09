-- SOURCE-ONLY REVIEW CANDIDATE; NOT INSTALLABLE; SQL/pgTAP/RLS executions 0.
-- New bounded registration event reader, source baseline 90bcd655 + reader draft.
-- Existing rows, policies, table ACLs, roles and event producers are untouched.
-- Only explicit structured contact keys/field names are removed. Arbitrary
-- text, notes, comments, attachments and phone-like values in other keys stay.
-- The narrow new authenticated EXECUTE grant is necessary for an INVOKER RPC;
-- it adds no table permission and retains both task/event RLS. No service-role
-- or anonymous RPC grant; actual catalog/default-ACL/RLS proof remains blocked.
-- Technical page budget 128000 bytes and JSON depth 64, fail closed, no truncation.
-- Timeline LIMIT p_limit<=30; latest valid-v1 legacy-import LIMIT1 preserves
-- the migration-review anchor even when it lies outside the timeline window.
-- The legacy predicate mirrors parseJsonRecord + Number(version)===1 for JSON
-- values, including numeric strings/booleans/singleton arrays. Malformed/non-v1
-- rows are skipped before ORDER/LIMIT, rather than masking an older valid row.
-- This is a bounded timeline plus anchor, not full-history pagination. Actual
-- population, scan cost/latency and budget suitability remain UNKNOWN.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Refuse replacing a preexisting function with unverified owner/body/ACL.
do $preflight$
begin
  if pg_catalog.to_regprocedure('public.read_registration_contact_events_v1(uuid,integer,boolean)') is not null then
    raise exception 'registration_contact_event_reader_target_exists' using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure('dashboard_private.registration_contact_legacy_import_valid_v1(text)') is not null then
    raise exception 'registration_contact_legacy_predicate_target_exists' using errcode = '55000';
  end if;
end $preflight$;

-- Private pure JSON predicate, no table reads or identity lookup. Existing
-- authenticated schema USAGE is required; this draft does not grant schema
-- permissions or expose the helper as a public Data API RPC. Parsing uses the
-- PostgreSQL JSON parser, not a regular-expression approximation of JSON.
-- Float8 conversion matches the mapper's binary64 Number comparison to 1;
-- decimal syntax and ECMAScript trim characters constrain SQL-only spellings.
create function dashboard_private.registration_contact_legacy_import_valid_v1(p_after_value text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $legacy_predicate$
declare
  payload json;
  version_value json;
  version_text text;
  from_array boolean := false;
begin
  if p_after_value is null then return false; end if;
  begin payload := p_after_value::json;
  exception when invalid_text_representation then return false; end;
  if pg_catalog.json_typeof(payload) is distinct from 'object' then return false; end if;
  version_value := payload -> 'version';
  if version_value is null then return false; end if;
  -- Number([x]) uses its singleton string representation; multiple/empty
  -- arrays cannot equal 1. Nested singleton arrays retain that behavior.
  while pg_catalog.json_typeof(version_value)='array' loop
    if pg_catalog.json_array_length(version_value)<>1 then return false; end if;
    version_value := version_value -> 0;
    from_array := true;
  end loop;
  if pg_catalog.json_typeof(version_value)='boolean' then
    return not from_array and version_value::text='true';
  elsif pg_catalog.json_typeof(version_value)='number' then
    version_text := version_value::text;
  elsif pg_catalog.json_typeof(version_value)='string' then
    begin version_text := version_value #>> '{}';
    exception when data_exception then return false; end;
  else return false;
  end if;
  version_text := pg_catalog.btrim(version_text,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if version_text ~ '^0[xX]0*1$' or version_text ~ '^0[oO]0*1$' or version_text ~ '^0[bB]0*1$' then return true; end if;
  if version_text !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return false; end if;
  begin return version_text::double precision = 1::double precision;
  exception when data_exception then return false; end;
end $legacy_predicate$;

create function public.read_registration_contact_events_v1(
  p_task_id uuid,
  p_limit integer,
  p_shared_only boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $reader$
#variable_conflict use_column
declare
  event_row record;
  contact_keys constant text[] := array['contact','parent_contact','parentContact','phone',
    'student_contact','studentContact','student_phone','studentPhone','parent_phone',
    'parentPhone','guardian_contact','guardianContact','guardian_phone','guardianPhone'];
  payload jsonb;
  parsed_payload json;
  removal_path text[];
  raw_value text;
  sanitized_values text[];
  page_bytes bigint := 0;
  output_bytes bigint := 0;
  event_json jsonb;
  events_json jsonb := '[]'::jsonb;
  legacy_json jsonb := 'null'::jsonb;
  response jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'registration_contact_event_reader_auth_required' using errcode = '42501';
  end if;
  if p_task_id is null or p_limit is null or p_limit < 1 or p_limit > 30 or p_shared_only is null then
    raise exception 'registration_contact_event_reader_input_invalid' using errcode = '22023';
  end if;
  -- INVOKER SELECT checks the caller's existing ops_tasks RLS. No fallback to
  -- a service client, definer or an inaccessible/non-registration task.
  if not exists(select 1 from public.ops_tasks task where task.id=p_task_id and task.type='registration') then
    raise exception 'registration_contact_event_reader_task_unavailable' using errcode = '42501';
  end if;
  for event_row in
    select selected.* from (
    select timeline.*,false as legacy_read from (
      select event.id,event.task_id,event.actor_id,event.event_type,event.field_name,
        event.before_value,event.after_value,event.created_at
      from public.ops_task_events event
      where event.task_id=p_task_id
        and (not p_shared_only or public.registration_task_event_shared_visible(event))
      order by event.created_at desc,event.id asc
      limit p_limit
    ) timeline
    union all
    select legacy.*,true as legacy_read from (
      select event.id,event.task_id,event.actor_id,event.event_type,event.field_name,
        event.before_value,event.after_value,event.created_at
      from public.ops_task_events event
      where event.task_id=p_task_id and event.event_type='legacy_registration_imported'
        and (not p_shared_only or public.registration_task_event_shared_visible(event))
        and dashboard_private.registration_contact_legacy_import_valid_v1(event.after_value)
      order by event.created_at desc,event.id asc
      limit 1
    ) legacy
    ) selected order by selected.legacy_read asc,selected.created_at desc,selected.id asc
  loop
    page_bytes := page_bytes + pg_catalog.octet_length(coalesce(event_row.before_value,''))
      + pg_catalog.octet_length(coalesce(event_row.after_value,''))
      + pg_catalog.octet_length(event_row.event_type) + pg_catalog.octet_length(coalesce(event_row.field_name,'')) + 256;
    if page_bytes > 128000 then
      raise exception 'registration_contact_event_reader_page_budget' using errcode = '55000';
    end if;
    sanitized_values := array[]::text[];
    foreach raw_value in array array[event_row.before_value,event_row.after_value] loop
      if event_row.field_name=any(contact_keys) then
        sanitized_values := pg_catalog.array_append(sanitized_values,null::text);
        continue;
      end if;
      if raw_value is null then
        sanitized_values := pg_catalog.array_append(sanitized_values,null::text);
        continue;
      end if;
      begin
        parsed_payload := raw_value::json;
      exception when invalid_text_representation then
        -- Legacy plain-text history is outside structured-key minimization.
        sanitized_values := pg_catalog.array_append(sanitized_values,raw_value);
        continue;
      end;
      begin payload := parsed_payload::jsonb;
      exception when data_exception then
        -- Syntactically valid JSON that jsonb cannot represent (for example
        -- U+0000/numeric overflow) is never echoed as unstructured history.
        raise exception 'registration_contact_event_reader_json_unrepresentable' using errcode='55000';
      end;
      -- Walk nested objects/arrays, then remove object keys at their exact JSON
      -- paths. No substring/phone regex scrub, no array element deletion, and
      -- no guessed schema/identity conversion. Children precede parents.
      for removal_path in
        with recursive nodes(path,value) as (
          select array[]::text[],payload
          union all
          select nodes.path || child.key,child.value
          from nodes
          cross join lateral (
            select entry.key,entry.value
            from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(nodes.value)='object' then nodes.value else '{}'::jsonb end) entry
            union all
            select (entry.ordinality-1)::text,entry.value
            from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(nodes.value)='array' then nodes.value else '[]'::jsonb end)
              with ordinality entry(value,ordinality)
          ) child
          where pg_catalog.cardinality(nodes.path)<=64
        )
        select selected.path from (
          select nodes.path || entry.key as path
          from nodes
          cross join lateral pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(nodes.value)='object' then nodes.value else '{}'::jsonb end) entry
          where entry.key=any(contact_keys)
          union all
          -- Sentinel path exposes depth overflow even if there are no contacts.
          select nodes.path from nodes where pg_catalog.cardinality(nodes.path)>64
        ) selected
        order by pg_catalog.cardinality(selected.path) desc,selected.path
      loop
        if pg_catalog.cardinality(removal_path)>64 then
          raise exception 'registration_contact_event_reader_depth_budget' using errcode = '55000';
        end if;
        payload := payload #- removal_path;
      end loop;
      sanitized_values := pg_catalog.array_append(sanitized_values,payload::text);
    end loop;
    event_json := pg_catalog.jsonb_build_object('id',event_row.id,'task_id',event_row.task_id,
      'actor_id',event_row.actor_id,'event_type',event_row.event_type,'field_name',event_row.field_name,
      'before_value',sanitized_values[1],'after_value',sanitized_values[2],'created_at',event_row.created_at);
    output_bytes := output_bytes + pg_catalog.octet_length(event_json::text) + 2;
    if output_bytes > 128000 then
      raise exception 'registration_contact_event_reader_page_budget' using errcode = '55000';
    end if;
    if event_row.legacy_read then legacy_json:=event_json;
    else events_json:=events_json || pg_catalog.jsonb_build_array(event_json); end if;
  end loop;
  response:=pg_catalog.jsonb_build_object('events',events_json,'legacyImport',legacy_json);
  if pg_catalog.octet_length(response::text)>128000 then
    raise exception 'registration_contact_event_reader_page_budget' using errcode = '55000';
  end if;
  return response;
end $reader$;

alter function public.read_registration_contact_events_v1(uuid,integer,boolean) owner to postgres;
alter function dashboard_private.registration_contact_legacy_import_valid_v1(text) owner to postgres;
revoke all on function public.read_registration_contact_events_v1(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_registration_contact_events_v1(uuid,integer,boolean) to authenticated;
revoke all on function dashboard_private.registration_contact_legacy_import_valid_v1(text) from public,anon,authenticated,service_role;
grant execute on function dashboard_private.registration_contact_legacy_import_valid_v1(text) to authenticated;
do $acl_guard$
declare target pg_catalog.pg_proc%rowtype;
begin
  select * into strict target from pg_catalog.pg_proc
  where oid='public.read_registration_contact_events_v1(uuid,integer,boolean)'::pg_catalog.regprocedure;
  if target.proowner<>'postgres'::pg_catalog.regrole or target.prosecdef
    or target.provolatile<>'s' or target.proretset or target.prorettype<>'jsonb'::pg_catalog.regtype
    or not coalesce('search_path=""'=any(target.proconfig) or 'search_path='=any(target.proconfig),false)
    or exists(select 1 from pg_catalog.aclexplode(coalesce(target.proacl,pg_catalog.acldefault('f',target.proowner))) acl
      where acl.grantee not in ('postgres'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
        or acl.privilege_type<>'EXECUTE'
        or (acl.grantee='authenticated'::pg_catalog.regrole and acl.is_grantable)) then
    raise exception 'registration_contact_event_reader_security_drift' using errcode='55000';
  end if;
  select * into strict target from pg_catalog.pg_proc
  where oid='dashboard_private.registration_contact_legacy_import_valid_v1(text)'::pg_catalog.regprocedure;
  if target.proowner<>'postgres'::pg_catalog.regrole or target.prosecdef
    or target.provolatile<>'i' or target.proretset or target.prorettype<>'boolean'::pg_catalog.regtype
    or not coalesce('search_path=""'=any(target.proconfig) or 'search_path='=any(target.proconfig),false)
    or exists(select 1 from pg_catalog.aclexplode(coalesce(target.proacl,pg_catalog.acldefault('f',target.proowner))) acl
      where acl.grantee not in ('postgres'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
        or acl.privilege_type<>'EXECUTE'
        or (acl.grantee='authenticated'::pg_catalog.regrole and acl.is_grantable)) then
    raise exception 'registration_contact_legacy_predicate_security_drift' using errcode='55000';
  end if;
end $acl_guard$;
commit;
