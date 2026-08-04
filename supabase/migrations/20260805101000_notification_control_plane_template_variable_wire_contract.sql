begin;

set local lock_timeout = '5s';

-- Keep the canonical template contract in its existing camelCase form for
-- persistence and checksum comparisons, but expose the historical API wire
-- shape (pii_class) that the settings client parses.
do $$
declare
  v_snapshot_definition text;
  v_raw_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_control_plane_snapshot_v1(text,boolean)'::pg_catalog.regprocedure
  )
  into v_snapshot_definition;

  if v_snapshot_definition is null then
    raise exception 'notification_control_plane_snapshot_missing'
      using errcode = '55000';
  end if;

  v_raw_definition := pg_catalog.regexp_replace(
    v_snapshot_definition,
    'FUNCTION[[:space:]]+dashboard_private[.]notification_control_plane_snapshot_v1[[:space:]]*[(]',
    'FUNCTION dashboard_private.notification_control_plane_snapshot_raw_v1(',
    'i'
  );

  if v_raw_definition = v_snapshot_definition
    or pg_catalog.strpos(
      v_raw_definition,
      'notification_control_plane_snapshot_raw_v1'
    ) = 0
  then
    raise exception 'notification_control_plane_snapshot_clone_failed'
      using errcode = '55000';
  end if;

  execute v_raw_definition;
end;
$$;

create or replace function dashboard_private.notification_control_plane_snapshot_v1(
  p_workflow_key text,
  p_editable boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with raw_snapshot as (
    select dashboard_private.notification_control_plane_snapshot_raw_v1(
      p_workflow_key,
      p_editable
    ) as payload
  ),
  normalized_rules as (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_set(
          rule_row.item,
          '{template,allowed_variables}'::text[],
          (
            select coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'key', variable_row.item ->> 'key',
                  'token', variable_row.item ->> 'token',
                  'pii_class', coalesce(
                    variable_row.item ->> 'piiClass',
                    variable_row.item ->> 'pii_class'
                  )
                )
                order by variable_row.ordinality
              ),
              '[]'::jsonb
            )
            from pg_catalog.jsonb_array_elements(
              coalesce(
                rule_row.item #> '{template,allowed_variables}'::text[],
                '[]'::jsonb
              )
            ) with ordinality variable_row(item, ordinality)
          ),
          true
        )
        order by rule_row.ordinality
      ),
      '[]'::jsonb
    ) as rules
    from raw_snapshot
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(raw_snapshot.payload -> 'rules', '[]'::jsonb)
    ) with ordinality rule_row(item, ordinality)
  )
  select pg_catalog.jsonb_set(
    raw_snapshot.payload,
    '{rules}'::text[],
    normalized_rules.rules,
    true
  )
  from raw_snapshot
  cross join normalized_rules;
$$;

alter function dashboard_private.notification_control_plane_snapshot_raw_v1(text, boolean)
  owner to postgres;
alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;

revoke all on function dashboard_private.notification_control_plane_snapshot_raw_v1(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;

commit;
