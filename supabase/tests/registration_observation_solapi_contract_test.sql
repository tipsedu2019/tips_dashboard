begin;

select plan(16);

select has_column(
  'public',
  'ops_registration_customer_messages',
  'observation_id',
  'customer messages retain the observation source identity'
);

select has_column(
  'dashboard_private',
  'registration_customer_solapi_activation',
  'automatic_delivery_cutoff_at',
  'automatic reminder activation has an explicit cutoff'
);

select results_eq(
  $$
    select message_kind || ':' || mode
    from dashboard_private.registration_customer_solapi_activation
    where message_kind like 'observation_%'
    order by message_kind
  $$,
  $$
    values
      ('observation_booking:off'::text),
      ('observation_reminder:off'::text)
  $$,
  'observation customer kinds are seeded OFF'
);

select is_empty(
  $$
    select 1
    from dashboard_private.registration_customer_solapi_template_receipts
    where message_kind like 'observation_%'
  $$,
  'observation customer kinds have no template receipt before review'
);

select throws_ok(
  $$
    insert into dashboard_private.registration_customer_solapi_activation(
      message_kind,
      mode
    ) values ('observation_unknown', 'off')
  $$,
  '23514',
  null,
  'unknown observation customer kinds remain closed'
);

create temporary table registration_observation_solapi_expected_message_lock (
  observation_id uuid,
  message_kind text,
  source_revision bigint
) on commit drop;

create unique index registration_observation_solapi_expected_message_lock_idx
  on registration_observation_solapi_expected_message_lock(
    observation_id,
    message_kind,
    source_revision
  )
  where message_kind in ('observation_booking', 'observation_reminder');

select ok(
  exists(
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    where index_row.indrelid =
      'public.ops_registration_customer_messages'::regclass
      and index_class.relname =
        'ops_reg_customer_msg_observation_revision_once_idx'
      and index_row.indisunique
      and array(
        select attribute.attname
        from pg_catalog.unnest(index_row.indkey::smallint[])
          with ordinality key_column(attnum, ordinal)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
          and attribute.attnum = key_column.attnum
        order by key_column.ordinal
      )::text[] = array[
        'observation_id',
        'message_kind',
        'source_revision'
      ]::text[]
      and pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        '[[:space:]]+',
        '',
        'g'
      ) = (
        select pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(expected_index.indpred, expected_index.indrelid),
          '[[:space:]]+',
          '',
          'g'
        )
        from pg_catalog.pg_index expected_index
        join pg_catalog.pg_class expected_index_class
          on expected_index_class.oid = expected_index.indexrelid
        where expected_index.indrelid =
            'pg_temp.registration_observation_solapi_expected_message_lock'::regclass
          and expected_index_class.relname =
            'registration_observation_solapi_expected_message_lock_idx'
      )
  ),
  'one customer message lock is unique and exactly observation revision scoped'
);

select is_empty(
  $$
    select 1
    from public.ops_registration_customer_messages
    where message_kind like 'observation_%'
  $$,
  'the contract seeds no durable observation customer message'
);

select is_empty(
  $$
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.set_registration_customer_solapi_cutoff_v1()'::regprocedure
      and (
        procedure.prosecdef
        or not exists(
          select 1
          from pg_catalog.pg_trigger trigger_row
          where trigger_row.tgfoid = procedure.oid
            and trigger_row.tgrelid =
              'dashboard_private.registration_customer_solapi_activation'::regclass
            and not trigger_row.tgisinternal
            and pg_catalog.pg_get_triggerdef(trigger_row.oid) ~
              '^CREATE TRIGGER set_registration_customer_solapi_cutoff BEFORE UPDATE OF mode ON dashboard_private.registration_customer_solapi_activation'
        )
      )
  $$,
  'the cutoff trigger is invoker and attached before activation mode updates'
);

