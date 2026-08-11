begin;
select plan(107);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select pg_catalog.set_config(
  'test.registration_enrollment_key_a',
  pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD') || ':7',
  true
);
select pg_catalog.set_config(
  'test.registration_enrollment_key_b',
  pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD') || ':8',
  true
);
select pg_catalog.set_config(
  'test.registration_enrollment_key_legacy_b',
  pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD') || ':88',
  true
);
select pg_catalog.set_config(
  'test.registration_enrollment_key_regular',
  pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD') || ':1',
  true
);

create extension if not exists dblink;

-- Mutation-sensitive coverage map. The executable cases below bind the
-- completed attended fit enrollment historical source, unfit, no-show,
-- canceled, wrong task, missing decision, id-less draft, ambiguous draft,
-- runtime 0, same-fingerprint replay, consultation_completed details bypass,
-- literal canonical-rows key, row audit failure, recompute failure,
-- details audit failure, outer receipt failure, concurrent activation,
-- single winner,
-- registration_observation_runtime_deactivate_v1, and provider-zero contract.
-- The shared runner owns committed cross-session fixtures and cleanup; this
-- transaction owns rollback-only domain branch fixtures.
-- Calendar matrix: first ten calendar columns.
-- level-test appended observation columns are null.
-- visit appended observation columns are null.
-- one observation appointment yields exactly one row.
-- one-element track and subject arrays.
-- active admin; active staff; exact director; assigned teacher; unrelated actor.
-- registration_appointment_track_ids_v1;
-- security_invoker=true; schemaReady; missingObjects.

select has_column(
  'public', 'ops_registration_enrollments',
  'class_start_source_observation_id',
  'observation source column exists'
);
select col_type_is(
  'public', 'ops_registration_enrollments',
  'class_start_source_observation_id', 'uuid',
  'observation source column keeps uuid type'
);
select has_index(
  'public', 'ops_registration_enrollments',
  'ops_registration_enrollments_class_start_source_observation_id_idx',
  'observation source partial lookup index exists'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table
      on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_schema
      on source_schema.oid = source_table.relnamespace
    where source_schema.nspname = 'public'
      and source_table.relname = 'ops_registration_enrollments'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid =
        'public.ops_registration_observations'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
        like '%class_start_source_observation_id%'
  ),
  'source foreign key is ON DELETE RESTRICT'
);
select trigger_is(
  'public', 'ops_registration_enrollments',
  'ops_registration_enrollments_sync_lesson_session',
  'dashboard_private',
  'sync_registration_enrollment_lesson_session_v1',
  'one final-value enrollment trigger is installed'
);

select function_returns(
  'dashboard_private',
  'validate_registration_observation_class_start_source_v1',
  array['uuid','uuid','uuid','date','text','uuid'],
  'jsonb',
  'historical source validator keeps exact signature'
);
select function_returns(
  'dashboard_private',
  'normalize_registration_enrollment_rows_request_v1',
  array['jsonb'], 'jsonb',
  'pure request normalizer keeps exact signature'
);
select function_returns(
  'dashboard_private',
  'save_registration_enrollment_rows_canonical_v1',
  array['uuid','jsonb','uuid'], 'jsonb',
  'receipt-free canonical DML keeps exact signature'
);
select function_returns(
  'public', 'save_registration_enrollment_rows',
  array['uuid','jsonb','text'], 'jsonb',
  'public enrollment rows wrapper keeps exact signature'
);
select function_returns(
  'dashboard_private', 'save_registration_enrollment_details_impl',
  array['uuid','jsonb','text'], 'jsonb',
  'details implementation keeps exact signature'
);
select function_returns(
  'dashboard_private', 'registration_appointment_track_ids_v1',
  array['uuid'], 'uuid[]',
  'calendar participant helper keeps exact signature'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'validatorDefiner', validator.prosecdef,
      'normalizerDefiner', normalizer.prosecdef,
      'canonicalDefiner', canonical.prosecdef,
      'wrapperDefiner', wrapper.prosecdef,
      'detailsDefiner', details.prosecdef,
      'triggerDefiner', trigger_proc.prosecdef,
      'helperDefiner', helper.prosecdef,
      'owners', pg_catalog.jsonb_build_array(
        validator_owner.rolname, normalizer_owner.rolname,
        canonical_owner.rolname, wrapper_owner.rolname,
        details_owner.rolname, trigger_owner.rolname, helper_owner.rolname
      ),
      'searchPaths', pg_catalog.jsonb_build_array(
        validator.proconfig, normalizer.proconfig, canonical.proconfig,
        wrapper.proconfig, details.proconfig, trigger_proc.proconfig,
        helper.proconfig
      )
    )
    from pg_catalog.pg_proc validator
    join pg_catalog.pg_roles validator_owner on validator_owner.oid = validator.proowner
    cross join pg_catalog.pg_proc normalizer
    join pg_catalog.pg_roles normalizer_owner on normalizer_owner.oid = normalizer.proowner
    cross join pg_catalog.pg_proc canonical
    join pg_catalog.pg_roles canonical_owner on canonical_owner.oid = canonical.proowner
    cross join pg_catalog.pg_proc wrapper
    join pg_catalog.pg_roles wrapper_owner on wrapper_owner.oid = wrapper.proowner
    cross join pg_catalog.pg_proc details
    join pg_catalog.pg_roles details_owner on details_owner.oid = details.proowner
    cross join pg_catalog.pg_proc trigger_proc
    join pg_catalog.pg_roles trigger_owner on trigger_owner.oid = trigger_proc.proowner
    cross join pg_catalog.pg_proc helper
    join pg_catalog.pg_roles helper_owner on helper_owner.oid = helper.proowner
    where validator.oid = 'dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)'::pg_catalog.regprocedure
      and normalizer.oid = 'dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)'::pg_catalog.regprocedure
      and canonical.oid = 'dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)'::pg_catalog.regprocedure
      and wrapper.oid = 'public.save_registration_enrollment_rows(uuid,jsonb,text)'::pg_catalog.regprocedure
      and details.oid = 'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)'::pg_catalog.regprocedure
      and trigger_proc.oid = 'dashboard_private.sync_registration_enrollment_lesson_session_v1()'::pg_catalog.regprocedure
      and helper.oid = 'dashboard_private.registration_appointment_track_ids_v1(uuid)'::pg_catalog.regprocedure
  ),
  '{"validatorDefiner":true,"normalizerDefiner":false,"canonicalDefiner":true,"wrapperDefiner":true,"detailsDefiner":true,"triggerDefiner":true,"helperDefiner":true,"owners":["postgres","postgres","postgres","postgres","postgres","postgres","postgres"],"searchPaths":[["search_path=\"\""],["search_path=\"\""],["search_path=\"\""],["search_path=\"\""],["search_path=\"\""],["search_path=\"\""],["search_path=\"\""]]}'::jsonb,
  'all enrollment bridges are postgres-owned with the exact definer and empty-search-path matrix'
);
select is(
  pg_catalog.jsonb_build_object(
    'authenticatedRows', pg_catalog.has_function_privilege('authenticated', 'public.save_registration_enrollment_rows(uuid,jsonb,text)', 'EXECUTE'),
    'anonRows', pg_catalog.has_function_privilege('anon', 'public.save_registration_enrollment_rows(uuid,jsonb,text)', 'EXECUTE'),
    'serviceRows', pg_catalog.has_function_privilege('service_role', 'public.save_registration_enrollment_rows(uuid,jsonb,text)', 'EXECUTE'),
    'authenticatedDetailsImpl', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)', 'EXECUTE'),
    'authenticatedCanonical', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', 'EXECUTE'),
    'authenticatedNormalizer', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)', 'EXECUTE'),
    'authenticatedValidator', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)', 'EXECUTE'),
    'authenticatedLegacy', pg_catalog.has_function_privilege('authenticated', 'public.save_registration_enrollment_rows_legacy_v1(uuid,jsonb,text)', 'EXECUTE'),
    'authenticatedOldImpl', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.save_registration_enrollment_rows_impl(uuid,jsonb,text)', 'EXECUTE'),
    'authenticatedTrigger', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.sync_registration_enrollment_lesson_session_v1()', 'EXECUTE'),
    'authenticatedHelper', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.registration_appointment_track_ids_v1(uuid)', 'EXECUTE')
  ),
  '{"authenticatedRows":true,"anonRows":false,"serviceRows":false,"authenticatedDetailsImpl":true,"authenticatedCanonical":false,"authenticatedNormalizer":false,"authenticatedValidator":false,"authenticatedLegacy":false,"authenticatedOldImpl":false,"authenticatedTrigger":false,"authenticatedHelper":false}'::jsonb,
  'only the two intended authenticated enrollment call chains remain executable'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      ) order by attribute.attnum
    )
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
      'public.ops_registration_appointment_calendar'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  '[{"name":"appointment_id","type":"uuid"},{"name":"task_id","type":"uuid"},{"name":"student_name","type":"text"},{"name":"kind","type":"text"},{"name":"scheduled_at","type":"timestamp with time zone"},{"name":"place","type":"text"},{"name":"status","type":"text"},{"name":"notification_revision","type":"integer"},{"name":"track_ids","type":"uuid[]"},{"name":"subjects","type":"text[]"},{"name":"observation_id","type":"uuid"},{"name":"observation_track_id","type":"uuid"},{"name":"observation_class_id","type":"uuid"},{"name":"observation_class_name","type":"text"},{"name":"observation_ends_at","type":"timestamp with time zone"},{"name":"observation_teacher_name","type":"text"},{"name":"observation_classroom_name","type":"text"}]'::jsonb,
  'first ten calendar columns and seven observation columns preserve exact order and type'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid =
      'public.ops_registration_appointment_calendar'::pg_catalog.regclass
      and 'security_invoker=true' = any(relation.reloptions)
  ),
  'calendar reloptions include security_invoker=true'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_appointment_track_ids_v1(uuid)'::pg_catalog.regprocedure
  ) ~ 'ops_registration_level_tests'
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_appointment_track_ids_v1(uuid)'::pg_catalog.regprocedure
  ) ~ 'ops_registration_consultations'
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_appointment_track_ids_v1(uuid)'::pg_catalog.regprocedure
  ) ~ 'ops_registration_observations'
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_appointment_track_ids_v1(uuid)'::pg_catalog.regprocedure
  ) ~ 'observation_class',
  'registration_appointment_track_ids_v1 keeps old branches and adds observation_class'
);
select is(
  pg_catalog.jsonb_build_object(
    'authenticatedSelect', pg_catalog.has_table_privilege('authenticated', 'public.ops_registration_appointment_calendar', 'SELECT'),
    'anonSelect', pg_catalog.has_table_privilege('anon', 'public.ops_registration_appointment_calendar', 'SELECT'),
    'serviceSelect', pg_catalog.has_table_privilege('service_role', 'public.ops_registration_appointment_calendar', 'SELECT')
  ),
  '{"authenticatedSelect":true,"anonSelect":false,"serviceSelect":false}'::jsonb,
  'calendar direct SELECT is authenticated-only'
);

