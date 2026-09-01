-- Extend active-paper output IDs to OX while preserving the full signed snapshot,
-- organization/author ownership, existing signature, and server-only RPC grants.
create or replace function public.record_worksheet_v2_export(
  p_organization_id uuid,
  p_user_id uuid,
  p_project_snapshot jsonb,
  p_content_signature text,
  p_mode text,
  p_paper_kind text,
  p_format public.export_format,
  p_problem_count integer,
  p_renderer_version text,
  p_problem_ids text[] default null
)
returns table (
  history_entry_id uuid,
  export_id uuid,
  export_created_at timestamptz,
  snapshot_created boolean
)
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_document_id uuid;
  v_document_revision integer;
  v_content_signature text;
  v_expected_problem_count integer;
  v_history_entry_id uuid;
  v_export_id uuid;
  v_export_created_at timestamptz;
  v_snapshot_created boolean := false;
begin
  if p_organization_id is null
    or p_user_id is null
    or p_mode is null
    or p_mode not in ('student', 'teacher', 'explanation', 'quick-answer')
    or p_paper_kind is null
    or p_paper_kind not in ('detail-check', 'transformed')
    or p_format is null
    or p_problem_count is null
    or p_problem_count < 0
    or nullif(btrim(p_renderer_version), '') is null
    or nullif(btrim(p_content_signature), '') is null
  then
    raise exception 'invalid worksheet V2 export arguments' using errcode = '23514';
  end if;

  if p_project_snapshot is null
    or (jsonb_typeof(p_project_snapshot) = 'object') is not true
    or (p_project_snapshot ?& array[
      'schemaVersion', 'documentId', 'title', 'school', 'grade', 'className',
      'outputSettings', 'passages', 'detailCheckBatches', 'problems',
      'revision', 'createdAt', 'updatedAt'
    ]) is not true
    or (jsonb_typeof(p_project_snapshot -> 'schemaVersion') = 'number') is not true
    or (p_project_snapshot ->> 'schemaVersion' = '2') is not true
    or (jsonb_typeof(p_project_snapshot -> 'documentId') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'title') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'school') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'grade') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'className') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'outputSettings') = 'object') is not true
    or (jsonb_typeof(p_project_snapshot -> 'passages') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'detailCheckBatches') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'problems') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'revision') = 'number') is not true
    or ((p_project_snapshot ->> 'revision') ~ '^(0|[1-9][0-9]*)$') is not true
    or (jsonb_typeof(p_project_snapshot -> 'createdAt') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'updatedAt') = 'string') is not true
    or ((p_project_snapshot ->> 'documentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true
  then
    raise exception 'invalid worksheet V2 snapshot' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    where (jsonb_typeof(batch.value -> 'sets') = 'array') is not true
  ) or exists (
    select 1
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    cross join lateral jsonb_array_elements(batch.value -> 'sets') detail_set(value)
    where (jsonb_typeof(detail_set.value -> 'items') = 'array') is not true
  ) then
    raise exception 'invalid worksheet V2 detail-check snapshot' using errcode = '23514';
  end if;

  if (p_project_snapshot ->> 'revision')::numeric > 2147483647 then
    raise exception 'worksheet V2 revision is out of range' using errcode = '23514';
  end if;

  if p_paper_kind = 'detail-check' then
    select coalesce(sum(jsonb_array_length(detail_set.value -> 'items')), 0)::integer
    into v_expected_problem_count
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    cross join lateral jsonb_array_elements(batch.value -> 'sets') detail_set(value);

    if p_problem_ids is not null then
      if cardinality(p_problem_ids) = 0
        or cardinality(p_problem_ids) > v_expected_problem_count
        or exists (
          select 1 from unnest(p_problem_ids) selected(item_id)
          where nullif(btrim(selected.item_id), '') is null
        )
        or (select count(distinct selected.item_id) from unnest(p_problem_ids) selected(item_id)) <> cardinality(p_problem_ids)
        or exists (
          select 1 from unnest(p_problem_ids) selected(item_id)
          where not exists (
            select 1
            from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
            cross join lateral jsonb_array_elements(batch.value -> 'sets') detail_set(value)
            cross join lateral jsonb_array_elements(detail_set.value -> 'items') item(value)
            where jsonb_typeof(item.value) = 'object'
              and jsonb_typeof(item.value -> 'id') = 'string'
              and item.value ->> 'id' = selected.item_id
          )
        )
      then
        raise exception 'invalid detail-check item ID selection' using errcode = '23514';
      end if;
      v_expected_problem_count := cardinality(p_problem_ids);
    end if;
  elsif p_problem_ids is null then
    v_expected_problem_count := jsonb_array_length(p_project_snapshot -> 'problems');
  else
    if cardinality(p_problem_ids) = 0
      or cardinality(p_problem_ids) > jsonb_array_length(p_project_snapshot -> 'problems')
      or exists (
        select 1
        from unnest(p_problem_ids) selected(problem_id)
        where nullif(btrim(selected.problem_id), '') is null
      )
      or (
        select count(distinct selected.problem_id)
        from unnest(p_problem_ids) selected(problem_id)
      ) <> cardinality(p_problem_ids)
      or exists (
        select 1
        from unnest(p_problem_ids) selected(problem_id)
        where not exists (
          select 1
          from jsonb_array_elements(p_project_snapshot -> 'problems') problem(value)
          where jsonb_typeof(problem.value) = 'object'
            and jsonb_typeof(problem.value -> 'id') = 'string'
            and problem.value ->> 'id' = selected.problem_id
        )
      )
    then
      raise exception 'invalid transformed problem ID selection' using errcode = '23514';
    end if;

    v_expected_problem_count := cardinality(p_problem_ids);
  end if;

  if p_problem_count <> v_expected_problem_count then
    raise exception 'worksheet V2 export problem count mismatch' using errcode = '23514';
  end if;

  v_document_id := (p_project_snapshot ->> 'documentId')::uuid;
  v_document_revision := (p_project_snapshot ->> 'revision')::integer;
  v_content_signature := btrim(p_content_signature);

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'worksheet organization membership required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_user_id::text || ':' || v_document_id::text || ':' || v_content_signature,
    0
  ));

  select wp.id
  into v_history_entry_id
  from public.worksheet_projects wp
  where wp.organization_id = p_organization_id
    and wp.created_by = p_user_id
    and wp.schema_version = 2
    and wp.document_id = v_document_id
    and wp.content_signature = v_content_signature
    and wp.project_snapshot = p_project_snapshot
    and wp.deleted_at is null
  order by wp.created_at desc, wp.id desc
  limit 1;

  if v_history_entry_id is null then
    insert into public.worksheet_projects (
      organization_id,
      subject,
      title,
      school,
      grade,
      class_name,
      settings,
      created_by,
      schema_version,
      project_snapshot,
      document_id,
      document_revision,
      content_signature
    ) values (
      p_organization_id,
      'english',
      p_project_snapshot ->> 'title',
      p_project_snapshot ->> 'school',
      p_project_snapshot ->> 'grade',
      p_project_snapshot ->> 'className',
      p_project_snapshot -> 'outputSettings',
      p_user_id,
      2,
      p_project_snapshot,
      v_document_id,
      v_document_revision,
      v_content_signature
    )
    returning id into v_history_entry_id;
    v_snapshot_created := true;
  end if;

  insert into public.worksheet_exports (
    worksheet_project_id,
    exported_by,
    mode,
    format,
    problem_count,
    renderer_version,
    render_settings
  ) values (
    v_history_entry_id,
    p_user_id,
    p_mode,
    p_format,
    p_problem_count,
    btrim(p_renderer_version),
    jsonb_build_object(
      'printColumnCount', case when p_paper_kind = 'transformed' then 2 else 1 end,
      'paperKind', p_paper_kind,
      'pageSize', 'A4',
      'orientation', 'portrait'
    ) || case
      when p_problem_ids is null then '{}'::jsonb
      else jsonb_build_object('problemIds', to_jsonb(p_problem_ids))
    end
  )
  returning id, created_at into v_export_id, v_export_created_at;

  return query
  select v_history_entry_id, v_export_id, v_export_created_at, v_snapshot_created;
