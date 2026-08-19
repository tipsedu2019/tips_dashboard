begin;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'track.workflow_status = ''enrollment_requested''',
    'track.pipeline_status in (''enrollment_decided'', ''enrollment_processing'')'
  );
  execute v_definition;

  select pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'track.workflow_status = ''enrollment_requested''',
    'track.pipeline_status in (''enrollment_decided'', ''enrollment_processing'')'
  );
  execute v_definition;
end;
$migration$;

commit;