do $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000001',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
end;
$$;

select is(
  public.registration_observation_schema_readiness_v1() ->> 'schemaReady',
  'true',
  'schemaReady is true after the exact enrollment and calendar dependencies exist'
);
select is(
  public.registration_observation_schema_readiness_v1() -> 'missingObjects',
  '[]'::jsonb,
  'missingObjects is empty only for the complete Task 6 dependency set'
);

select is(
  dashboard_private.normalize_registration_enrollment_rows_request_v1(
    '[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0}]'::jsonb
  ),
  '[{"id":null,"classId":"99300000-0000-4000-8000-000000000103","textbookId":null,"classStartDate":null,"classStartSessionKey":null,"classStartLessonSessionId":null,"classStartSession":null,"classStartSourceObservationId":null,"sortOrder":0}]'::jsonb,
  'normalizer emits all nine exact keys for absent optional values'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('{}'::jsonb)$$,
  '22023', 'registration_enrollment_rows_invalid',
  'normalizer rejects a non-array request'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0,"provider":"send"}]'::jsonb)$$,
  '22023', 'registration_enrollment_rows_unknown_key',
  'normalizer rejects unknown provider-shaped keys'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('[{"classId":"bad","sortOrder":0}]'::jsonb)$$,
  '22023', 'registration_enrollment_rows_invalid',
  'normalizer rejects malformed UUID values'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0.5}]'::jsonb)$$,
  '22023', 'registration_enrollment_rows_invalid',
  'normalizer rejects non-integer sortOrder values'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0},{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":1}]'::jsonb)$$,
  '22023', 'registration_enrollment_rows_duplicate_class',
  'batch duplicate class IDs fail closed before writes'
);
select throws_ok(
  $$select dashboard_private.normalize_registration_enrollment_rows_request_v1('[{"id":"99300000-0000-4000-8000-000000000199","classId":"99300000-0000-4000-8000-000000000103","sortOrder":0},{"id":"99300000-0000-4000-8000-000000000199","classId":"99300000-0000-4000-8000-000000000113","sortOrder":1}]'::jsonb)$$,
  '22023', 'registration_enrollment_rows_duplicate_id',
  'duplicate supplied enrollment IDs fail closed before writes'
);

select is(
  (
    select setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  0,
  'committed enrollment fixture starts at runtime 0'
);
select is(
  (
    select pg_catalog.count(*)
    from public.ops_registration_observations observation
    where observation.id = '99300000-0000-4000-8000-000000000108'
      and observation.status = 'completed'
      and observation.attendance = 'attended'
      and observation.suitability_result = 'fit'
      and observation.decision_kind = 'enrollment'
  ),
  1::bigint,
  'committed eligible observation fixture exists before concurrent activation'
);

-- Committed concurrent activation: both workers must overlap on the singleton
-- runtime lock. One real RPC commits 0 -> 1, the other loses with 55000, and
-- the winner's original request key remains replayable.
create temporary table registration_observation_activation_results (
  worker text primary key,
  result_sqlstate text not null,
  response jsonb,
  message text
) on commit drop;

create function pg_temp.registration_observation_activation_waiting_workers()
returns bigint
language plpgsql
as $$
declare
  v_waiting bigint := 0;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
begin
  loop
    select pg_catalog.count(*)
    into v_waiting
    from pg_catalog.pg_stat_activity activity
    where activity.application_name in (
      'enrollment_activation_a',
      'enrollment_activation_b'
    )
      and activity.wait_event_type = 'Lock'
      and pg_catalog.cardinality(
        pg_catalog.pg_blocking_pids(activity.pid)
      ) > 0;
    exit when v_waiting = 2
      or pg_catalog.clock_timestamp() >= v_deadline;
    perform pg_catalog.pg_sleep(0.02);
  end loop;
  return v_waiting;
end;
$$;

select dblink_connect(
  'enrollment_activation_blocker',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=enrollment_activation_blocker'
);
select dblink_connect(
  'enrollment_activation_a',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=enrollment_activation_a'
);
select dblink_connect(
  'enrollment_activation_b',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=enrollment_activation_b'
);
select dblink_exec('enrollment_activation_blocker', 'begin');
select dblink_exec('enrollment_activation_blocker', $remote$
  do $blocker$
  begin
    perform setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
    for update;
    if not found then
      raise exception 'enrollment_activation_blocker_target_missing';
    end if;
  end;
  $blocker$;
$remote$);
select dblink_exec(connection_name, $remote$
  create or replace function pg_temp.registration_observation_activation_capture(
    p_request_key text
  )
  returns table(result_sqlstate text, response jsonb, message text)
  language plpgsql
  as $capture$
  begin
    begin
      response := public.activate_registration_observation_runtime_v1(
        0,
        p_request_key
      );
      result_sqlstate := '00000';
      message := null;
      return next;
    exception
      when others then
        get stacked diagnostics
          result_sqlstate = returned_sqlstate,
          message = message_text;
        response := null;
        return next;
    end;
  end;
  $capture$;
  do $actor$
  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      '99300000-0000-4000-8000-000000000001',
      false
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role', 'authenticated', false
    );
  end;
  $actor$;
  set role authenticated;
$remote$)
from (values ('enrollment_activation_a'), ('enrollment_activation_b'))
  connection(connection_name);

select dblink_send_query(
  'enrollment_activation_a',
  $$select * from pg_temp.registration_observation_activation_capture(
    'enrollment-concurrent-activation-a'
  )$$
);
select dblink_send_query(
  'enrollment_activation_b',
  $$select * from pg_temp.registration_observation_activation_capture(
    'enrollment-concurrent-activation-b'
  )$$
);
select is(
  pg_temp.registration_observation_activation_waiting_workers(),
  2::bigint,
  'both concurrent activation workers overlap on the committed runtime row lock'
);
select dblink_exec('enrollment_activation_blocker', 'rollback');
insert into registration_observation_activation_results
select 'a', result.*
from dblink_get_result('enrollment_activation_a')
  as result(result_sqlstate text, response jsonb, message text);
insert into registration_observation_activation_results
select 'b', result.*
from dblink_get_result('enrollment_activation_b')
  as result(result_sqlstate text, response jsonb, message text);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'successes', pg_catalog.count(*) filter (
        where result_sqlstate = '00000'
      ),
      'rejected', pg_catalog.count(*) filter (
        where result_sqlstate = '55000'
          and message = 'registration_observation_runtime_transition_rejected'
      )
    )
    from registration_observation_activation_results
  ),
  '{"successes":1,"rejected":1}'::jsonb,
  'concurrent activation has a single winner and one transition rejection'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'runtimeVersion', setting.activation_version,
      'updatedBy', setting.updated_by,
      'receipts', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.actor_profile_id =
          '99300000-0000-4000-8000-000000000001'
          and request.operation = 'activate'
          and request.request_key in (
            'enrollment-concurrent-activation-a',
            'enrollment-concurrent-activation-b'
          )
      )
    )
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  '{"runtimeVersion":1,"updatedBy":"99300000-0000-4000-8000-000000000001","receipts":1}'::jsonb,
  'single activation winner commits runtime 1, actor and one receipt'
);

create temporary table registration_observation_activation_replay
on commit drop
as
select public.activate_registration_observation_runtime_v1(
  0,
  case worker
    when 'a' then 'enrollment-concurrent-activation-a'
    else 'enrollment-concurrent-activation-b'
  end
) as response
from registration_observation_activation_results
where result_sqlstate = '00000';

