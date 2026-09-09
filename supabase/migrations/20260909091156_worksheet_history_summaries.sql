set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Read-only server projection; full snapshots remain on the detail endpoint.
create view public.worksheet_history_summaries
with (security_invoker = true) as
select id, organization_id, created_by, schema_version, deleted_at,
  document_id, document_revision, content_signature,
  title, school, grade, class_name, created_at,
  jsonb_array_length(project_snapshot -> 'passages') as passage_count,
  jsonb_array_length(jsonb_path_query_array(project_snapshot,
    '$.detailCheckBatches[*].sets[*].items[*]')) as detail_check_count,
  jsonb_array_length(project_snapshot -> 'problems') as problem_count
from public.worksheet_projects
where schema_version = 2 and deleted_at is null;

revoke all on public.worksheet_history_summaries from public, anon, authenticated, service_role;
grant select on public.worksheet_history_summaries to service_role;
comment on view public.worksheet_history_summaries is
  'Server-only V2 history summaries. Callers must filter organization_id and created_by; detail loads validate the full signed snapshot.';
