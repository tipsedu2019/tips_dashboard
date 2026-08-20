begin;

do $migration$
declare
  v_definition text;
  v_legacy_filter constant text := 'track.workflow_status = ''enrollment_requested''';
  v_pipeline_filter constant text := 'track.pipeline_status in (''enrollment_decided'', ''enrollment_processing'')';
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'::pg_catalog.regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_legacy_filter) = 0 then
    raise exception 'registration_admission_preview_active_resolver_filter_missing';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_legacy_filter,
    v_pipeline_filter
  );
  execute v_definition;
end;
$migration$;

commit;
