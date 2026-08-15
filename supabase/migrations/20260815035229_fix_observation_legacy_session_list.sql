begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  v_function regprocedure := pg_catalog.to_regprocedure(
    'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)'
  );
  v_definition text;
  v_old_filter constant text := E'        and (\n          slot_fact.slot_count <> 1\n          or (dated.session_date + slot_fact.start_time) at time zone ''Asia/Seoul''\n            > pg_catalog.now()\n        )';
  v_new_filter constant text := E'        and slot_fact.slot_count > 0\n        and (\n          slot_fact.slot_count > 1\n          or (dated.session_date + slot_fact.start_time) at time zone ''Asia/Seoul''\n            > pg_catalog.now()\n        )';
  v_old_ambiguity constant text := '        enriched.slot_count <> 1 as time_ambiguous,';
  v_new_ambiguity constant text := '        enriched.slot_count > 1 as time_ambiguous,';
begin
  if v_function is null then
    raise exception 'registration_observation_session_list_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_function::oid)
  into v_definition;

  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_filter, ''))
  ) / pg_catalog.length(v_old_filter) is distinct from 1
    or (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_ambiguity, ''))
    ) / pg_catalog.length(v_old_ambiguity) is distinct from 1
  then
    raise exception 'registration_observation_session_list_dependency_drift'
      using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_filter, v_new_filter);
  v_definition := pg_catalog.replace(v_definition, v_old_ambiguity, v_new_ambiguity);
  execute v_definition;

  select pg_catalog.pg_get_functiondef(v_function::oid)
  into v_definition;
  if pg_catalog.strpos(v_definition, v_new_filter) = 0
    or pg_catalog.strpos(v_definition, v_new_ambiguity) = 0
    or pg_catalog.strpos(
      v_definition,
      'dashboard_private.registration_observation_effective_legacy_slots_v1(p_class_id) slot'
    ) = 0
  then
    raise exception 'registration_observation_session_list_install_failed'
      using errcode = '55000';
  end if;
end;
$$;

commit;
