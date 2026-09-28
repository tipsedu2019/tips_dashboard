-- Stats use only track membership, its director and the latest visit place.
-- Avoid expanding unrelated observation/phone/level-test joins and their RLS
-- plans from the full row summary view on every new database connection.
-- Keep the final filters/aggregation, invoker security, ACL and soft archive.
do $migration$
declare
  target regprocedure := 'dashboard_private.ops_registration_task_stats_v1(jsonb)'::regprocedure;
  function_row record;
  body text;
begin
  select p.*, l.lanname into strict function_row
  from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
  where p.oid=target;
  if function_row.lanname <> 'sql' or function_row.prosecdef
    or function_row.provolatile <> 's'
    or function_row.proargnames <> array['p_filters']
    or function_row.prorettype <> 'jsonb'::regtype
    or not coalesce('search_path=""'=any(function_row.proconfig)
      or 'search_path='=any(function_row.proconfig),false)
    or not coalesce('TimeZone=Asia/Seoul'=any(function_row.proconfig),false)
    or not pg_catalog.has_function_privilege('authenticated',target,'execute')
    or pg_catalog.has_function_privilege('anon',target,'execute')
    or pg_catalog.has_function_privilege('public',target,'execute')
    or pg_catalog.md5(function_row.prosrc) <> 'b407e05137ddf464ade17a50f2a5c8f6' then
    raise exception using errcode='55000',message='registration_stats_summary_definition_drift';
  end if;

  body := pg_catalog.replace(function_row.prosrc,
    'public.ops_registration_subject_track_summaries summary',
    $summary$(
      select track.task_id, track.workflow_status, track.subject,
        track.director_profile_id, active_visit.place as visit_place
      from public.ops_registration_subject_tracks track
      left join lateral (
        select appointment.place
        from public.ops_registration_consultations consultation
        join public.ops_registration_appointments appointment
          on appointment.id = consultation.appointment_id
        where consultation.track_id = track.id
          and consultation.mode = 'visit' and consultation.status = 'scheduled'
          and appointment.kind = 'visit_consultation' and appointment.status = 'scheduled'
        order by consultation.created_at desc, consultation.id desc
        limit 1
      ) active_visit on true
      where track.archived_at is null
    ) summary$summary$);
  execute pg_catalog.format(
    'create or replace function dashboard_private.ops_registration_task_stats_v1(p_filters jsonb)
     returns jsonb language sql stable security invoker
     set search_path = '''' set timezone = ''Asia/Seoul'' as %L', body);
end
$migration$;