end;
$function$;

revoke execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, text, public.export_format, integer, text, text[]
) from public, anon, authenticated;
grant execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, text, public.export_format, integer, text, text[]
) to service_role;

-- V4 stays available for old deployments, but only checks the RPC signature.
-- Pin this exact validated OX body as a fail-closed capability fingerprint.
-- MD5 is not an authentication hash here. A later RPC body change must update
-- this fingerprint and re-run the selected-output/ownership contract tests.
create function public.worksheet_v5_ox_export_projection_contract_ready()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $readiness$
  select exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.record_worksheet_v2_export(uuid,uuid,jsonb,text,text,text,public.export_format,integer,text,text[])'
    )
      and not p.prosecdef
      and pg_catalog.md5(p.prosrc) = 'dc8a374f5dd13b64aa9e7bad980b1450'
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and (
        select count(*) = 1
        from pg_catalog.pg_proc candidate
        join pg_catalog.pg_namespace namespace on namespace.oid = candidate.pronamespace
        where namespace.nspname = 'public'
          and candidate.proname = 'record_worksheet_v2_export'
      )
  );
$readiness$;

revoke execute on function public.worksheet_v5_ox_export_projection_contract_ready()
  from public, anon, authenticated;
grant execute on function public.worksheet_v5_ox_export_projection_contract_ready()
  to service_role;