select ok(
  (
    select exists(
      select 1
      from pg_catalog.unnest(coalesce(procedure.proconfig, '{}'::text[])) setting
      where setting in ('search_path=', 'search_path=""')
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.set_registration_customer_solapi_cutoff_v1()'::regprocedure
  ),
  'the cutoff trigger fixes an empty search path'
);

select is_empty(
  $$
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'dashboard_private'
      and routine_name = 'set_registration_customer_solapi_cutoff_v1'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  $$,
  'the cutoff trigger has no direct API execute grant'
);

select is_empty(
  $$
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.registration_customer_solapi_assert_kind_v1(text)'::regprocedure
      and (
        procedure.prosecdef
        or not exists(
          select 1
          from pg_catalog.unnest(coalesce(procedure.proconfig, '{}'::text[])) setting
          where setting in ('search_path=', 'search_path=""')
        )
        or exists(
          select 1
          from pg_catalog.unnest(
            array['anon', 'authenticated', 'service_role']::text[]
          ) role_name
          where has_function_privilege(role_name, procedure.oid, 'EXECUTE')
        )
      )
  $$,
  'the pure kind assertion is invoker with empty search path and no anon execute'
);

select matches(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname =
      'ops_registration_customer_message_previews_source_shape_check'
  ),
  'observation_booking.*observation_reminder.*observation_id IS NOT NULL.*appointment_id IS NOT NULL.*track_id IS NOT NULL.*source_revision IS NOT NULL',
  'preview observation source shape is closed'
);

select matches(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname =
      'ops_registration_customer_messages_source_shape_check'
  ),
  'observation_booking.*observation_reminder.*observation_id IS NOT NULL.*appointment_id IS NOT NULL.*track_id IS NOT NULL.*source_revision IS NOT NULL',
  'message observation source shape is closed'
);

select is_empty(
  $$
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.grantee = 'authenticated'
      and grant_row.table_schema in ('public', 'dashboard_private')
      and grant_row.table_name in (
        'ops_registration_customer_message_previews',
        'ops_registration_customer_messages',
        'registration_customer_solapi_activation'
      )
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  'authenticated has no direct customer-message writes'
);

alter table dashboard_private.registration_customer_solapi_activation
  drop constraint registration_customer_solapi_activation_shape_check;

create temporary table registration_observation_solapi_cutoff_transitions (
  phase text primary key,
  automatic_delivery_cutoff_at timestamptz
) on commit drop;

with changed as (
  update dashboard_private.registration_customer_solapi_activation activation
  set mode = 'live'
  where activation.message_kind = 'observation_reminder'
  returning activation.automatic_delivery_cutoff_at
)
insert into registration_observation_solapi_cutoff_transitions(
  phase,
  automatic_delivery_cutoff_at
)
select 'reminder_live', changed.automatic_delivery_cutoff_at
from changed;

with changed as (
  update dashboard_private.registration_customer_solapi_activation activation
  set mode = 'off'
  where activation.message_kind = 'observation_reminder'
  returning activation.automatic_delivery_cutoff_at
)
insert into registration_observation_solapi_cutoff_transitions(
  phase,
  automatic_delivery_cutoff_at
)
select 'reminder_off', changed.automatic_delivery_cutoff_at
from changed;

with changed as (
  update dashboard_private.registration_customer_solapi_activation activation
  set mode = 'live'
  where activation.message_kind = 'appointment_reminder'
  returning activation.automatic_delivery_cutoff_at
)
insert into registration_observation_solapi_cutoff_transitions(
  phase,
  automatic_delivery_cutoff_at
)
select 'legacy_live', changed.automatic_delivery_cutoff_at
from changed;

select is_empty(
  $$
    select 1
    from registration_observation_solapi_cutoff_transitions transition_row
    where (transition_row.phase = 'reminder_live'
      and transition_row.automatic_delivery_cutoff_at is null)
      or (transition_row.phase in ('reminder_off', 'legacy_live')
        and transition_row.automatic_delivery_cutoff_at is not null)
    union all
    select 1
    where (
      select count(*)
      from registration_observation_solapi_cutoff_transitions
    ) <> 3
    union all
    select 1
    from dashboard_private.registration_customer_solapi_activation
    where message_kind not in ('observation_booking', 'observation_reminder')
      and automatic_delivery_cutoff_at is not null
  $$,
  'cutoff trigger stamps live reminders, clears non-reminders, and preserves existing kinds'
);

update dashboard_private.registration_customer_solapi_activation
set mode = 'off'
where message_kind = 'appointment_reminder';

select is_empty(
  $$
    select 1
    from dashboard_private.registration_customer_solapi_activation
    where message_kind in ('observation_booking', 'observation_reminder')
      and (mode <> 'off' or automatic_delivery_cutoff_at is not null)
  $$,
  'new kinds remain OFF with no cutoff'
);

select * from finish();
rollback;