select is(
  (select response from registration_observation_activation_replay),
  (
    select response
    from registration_observation_activation_results
    where result_sqlstate = '00000'
  ),
  'same activation request replays the identical committed response'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.registration_observation_mutation_requests request
    where request.actor_profile_id =
      '99300000-0000-4000-8000-000000000001'
      and request.operation = 'activate'
      and request.request_key in (
        'enrollment-concurrent-activation-a',
        'enrollment-concurrent-activation-b'
      )
  ),
  1::bigint,
  'activation replay creates no second receipt'
);
select dblink_disconnect('enrollment_activation_a');
select dblink_disconnect('enrollment_activation_b');
select dblink_disconnect('enrollment_activation_blocker');

-- A paid admission row makes the finance fingerprint non-empty. Enrollment
-- source and calendar workflow operations must never change it or create a
-- provider/domain event.
insert into public.ops_registration_admission_batches(
  id,
  task_id,
  revision_number,
  status,
  invoice_sent_at,
  payment_confirmed_at
) values (
  '99300000-0000-4000-8000-000000000190',
  '99300000-0000-4000-8000-000000000105',
  99,
  'paid',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '1 day'
);

create function pg_temp.registration_observation_enrollment_finance_state()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'admissionCount', pg_catalog.count(*),
    'paymentCount', pg_catalog.count(*) filter (
      where admission.payment_confirmed_at is not null
    ),
    'hash', pg_catalog.md5(coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(admission)
          - 'created_at' - 'updated_at'
        order by admission.id
      )::text,
      '[]'
    ))
  )
  from public.ops_registration_admission_batches admission
  where admission.task_id =
    '99300000-0000-4000-8000-000000000105';
$$;

create temporary table registration_observation_finance_baseline
on commit drop
as select pg_temp.registration_observation_enrollment_finance_state() as state;

create temporary table registration_observation_task_update_counter (
  update_count integer not null
) on commit drop;
insert into registration_observation_task_update_counter values (0);
create function pg_temp.registration_observation_count_task_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update pg_temp.registration_observation_task_update_counter
  set update_count = update_count + 1;
  return new;
end;
$$;
create trigger registration_observation_count_task_update
after update on public.ops_tasks
for each row
when (new.id = '99300000-0000-4000-8000-000000000105'::uuid)
execute function pg_temp.registration_observation_count_task_update();

create temporary table registration_observation_details_baseline
on commit drop
as
select
  (
    select pg_catalog.count(*)
    from public.ops_task_events event
    where event.task_id = '99300000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type' = 'enrollment_rows_saved'
  ) as row_events,
  (
    select pg_catalog.count(*)
    from public.ops_task_events event
    where event.task_id = '99300000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type' =
        'registration_enrollment_details_saved'
  ) as detail_events,
  (
    select pg_catalog.count(*)
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
  ) as receipts;

-- This fresh connection runs before the local details transaction takes the
-- track row lock. It proves no session-local bypass exists on a new backend.
select dblink_connect(
  'enrollment_guc_fresh',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=enrollment_guc_fresh'
);
select dblink_exec('enrollment_guc_fresh', $remote$
  create or replace function pg_temp.registration_observation_rows_capture()
  returns table(result_sqlstate text, message text)
  language plpgsql
  as $capture$
  begin
    begin
      perform public.save_registration_enrollment_rows(
        '99300000-0000-4000-8000-000000000106',
        '[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0}]'::jsonb,
        'enrollment-direct-fresh-after-details'
      );
      result_sqlstate := '00000';
      message := null;
      return next;
    exception
      when others then
        get stacked diagnostics
          result_sqlstate = returned_sqlstate,
          message = message_text;
        return next;
    end;
  end;
  $capture$;
  do $actor$
  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      '99300000-0000-4000-8000-000000000001',
      false
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role', 'authenticated', false
    );
  end;
  $actor$;
  set role authenticated;
$remote$);
create temporary table registration_observation_fresh_direct_result
on commit drop
as
select result.*
from dblink(
  'enrollment_guc_fresh',
  'select * from pg_temp.registration_observation_rows_capture()'
) as result(result_sqlstate text, message text);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'sqlstate', result_sqlstate,
      'message', message,
      'receiptCount', (
        select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.request_key = 'enrollment-direct-fresh-after-details'
      )
    )
    from registration_observation_fresh_direct_result
  ),
  '{"sqlstate":"40001","message":"registration_invalid_source_state","receiptCount":0}'::jsonb,
  'details GUC is transaction-local and a fresh direct rows connection still fails consultation_completed state'
);
select dblink_disconnect('enrollment_guc_fresh');

create temporary table registration_observation_details_response
on commit drop
as
select public.save_registration_enrollment_details_v1(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', '99300000-0000-4000-8000-000000000113',
    'textbookId', null,
    'classStartDate', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_regular'),
    'classStartLessonSessionId',
      '99300000-0000-4000-8000-000000000114',
    'classStartSession', '브라우저 위조 라벨',
    'classStartSourceObservationId', null,
    'sortOrder', 0
  )),
  'enrollment-details-consultation-completed'
) as response;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowCount', pg_catalog.jsonb_array_length(response -> 'rows'),
      'source', response #> '{rows,0,classStartSourceObservationId}',
      'lesson', response #>> '{rows,0,classStartLessonSessionId}',
      'label', response #>> '{rows,0,classStartSession}'
    )
    from registration_observation_details_response
  ),
  '{"rowCount":1,"source":null,"lesson":"99300000-0000-4000-8000-000000000114","label":"수업"}'::jsonb,
  'details succeeds at consultation_completed only through its local bypass and server canonicalizes the regular row'
);
select is(
  (
    select track.enrollment_detail_rows
    from public.ops_registration_subject_tracks track
    where track.id = '99300000-0000-4000-8000-000000000106'
  ),
  (select response -> 'rows' from registration_observation_details_response),
  'details stores final canonical response rows rather than browser input'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowAuditDelta', (
        select pg_catalog.count(*) - baseline.row_events
        from public.ops_task_events event
        cross join registration_observation_details_baseline baseline
        where event.task_id = '99300000-0000-4000-8000-000000000105'
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'event_type' = 'enrollment_rows_saved'
        group by baseline.row_events
      ),
      'detailAuditDelta', (
        select pg_catalog.count(*) - baseline.detail_events
        from public.ops_task_events event
        cross join registration_observation_details_baseline baseline
        where event.task_id = '99300000-0000-4000-8000-000000000105'
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'event_type' =
            'registration_enrollment_details_saved'
        group by baseline.detail_events
      ),
      'receiptDelta', (
        select pg_catalog.count(*) - baseline.receipts
        from dashboard_private.ops_registration_mutations mutation
        cross join registration_observation_details_baseline baseline
        where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
        group by baseline.receipts
      ),
      'taskUpdates', (
        select update_count
        from registration_observation_task_update_counter
      )
    )
  ),
  '{"rowAuditDelta":1,"detailAuditDelta":1,"receiptDelta":1,"taskUpdates":1}'::jsonb,
  'new details save owns one row audit recompute details audit and outer receipt'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
      and mutation.request_key like '%:canonical-rows'
  ),
  0::bigint,
  'details creates no nested canonical-rows receipt'
);

create temporary table registration_observation_details_replay
on commit drop
as
select public.save_registration_enrollment_details_v1(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', '99300000-0000-4000-8000-000000000113',
    'textbookId', null,
    'classStartDate', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_regular'),
    'classStartLessonSessionId',
      '99300000-0000-4000-8000-000000000114',
    'classStartSession', '브라우저 위조 라벨',
    'classStartSourceObservationId', null,
    'sortOrder', 0
  )),
  'enrollment-details-consultation-completed'
) as response;
select is(
  (select response from registration_observation_details_replay),
  (select response from registration_observation_details_response),
  'same-fingerprint details replay returns identical final JSON'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowAudits', pg_catalog.count(*) filter (
        where event.after_value::jsonb ->> 'event_type' =
          'enrollment_rows_saved'
      ),
      'detailAudits', pg_catalog.count(*) filter (
        where event.after_value::jsonb ->> 'event_type' =
          'registration_enrollment_details_saved'
      ),
      'taskUpdates', (
        select update_count
        from registration_observation_task_update_counter
      ),
      'receiptCount', (
        select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
          and mutation.request_key =
            'enrollment-details-consultation-completed'
      )
    )
    from public.ops_task_events event
    cross join registration_observation_details_baseline baseline
    where event.task_id = '99300000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.created_at >= (
        select pg_catalog.min(created_at)
        from public.ops_task_events
        where task_id = '99300000-0000-4000-8000-000000000105'
      )
  ),
  '{"rowAudits":1,"detailAudits":1,"taskUpdates":1,"receiptCount":1}'::jsonb,
  'details replay adds zero DML audit recompute detail or receipt effects'
);

select pg_catalog.set_config(
  'dashboard.registration_status_independent_enrollment',
  '',
  true
);

select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0}]'::jsonb,
    'enrollment-direct-consultation-completed'
  )$$,
  '40001',
  'registration_invalid_source_state',
  'direct public rows at consultation_completed cannot set the details-only bypass'
);
select is(
  pg_temp.registration_observation_enrollment_finance_state(),
  (select state from registration_observation_finance_baseline),
  'details replay and direct state rejection leave admission payment and import finance fingerprint unchanged'
);

