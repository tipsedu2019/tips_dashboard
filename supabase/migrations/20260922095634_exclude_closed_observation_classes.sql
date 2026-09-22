begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Older closed classes may have no closed_at timestamp. Use the same lifecycle
-- as class management in the picker and both new-booking session entry points.
-- Existing observations and their attendance/feedback history remain readable.
do $$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_old constant text := 'and class.closed_at is null';
  v_new constant text := E'and class.closed_at is null\n    and dashboard_private.academic_class_status_v1(\n      class.status, nullif(pg_catalog.btrim(class.start_date), '''')::date, nullif(pg_catalog.btrim(class.end_date), '''')::date\n    ) <> ''종강''';
begin
  foreach v_signature in array array[
    'dashboard_private.registration_observation_manager_detail_rows_v1(uuid,integer)',
    'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)',
    'dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)'
  ] loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'registration_observation_class_lifecycle_dependency_missing'
        using errcode = '55000';
    end if;
    v_definition := pg_catalog.pg_get_functiondef(v_function::oid);
    if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_old, '')
    )) / pg_catalog.length(v_old) <> 1 then
      raise exception 'registration_observation_class_lifecycle_dependency_drift'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
end;
$$;

commit;
