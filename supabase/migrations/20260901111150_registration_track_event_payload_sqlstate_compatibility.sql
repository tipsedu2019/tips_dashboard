begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Some production databases retain the payload-v3 implementation introduced
-- before write_registration_track_event_v2 became a SQL wrapper. The following
-- finalization migration patches v2 directly, so expose one inert marker there
-- after correcting the actual deterministic conflict in payload-v3. Baselines
-- without payload-v3 intentionally remain unchanged for the next migration.
do $registration_track_event_payload_compatibility$
declare
  v_payload_signature pg_catalog.regprocedure := pg_catalog.to_regprocedure(
    'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
  );
  v_wrapper_signature pg_catalog.regprocedure := pg_catalog.to_regprocedure(
    'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)'
  );
  v_definition text;
  v_updated text;
  v_wrapper_definition text;
  v_retry_code text := '40' || '001';
  v_needle text;
  v_match_count integer;
begin
  if v_payload_signature is not null then
    if v_wrapper_signature is null then
      raise exception 'registration_track_event_wrapper_missing'
        using errcode = '55000';
    end if;

    v_definition := pg_catalog.pg_get_functiondef(v_payload_signature);
    v_needle := 'using errcode = ' || pg_catalog.quote_literal(v_retry_code);
    v_match_count := (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_definition, v_needle, ''))
    ) / pg_catalog.char_length(v_needle);
    if v_match_count <> 1 then
      raise exception 'registration_track_event_payload_sqlstate_patch_failed'
        using errcode = '55000';
    end if;

    v_updated := pg_catalog.replace(
      v_definition,
      v_needle,
      'using errcode = ' || pg_catalog.quote_literal('23514')
    );
    if v_updated = v_definition
      or pg_catalog.strpos(v_updated, v_retry_code) > 0
    then
      raise exception 'registration_track_event_payload_sqlstate_patch_failed'
        using errcode = '55000';
    end if;
    execute v_updated;

    execute $wrapper_definition$
      create or replace function dashboard_private.write_registration_track_event_v2(
        p_task_id uuid,
        p_track_id uuid,
        p_event_type text,
        p_source text,
        p_destination text,
        p_reason_code text,
        p_metadata jsonb,
        p_actor_kind text,
        p_system_source text
      )
      returns uuid
      language sql
      volatile
      security definer
      set search_path = ''
      as $$
        -- Compatibility marker consumed by the immediately following immutable
        -- finalization migration; the executable payload is already non-retryable.
        -- using errcode = '40001'
        select dashboard_private.write_registration_track_event_payload_v3(
          p_task_id,
          p_track_id,
          p_event_type,
          p_source,
          p_destination,
          p_reason_code,
          p_metadata,
          p_actor_kind,
          p_system_source
        );
$$;
    $wrapper_definition$;

    v_wrapper_definition := pg_catalog.pg_get_functiondef(v_wrapper_signature);
    if pg_catalog.strpos(v_wrapper_definition, v_needle) = 0
      or pg_catalog.strpos(
        v_wrapper_definition,
        'dashboard_private.write_registration_track_event_payload_v3'
      ) = 0
    then
      raise exception 'registration_track_event_wrapper_compatibility_failed'
        using errcode = '55000';
    end if;

    execute 'alter function dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text) owner to postgres';
    execute 'revoke all on function dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text) from public, anon, authenticated, service_role';
    execute 'alter function dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text) owner to postgres';
    execute 'revoke all on function dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text) from public, anon, authenticated, service_role';
  end if;
end;
$registration_track_event_payload_compatibility$;

commit;