update public.ops_registration_subject_tracks
set pipeline_status = 'enrollment_decided'
where id = '99300000-0000-4000-8000-000000000106';
update registration_observation_task_update_counter set update_count = 0;

-- Validator branch matrix. These direct calls exercise the exact task/track/
-- class and completed/attended/fit/enrollment facts before any enrollment DML.
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
) values (
  '99300000-0000-4000-8000-000000000195',
  '청강 등록 wrong-task fixture',
  'registration',
  'requested',
  'normal',
  '99300000-0000-4000-8000-000000000001',
  '합성 wrong-task 학생'
);
insert into public.ops_registration_details(task_id)
values ('99300000-0000-4000-8000-000000000195');
insert into public.ops_registration_subject_tracks(
  id,
  task_id,
  subject,
  pipeline_status,
  director_profile_id,
  director_assignment_source,
  director_assigned_at,
  migration_review_required,
  workflow_status,
  workflow_revision,
  workflow_status_entered_at,
  observation_attempt_count
) values (
  '99300000-0000-4000-8000-000000000196',
  '99300000-0000-4000-8000-000000000195',
  '영어',
  'enrollment_decided',
  '99300000-0000-4000-8000-000000000005',
  'manual',
  pg_catalog.now(),
  false,
  'enrollment_requested',
  1,
  pg_catalog.now(),
  0
);

select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000196',
    '99300000-0000-4000-8000-000000000108',
    '99300000-0000-4000-8000-000000000103',
    current_date - 2,
    pg_catalog.current_setting('test.registration_enrollment_key_a'),
    '99300000-0000-4000-8000-000000000104'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'wrong task and track source is rejected with zero writes'
);
select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000108',
    '99300000-0000-4000-8000-000000000113',
    current_date - 2,
    pg_catalog.current_setting('test.registration_enrollment_key_a'),
    '99300000-0000-4000-8000-000000000104'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'wrong class source is rejected with zero writes'
);
select ok(
  (
    dashboard_private.validate_registration_observation_class_start_source_v1(
      '99300000-0000-4000-8000-000000000106',
      '99300000-0000-4000-8000-000000000108',
      '99300000-0000-4000-8000-000000000103',
      current_date - 2,
      pg_catalog.current_setting('test.registration_enrollment_key_a'),
      '99300000-0000-4000-8000-000000000104'
    ) ->> 'classStartSession'
  ) = pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD') || ' 18:00–20:00',
  'completed attended fit enrollment historical source succeeds despite exception schedule state and uses server KST label'
);

update public.ops_registration_observations
set suitability_result = 'unfit'
where id = '99300000-0000-4000-8000-000000000118';
select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000118',
    '99300000-0000-4000-8000-000000000103',
    current_date - 3,
    pg_catalog.current_setting('test.registration_enrollment_key_b'),
    '99300000-0000-4000-8000-000000000124'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'unfit observation source is rejected with zero writes'
);
update public.ops_registration_observations
set suitability_result = 'fit'
where id = '99300000-0000-4000-8000-000000000118';

update public.ops_registration_observations
set status = 'no_show',
    attendance = 'no_show',
    suitability_result = null,
    feedback_reason = null,
    feedback_submitted_by = null,
    feedback_submitted_at = null
where id = '99300000-0000-4000-8000-000000000118';
select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000118',
    '99300000-0000-4000-8000-000000000103',
    current_date - 3,
    pg_catalog.current_setting('test.registration_enrollment_key_b'),
    '99300000-0000-4000-8000-000000000124'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'no-show attendance source is rejected with zero writes'
);
update public.ops_registration_observations
set status = 'completed',
    attendance = 'attended',
    suitability_result = 'fit',
    feedback_reason = '등록 적합 B',
    feedback_submitted_by = '99300000-0000-4000-8000-000000000003',
    feedback_submitted_at = pg_catalog.now() - interval '3 days'
where id = '99300000-0000-4000-8000-000000000118';

update public.ops_registration_observations
set status = 'canceled',
    attendance = null,
    attendance_recorded_by = null,
    attendance_recorded_at = null,
    suitability_result = null,
    feedback_reason = null,
    feedback_submitted_by = null,
    feedback_submitted_at = null
where id = '99300000-0000-4000-8000-000000000118';
select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000118',
    '99300000-0000-4000-8000-000000000103',
    current_date - 3,
    pg_catalog.current_setting('test.registration_enrollment_key_b'),
    '99300000-0000-4000-8000-000000000124'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'canceled observation source is rejected with zero writes'
);
update public.ops_registration_observations
set status = 'completed',
    attendance = 'attended',
    attendance_recorded_by = '99300000-0000-4000-8000-000000000003',
    attendance_recorded_at = pg_catalog.now() - interval '3 days',
    suitability_result = 'fit',
    feedback_reason = '등록 적합 B',
    feedback_submitted_by = '99300000-0000-4000-8000-000000000003',
    feedback_submitted_at = pg_catalog.now() - interval '3 days'
where id = '99300000-0000-4000-8000-000000000118';

update public.ops_registration_observations
set decision_kind = null,
    decided_by = null,
    decided_at = null
where id = '99300000-0000-4000-8000-000000000118';
select throws_ok(
  $$select dashboard_private.validate_registration_observation_class_start_source_v1(
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000118',
    '99300000-0000-4000-8000-000000000103',
    current_date - 3,
    pg_catalog.current_setting('test.registration_enrollment_key_b'),
    '99300000-0000-4000-8000-000000000124'
  )$$,
  '23514',
  'registration_observation_class_start_source_invalid',
  'missing decision observation source is rejected with zero writes'
);
update public.ops_registration_observations
set decision_kind = 'enrollment',
    decided_by = '99300000-0000-4000-8000-000000000005',
    decided_at = pg_catalog.now() - interval '1 day'
where id = '99300000-0000-4000-8000-000000000118';

select is(
  (
    select pg_catalog.jsonb_build_object(
      'enrollments', pg_catalog.count(*),
      'receipts', (
        select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.request_key like 'validator-%'
      )
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '99300000-0000-4000-8000-000000000106'
      and enrollment.class_id = '99300000-0000-4000-8000-000000000103'
  ),
  '{"enrollments":0,"receipts":0}'::jsonb,
  'validator wrong task track class status attendance fit and decision branches write no enrollment or receipt'
);
select is(
  pg_temp.registration_observation_enrollment_finance_state(),
  (select state from registration_observation_finance_baseline),
  'every validator failure preserves non-empty admission payment and import fingerprint'
);

-- Id-less binding precedes class conflict detection. The current unique index
-- normally prevents corruption, so the 2+ candidate case is constructed only
-- inside this rollback transaction, tested, removed, and the exact index is
-- immediately recreated before the successful path.
drop index public.ops_registration_enrollments_active_class_uidx;
insert into public.ops_registration_enrollments(
  id, track_id, class_id, status, makeedu_registered, roster_active, sort_order
) values
  (
    '99300000-0000-4000-8000-000000000151',
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000103',
    'planned', false, false, 10
  ),
  (
    '99300000-0000-4000-8000-000000000152',
    '99300000-0000-4000-8000-000000000106',
    '99300000-0000-4000-8000-000000000103',
    'planned', false, false, 11
  );
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"classId":"99300000-0000-4000-8000-000000000103","sortOrder":0}]'::jsonb,
    'enrollment-ambiguous-id-less'
  )$$,
  '40001',
  'registration_enrollment_draft_ambiguous',
  'ambiguous 2+ editable id-less candidates fail closed'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'rows', pg_catalog.count(*),
      'receipt', (
        select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.request_key = 'enrollment-ambiguous-id-less'
      )
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.id in (
      '99300000-0000-4000-8000-000000000151',
      '99300000-0000-4000-8000-000000000152'
    )
  ),
  '{"rows":2,"receipt":0}'::jsonb,
  'ambiguous candidate rejection has zero DML and receipt delta'
);
delete from public.ops_registration_enrollments
where id in (
  '99300000-0000-4000-8000-000000000151',
  '99300000-0000-4000-8000-000000000152'
);
create unique index ops_registration_enrollments_active_class_uidx
  on public.ops_registration_enrollments(track_id, class_id)
  where status = 'planned' or roster_active;

insert into public.ops_registration_enrollments(
  id, track_id, class_id, status, makeedu_registered, roster_active, sort_order
) values (
  '99300000-0000-4000-8000-000000000153',
  '99300000-0000-4000-8000-000000000106',
  '99300000-0000-4000-8000-000000000103',
  'planned', false, false, 7
);

create temporary table registration_observation_rows_success_baseline
on commit drop
as
select
  (
    select pg_catalog.count(*)
    from public.ops_task_events event
    where event.task_id = '99300000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type' = 'enrollment_rows_saved'
  ) as row_events,
  (
    select pg_catalog.count(*)
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
  ) as receipts;

