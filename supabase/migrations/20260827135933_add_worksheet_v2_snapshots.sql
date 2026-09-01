alter table public.worksheet_projects
  add column if not exists schema_version smallint not null default 1,
  add column if not exists project_snapshot jsonb,
  add column if not exists document_id uuid,
  add column if not exists document_revision integer,
  add column if not exists content_signature text;

alter table public.worksheet_projects
  add constraint worksheet_projects_v2_snapshot_check check (
    schema_version <> 2 or (
      project_snapshot is not null
      and (jsonb_typeof(project_snapshot) = 'object') is true
      and (project_snapshot ?& array['schemaVersion', 'documentId', 'revision']) is true
      and (jsonb_typeof(project_snapshot -> 'schemaVersion') = 'number') is true
      and (project_snapshot ->> 'schemaVersion' = '2') is true
      and (jsonb_typeof(project_snapshot -> 'documentId') = 'string') is true
      and (jsonb_typeof(project_snapshot -> 'revision') = 'number') is true
      and ((project_snapshot ->> 'revision') ~ '^(0|[1-9][0-9]*)$') is true
      and document_id is not null
      and document_revision is not null
      and document_revision >= 0
      and (document_id::text = lower(project_snapshot ->> 'documentId')) is true
      and (document_revision::text = project_snapshot ->> 'revision') is true
      and nullif(btrim(content_signature), '') is not null
    ) is true
  ) not valid;

alter table public.worksheet_projects
  validate constraint worksheet_projects_v2_snapshot_check;

create index if not exists worksheet_projects_v2_exact_active_idx
on public.worksheet_projects(organization_id, document_id, content_signature, created_at desc)
where schema_version = 2 and deleted_at is null;

revoke insert, update, delete on public.worksheet_projects from anon, authenticated;
revoke insert, update, delete on public.worksheet_exports from anon, authenticated;

drop policy if exists "members can manage worksheet projects"
  on public.worksheet_projects;
create policy "members can read worksheet projects"
  on public.worksheet_projects
  for select
  to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = worksheet_projects.organization_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert worksheet exports"
  on public.worksheet_exports;

create or replace function public.record_worksheet_v2_export(
  p_organization_id uuid,
  p_user_id uuid,
  p_project_snapshot jsonb,
  p_content_signature text,
  p_mode text,
  p_format public.export_format,
  p_problem_count integer,
  p_renderer_version text
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
  v_history_entry_id uuid;
  v_export_id uuid;
  v_export_created_at timestamptz;
  v_snapshot_created boolean := false;
begin
  if p_organization_id is null
    or p_user_id is null
    or p_mode is null
    or p_mode not in ('student', 'teacher', 'explanation')
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

  if (p_project_snapshot ->> 'revision')::numeric > 2147483647 then
    raise exception 'worksheet V2 revision is out of range' using errcode = '23514';
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
    p_organization_id::text || ':' || v_document_id::text || ':' || v_content_signature,
    0
  ));

  select wp.id
  into v_history_entry_id
  from public.worksheet_projects wp
  where wp.organization_id = p_organization_id
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
    p_project_snapshot -> 'outputSettings'
  )
  returning id, created_at into v_export_id, v_export_created_at;

  return query
  select v_history_entry_id, v_export_id, v_export_created_at, v_snapshot_created;
end;
$function$;

revoke execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, public.export_format, integer, text
) from public, anon, authenticated;
grant execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, public.export_format, integer, text
) to service_role;
grant usage on schema public to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.organizations to service_role;
grant select, insert on public.organization_members to service_role;
grant select, insert, update on public.worksheet_projects to service_role;
grant select, insert on public.worksheet_exports to service_role;
