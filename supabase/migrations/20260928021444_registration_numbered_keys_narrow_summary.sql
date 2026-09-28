-- Numbered pages select keys before building full row DTOs.
-- Keep only fields needed for registration membership, search and phone order;
-- the final DTO projection still uses the complete security-invoker summary.
do $migration$
declare
  target regprocedure := 'dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::regprocedure;
  definition text;
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(target)) <> '3a4bbc27fa126eae7bb5b5ee88b3b7b4'
    or not pg_catalog.has_function_privilege('authenticated',target,'execute')
    or pg_catalog.has_function_privilege('anon',target,'execute')
    or pg_catalog.has_function_privilege('public',target,'execute') then
    raise exception using errcode='55000',message='registration_numbered_keys_definition_drift';
  end if;

  definition := pg_catalog.pg_get_functiondef(target);
  definition := pg_catalog.replace(definition,
    'public.ops_registration_subject_track_summaries summary',
    $summary$(
        select track.id, track.task_id, track.subject, track.pipeline_status,
          track.workflow_status, track.director_profile_id,
          active_visit.place as visit_place, active_phone.ready_at as phone_ready_at
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
        left join lateral (
          select consultation.ready_at
          from public.ops_registration_consultations consultation
          where consultation.track_id = track.id
            and consultation.mode = 'phone' and consultation.status = 'waiting'
          order by consultation.created_at desc, consultation.id desc
          limit 1
        ) active_phone on true
        where track.archived_at is null
      ) summary$summary$);
  definition := pg_catalog.replace(definition,
    'public.ops_registration_subject_track_summaries search_track',
    '(select task_id, workflow_status, director_profile_id, subject
              from public.ops_registration_subject_tracks where archived_at is null) search_track');
  definition := pg_catalog.replace(definition,
    'public.ops_registration_subject_track_summaries active_track',
    '(select task_id from public.ops_registration_subject_tracks
              where archived_at is null) active_track');

  -- Reuse the complete signature/configuration, retaining invoker security,
  -- existing custom-plan behavior, volatility, ownership and execution grants.
  execute definition;
end
$migration$;