create temporary table registration_observation_source_a_response
on commit drop
as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId',
      '99300000-0000-4000-8000-000000000104',
    'classStartSession', '브라우저 historical 위조 라벨',
    'classStartSourceObservationId',
      '99300000-0000-4000-8000-000000000108',
    'sortOrder', 0
  )),
  'enrollment-source-a-original'
) as response;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'id', response #>> '{rows,0,id}',
      'source', response #>> '{rows,0,classStartSourceObservationId}',
      'date', response #>> '{rows,0,classStartDate}',
      'key', response #>> '{rows,0,classStartSessionKey}',
      'lesson', response #>> '{rows,0,classStartLessonSessionId}',
      'label', response #>> '{rows,0,classStartSession}'
    )
    from registration_observation_source_a_response
  ),
  pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'source', '99300000-0000-4000-8000-000000000108',
    'date', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'key', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'lesson', '99300000-0000-4000-8000-000000000104',
    'label', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD') ||
      ' 18:00–20:00'
  ),
  'id-less historical save binds the exact preexisting draft and stores one aligned final source date key lesson set with server label'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'classRows', pg_catalog.count(*),
      'rowAuditDelta', (
        select pg_catalog.count(*) - baseline.row_events
        from public.ops_task_events event
        cross join registration_observation_rows_success_baseline baseline
        where event.task_id = '99300000-0000-4000-8000-000000000105'
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'event_type' =
            'enrollment_rows_saved'
        group by baseline.row_events
      ),
      'receiptDelta', (
        select pg_catalog.count(*) - baseline.receipts
        from dashboard_private.ops_registration_mutations mutation
        cross join registration_observation_rows_success_baseline baseline
        where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
        group by baseline.receipts
      ),
      'taskUpdates', (
        select update_count
        from registration_observation_task_update_counter
      )
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '99300000-0000-4000-8000-000000000106'
      and enrollment.class_id = '99300000-0000-4000-8000-000000000103'
  ),
  '{"classRows":1,"rowAuditDelta":1,"receiptDelta":1,"taskUpdates":1}'::jsonb,
  'direct source save performs one final write audit recompute and caller-key receipt'
);

create temporary table registration_observation_source_a_row_snapshot
on commit drop
as
select pg_catalog.to_jsonb(enrollment) as row_json
from public.ops_registration_enrollments enrollment
where enrollment.id = '99300000-0000-4000-8000-000000000153';

create temporary table registration_observation_source_a_replay on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000104',
    'classStartSession', '브라우저 historical 위조 라벨',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000108',
    'sortOrder', 0
  )),
  'enrollment-source-a-original'
) as response;
select is(
  (select response from registration_observation_source_a_replay),
  (select response from registration_observation_source_a_response),
  'same-fingerprint historical source replay returns identical final JSON'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowUnchanged', pg_catalog.to_jsonb(enrollment) = snapshot.row_json,
      'taskUpdates', counter.update_count,
      'receiptCount', (select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.request_key = 'enrollment-source-a-original'),
      'eventDelta', (select pg_catalog.count(*) - baseline.row_events
        from public.ops_task_events event
        cross join registration_observation_rows_success_baseline baseline
        where event.task_id = '99300000-0000-4000-8000-000000000105'
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'event_type' = 'enrollment_rows_saved'
        group by baseline.row_events)
    )
    from public.ops_registration_enrollments enrollment
    cross join registration_observation_source_a_row_snapshot snapshot
    cross join registration_observation_task_update_counter counter
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  '{"rowUnchanged":true,"taskUpdates":1,"receiptCount":1,"eventDelta":1}'::jsonb,
  'direct replay has DML audit recompute and receipt delta zero'
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_b'),
      'classStartLessonSessionId', '99300000-0000-4000-8000-000000000124',
      'classStartSession', 'different source',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 0
    )),
    'enrollment-source-a-original'
  )$$,
  '22023', 'idempotency_key_reused',
  'same direct key with different source conflicts before runtime and DML'
);
select is(
  pg_catalog.to_jsonb(enrollment),
  snapshot.row_json,
  'same-key different-source conflict mutates zero enrollment fields'
)
from public.ops_registration_enrollments enrollment
cross join registration_observation_source_a_row_snapshot snapshot
where enrollment.id = '99300000-0000-4000-8000-000000000153';

create temporary table registration_observation_source_b_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_b'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000124',
    'classStartSession', 'browser source B',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
    'sortOrder', 1
  )),
  'enrollment-source-a-to-b'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'id', enrollment.id,
      'source', enrollment.class_start_source_observation_id,
      'date', enrollment.class_start_date,
      'key', enrollment.class_start_session_key,
      'lesson', enrollment.class_start_lesson_session_id,
      'responseSource', response.response #>> '{rows,0,classStartSourceObservationId}'
    )
    from public.ops_registration_enrollments enrollment
    cross join registration_observation_source_b_response response
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'source', '99300000-0000-4000-8000-000000000118',
    'date', current_date - 3,
    'key', pg_catalog.current_setting('test.registration_enrollment_key_b'),
    'lesson', '99300000-0000-4000-8000-000000000124',
    'responseSource', '99300000-0000-4000-8000-000000000118'
  ),
  'historical A to B changes the source and aligned normalized date key and lesson atomically'
);

update public.ops_registration_observations
set session_authority = 'legacy',
    class_lesson_session_id = null,
    legacy_session_key = pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
    session_source_revision = null,
    legacy_session_source_hash = repeat('l', 64),
    source_revision = pg_catalog.jsonb_build_object(
      'authority', 'legacy',
      'sessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'contentHash', repeat('l', 64)
    )
where id = '99300000-0000-4000-8000-000000000118';
create temporary table registration_observation_legacy_source_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
    'classStartLessonSessionId', null,
    'classStartSession', 'legacy browser label',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
    'sortOrder', 2
  )),
  'enrollment-source-b-legacy'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'source', enrollment.class_start_source_observation_id,
      'date', enrollment.class_start_date,
      'key', enrollment.class_start_session_key,
      'lesson', enrollment.class_start_lesson_session_id,
      'label', enrollment.class_start_session
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  pg_catalog.jsonb_build_object(
    'source', '99300000-0000-4000-8000-000000000118',
    'date', current_date - 3,
    'key', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
    'lesson', null,
    'label', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD') || ' 17:00–19:00'
  ),
  'legacy historical source requires recorded key date and null lesson with server snapshot label'
);

select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', (select enrollment.id from public.ops_registration_enrollments enrollment
        where enrollment.track_id = '99300000-0000-4000-8000-000000000106'
          and enrollment.class_id = '99300000-0000-4000-8000-000000000113'),
      'classId', '99300000-0000-4000-8000-000000000113',
      'classStartDate', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD'),
      'classStartSessionKey', 'not-a-current-session',
      'classStartLessonSessionId', '99300000-0000-4000-8000-000000000114',
      'classStartSession', 'invalid regular',
      'classStartSourceObservationId', null,
      'sortOrder', 0
    )),
    'enrollment-regular-invalid-state'
  )$$,
  '23514', 'registration_class_session_invalid',
  'regular invalid current schedule state fails before any final write'
);
select is(
  (select pg_catalog.count(*) from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key = 'enrollment-regular-invalid-state'),
  0::bigint,
  'regular invalid state failure creates no receipt'
);

delete from public.ops_registration_enrollments enrollment
where enrollment.track_id = '99300000-0000-4000-8000-000000000106'
  and enrollment.class_id = '99300000-0000-4000-8000-000000000113';
create temporary table registration_observation_regular_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000113',
    'classStartDate', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_regular'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000114',
    'classStartSession', 'regular browser label',
    'classStartSourceObservationId', null,
    'sortOrder', 3
  )),
  'enrollment-historical-to-regular'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'id', enrollment.id, 'class', enrollment.class_id,
      'source', enrollment.class_start_source_observation_id,
      'date', enrollment.class_start_date,
      'key', enrollment.class_start_session_key,
      'lesson', enrollment.class_start_lesson_session_id,
      'label', enrollment.class_start_session
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'class', '99300000-0000-4000-8000-000000000113',
    'source', null, 'date', current_date + 7,
    'key', pg_catalog.current_setting('test.registration_enrollment_key_regular'),
    'lesson', '99300000-0000-4000-8000-000000000114', 'label', '수업'
  ),
  'historical to normalized regular removes source and persists canonical active session values'
);
create temporary table registration_observation_blank_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  '[{"id":"99300000-0000-4000-8000-000000000153","classId":"99300000-0000-4000-8000-000000000103","classStartDate":null,"classStartSessionKey":null,"classStartLessonSessionId":null,"classStartSession":null,"classStartSourceObservationId":null,"sortOrder":4}]'::jsonb,
  'enrollment-regular-to-blank'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'class', enrollment.class_id,
      'source', enrollment.class_start_source_observation_id,
      'date', enrollment.class_start_date,
      'key', enrollment.class_start_session_key,
      'lesson', enrollment.class_start_lesson_session_id,
      'label', enrollment.class_start_session
    ) from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  '{"class":"99300000-0000-4000-8000-000000000103","source":null,"date":null,"key":null,"lesson":null,"label":null}'::jsonb,
  'blank row clears historical source date key lesson and label as one final set'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
) values (
  '99300000-0000-4000-8000-000000000123',
  '청강 등록 legacy regular 영어반', '영어', '수업 진행 중', 'legacy',
  pg_catalog.jsonb_build_object(
    'sessions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'date', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD'),
      'sessionNumber', 1, 'scheduleState', 'active'
    ))
  )
);
create temporary table registration_observation_regular_legacy_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', '99300000-0000-4000-8000-000000000123',
    'classStartDate', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD') || ':1',
    'classStartLessonSessionId', null,
    'classStartSession', 'legacy regular browser label',
    'classStartSourceObservationId', null,
    'sortOrder', 5
  )),
  'enrollment-regular-legacy'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'source', response #> '{rows,0,classStartSourceObservationId}',
      'date', response #>> '{rows,0,classStartDate}',
      'key', response #>> '{rows,0,classStartSessionKey}',
      'lesson', response #> '{rows,0,classStartLessonSessionId}',
      'label', response #>> '{rows,0,classStartSession}'
    ) from registration_observation_regular_legacy_response
  ),
  pg_catalog.jsonb_build_object(
    'source', null,
    'date', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD'),
    'key', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD') || ':1',
    'lesson', null, 'label', '1회차'
  ),
  'regular future legacy session remains available with null lesson and server label'
);
delete from public.ops_registration_enrollments
where class_id = '99300000-0000-4000-8000-000000000123';

