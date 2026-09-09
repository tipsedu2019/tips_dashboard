begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Since flat registration separates manual workflow labels from saved facts,
-- a planned, unbatched enrollment may legitimately keep an inquiry label.
-- Change only admission selection in the final delegated resolver and its
-- per-enrollment plan reader. Keep their locks, identity, schedule, duplicate
-- message checks and existing public service-role boundary intact.
do $registration_admission_preview_saved_facts$
declare
  v_definition text;
  v_updated text;
  v_status_filter constant text :=
    'track.pipeline_status in (''enrollment_decided'', ''enrollment_processing'')';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_filter, '')))
      / pg_catalog.length(v_status_filter) <> 2
    or pg_catalog.regexp_count(v_definition, 'track\.archived_at is null') < 5
    or pg_catalog.strpos(v_definition, 'enrollment.status = ''planned''') = 0
    or pg_catalog.strpos(v_definition, 'enrollment.admission_batch_id is null') = 0
    or pg_catalog.strpos(v_definition, 'registration_customer_message_admission_already_sent') = 0
  then
    raise exception 'registration_admission_saved_facts_resolver_drift'
      using errcode = '55000';
  end if;
  v_updated := pg_catalog.replace(
    v_definition, v_status_filter, 'not track.migration_review_required'
  );
  execute v_updated;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_filter, '')))
      / pg_catalog.length(v_status_filter) <> 1
    or pg_catalog.strpos(v_definition, 'v_enrollment.status <> ''planned''') = 0
    or pg_catalog.strpos(v_definition, 'v_enrollment.admission_batch_id is not null') = 0
  then
    raise exception 'registration_admission_saved_facts_plan_drift'
      using errcode = '55000';
  end if;
  v_updated := pg_catalog.replace(
    v_definition,
    v_status_filter,
    'track.archived_at is null and not track.migration_review_required'
  );
  execute v_updated;
end;
$registration_admission_preview_saved_facts$;

alter function dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text, uuid)
  from public, anon, authenticated, service_role;
alter function dashboard_private.registration_customer_message_admission_plan_v1(uuid, integer)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_admission_plan_v1(uuid, integer)
  from public, anon, authenticated, service_role;

commit;