-- Rollback-only active/rostered/admission fixture uses an exact synthetic
-- student, so all foreign keys and production triggers remain enabled.
insert into public.students(
  id, name, uid, class_ids, waitlist_class_ids
) values (
  '99300000-0000-4000-8000-000000000194',
  '청강 등록 roster fixture',
  'enrollment-roster-fixture',
  '[]'::jsonb,
  '[]'::jsonb
);
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id,
  status, makeedu_registered, roster_active, sort_order
) values (
  '99300000-0000-4000-8000-000000000154',
  '99300000-0000-4000-8000-000000000106',
  '99300000-0000-4000-8000-000000000194',
  '99300000-0000-4000-8000-000000000190',
  '99300000-0000-4000-8000-000000000123',
  'planned', false, true, 9
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"id":"99300000-0000-4000-8000-000000000154","classId":"99300000-0000-4000-8000-000000000123","sortOrder":9}]'::jsonb,
    'enrollment-rostered-admission-linked'
  )$$,
  '40001', 'registration_enrollment_draft_not_editable',
  'active rostered admission-linked supplied enrollment fails closed'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowCount', pg_catalog.count(*),
      'receiptCount', (select pg_catalog.count(*)
        from dashboard_private.ops_registration_mutations mutation
        where mutation.request_key = 'enrollment-rostered-admission-linked')
    )
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000154'
      and enrollment.roster_active
      and enrollment.admission_batch_id = '99300000-0000-4000-8000-000000000190'
  ),
  '{"rowCount":1,"receiptCount":0}'::jsonb,
  'rostered admission-linked rejection has zero DML and receipt delta'
);
delete from public.ops_registration_enrollments
where id = '99300000-0000-4000-8000-000000000154';
delete from public.students
where id = '99300000-0000-4000-8000-000000000194';

create temporary table registration_observation_runtime_replay_seed on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000104',
    'classStartSession', 'runtime replay browser label',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000108',
    'sortOrder', 6
  )),
  'enrollment-runtime-zero-replay-seed'
) as response;
select is(
  (select enrollment.class_start_source_observation_id
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'),
  '99300000-0000-4000-8000-000000000108'::uuid,
  'runtime replay seed ends with a historical source before deactivation'
);

update public.ops_registration_enrollments
set status = 'canceled'
where id = '99300000-0000-4000-8000-000000000153';
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"id":"99300000-0000-4000-8000-000000000153","classId":"99300000-0000-4000-8000-000000000103","classStartDate":null,"classStartSessionKey":null,"classStartLessonSessionId":null,"classStartSession":null,"classStartSourceObservationId":null,"sortOrder":6}]'::jsonb,
    'enrollment-canceled-not-editable'
  )$$,
  '40001', 'registration_enrollment_draft_not_editable',
  'canceled supplied enrollment fails the editable draft predicate'
);
update public.ops_registration_enrollments
set status = 'planned'
where id = '99300000-0000-4000-8000-000000000153';
select is(
  pg_temp.registration_observation_enrollment_finance_state(),
  (select state from registration_observation_finance_baseline),
  'normalized legacy blank conflict candidate and replay branches preserve admission payment and import fingerprint'
);

-- A literal caller key ending in :canonical-rows is not derived. It coexists
-- with a details key K, while exact-key reuse across operations still conflicts.
create temporary table registration_observation_literal_rows_response on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000104',
    'classStartSession', 'literal direct browser label',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000108',
    'sortOrder', 6
  )),
  'enrollment-literal-key:canonical-rows'
) as response;
create temporary table registration_observation_literal_details_response on commit drop as
select public.save_registration_enrollment_details_v1(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000104',
    'classStartSession', 'literal details browser label',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000108',
    'sortOrder', 6
  )),
  'enrollment-literal-key'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'directReceipt', pg_catalog.count(*) filter (
        where mutation.request_key = 'enrollment-literal-key:canonical-rows'
          and mutation.mutation_type = 'save_enrollment_rows'
      ),
      'detailsReceipt', pg_catalog.count(*) filter (
        where mutation.request_key = 'enrollment-literal-key'
          and mutation.mutation_type = 'save_registration_enrollment_details'
      ),
      'derivedReceipt', pg_catalog.count(*) filter (
        where mutation.request_key =
          'enrollment-literal-key:canonical-rows:canonical-rows'
      )
    )
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
  ),
  '{"directReceipt":1,"detailsReceipt":1,"derivedReceipt":0}'::jsonb,
  'direct K canonical-rows and details K own two independent original receipts and no nested receipt'
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"id":"99300000-0000-4000-8000-000000000153","classId":"99300000-0000-4000-8000-000000000103","sortOrder":6}]'::jsonb,
    'enrollment-literal-key'
  )$$,
  '22023', 'idempotency_key_reused',
  'reusing exact details key K for direct rows preserves global conflict contract before DML'
);

select pg_catalog.set_config(
  'dashboard.registration_status_independent_enrollment', '', true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000004',
  true
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    '[{"id":"99300000-0000-4000-8000-000000000153","classId":"99300000-0000-4000-8000-000000000103","sortOrder":6}]'::jsonb,
    'enrollment-unrelated-actor'
  )$$,
  '42501', 'registration_access_denied',
  'unrelated active actor cannot reach another track through the public wrapper'
);
select is(
  (select pg_catalog.count(*) from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key = 'enrollment-unrelated-actor'),
  0::bigint,
  'unrelated actor authorization failure happens before receipt lookup or write'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000001',
  true
);

create function pg_temp.registration_observation_enrollment_atomic_state()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'enrollment', (
      select pg_catalog.to_jsonb(enrollment)
      from public.ops_registration_enrollments enrollment
      where enrollment.id = '99300000-0000-4000-8000-000000000153'
    ),
    'detailRows', (
      select track.enrollment_detail_rows
      from public.ops_registration_subject_tracks track
      where track.id = '99300000-0000-4000-8000-000000000106'
    ),
    'task', (
      select pg_catalog.to_jsonb(task)
      from public.ops_tasks task
      where task.id = '99300000-0000-4000-8000-000000000105'
    ),
    'events', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(event) order by event.id
      ), '[]'::jsonb)
      from public.ops_task_events event
      where event.task_id = '99300000-0000-4000-8000-000000000105'
    ),
    'receipts', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(mutation) order by mutation.request_key
      ), '[]'::jsonb)
      from dashboard_private.ops_registration_mutations mutation
      where mutation.actor_id = '99300000-0000-4000-8000-000000000001'
        and mutation.task_id = '99300000-0000-4000-8000-000000000105'
    ),
    'finance', pg_temp.registration_observation_enrollment_finance_state(),
    'taskUpdateCount', (
      select counter.update_count
      from pg_temp.registration_observation_task_update_counter counter
    )
  );
$$;

create temporary table registration_observation_atomic_before (
  guard_name text primary key,
  state jsonb not null
) on commit drop;

-- Row audit failure. The outer IF narrows exact task/event/field before the
-- nested JSON cast, matching production event storage shape.
create function pg_temp.registration_observation_row_audit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id = '99300000-0000-4000-8000-000000000105'
    and new.event_type = 'registration_track_event'
    and new.field_name =
      'registration_track:99300000-0000-4000-8000-000000000106'
  then
    if new.after_value::jsonb ->> 'event_type' = 'enrollment_rows_saved' then
      raise exception 'registration_enrollment_row_audit_guard';
    end if;
  end if;
  return new;
end;
$$;
create trigger registration_observation_row_audit_guard
before insert on public.ops_task_events
for each row execute function pg_temp.registration_observation_row_audit_guard();
insert into registration_observation_atomic_before
values ('row-audit', pg_temp.registration_observation_enrollment_atomic_state());
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'row audit failure browser',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 7
    )),
    'enrollment-row-audit-failure'
  )$$,
  'P0001', 'registration_enrollment_row_audit_guard',
  'row audit failure aborts the direct operation'
);
select is(
  pg_temp.registration_observation_enrollment_atomic_state(),
  (select state from registration_observation_atomic_before where guard_name = 'row-audit'),
  'row audit failure rolls back DML event parent receipt detail and finance state'
);
drop trigger registration_observation_row_audit_guard on public.ops_task_events;
drop function pg_temp.registration_observation_row_audit_guard();

create function pg_temp.registration_observation_recompute_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id = '99300000-0000-4000-8000-000000000105' then
    raise exception 'registration_enrollment_recompute_guard';
  end if;
  return new;
end;
$$;
create trigger aaa_registration_observation_recompute_guard
before update on public.ops_tasks
for each row execute function pg_temp.registration_observation_recompute_guard();
insert into registration_observation_atomic_before
values ('recompute', pg_temp.registration_observation_enrollment_atomic_state());
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'recompute failure browser',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 7
    )),
    'enrollment-recompute-failure'
  )$$,
  'P0001', 'registration_enrollment_recompute_guard',
  'recompute failure aborts direct rows after audit'
);
select is(
  pg_temp.registration_observation_enrollment_atomic_state(),
  (select state from registration_observation_atomic_before where guard_name = 'recompute'),
  'recompute failure rolls back final row audit parent receipt detail and finance state'
);
drop trigger aaa_registration_observation_recompute_guard on public.ops_tasks;
drop function pg_temp.registration_observation_recompute_guard();

create function pg_temp.registration_observation_details_audit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id = '99300000-0000-4000-8000-000000000105'
    and new.event_type = 'registration_track_event'
    and new.field_name =
      'registration_track:99300000-0000-4000-8000-000000000106'
  then
    if new.after_value::jsonb ->> 'event_type' =
      'registration_enrollment_details_saved'
    then
      raise exception 'registration_enrollment_details_audit_guard';
    end if;
  end if;
  return new;
end;
$$;
create trigger registration_observation_details_audit_guard
before insert on public.ops_task_events
for each row execute function pg_temp.registration_observation_details_audit_guard();
insert into registration_observation_atomic_before
values ('details-audit', pg_temp.registration_observation_enrollment_atomic_state());
select throws_ok(
  $$select public.save_registration_enrollment_details_v1(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'details audit failure browser',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 7
    )),
    'enrollment-details-audit-failure'
  )$$,
  'P0001', 'registration_enrollment_details_audit_guard',
  'details audit failure aborts its one public operation'
);
select is(
  pg_temp.registration_observation_enrollment_atomic_state(),
  (select state from registration_observation_atomic_before where guard_name = 'details-audit'),
  'details audit failure rolls back row detail both audits recompute receipt and finance state'
);
drop trigger registration_observation_details_audit_guard on public.ops_task_events;
drop function pg_temp.registration_observation_details_audit_guard();

create function pg_temp.registration_observation_outer_receipt_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_id = '99300000-0000-4000-8000-000000000001'
    and new.request_key = 'enrollment-outer-receipt-failure'
    and new.mutation_type = 'save_enrollment_rows'
  then
    raise exception 'registration_enrollment_outer_receipt_guard';
  end if;
  return new;
end;
$$;
create trigger registration_observation_outer_receipt_guard
before insert on dashboard_private.ops_registration_mutations
for each row execute function pg_temp.registration_observation_outer_receipt_guard();
insert into registration_observation_atomic_before
values ('outer-receipt', pg_temp.registration_observation_enrollment_atomic_state());
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'outer receipt failure browser',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 7
    )),
    'enrollment-outer-receipt-failure'
  )$$,
  'P0001', 'registration_enrollment_outer_receipt_guard',
  'outer receipt failure aborts final direct operation'
);
select is(
  pg_temp.registration_observation_enrollment_atomic_state(),
  (select state from registration_observation_atomic_before where guard_name = 'outer-receipt'),
  'outer receipt failure rolls back DML audit recompute receipt detail and finance state'
);
drop trigger registration_observation_outer_receipt_guard
  on dashboard_private.ops_registration_mutations;
drop function pg_temp.registration_observation_outer_receipt_guard();

create function pg_temp.registration_observation_deactivation_state()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'observations', (select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(observation) order by observation.id
    ), '[]'::jsonb) from public.ops_registration_observations observation
      where observation.id in (
        '99300000-0000-4000-8000-000000000108',
        '99300000-0000-4000-8000-000000000118'
      )),
    'openObservationIds', (select coalesce(pg_catalog.jsonb_agg(
      observation.id order by observation.id
    ), '[]'::jsonb) from public.ops_registration_observations observation
      where observation.track_id = '99300000-0000-4000-8000-000000000106'
        and observation.decision_kind is null),
    'appointments', (select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(appointment) order by appointment.id
    ), '[]'::jsonb) from public.ops_registration_appointments appointment
      where appointment.id in (
        '99300000-0000-4000-8000-000000000107',
        '99300000-0000-4000-8000-000000000117'
      )),
    'track', (select pg_catalog.to_jsonb(track)
      from public.ops_registration_subject_tracks track
      where track.id = '99300000-0000-4000-8000-000000000106'),
    'enrollments', (select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(enrollment) order by enrollment.id
    ), '[]'::jsonb) from public.ops_registration_enrollments enrollment
      where enrollment.track_id = '99300000-0000-4000-8000-000000000106'),
    'admissions', (select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(admission) order by admission.id
    ), '[]'::jsonb) from public.ops_registration_admission_batches admission
      where admission.task_id = '99300000-0000-4000-8000-000000000105'),
    'domainEvents', (select pg_catalog.count(*)
      from dashboard_private.registration_observation_domain_events event
      where event.observation_id in (
        '99300000-0000-4000-8000-000000000108',
        '99300000-0000-4000-8000-000000000118'
      ))
  );
$$;
create temporary table registration_observation_deactivation_before
on commit drop
as select pg_temp.registration_observation_deactivation_state() as state;

lock table dashboard_private.registration_observation_runtime_settings
  in row exclusive mode;
do $registration_observation_runtime_deactivate_v1$
declare
  v_current integer;
begin
  select activation_version
  into v_current
  from dashboard_private.registration_observation_runtime_settings
  where singleton = true
  for update;
  if not found or v_current not in (0, 1) then
    raise exception 'registration_observation_runtime_state_invalid'
      using errcode = '55000';
  end if;
  if v_current = 1 then
    update dashboard_private.registration_observation_runtime_settings
    set activation_version = 0,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = null
    where singleton = true
      and activation_version = 1;
  end if;
end;
$registration_observation_runtime_deactivate_v1$;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'runtimeVersion', setting.activation_version,
      'updatedBy', setting.updated_by
    )
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  '{"runtimeVersion":0,"updatedBy":null}'::jsonb,
  'marked deactivation body rehearses committed runtime 1 to local runtime 0 with null actor'
);
select is(
  pg_temp.registration_observation_deactivation_state(),
  (select state from registration_observation_deactivation_before),
  'deactivation preserves observation appointment track enrollment admission open IDs revisions and domain provider state'
);
create temporary table registration_observation_first_deactivation
on commit drop
as
select setting.updated_at, pg_temp.registration_observation_deactivation_state() as state
from dashboard_private.registration_observation_runtime_settings setting
where setting.singleton = true;

do $registration_observation_runtime_deactivate_v1$
declare
  v_current integer;
begin
  select activation_version
  into v_current
  from dashboard_private.registration_observation_runtime_settings
  where singleton = true
  for update;
  if not found or v_current not in (0, 1) then
    raise exception 'registration_observation_runtime_state_invalid'
      using errcode = '55000';
  end if;
  if v_current = 1 then
    update dashboard_private.registration_observation_runtime_settings
    set activation_version = 0,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = null
    where singleton = true
      and activation_version = 1;
  end if;
end;
$registration_observation_runtime_deactivate_v1$;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'runtimeVersion', setting.activation_version,
      'updatedBy', setting.updated_by,
      'timestampStable', setting.updated_at = first.updated_at,
      'stateStable', pg_temp.registration_observation_deactivation_state() =
        first.state
    )
    from dashboard_private.registration_observation_runtime_settings setting
    cross join registration_observation_first_deactivation first
    where setting.singleton = true
  ),
  '{"runtimeVersion":0,"updatedBy":null,"timestampStable":true,"stateStable":true}'::jsonb,
  'same marked deactivation body is replay-safe from runtime 0 to 0'
);

create temporary table registration_observation_runtime_zero_replay on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000103',
    'classStartDate', pg_catalog.to_char(current_date - 2, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_a'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000104',
    'classStartSession', 'runtime replay browser label',
    'classStartSourceObservationId', '99300000-0000-4000-8000-000000000108',
    'sortOrder', 6
  )),
  'enrollment-runtime-zero-replay-seed'
) as response;
select is(
  (select response from registration_observation_runtime_zero_replay),
  (select response from registration_observation_runtime_replay_seed),
  'runtime 0 same-fingerprint historical-source replay returns its identical receipt before runtime logic'
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'runtime zero conflict',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 6
    )),
    'enrollment-runtime-zero-replay-seed'
  )$$,
  '22023', 'idempotency_key_reused',
  'runtime 0 same key different source conflicts before runtime and DML'
);
select throws_ok(
  $$select public.save_registration_enrollment_rows(
    '99300000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', '99300000-0000-4000-8000-000000000153',
      'classId', '99300000-0000-4000-8000-000000000103',
      'classStartDate', pg_catalog.to_char(current_date - 3, 'YYYY-MM-DD'),
      'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_legacy_b'),
      'classStartLessonSessionId', null,
      'classStartSession', 'runtime zero new source',
      'classStartSourceObservationId', '99300000-0000-4000-8000-000000000118',
      'sortOrder', 6
    )),
    'enrollment-runtime-zero-new-source'
  )$$,
  '55000', 'registration_observation_runtime_inactive',
  'runtime 0 rejects a new request containing any non-null observation source'
);
select is(
  (select pg_catalog.count(*) from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key in (
      'enrollment-runtime-zero-new-source'
    )),
  0::bigint,
  'runtime 0 new historical source rejection writes no receipt'
);

create temporary table registration_observation_runtime_zero_blank on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  '[{"id":"99300000-0000-4000-8000-000000000153","classId":"99300000-0000-4000-8000-000000000103","classStartDate":null,"classStartSessionKey":null,"classStartLessonSessionId":null,"classStartSession":null,"classStartSourceObservationId":null,"sortOrder":7}]'::jsonb,
  'enrollment-runtime-zero-remove-source'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'source', enrollment.class_start_source_observation_id,
      'date', enrollment.class_start_date,
      'key', enrollment.class_start_session_key,
      'lesson', enrollment.class_start_lesson_session_id,
      'label', enrollment.class_start_session
    ) from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  '{"source":null,"date":null,"key":null,"lesson":null,"label":null}'::jsonb,
  'runtime 0 allows historical source removal to a blank row'
);
create temporary table registration_observation_runtime_zero_regular on commit drop as
select public.save_registration_enrollment_rows(
  '99300000-0000-4000-8000-000000000106',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', '99300000-0000-4000-8000-000000000153',
    'classId', '99300000-0000-4000-8000-000000000113',
    'classStartDate', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD'),
    'classStartSessionKey', pg_catalog.current_setting('test.registration_enrollment_key_regular'),
    'classStartLessonSessionId', '99300000-0000-4000-8000-000000000114',
    'classStartSession', 'runtime zero regular browser',
    'classStartSourceObservationId', null,
    'sortOrder', 8
  )),
  'enrollment-runtime-zero-regular'
) as response;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'class', enrollment.class_id,
      'source', enrollment.class_start_source_observation_id,
      'lesson', enrollment.class_start_lesson_session_id,
      'label', enrollment.class_start_session
    ) from public.ops_registration_enrollments enrollment
    where enrollment.id = '99300000-0000-4000-8000-000000000153'
  ),
  '{"class":"99300000-0000-4000-8000-000000000113","source":null,"lesson":"99300000-0000-4000-8000-000000000114","label":"수업"}'::jsonb,
  'runtime 0 keeps ordinary normalized regular enrollment save available'
);
select is(
  pg_temp.registration_observation_enrollment_finance_state(),
  (select state from registration_observation_finance_baseline),
  'runtime replay conflict rejection removal and regular save leave non-empty finance fingerprint unchanged'
);

-- Calendar regression: old level-test and visit branches retain the first ten
-- columns, observation fields are nullable there, and one observation
-- appointment maps to exactly one canonical row and one-element arrays.
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
) values
  (
    '99300000-0000-4000-8000-000000000127',
    '99300000-0000-4000-8000-000000000105',
    'level_test',
    (current_date + 1 + time '15:00') at time zone 'Asia/Seoul',
    '본관', 'scheduled', 6,
    '99300000-0000-4000-8000-000000000001'
  ),
  (
    '99300000-0000-4000-8000-000000000137',
    '99300000-0000-4000-8000-000000000105',
    'visit_consultation',
    (current_date + 2 + time '16:00') at time zone 'Asia/Seoul',
    '본관', 'scheduled', 7,
    '99300000-0000-4000-8000-000000000001'
  );
insert into public.ops_registration_level_tests(
  id, track_id, appointment_id, attempt_number, status
) values (
  '99300000-0000-4000-8000-000000000128',
  '99300000-0000-4000-8000-000000000106',
  '99300000-0000-4000-8000-000000000127',
  99, 'scheduled'
);
insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
) values (
  '99300000-0000-4000-8000-000000000138',
  '99300000-0000-4000-8000-000000000106',
  '99300000-0000-4000-8000-000000000137',
  'visit', 'scheduled',
  '99300000-0000-4000-8000-000000000005'
);

select is(
  dashboard_private.registration_appointment_track_ids_v1(
    '99300000-0000-4000-8000-000000000127'
  ),
  array['99300000-0000-4000-8000-000000000106'::uuid],
  'private participant helper preserves scheduled level-test branch'
);
select is(
  dashboard_private.registration_appointment_track_ids_v1(
    '99300000-0000-4000-8000-000000000137'
  ),
  array['99300000-0000-4000-8000-000000000106'::uuid],
  'private participant helper preserves scheduled visit branch'
);
select is(
  dashboard_private.registration_appointment_track_ids_v1(
    '99300000-0000-4000-8000-000000000107'
  ),
  array['99300000-0000-4000-8000-000000000106'::uuid],
  'private participant helper adds exact observation_class track branch'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.count(*),
      'kind', pg_catalog.min(calendar.kind),
      'trackIds', pg_catalog.min(calendar.track_ids),
      'subjects', pg_catalog.min(calendar.subjects),
      'observationNulls', pg_catalog.count(*) filter (
        where pg_catalog.num_nonnulls(
          calendar.observation_id,
          calendar.observation_track_id,
          calendar.observation_class_id,
          calendar.observation_class_name,
          calendar.observation_ends_at,
          calendar.observation_teacher_name,
          calendar.observation_classroom_name
        ) = 0
      )
    )
    from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000127'
  ),
  '{"count":1,"kind":"level_test","trackIds":["99300000-0000-4000-8000-000000000106"],"subjects":["영어"],"observationNulls":1}'::jsonb,
  'level-test keeps first ten calendar facts and all seven observation columns null'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.count(*),
      'kind', pg_catalog.min(calendar.kind),
      'trackIds', pg_catalog.min(calendar.track_ids),
      'subjects', pg_catalog.min(calendar.subjects),
      'observationNulls', pg_catalog.count(*) filter (
        where pg_catalog.num_nonnulls(
          calendar.observation_id,
          calendar.observation_track_id,
          calendar.observation_class_id,
          calendar.observation_class_name,
          calendar.observation_ends_at,
          calendar.observation_teacher_name,
          calendar.observation_classroom_name
        ) = 0
      )
    )
    from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000137'
  ),
  '{"count":1,"kind":"visit_consultation","trackIds":["99300000-0000-4000-8000-000000000106"],"subjects":["영어"],"observationNulls":1}'::jsonb,
  'visit keeps first ten calendar facts and all seven observation columns null'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.count(*),
      'kind', pg_catalog.min(calendar.kind),
      'trackIds', pg_catalog.min(calendar.track_ids),
      'subjects', pg_catalog.min(calendar.subjects),
      'observationId', pg_catalog.min(calendar.observation_id::text),
      'trackId', pg_catalog.min(calendar.observation_track_id::text),
      'classId', pg_catalog.min(calendar.observation_class_id::text),
      'className', pg_catalog.min(calendar.observation_class_name),
      'endsAt', pg_catalog.min(calendar.observation_ends_at),
      'teacherName', pg_catalog.min(calendar.observation_teacher_name),
      'classroomName', pg_catalog.min(calendar.observation_classroom_name)
    )
    from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'
  ),
  pg_catalog.jsonb_build_object(
    'count', 1,
    'kind', 'observation_class',
    'trackIds', array['99300000-0000-4000-8000-000000000106'::uuid],
    'subjects', array['영어'::text],
    'observationId', '99300000-0000-4000-8000-000000000108',
    'trackId', '99300000-0000-4000-8000-000000000106',
    'classId', '99300000-0000-4000-8000-000000000103',
    'className', '청강 등록 historical 영어반',
    'endsAt', (current_date - 2 + time '20:00') at time zone 'Asia/Seoul',
    'teacherName', '청강 등록 runner 담당',
    'classroomName', '청강 등록 runner 101호'
  ),
  'one observation appointment yields one canonical row with exact one-element arrays and safe snapshots'
);
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  1::bigint,
  'two view paths never duplicate the same unique observation appointment'
);

-- Manager/admin/staff/exact director see observation calendar rows; assigned
-- teacher and unrelated actor cannot bypass observation RLS through the view.
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  1::bigint,
  'active admin sees observation calendar row'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000002',
  true
);
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  1::bigint,
  'active staff sees observation calendar row'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000005',
  true
);
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  1::bigint,
  'exact director sees observation calendar row'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000003',
  true
);
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  0::bigint,
  'assigned observation teacher cannot read observation calendar row'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000004',
  true
);
select is(
  (select pg_catalog.count(*) from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = '99300000-0000-4000-8000-000000000107'),
  0::bigint,
  'unrelated actor cannot read observation calendar row'
);
reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000001',
  true
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id in (
      '99300000-0000-4000-8000-000000000108',
      '99300000-0000-4000-8000-000000000118'
    )
  ),
  0::bigint,
  'enrollment source and calendar workflow produce zero observation domain events'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.registration_observation_domain_events
  ),
  (
    select baseline.baseline_count
    from dashboard_private.registration_observation_local_qa_provider_baselines baseline
    where baseline.manifest_key = 'observation-domain-events'
  ),
  'provider outbox baseline remains zero-delta through the complete enrollment focus'
);

rollback;
