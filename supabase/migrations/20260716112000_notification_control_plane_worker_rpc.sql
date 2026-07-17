begin;

set local lock_timeout = '5s';

-- Fan-out owns the immutable dispatch schedule snapshot. Existing rows created
-- before this worker migration inherit the event occurrence time; scheduled
-- rule reconciliation replaces it exactly once with its domain schedule.
alter table dashboard_private.notification_event_fanout_jobs
  add column if not exists scheduled_for timestamp with time zone;
alter table dashboard_private.notification_event_fanout_jobs
  add column if not exists scheduled_for_source text;

update dashboard_private.notification_event_fanout_jobs job
set scheduled_for = event_row.occurred_at,
    scheduled_for_source = 'event'
from dashboard_private.notification_events event_row
where event_row.id = job.event_id
  and (job.scheduled_for is null or job.scheduled_for_source is null);

alter table dashboard_private.notification_event_fanout_jobs
  alter column scheduled_for set default pg_catalog.clock_timestamp(),
  alter column scheduled_for set not null,
  alter column scheduled_for_source set default 'event',
  alter column scheduled_for_source set not null;

alter table dashboard_private.notification_event_fanout_jobs
  drop constraint if exists notification_event_fanout_jobs_schedule_source_check;
alter table dashboard_private.notification_event_fanout_jobs
  add constraint notification_event_fanout_jobs_schedule_source_check
  check (scheduled_for_source in ('event', 'rule_reconciliation'));

alter table dashboard_private.notification_dispatch_ownership_claims
  add column if not exists terminal_outcome text;
alter table dashboard_private.notification_dispatch_ownership_claims
  drop constraint if exists notification_dispatch_ownership_terminal_outcome_check;
alter table dashboard_private.notification_dispatch_ownership_claims
  add constraint notification_dispatch_ownership_terminal_outcome_check
  check (terminal_outcome is null or terminal_outcome in (
    'sent', 'failed', 'delivery_unknown'
  ));

-- This migration deliberately keeps every producer and worker mutation behind
-- service_role. Public authenticated entry points below are read/operator
-- wrappers that re-check auth.uid() and the dashboard role.

create or replace function dashboard_private.notification_worker_bounds_valid_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_worker_id), '') is not null
    and p_batch_size between 1 and 100
    and p_lease_seconds between 5 and 900;
$$;

create or replace function dashboard_private.notification_canonical_json_v1(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_type text := pg_catalog.jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'null' then
    return 'null';
  elsif v_type in ('boolean', 'number') then
    return p_value::text;
  elsif v_type = 'string' then
    return pg_catalog.to_jsonb(p_value #>> '{}')::text;
  elsif v_type = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      dashboard_private.notification_canonical_json_v1(item.value),
      ',' order by item.ordinality
    ), '') || ']'
    into v_result
    from pg_catalog.jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  elsif v_type = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(item.key)::text || ':' ||
        dashboard_private.notification_canonical_json_v1(item.value),
      ',' order by item.key
    ), '') || '}'
    into v_result
    from pg_catalog.jsonb_each(p_value) item(key, value);
    return v_result;
  end if;
  raise exception 'notification_canonical_json_invalid' using errcode = '22023';
end;
$$;

create or replace function dashboard_private.notification_target_set_hash_v1(
  p_deliveries jsonb
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '[' || coalesce(pg_catalog.string_agg(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'targetKind', delivery.value -> 'target_kind',
          'targetKey', delivery.value -> 'target_key',
          'targetProfileId', delivery.value -> 'target_profile_id',
          'connectionKey', delivery.value -> 'connection_key',
          'targetSnapshot', delivery.value -> 'target_snapshot'
        )
      ),
      ',' order by dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'targetKind', delivery.value -> 'target_kind',
          'targetKey', delivery.value -> 'target_key',
          'targetProfileId', delivery.value -> 'target_profile_id',
          'connectionKey', delivery.value -> 'connection_key',
          'targetSnapshot', delivery.value -> 'target_snapshot'
        )
      )
    ), '') || ']',
    'UTF8'
  )), 'hex')
  from pg_catalog.jsonb_array_elements(p_deliveries) delivery(value);
$$;

create or replace function dashboard_private.materialize_notification_delivery_v1(
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_template_id uuid,
  p_target_generation bigint,
  p_target_set_hash text,
  p_target_kind text,
  p_target_key text,
  p_target_profile_id uuid,
  p_connection_key text,
  p_target_snapshot jsonb,
  p_rendered_title text,
  p_rendered_body text,
  p_href text,
  p_scheduled_for timestamptz,
  p_parent_delivery_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_state jsonb;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_dedupe_key text;
begin
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;

  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id;

  if v_rule.scope_key <> v_event.scope_key
    or v_rule.workflow_key <> v_event.workflow_key
    or v_rule.event_key <> v_event.event_key
    or v_rule.revision <> p_rule_revision
    or v_rule.active_template_id <> p_template_id
    or p_target_generation is null
    or p_target_generation < 0
    or nullif(pg_catalog.btrim(p_target_set_hash), '') is null
    or p_target_kind is null
    or p_target_kind not in (
      'profile', 'connection', 'push_subscription', 'customer_endpoint', 'audience'
    )
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_snapshot is null
    or pg_catalog.jsonb_typeof(p_target_snapshot) <> 'object'
    or nullif(pg_catalog.btrim(p_rendered_title), '') is null
    or nullif(pg_catalog.btrim(p_rendered_body), '') is null
    or p_scheduled_for is null
    or (p_href is not null and (p_href not like '/admin/%' or p_href like '//%'))
    or not exists (
      select 1
      from dashboard_private.notification_templates template
      where template.id = p_template_id
        and template.rule_id = p_rule_id
        and template.payload_schema_version = v_event.payload_schema_version
    )
  then
    raise exception 'notification_delivery_materialization_invalid' using errcode = '22023';
  end if;

  if p_target_profile_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = p_target_profile_id
  ) then
    raise exception 'notification_delivery_recipient_invalid' using errcode = '22023';
  end if;

  v_state := dashboard_private.notification_initial_delivery_state_v1(
    v_event.workflow_key,
    v_event.event_key,
    v_rule.enabled
  );
  v_dedupe_key := pg_catalog.md5(
    v_event.id::text || ':' || p_rule_id::text || ':' || v_rule.channel_key || ':' ||
    p_target_kind || ':' || p_target_key || ':' || p_target_generation::text
  );

  insert into dashboard_private.notification_deliveries(
    event_id,
    rule_id,
    rule_revision,
    template_id,
    channel_key,
    audience_key,
    target_generation,
    target_set_hash,
    target_kind,
    target_key,
    target_profile_id,
    connection_key,
    target_snapshot,
    parent_delivery_id,
    status,
    status_reason,
    dedupe_key,
    rendered_title,
    rendered_body,
    href,
    scheduled_for,
    max_attempts,
    next_attempt_at
  ) values (
    p_event_id,
    p_rule_id,
    p_rule_revision,
    p_template_id,
    v_rule.channel_key,
    v_rule.audience_key,
    p_target_generation,
    p_target_set_hash,
    p_target_kind,
    p_target_key,
    p_target_profile_id,
    p_connection_key,
    p_target_snapshot,
    p_parent_delivery_id,
    v_state ->> 'status',
    v_state ->> 'status_reason',
    v_dedupe_key,
    p_rendered_title,
    p_rendered_body,
    p_href,
    p_scheduled_for,
    case when v_rule.channel_key = 'in_app' then 1 else 5 end,
    case when v_state ->> 'status' = 'pending' then pg_catalog.clock_timestamp() else null end
  )
  on conflict (dedupe_key) do nothing
  returning * into v_delivery;

  if not found then
    select delivery.*
    into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.dedupe_key = v_dedupe_key
    for update of delivery;
    if v_delivery.event_id <> p_event_id
      or v_delivery.rule_id <> p_rule_id
      or v_delivery.rule_revision <> p_rule_revision
      or v_delivery.template_id <> p_template_id
      or v_delivery.target_generation <> p_target_generation
      or v_delivery.target_set_hash <> p_target_set_hash
      or v_delivery.target_kind <> p_target_kind
      or v_delivery.target_key <> p_target_key
      or v_delivery.target_profile_id is distinct from p_target_profile_id
      or v_delivery.connection_key is distinct from p_connection_key
      or v_delivery.target_snapshot <> p_target_snapshot
      or v_delivery.rendered_title <> p_rendered_title
      or v_delivery.rendered_body <> p_rendered_body
      or v_delivery.href is distinct from p_href
      or v_delivery.scheduled_for <> p_scheduled_for
    then
      raise exception 'notification_delivery_replay_mismatch' using errcode = '22023';
    end if;
  end if;

  if v_delivery.status = 'pending' then
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(v_delivery.id);
  end if;
  return v_delivery.id;
end;
$$;

create or replace function public.apply_notification_rule_reconciliation_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_rule_reconciliation_jobs%rowtype;
  v_source jsonb;
  v_occurrence jsonb;
  v_recorded jsonb;
  v_processed integer := 0;
  v_canceled integer := 0;
  v_page_canceled integer := 0;
  v_regenerated integer := 0;
begin
  if p_job_id is null
    or p_claim_token is null
    or p_batch is null
    or pg_catalog.jsonb_typeof(p_batch) <> 'object'
    or not (p_batch ?& array['sources', 'occurrences']::text[])
    or p_batch - array['sources', 'occurrences']::text[] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_batch -> 'sources') <> 'array'
    or pg_catalog.jsonb_typeof(p_batch -> 'occurrences') <> 'array'
    or p_done is null
    or (p_done and p_next_cursor is not null)
    or (not p_done and nullif(p_next_cursor, '') is null)
  then
    raise exception 'notification_rule_reconciliation_batch_invalid' using errcode = '22023';
  end if;

  select job.* into v_job
  from dashboard_private.notification_rule_reconciliation_jobs job
  where job.id = p_job_id
  for update of job;
  if not found or v_job.status <> 'claimed' or v_job.claim_token <> p_claim_token then
    raise exception 'notification_reconciliation_claim_mismatch' using errcode = '40001';
  end if;
  if nullif(v_job.cursor ->> 'value', '') is distinct from nullif(p_expected_cursor, '') then
    raise exception 'notification_reconciliation_cursor_conflict' using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(v_job.rule_revision_map) captured(rule_id, revision)
    where captured.rule_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or captured.revision !~ '^[1-9][0-9]*$'
       or not exists (
         select 1
         from dashboard_private.notification_rules rule
         where rule.id = captured.rule_id::uuid
           and rule.workflow_key = v_job.workflow_key
           and rule.revision = captured.revision::bigint
       )
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'superseded',
      'processed_count', 0,
      'canceled_count', 0,
      'regenerated_count', 0,
      'cursor', nullif(v_job.cursor ->> 'value', '')
    );
  end if;

  for v_source in select value from pg_catalog.jsonb_array_elements(p_batch -> 'sources')
  loop
    if pg_catalog.jsonb_typeof(v_source) <> 'object'
      or not (v_source ?& array['source_type', 'source_id', 'source_revision']::text[])
      or v_source - array['source_type', 'source_id', 'source_revision']::text[] <> '{}'::jsonb
      or nullif(pg_catalog.btrim(v_source ->> 'source_type'), '') is null
      or nullif(pg_catalog.btrim(v_source ->> 'source_id'), '') is null
      or (
        v_source -> 'source_revision' <> 'null'::jsonb
        and (v_source ->> 'source_revision') !~ '^[1-9][0-9]*$'
      )
    then
      raise exception 'notification_rule_reconciliation_source_invalid' using errcode = '22023';
    end if;
    v_processed := v_processed + 1;

    with canceled as (
      update dashboard_private.notification_deliveries delivery
      set status = 'canceled',
          status_reason = 'rule_revision_changed',
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row
      where delivery.event_id = event_row.id
        and event_row.workflow_key = v_job.workflow_key
        and event_row.source_type = v_source ->> 'source_type'
        and event_row.source_id = v_source ->> 'source_id'
        and event_row.source_revision is not distinct from case
          when v_source -> 'source_revision' = 'null'::jsonb then null
          else (v_source ->> 'source_revision')::bigint
        end
        and delivery.status in ('pending', 'retry_wait')
      returning delivery.id
    ), requested as (
      update dashboard_private.notification_deliveries delivery
      set cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.clock_timestamp()),
          cancel_reason = 'rule_revision_changed',
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row
      where delivery.event_id = event_row.id
        and event_row.workflow_key = v_job.workflow_key
        and event_row.source_type = v_source ->> 'source_type'
        and event_row.source_id = v_source ->> 'source_id'
        and event_row.source_revision is not distinct from case
          when v_source -> 'source_revision' = 'null'::jsonb then null
          else (v_source ->> 'source_revision')::bigint
        end
        and delivery.status = 'claimed'
      returning delivery.id
    )
    select (select count(*) from canceled) + (select count(*) from requested)
    into v_page_canceled;
    v_canceled := v_canceled + v_page_canceled;
  end loop;

  for v_occurrence in select value from pg_catalog.jsonb_array_elements(p_batch -> 'occurrences')
  loop
    if pg_catalog.jsonb_typeof(v_occurrence) <> 'object'
      or not (v_occurrence ?& array[
        'event_key', 'source_type', 'source_id', 'source_revision', 'occurrence_key',
        'occurred_at', 'payload_schema_version', 'payload', 'materialized_rule_id',
        'materialized_rule_revision', 'scheduled_for'
      ]::text[])
      or v_occurrence - array[
        'event_key', 'source_type', 'source_id', 'source_revision', 'occurrence_key',
        'occurred_at', 'payload_schema_version', 'payload', 'materialized_rule_id',
        'materialized_rule_revision', 'scheduled_for'
      ]::text[] <> '{}'::jsonb
      or (v_occurrence ->> 'materialized_rule_revision') !~ '^[1-9][0-9]*$'
      or (v_occurrence ->> 'payload_schema_version') !~ '^[1-9][0-9]*$'
      or pg_catalog.jsonb_typeof(v_occurrence -> 'occurred_at') <> 'string'
      or nullif(v_occurrence ->> 'occurred_at', '') is null
      or pg_catalog.jsonb_typeof(v_occurrence -> 'scheduled_for') <> 'string'
      or nullif(v_occurrence ->> 'scheduled_for', '') is null
      or pg_catalog.jsonb_typeof(v_occurrence -> 'payload') <> 'object'
    then
      raise exception 'notification_rule_reconciliation_occurrence_invalid' using errcode = '22023';
    end if;

    v_recorded := dashboard_private.record_notification_event_v1(
      'global',
      v_job.workflow_key,
      v_occurrence ->> 'event_key',
      v_occurrence ->> 'source_type',
      v_occurrence ->> 'source_id',
      case when v_occurrence -> 'source_revision' = 'null'::jsonb then null
        else (v_occurrence ->> 'source_revision')::bigint end,
      v_occurrence ->> 'occurrence_key',
      null,
      (v_occurrence ->> 'occurred_at')::timestamptz,
      (v_occurrence ->> 'payload_schema_version')::integer,
      v_occurrence -> 'payload',
      (v_occurrence ->> 'materialized_rule_id')::uuid,
      (v_occurrence ->> 'materialized_rule_revision')::bigint
    );

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'notification-fanout-schedule:' || (v_recorded ->> 'fanout_job_id'), 0
    ));
    if exists (
      select 1
      from dashboard_private.notification_event_fanout_jobs job
      where job.id = (v_recorded ->> 'fanout_job_id')::uuid
        and job.scheduled_for_source = 'rule_reconciliation'
        and job.scheduled_for is distinct from
          (v_occurrence ->> 'scheduled_for')::timestamptz
    ) then
      raise exception 'notification_rule_reconciliation_schedule_replay_mismatch'
        using errcode = '22023';
    end if;
    update dashboard_private.notification_event_fanout_jobs job
    set scheduled_for = (v_occurrence ->> 'scheduled_for')::timestamptz,
        scheduled_for_source = 'rule_reconciliation',
        updated_at = pg_catalog.clock_timestamp()
    where job.id = (v_recorded ->> 'fanout_job_id')::uuid
      and job.scheduled_for_source = 'event';

    perform v_recorded;
    v_regenerated := v_regenerated + 1;
  end loop;

  update dashboard_private.notification_rule_reconciliation_jobs job
  set cursor = case when p_next_cursor is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('value', p_next_cursor) end,
      processed_count = job.processed_count + v_processed,
      canceled_count = job.canceled_count + v_canceled,
      regenerated_count = job.regenerated_count + v_regenerated,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'processed_count', v_processed,
    'canceled_count', v_canceled,
    'regenerated_count', v_regenerated,
    'cursor', p_next_cursor,
    'done', p_done
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'notification_rule_reconciliation_batch_invalid' using errcode = '22023';
end;
$$;

create or replace function public.apply_notification_target_reconciliation_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_target_reconciliation_jobs%rowtype;
  v_delivery jsonb;
  v_delivery_id uuid;
  v_canceled integer := 0;
  v_inserted integer := 0;
  v_revoked integer := 0;
begin
  if p_job_id is null
    or p_claim_token is null
    or p_batch is null
    or pg_catalog.jsonb_typeof(p_batch) <> 'object'
    or not (p_batch ?& array['target_generation', 'target_set_hash', 'deliveries']::text[])
    or p_batch - array['target_generation', 'target_set_hash', 'deliveries']::text[] <> '{}'::jsonb
    or (p_batch ->> 'target_generation') !~ '^(0|[1-9][0-9]*)$'
    or (p_batch ->> 'target_set_hash') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_batch -> 'deliveries') <> 'array'
    or p_done is null
    or (p_done and p_next_cursor is not null)
    or (not p_done and nullif(p_next_cursor, '') is null)
  then
    raise exception 'notification_target_reconciliation_batch_invalid' using errcode = '22023';
  end if;

  select job.* into v_job
  from dashboard_private.notification_target_reconciliation_jobs job
  where job.id = p_job_id
  for update of job;
  if not found or v_job.status <> 'claimed' or v_job.claim_token <> p_claim_token then
    raise exception 'notification_reconciliation_claim_mismatch' using errcode = '40001';
  end if;
  if nullif(v_job.cursor ->> 'value', '') is distinct from nullif(p_expected_cursor, '') then
    raise exception 'notification_reconciliation_cursor_conflict' using errcode = '40001';
  end if;

  if (p_batch ->> 'target_generation')::bigint <> v_job.target_generation
    or p_batch ->> 'target_set_hash' <> v_job.current_target_set_hash
    or exists (
      select 1
      from dashboard_private.notification_target_reconciliation_jobs newer
      where newer.workflow_key = v_job.workflow_key
        and newer.source_type = v_job.source_type
        and newer.source_id = v_job.source_id
        and newer.target_generation > v_job.target_generation
        and newer.created_at >= v_job.created_at
    )
  then
    return pg_catalog.jsonb_build_object(
      'outcome', 'superseded',
      'canceled_count', 0,
      'delivery_count', 0,
      'revoked_count', 0,
      'cursor', nullif(v_job.cursor ->> 'value', '')
    );
  end if;

  with canceled as (
    update dashboard_private.notification_deliveries delivery
    set status = 'canceled',
        status_reason = 'recipient_revoked',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and delivery.target_generation < v_job.target_generation
      and delivery.status in ('pending', 'retry_wait')
    returning delivery.id
  ), requested as (
    update dashboard_private.notification_deliveries delivery
    set cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.clock_timestamp()),
        cancel_reason = 'recipient_revoked',
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and delivery.target_generation < v_job.target_generation
      and delivery.status = 'claimed'
    returning delivery.id
  )
  select (select count(*) from canceled) + (select count(*) from requested)
  into v_canceled;

  with revoked as (
    update public.dashboard_notifications notification
    set revoked_at = coalesce(notification.revoked_at, pg_catalog.clock_timestamp()),
        revoked_reason = coalesce(notification.revoked_reason, 'recipient_revoked')
    from dashboard_private.notification_deliveries delivery,
         dashboard_private.notification_events event_row
    where notification.source_delivery_id = delivery.id
      and delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and delivery.target_generation < v_job.target_generation
      and notification.revoked_at is null
    returning notification.id
  )
  select count(*) into v_revoked from revoked;

  for v_delivery in select value from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
  loop
    if pg_catalog.jsonb_typeof(v_delivery) <> 'object'
      or not (v_delivery ?& array[
        'event_id', 'rule_id', 'rule_revision', 'template_id', 'target_kind',
        'target_key', 'target_profile_id', 'connection_key', 'target_snapshot',
        'rendered_title', 'rendered_body', 'href', 'scheduled_for'
      ]::text[])
      or v_delivery - array[
        'event_id', 'rule_id', 'rule_revision', 'template_id', 'target_kind',
        'target_key', 'target_profile_id', 'connection_key', 'target_snapshot',
        'rendered_title', 'rendered_body', 'href', 'scheduled_for'
      ]::text[] <> '{}'::jsonb
      or (v_delivery ->> 'rule_revision') !~ '^[1-9][0-9]*$'
      or not exists (
        select 1
        from dashboard_private.notification_events event_row
        where event_row.id = (v_delivery ->> 'event_id')::uuid
          and event_row.workflow_key = v_job.workflow_key
          and event_row.source_type = v_job.source_type
          and event_row.source_id = v_job.source_id
          and event_row.source_revision is not distinct from v_job.source_revision
      )
    then
      raise exception 'notification_target_reconciliation_delivery_invalid' using errcode = '22023';
    end if;

    v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
      (v_delivery ->> 'event_id')::uuid,
      (v_delivery ->> 'rule_id')::uuid,
      (v_delivery ->> 'rule_revision')::bigint,
      (v_delivery ->> 'template_id')::uuid,
      v_job.target_generation,
      v_job.current_target_set_hash,
      v_delivery ->> 'target_kind',
      v_delivery ->> 'target_key',
      case when v_delivery -> 'target_profile_id' = 'null'::jsonb then null
        else (v_delivery ->> 'target_profile_id')::uuid end,
      case when v_delivery -> 'connection_key' = 'null'::jsonb then null
        else v_delivery ->> 'connection_key' end,
      v_delivery -> 'target_snapshot',
      v_delivery ->> 'rendered_title',
      v_delivery ->> 'rendered_body',
      case when v_delivery -> 'href' = 'null'::jsonb then null else v_delivery ->> 'href' end,
      (v_delivery ->> 'scheduled_for')::timestamptz
    );
    perform v_delivery_id;
    v_inserted := v_inserted + 1;
  end loop;

  if (
      pg_catalog.jsonb_array_length(p_batch -> 'deliveries') = 0
      and dashboard_private.notification_target_set_hash_v1('[]'::jsonb)
        <> v_job.current_target_set_hash
    ) or exists (
      select 1
      from (
        select pg_catalog.jsonb_agg(
          delivery.value order by delivery.ordinality
        ) as deliveries
        from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
          with ordinality delivery(value, ordinality)
        group by
          delivery.value ->> 'event_id',
          delivery.value ->> 'rule_id',
          delivery.value ->> 'rule_revision'
      ) target_page
      where dashboard_private.notification_target_set_hash_v1(target_page.deliveries)
        <> v_job.current_target_set_hash
    )
  then
    raise exception 'notification_target_set_hash_mismatch' using errcode = '22023';
  end if;

  update dashboard_private.notification_target_reconciliation_jobs job
  set cursor = case when p_next_cursor is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('value', p_next_cursor) end,
      canceled_count = job.canceled_count + v_canceled,
      fanout_count = job.fanout_count + v_inserted,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'canceled_count', v_canceled,
    'delivery_count', v_inserted,
    'revoked_count', v_revoked,
    'cursor', p_next_cursor,
    'done', p_done
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'notification_target_reconciliation_batch_invalid' using errcode = '22023';
end;
$$;


create or replace function dashboard_private.notification_dispatch_enabled_v1(
  p_workflow_key text,
  p_event_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select flag.enabled
    from dashboard_private.notification_runtime_flags flag
    where flag.flag_key = case
      when p_workflow_key = 'registration'
        and p_event_key = 'registration.phone_consultation_ready'
        then 'notification_control_plane_registration_phone_adapter_enabled'
      when p_workflow_key = 'registration'
        and p_event_key in (
          'registration.visit_scheduled',
          'registration.visit_rescheduled',
          'registration.visit_replaced',
          'registration.visit_subject_deselected',
          'registration.visit_canceled'
        ) then 'notification_control_plane_registration_visit_adapter_enabled'
      when p_workflow_key = 'registration'
        and p_event_key in (
          'registration.admission_message_requested',
          'registration.admission_message_accepted',
          'registration.admission_message_failed',
          'registration.admission_message_unknown',
          'registration.admission_message_reconciled',
          'registration.admission_message_retry_released'
        ) then 'notification_control_plane_registration_solapi_adapter_enabled'
      else 'notification_control_plane_dispatch_' || p_workflow_key || '_enabled'
    end
  ), false);
$$;

create or replace function dashboard_private.notification_shadow_enabled_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select flag.enabled
    from dashboard_private.notification_runtime_flags flag
    where flag.flag_key = 'notification_control_plane_shadow_write_enabled'
  ), false);
$$;

create or replace function dashboard_private.notification_initial_delivery_state_v1(
  p_workflow_key text,
  p_event_key text,
  p_rule_enabled boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not p_rule_enabled then pg_catalog.jsonb_build_object(
      'status', 'disabled', 'status_reason', 'rule_disabled'
    )
    when dashboard_private.notification_dispatch_enabled_v1(p_workflow_key, p_event_key)
      then pg_catalog.jsonb_build_object('status', 'pending', 'status_reason', null)
    when dashboard_private.notification_shadow_enabled_v1()
      then pg_catalog.jsonb_build_object('status', 'skipped', 'status_reason', 'shadow_mode')
    else pg_catalog.jsonb_build_object('status', 'skipped', 'status_reason', 'legacy_skipped')
  end;
$$;

create or replace function dashboard_private.notification_safe_job_outcome_v1(
  p_outcome jsonb
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_outcome is not null
    and pg_catalog.jsonb_typeof(p_outcome) = 'object'
    and pg_catalog.octet_length(p_outcome::text) <= 4096
    and not (p_outcome::text ~* '(payload|rendered|title|body|href|target|endpoint|webhook|p256dh|auth|secret|token)');
$$;

create or replace function dashboard_private.record_notification_event_v1(
  p_scope_key text,
  p_workflow_key text,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_occurrence_key text,
  p_actor_profile_id uuid,
  p_occurred_at timestamptz,
  p_payload_schema_version integer,
  p_payload jsonb,
  p_materialized_rule_id uuid default null,
  p_materialized_rule_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_fanout_job_id uuid;
  v_rule_snapshot jsonb;
begin
  if p_scope_key is null or p_scope_key <> 'global'
    or p_workflow_key is null
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or nullif(pg_catalog.btrim(p_source_type), '') is null
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_occurred_at is null
    or p_payload_schema_version is null
    or p_payload_schema_version < 1
    or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or (p_source_revision is not null and p_source_revision < 1)
    or ((p_materialized_rule_id is null) <> (p_materialized_rule_revision is null))
  then
    raise exception 'notification_event_invalid' using errcode = '22023';
  end if;

  if p_actor_profile_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = p_actor_profile_id
  ) then
    raise exception 'notification_event_actor_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_scope_key || ':' || p_workflow_key || ':' || p_source_type || ':' ||
    p_source_id || ':' || p_event_key || ':' || p_occurrence_key,
    0
  ));
  select event_row.*
  into v_event
  from dashboard_private.notification_events event_row
  where event_row.scope_key = p_scope_key
    and event_row.workflow_key = p_workflow_key
    and event_row.source_type = p_source_type
    and event_row.source_id = p_source_id
    and event_row.event_key = p_event_key
    and event_row.occurrence_key = p_occurrence_key
  for update of event_row;
  if found then
    if v_event.source_revision is distinct from p_source_revision
      or v_event.actor_profile_id is distinct from p_actor_profile_id
      or v_event.occurred_at is distinct from p_occurred_at
      or v_event.payload_schema_version <> p_payload_schema_version
      or v_event.payload <> p_payload
      or v_event.materialized_rule_id is distinct from p_materialized_rule_id
      or v_event.materialized_rule_revision is distinct from p_materialized_rule_revision
    then
      raise exception 'notification_event_replay_mismatch' using errcode = '22023';
    end if;
    select job.id into strict v_fanout_job_id
    from dashboard_private.notification_event_fanout_jobs job
    where job.event_id = v_event.id;
    return pg_catalog.jsonb_build_object(
      'event_id', v_event.id,
      'fanout_job_id', v_fanout_job_id
    );
  end if;

  if p_materialized_rule_id is not null then
    select coalesce(pg_catalog.jsonb_agg(rule_snapshot.item order by rule_snapshot.rule_id), '[]'::jsonb)
    into v_rule_snapshot
    from (
      select
        rule.id as rule_id,
        pg_catalog.jsonb_build_object(
          'rule_id', rule.id,
          'rule_revision', rule.revision::text,
          'template_id', rule.active_template_id,
          'channel_key', rule.channel_key,
          'audience_key', rule.audience_key,
          'rule_variant_key', rule.rule_variant_key,
          'enabled', rule.enabled
        ) as item
      from dashboard_private.notification_rules rule
      where rule.id = p_materialized_rule_id
        and rule.scope_key = p_scope_key
        and rule.workflow_key = p_workflow_key
        and rule.event_key = p_event_key
        and rule.revision = p_materialized_rule_revision
    ) rule_snapshot;
    if pg_catalog.jsonb_array_length(v_rule_snapshot) <> 1 then
      raise exception 'notification_materialized_rule_revision_invalid' using errcode = '40001';
    end if;
  else
    select coalesce(pg_catalog.jsonb_agg(rule_snapshot.item order by rule_snapshot.rule_id), '[]'::jsonb)
    into v_rule_snapshot
    from (
      select
        rule.id as rule_id,
        pg_catalog.jsonb_build_object(
          'rule_id', rule.id,
          'rule_revision', rule.revision::text,
          'template_id', rule.active_template_id,
          'channel_key', rule.channel_key,
          'audience_key', rule.audience_key,
          'rule_variant_key', rule.rule_variant_key,
          'enabled', rule.enabled
        ) as item
      from dashboard_private.notification_rules rule
      where rule.scope_key = p_scope_key
        and rule.workflow_key = p_workflow_key
        and rule.event_key = p_event_key
      order by rule.id
    ) rule_snapshot;
  end if;

  insert into dashboard_private.notification_events(
    scope_key,
    workflow_key,
    event_key,
    source_type,
    source_id,
    source_revision,
    occurrence_key,
    actor_profile_id,
    occurred_at,
    payload_schema_version,
    payload,
    rule_snapshot,
    materialized_rule_id,
    materialized_rule_revision
  ) values (
    p_scope_key,
    p_workflow_key,
    p_event_key,
    p_source_type,
    p_source_id,
    p_source_revision,
    p_occurrence_key,
    p_actor_profile_id,
    p_occurred_at,
    p_payload_schema_version,
    p_payload,
    v_rule_snapshot,
    p_materialized_rule_id,
    p_materialized_rule_revision
  )
  on conflict (
    scope_key, workflow_key, source_type, source_id, event_key, occurrence_key
  ) do nothing
  returning * into v_event;

  if not found then
    select event_row.*
    into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.scope_key = p_scope_key
      and event_row.workflow_key = p_workflow_key
      and event_row.source_type = p_source_type
      and event_row.source_id = p_source_id
      and event_row.event_key = p_event_key
      and event_row.occurrence_key = p_occurrence_key
    for update of event_row;

    if v_event.source_revision is distinct from p_source_revision
      or v_event.actor_profile_id is distinct from p_actor_profile_id
      or v_event.occurred_at is distinct from p_occurred_at
      or v_event.payload_schema_version <> p_payload_schema_version
      or v_event.payload <> p_payload
      or v_event.materialized_rule_id is distinct from p_materialized_rule_id
      or v_event.materialized_rule_revision is distinct from p_materialized_rule_revision
    then
      raise exception 'notification_event_replay_mismatch' using errcode = '22023';
    end if;
  end if;

  insert into dashboard_private.notification_event_fanout_jobs(
    event_id,
    workflow_key,
    status,
    next_attempt_at,
    scheduled_for,
    scheduled_for_source
  ) values (
    v_event.id,
    v_event.workflow_key,
    'pending',
    pg_catalog.clock_timestamp(),
    v_event.occurred_at,
    'event'
  )
  on conflict (event_id) do nothing
  returning id into v_fanout_job_id;

  if v_fanout_job_id is null then
    select job.id
    into strict v_fanout_job_id
    from dashboard_private.notification_event_fanout_jobs job
    where job.event_id = v_event.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'fanout_job_id', v_fanout_job_id
  );
end;
$$;

create or replace function dashboard_private.enqueue_notification_target_reconciliation_job_v1(
  p_workflow_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_source_event_id uuid,
  p_reconciliation_kind text,
  p_target_generation bigint,
  p_previous_target_set_hash text,
  p_current_target_set_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_target_reconciliation_jobs%rowtype;
begin
  if p_workflow_key is null
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_source_type), '') is null
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or p_source_event_id is null
    or p_reconciliation_kind is null
    or p_reconciliation_kind <> 'recipient_set_changed'
    or p_target_generation is null
    or p_target_generation < 1
    or p_current_target_set_hash is null
    or p_current_target_set_hash !~ '^[a-f0-9]{64}$'
    or (
      p_previous_target_set_hash is not null
      and p_previous_target_set_hash !~ '^[a-f0-9]{64}$'
    )
    or (p_source_revision is not null and p_source_revision < 1)
  then
    raise exception 'notification_target_reconciliation_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workflow_key || ':' || p_source_type || ':' || p_source_id || ':' ||
    p_source_event_id::text || ':' || p_reconciliation_kind,
    0
  ));

  insert into dashboard_private.notification_target_reconciliation_jobs(
    workflow_key,
    source_type,
    source_id,
    source_revision,
    source_event_id,
    reconciliation_kind,
    target_generation,
    previous_target_set_hash,
    current_target_set_hash,
    status,
    next_attempt_at
  ) values (
    p_workflow_key,
    p_source_type,
    p_source_id,
    p_source_revision,
    p_source_event_id,
    p_reconciliation_kind,
    p_target_generation,
    p_previous_target_set_hash,
    p_current_target_set_hash,
    'pending',
    pg_catalog.clock_timestamp()
  )
  on conflict (
    workflow_key, source_type, source_id, source_revision, source_event_id, reconciliation_kind
  ) do nothing
  returning * into v_job;

  if not found then
    select job.*
    into strict v_job
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.workflow_key = p_workflow_key
      and job.source_type = p_source_type
      and job.source_id = p_source_id
      and job.source_revision is not distinct from p_source_revision
      and job.source_event_id = p_source_event_id
      and job.reconciliation_kind = p_reconciliation_kind
    for update of job;
    if v_job.target_generation <> p_target_generation
      or v_job.previous_target_set_hash is distinct from p_previous_target_set_hash
      or v_job.current_target_set_hash <> p_current_target_set_hash
    then
      raise exception 'notification_target_reconciliation_replay_mismatch' using errcode = '22023';
    end if;
  end if;

  return v_job.id;
end;
$$;

create or replace function dashboard_private.get_notification_render_snapshot_v1(
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_template dashboard_private.notification_templates%rowtype;
begin
  if p_event_id is null or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
  then
    raise exception 'notification_render_snapshot_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;
  if not found then
    raise exception 'notification_event_not_found' using errcode = 'P0002';
  end if;
  select snapshot.value into v_rule_snapshot
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(value)
  where snapshot.value ->> 'rule_id' = p_rule_id::text
    and snapshot.value ->> 'rule_revision' = p_rule_revision::text;
  if not found then
    raise exception 'notification_render_snapshot_rule_mismatch' using errcode = '40001';
  end if;
  select template.* into strict v_template
  from dashboard_private.notification_templates template
  where template.id = (v_rule_snapshot ->> 'template_id')::uuid
    and template.rule_id = p_rule_id;

  return pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'workflow_key', v_event.workflow_key,
    'event_key', v_event.event_key,
    'source_type', v_event.source_type,
    'source_id', v_event.source_id,
    'source_revision', case when v_event.source_revision is null then null
      else v_event.source_revision::text end,
    'occurrence_key', v_event.occurrence_key,
    'occurred_at', v_event.occurred_at,
    'payload_schema_version', v_event.payload_schema_version,
    'payload', v_event.payload,
    'rule_id', p_rule_id,
    'rule_revision', p_rule_revision::text,
    'template_id', v_template.id,
    'channel_key', v_rule_snapshot ->> 'channel_key',
    'audience_key', v_rule_snapshot ->> 'audience_key',
    'rule_variant_key', v_rule_snapshot ->> 'rule_variant_key',
    'title_template', v_template.title_template,
    'body_template', v_template.body_template,
    'allowed_variables', v_template.allowed_variables,
    'template_payload_schema_version', v_template.payload_schema_version
  );
end;
$$;

create or replace function dashboard_private.apply_notification_fanout_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_target_set_hash text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_event_fanout_jobs%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_rule_index integer;
  v_rule_count integer;
  v_delivery jsonb;
  v_delivery_id uuid;
  v_delivery_count integer := 0;
  v_targets jsonb := '[]'::jsonb;
begin
  if p_job_id is null or p_claim_token is null or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_target_set_hash is null or p_target_set_hash !~ '^[a-f0-9]{64}$'
    or p_batch is null or pg_catalog.jsonb_typeof(p_batch) <> 'object'
    or not (p_batch ? 'deliveries')
    or p_batch - 'deliveries' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_batch -> 'deliveries') <> 'array'
    or p_done is null
    or (p_done and p_next_cursor is not null)
    or (not p_done and nullif(p_next_cursor, '') is null)
  then
    raise exception 'notification_fanout_batch_invalid' using errcode = '22023';
  end if;

  select job.* into v_job
  from dashboard_private.notification_event_fanout_jobs job
  where job.id = p_job_id
  for update of job;
  if not found or v_job.status <> 'claimed' or v_job.claim_token <> p_claim_token then
    raise exception 'notification_fanout_claim_mismatch' using errcode = '40001';
  end if;
  if coalesce((v_job.cursor ->> 'done')::boolean, false)
    or nullif(v_job.cursor ->> 'value', '') is distinct from nullif(p_expected_cursor, '')
  then
    raise exception 'notification_fanout_cursor_conflict' using errcode = '40001';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_job.event_id;
  v_rule_count := pg_catalog.jsonb_array_length(v_event.rule_snapshot);
  v_rule_index := coalesce(nullif(v_job.cursor ->> 'value', '')::integer, 0);
  v_rule_snapshot := v_event.rule_snapshot -> v_rule_index;
  if v_rule_snapshot is null
    or v_rule_snapshot ->> 'rule_id' <> p_rule_id::text
    or v_rule_snapshot ->> 'rule_revision' <> p_rule_revision::text
    or (
      p_done and p_next_cursor is not null
      or not p_done and p_next_cursor <> (v_rule_index + 1)::text
    )
    or p_done is distinct from (v_rule_index >= v_rule_count - 1)
  then
    raise exception 'notification_fanout_rule_cursor_mismatch' using errcode = '40001';
  end if;

  if not exists (
    select 1
    from dashboard_private.notification_rules rule
    where rule.id = p_rule_id
      and rule.workflow_key = v_event.workflow_key
      and rule.event_key = v_event.event_key
      and rule.revision = p_rule_revision
      and rule.active_template_id = (v_rule_snapshot ->> 'template_id')::uuid
  ) then
    update dashboard_private.notification_event_fanout_jobs job
    set cursor = case when p_done then pg_catalog.jsonb_build_object('done', true)
      else pg_catalog.jsonb_build_object('value', p_next_cursor, 'done', false) end,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = v_job.id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'superseded',
      'delivery_count', 0,
      'cursor', p_next_cursor,
      'done', p_done
    );
  end if;

  for v_delivery in select value from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
  loop
    if pg_catalog.jsonb_typeof(v_delivery) <> 'object'
      or not (v_delivery ?& array[
        'template_id', 'target_kind', 'target_key', 'target_profile_id',
        'connection_key', 'target_snapshot', 'rendered_title', 'rendered_body',
        'href', 'scheduled_for'
      ]::text[])
      or v_delivery - array[
        'template_id', 'target_kind', 'target_key', 'target_profile_id',
        'connection_key', 'target_snapshot', 'rendered_title', 'rendered_body',
        'href', 'scheduled_for'
      ]::text[] <> '{}'::jsonb
      or v_delivery ->> 'template_id' <> v_rule_snapshot ->> 'template_id'
      or pg_catalog.jsonb_typeof(v_delivery -> 'target_snapshot') <> 'object'
      or (v_delivery ->> 'scheduled_for')::timestamptz is distinct from v_job.scheduled_for
    then
      raise exception 'notification_fanout_delivery_invalid' using errcode = '22023';
    end if;
    v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
      v_event.id,
      p_rule_id,
      p_rule_revision,
      (v_delivery ->> 'template_id')::uuid,
      p_target_generation,
      p_target_set_hash,
      v_delivery ->> 'target_kind',
      v_delivery ->> 'target_key',
      case when v_delivery -> 'target_profile_id' = 'null'::jsonb then null
        else (v_delivery ->> 'target_profile_id')::uuid end,
      case when v_delivery -> 'connection_key' = 'null'::jsonb then null
        else v_delivery ->> 'connection_key' end,
      v_delivery -> 'target_snapshot',
      v_delivery ->> 'rendered_title',
      v_delivery ->> 'rendered_body',
      case when v_delivery -> 'href' = 'null'::jsonb then null
        else v_delivery ->> 'href' end,
      (v_delivery ->> 'scheduled_for')::timestamptz
    );
    perform v_delivery_id;
    v_delivery_count := v_delivery_count + 1;
    v_targets := v_targets || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', v_delivery ->> 'target_kind',
      'target_key', v_delivery ->> 'target_key',
      'target_profile_id', v_delivery -> 'target_profile_id',
      'connection_key', v_delivery -> 'connection_key',
      'target_snapshot', v_delivery -> 'target_snapshot'
    ));
  end loop;

  if dashboard_private.notification_target_set_hash_v1(p_batch -> 'deliveries')
    <> p_target_set_hash
  then
    raise exception 'notification_target_set_hash_mismatch' using errcode = '22023';
  end if;

  update dashboard_private.notification_event_fanout_jobs job
  set cursor = case when p_done then pg_catalog.jsonb_build_object('done', true)
    else pg_catalog.jsonb_build_object('value', p_next_cursor, 'done', false) end,
      target_generation = p_target_generation,
      target_set_hash = p_target_set_hash,
      target_snapshot = v_targets,
      outcome_summary = pg_catalog.jsonb_build_object(
        'delivery_count', v_delivery_count,
        'done', p_done
      ),
      updated_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'delivery_count', v_delivery_count,
    'cursor', p_next_cursor,
    'done', p_done
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'notification_fanout_batch_invalid' using errcode = '22023';
end;
$$;

-- Internal worker wrappers. These are intentionally outside the locked 25
-- domain/operator interfaces: PostgREST can reach public, while the actual
-- implementations stay in dashboard_private and are never granted directly.
create or replace function public.get_notification_render_snapshot_v1(
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'notification_service_role_required' using errcode = '42501';
  end if;
  return dashboard_private.get_notification_render_snapshot_v1(
    p_event_id, p_rule_id, p_rule_revision
  );
end;
$$;

create or replace function public.apply_notification_fanout_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_target_set_hash text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'notification_service_role_required' using errcode = '42501';
  end if;
  return dashboard_private.apply_notification_fanout_batch_v1(
    p_job_id,
    p_claim_token,
    p_expected_cursor,
    p_rule_id,
    p_rule_revision,
    p_target_generation,
    p_target_set_hash,
    p_batch,
    p_next_cursor,
    p_done
  );
end;
$$;

create or replace function public.claim_notification_fanout_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_event_fanout_jobs%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_rule_index integer;
  v_rule_count integer;
  v_template dashboard_private.notification_templates%rowtype;
begin
  if not dashboard_private.notification_worker_bounds_valid_v1(
    p_worker_id, p_batch_size, p_lease_seconds
  ) then
    raise exception 'notification_worker_claim_invalid' using errcode = '22023';
  end if;

  for v_job in
    with candidates as (
      select job.id
      from dashboard_private.notification_event_fanout_jobs job
      where job.status = 'pending'
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
      order by job.next_attempt_at, job.created_at, job.id
      for update skip locked
      limit p_batch_size
    )
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'claimed',
        attempt_count = job.attempt_count + 1,
        next_attempt_at = null,
        claimed_by = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  loop
    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_job.event_id;
    v_rule_count := pg_catalog.jsonb_array_length(v_event.rule_snapshot);
    v_rule_index := coalesce(nullif(v_job.cursor ->> 'value', '')::integer, 0);
    if v_rule_count = 0 or coalesce((v_job.cursor ->> 'done')::boolean, false) then
      update dashboard_private.notification_event_fanout_jobs job
      set status = 'succeeded',
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          outcome_summary = case when v_rule_count = 0
            then pg_catalog.jsonb_build_object('delivery_count', 0, 'done', true)
            else job.outcome_summary end,
          last_error_code = null,
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where job.id = v_job.id;
      continue;
    end if;
    v_rule_snapshot := v_event.rule_snapshot -> v_rule_index;
    if v_rule_snapshot is not null then
      select template.* into strict v_template
      from dashboard_private.notification_templates template
      where template.id = (v_rule_snapshot ->> 'template_id')::uuid
        and template.rule_id = (v_rule_snapshot ->> 'rule_id')::uuid;
    end if;

    return next pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'job_id', v_job.id,
      'claim_token', v_job.claim_token,
      'workflow_key', v_job.workflow_key,
      'attempt_count', v_job.attempt_count,
      'lease_expires_at', v_job.lease_expires_at,
      'cursor', nullif(v_job.cursor ->> 'value', ''),
      'next_cursor', case
        when v_rule_snapshot is null or v_rule_index >= v_rule_count - 1 then null
        else (v_rule_index + 1)::text
      end,
      'last_rule', v_rule_snapshot is null or v_rule_index >= v_rule_count - 1,
      'event_id', v_event.id,
      'event_key', v_event.event_key,
      'source_type', v_event.source_type,
      'source_id', v_event.source_id,
      'source_revision', case when v_event.source_revision is null then null else v_event.source_revision::text end,
      'occurrence_key', v_event.occurrence_key,
      'actor_profile_id', v_event.actor_profile_id,
      'occurred_at', v_event.occurred_at,
      'scheduled_for', v_job.scheduled_for,
      'payload_schema_version', v_event.payload_schema_version,
      'payload', v_event.payload,
      'rule_id', v_rule_snapshot ->> 'rule_id',
      'rule_revision', v_rule_snapshot ->> 'rule_revision',
      'template_id', v_rule_snapshot ->> 'template_id',
      'channel_key', v_rule_snapshot ->> 'channel_key',
      'audience_key', v_rule_snapshot ->> 'audience_key',
      'rule_variant_key', v_rule_snapshot ->> 'rule_variant_key',
      'rule_enabled', case when v_rule_snapshot is null then null
        else (v_rule_snapshot ->> 'enabled')::boolean end,
      'title_template', case when v_rule_snapshot is null then null else v_template.title_template end,
      'body_template', case when v_rule_snapshot is null then null else v_template.body_template end,
      'allowed_variables', case when v_rule_snapshot is null then null else v_template.allowed_variables end,
      'template_payload_schema_version', case when v_rule_snapshot is null then null
        else v_template.payload_schema_version end
    ));
  end loop;
  return;
end;
$$;

create or replace function public.claim_notification_rule_reconciliation_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_rule_reconciliation_jobs%rowtype;
begin
  if not dashboard_private.notification_worker_bounds_valid_v1(
    p_worker_id, p_batch_size, p_lease_seconds
  ) then
    raise exception 'notification_worker_claim_invalid' using errcode = '22023';
  end if;

  for v_job in
    with candidates as (
      select job.id
      from dashboard_private.notification_rule_reconciliation_jobs job
      where job.status = 'pending'
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
      order by job.next_attempt_at, job.created_at, job.id
      for update skip locked
      limit p_batch_size
    )
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = 'claimed',
        attempt_count = job.attempt_count + 1,
        next_attempt_at = null,
        claimed_by = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  loop
    return next pg_catalog.jsonb_build_object(
      'job_id', v_job.id,
      'claim_token', v_job.claim_token,
      'workflow_key', v_job.workflow_key,
      'attempt_count', v_job.attempt_count,
      'lease_expires_at', v_job.lease_expires_at,
      'rule_revision_map', v_job.rule_revision_map,
      'cursor', nullif(v_job.cursor ->> 'value', '')
    );
  end loop;
  return;
end;
$$;

create or replace function public.claim_notification_target_reconciliation_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_target_reconciliation_jobs%rowtype;
begin
  if not dashboard_private.notification_worker_bounds_valid_v1(
    p_worker_id, p_batch_size, p_lease_seconds
  ) then
    raise exception 'notification_worker_claim_invalid' using errcode = '22023';
  end if;

  for v_job in
    with candidates as (
      select job.id
      from dashboard_private.notification_target_reconciliation_jobs job
      where job.status = 'pending'
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
      order by job.next_attempt_at, job.created_at, job.id
      for update skip locked
      limit p_batch_size
    )
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = 'claimed',
        attempt_count = job.attempt_count + 1,
        next_attempt_at = null,
        claimed_by = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  loop
    return next pg_catalog.jsonb_build_object(
      'job_id', v_job.id,
      'claim_token', v_job.claim_token,
      'workflow_key', v_job.workflow_key,
      'attempt_count', v_job.attempt_count,
      'lease_expires_at', v_job.lease_expires_at,
      'source_type', v_job.source_type,
      'source_id', v_job.source_id,
      'source_revision', case when v_job.source_revision is null then null else v_job.source_revision::text end,
      'source_event_id', v_job.source_event_id,
      'reconciliation_kind', v_job.reconciliation_kind,
      'target_generation', v_job.target_generation::text,
      'previous_target_set_hash', v_job.previous_target_set_hash,
      'current_target_set_hash', v_job.current_target_set_hash,
      'cursor', nullif(v_job.cursor ->> 'value', '')
    );
  end loop;
  return;
end;
$$;

create or replace function public.finish_notification_orchestration_job_v1(
  p_job_kind text,
  p_job_id uuid,
  p_claim_token uuid,
  p_disposition text,
  p_outcome_summary jsonb,
  p_error_code text,
  p_next_attempt_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
begin
  if p_job_kind is null
    or p_job_kind not in ('fanout', 'rule_reconciliation', 'target_reconciliation')
    or p_job_id is null
    or p_claim_token is null
    or p_disposition is null
    or p_disposition not in ('succeeded', 'retry', 'failed')
    or not dashboard_private.notification_safe_job_outcome_v1(p_outcome_summary)
    or (p_disposition = 'retry' and p_next_attempt_at is null)
    or (p_disposition <> 'retry' and p_next_attempt_at is not null)
    or (p_disposition = 'failed' and nullif(pg_catalog.btrim(p_error_code), '') is null)
    or pg_catalog.octet_length(coalesce(p_error_code, '')) > 96
  then
    raise exception 'notification_orchestration_finish_invalid' using errcode = '22023';
  end if;

  if p_job_kind = 'fanout' then
    update dashboard_private.notification_event_fanout_jobs job
    set status = case p_disposition when 'succeeded' then 'succeeded'
        when 'failed' then 'failed' else 'pending' end,
        next_attempt_at = case when p_disposition = 'retry' then least(
          greatest(p_next_attempt_at, pg_catalog.clock_timestamp() + interval '5 seconds'),
          pg_catalog.clock_timestamp() + interval '24 hours'
        ) else null end,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        outcome_summary = p_outcome_summary,
        last_error_code = case when p_disposition = 'succeeded' then null else p_error_code end,
        completed_at = case when p_disposition in ('succeeded', 'failed')
          then pg_catalog.clock_timestamp() else null end,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id
      and job.status = 'claimed'
      and job.claim_token = p_claim_token
    returning pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'completed_at', job.completed_at
    ) into v_response;
  elsif p_job_kind = 'rule_reconciliation' then
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = case p_disposition when 'succeeded' then 'succeeded'
        when 'failed' then 'failed' else 'pending' end,
        next_attempt_at = case when p_disposition = 'retry' then least(
          greatest(p_next_attempt_at, pg_catalog.clock_timestamp() + interval '5 seconds'),
          pg_catalog.clock_timestamp() + interval '24 hours'
        ) else null end,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        last_error_code = case when p_disposition = 'succeeded' then null else p_error_code end,
        completed_at = case when p_disposition in ('succeeded', 'failed')
          then pg_catalog.clock_timestamp() else null end,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id
      and job.status = 'claimed'
      and job.claim_token = p_claim_token
    returning pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'completed_at', job.completed_at
    ) into v_response;
  else
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = case p_disposition when 'succeeded' then 'succeeded'
        when 'failed' then 'failed' else 'pending' end,
        next_attempt_at = case when p_disposition = 'retry' then least(
          greatest(p_next_attempt_at, pg_catalog.clock_timestamp() + interval '5 seconds'),
          pg_catalog.clock_timestamp() + interval '24 hours'
        ) else null end,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        last_error_code = case when p_disposition = 'succeeded' then null else p_error_code end,
        completed_at = case when p_disposition in ('succeeded', 'failed')
          then pg_catalog.clock_timestamp() else null end,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id
      and job.status = 'claimed'
      and job.claim_token = p_claim_token
    returning pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'completed_at', job.completed_at
    ) into v_response;
  end if;

  if v_response is null then
    raise exception 'notification_orchestration_claim_mismatch' using errcode = '40001';
  end if;
  return v_response;
end;
$$;

create or replace function public.get_notification_orchestration_job_status_v1(
  p_job_kind text,
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_response jsonb;
begin
  v_role := public.current_dashboard_role();
  if (select auth.uid()) is null or v_role not in ('admin', 'staff') then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_job_kind is null
    or p_job_kind not in ('fanout', 'rule_reconciliation', 'target_reconciliation')
    or p_job_id is null
  then
    raise exception 'notification_orchestration_job_invalid' using errcode = '22023';
  end if;

  if p_job_kind = 'fanout' then
    select pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'workflow_key', job.workflow_key,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'last_error_code', job.last_error_code,
      'created_at', job.created_at,
      'completed_at', job.completed_at
    ) into v_response
    from dashboard_private.notification_event_fanout_jobs job
    where job.id = p_job_id;
  elsif p_job_kind = 'rule_reconciliation' then
    select pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'workflow_key', job.workflow_key,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'last_error_code', job.last_error_code,
      'created_at', job.created_at,
      'completed_at', job.completed_at
    ) into v_response
    from dashboard_private.notification_rule_reconciliation_jobs job
    where job.id = p_job_id;
  else
    select pg_catalog.jsonb_build_object(
      'job_kind', p_job_kind,
      'job_id', job.id,
      'workflow_key', job.workflow_key,
      'status', job.status,
      'attempt_count', job.attempt_count,
      'next_attempt_at', job.next_attempt_at,
      'last_error_code', job.last_error_code,
      'created_at', job.created_at,
      'completed_at', job.completed_at
    ) into v_response
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.id = p_job_id;
  end if;

  if v_response is null then
    raise exception 'notification_orchestration_job_not_found' using errcode = 'P0002';
  end if;
  return v_response;
end;
$$;

create or replace function public.retry_notification_orchestration_job_v1(
  p_job_kind text,
  p_job_id uuid,
  p_expected_attempt_count integer,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_status text;
  v_attempt_count integer;
  v_error_code text;
  v_response jsonb;
begin
  v_role := public.current_dashboard_role();
  if (select auth.uid()) is null or v_role not in ('admin', 'staff') then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_job_kind is null
    or p_job_kind not in ('fanout', 'rule_reconciliation', 'target_reconciliation')
    or p_job_id is null
    or p_expected_attempt_count is null
    or p_expected_attempt_count < 0
    or p_request_id is null
  then
    raise exception 'notification_orchestration_retry_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()),
    'job_kind', p_job_kind,
    'job_id', p_job_id,
    'expected_attempt_count', p_expected_attempt_count
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'orchestration_job_retry'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  if p_job_kind = 'fanout' then
    select job.status, job.attempt_count, job.last_error_code
    into v_status, v_attempt_count, v_error_code
    from dashboard_private.notification_event_fanout_jobs job
    where job.id = p_job_id
    for update of job;
  elsif p_job_kind = 'rule_reconciliation' then
    select job.status, job.attempt_count, job.last_error_code
    into v_status, v_attempt_count, v_error_code
    from dashboard_private.notification_rule_reconciliation_jobs job
    where job.id = p_job_id
    for update of job;
  else
    select job.status, job.attempt_count, job.last_error_code
    into v_status, v_attempt_count, v_error_code
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.id = p_job_id
    for update of job;
  end if;
  if not found then
    raise exception 'notification_orchestration_job_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'failed'
    or v_attempt_count <> p_expected_attempt_count
    or v_error_code not in (
      'reconciler_missing',
      'payload_schema_unsupported',
      'transient_database_failure',
      'worker_error',
      'worker_lease_expired'
    )
  then
    raise exception 'notification_orchestration_retry_not_allowed' using errcode = '55000';
  end if;

  if p_job_kind = 'fanout' then
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'pending',
        next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        completed_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
  elsif p_job_kind = 'rule_reconciliation' then
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = 'pending',
        next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        completed_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
  else
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = 'pending',
        next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        completed_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'job_kind', p_job_kind,
    'job_id', p_job_id,
    'status', 'pending',
    'attempt_count', v_attempt_count,
    'next_attempt_at', pg_catalog.clock_timestamp()
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (
    p_request_id, 'orchestration_job_retry', v_fingerprint, v_response
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    request_id, before_summary, after_summary, reason_code
  ) values (
    'notification_orchestration_job', p_job_id::text, 'manual_retry_requested',
    (select auth.uid()), 'user', p_request_id,
    pg_catalog.jsonb_build_object('status', 'failed', 'attempt_count', v_attempt_count),
    pg_catalog.jsonb_build_object('status', 'pending', 'attempt_count', v_attempt_count),
    v_error_code
  );
  return v_response;
end;
$$;

create or replace function public.claim_notification_deliveries_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
begin
  if not dashboard_private.notification_worker_bounds_valid_v1(
    p_worker_id, p_batch_size, p_lease_seconds
  ) then
    raise exception 'notification_worker_claim_invalid' using errcode = '22023';
  end if;

  for v_delivery in
    with candidates as (
      select delivery.id
      from dashboard_private.notification_deliveries delivery
      join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.workflow_key = event_row.workflow_key
       and ownership.occurrence_key = event_row.occurrence_key
       and ownership.rule_id = delivery.rule_id
       and ownership.channel_key = delivery.channel_key
       and ownership.target_key = delivery.target_key
       and ownership.target_generation = delivery.target_generation
       and ownership.owner_kind = 'canonical'
       and ownership.state = 'reserved'
      where delivery.status in ('pending', 'retry_wait')
        and delivery.scheduled_for <= pg_catalog.clock_timestamp()
        and coalesce(delivery.next_attempt_at, delivery.scheduled_for) <= pg_catalog.clock_timestamp()
        and delivery.attempt_count < delivery.max_attempts
      order by coalesce(delivery.next_attempt_at, delivery.scheduled_for), delivery.created_at, delivery.id
      for update skip locked
      limit p_batch_size
    )
    update dashboard_private.notification_deliveries delivery
    set status = 'claimed',
        status_reason = null,
        claimed_by = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        next_attempt_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  loop
    return next (
      select pg_catalog.jsonb_build_object(
        'delivery_id', v_delivery.id,
        'claim_token', v_delivery.claim_token,
        'event_id', event_row.id,
        'workflow_key', event_row.workflow_key,
        'event_key', event_row.event_key,
        'source_type', event_row.source_type,
        'source_id', event_row.source_id,
        'source_revision', case when event_row.source_revision is null then null else event_row.source_revision::text end,
        'rule_id', v_delivery.rule_id,
        'rule_revision', v_delivery.rule_revision::text,
        'target_generation', v_delivery.target_generation::text,
        'scheduled_for', v_delivery.scheduled_for,
        'channel_key', v_delivery.channel_key,
        'target', pg_catalog.jsonb_build_object(
          'target_kind', v_delivery.target_kind,
          'target_key', v_delivery.target_key,
          'target_profile_id', v_delivery.target_profile_id,
          'connection_key', v_delivery.connection_key,
          'target_snapshot', v_delivery.target_snapshot
        )
      )
      from dashboard_private.notification_events event_row
      where event_row.id = v_delivery.event_id
    );
  end loop;
  return;
end;
$$;

create or replace function public.record_notification_worker_heartbeat_v1(
  p_worker_id text,
  p_run_id uuid,
  p_phase text,
  p_counts jsonb,
  p_error_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing dashboard_private.notification_worker_heartbeats%rowtype;
begin
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or p_run_id is null
    or p_phase is null
    or p_phase not in ('started', 'succeeded', 'failed')
    or p_counts is null
    or pg_catalog.jsonb_typeof(p_counts) <> 'object'
    or not (p_counts ?& array[
      'fanout', 'rule_reconciliation', 'target_reconciliation', 'deliveries', 'reaped'
    ]::text[])
    or p_counts - array[
      'fanout', 'rule_reconciliation', 'target_reconciliation', 'deliveries', 'reaped'
    ]::text[] <> '{}'::jsonb
    or exists (
      select 1
      from pg_catalog.jsonb_each(p_counts) count_entry
      where pg_catalog.jsonb_typeof(count_entry.value) <> 'number'
         or count_entry.value::text !~ '^(0|[1-9][0-9]*)$'
    )
    or (p_phase = 'failed' and (
      nullif(pg_catalog.btrim(p_error_code), '') is null
      or pg_catalog.octet_length(p_error_code) > 96
    ))
    or (p_phase <> 'failed' and p_error_code is not null)
  then
    raise exception 'notification_worker_heartbeat_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-worker-run:' || p_run_id::text, 0)
  );
  if p_phase in ('succeeded', 'failed') then
    select heartbeat.* into v_existing
    from dashboard_private.notification_worker_heartbeats heartbeat
    where heartbeat.run_id = p_run_id
      and heartbeat.phase in ('succeeded', 'failed')
    for update of heartbeat;
  else
    select heartbeat.* into v_existing
    from dashboard_private.notification_worker_heartbeats heartbeat
    where heartbeat.run_id = p_run_id
      and heartbeat.phase = 'started'
    for update of heartbeat;
  end if;
  if found then
    if v_existing.worker_id <> p_worker_id
      or v_existing.phase <> p_phase
      or v_existing.counts <> p_counts
      or v_existing.error_code is distinct from p_error_code
    then
      raise exception 'notification_worker_heartbeat_conflict' using errcode = '40001';
    end if;
    return;
  end if;

  insert into dashboard_private.notification_worker_heartbeats(
    worker_id, run_id, phase, counts, error_code
  ) values (
    p_worker_id, p_run_id, p_phase, p_counts, p_error_code
  )
  on conflict (run_id, phase) do nothing;

  if p_phase in ('succeeded', 'failed') and not exists (
    select 1
    from dashboard_private.notification_worker_heartbeats heartbeat
    where heartbeat.run_id = p_run_id
      and heartbeat.worker_id = p_worker_id
      and heartbeat.phase = 'started'
  ) then
    raise exception 'notification_worker_heartbeat_start_missing' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.record_push_connection_test_audit_v1(
  p_profile_id uuid,
  p_outcome text,
  p_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'notification_service_role_required' using errcode = '42501';
  end if;
  if p_profile_id is null
    or not exists (
      select 1 from public.profiles profile where profile.id = p_profile_id
    )
    or p_outcome is null
    or p_code is null
    or (p_outcome, p_code) not in (
      ('sent', 'push_self_test_sent'),
      ('expired', 'push_subscription_expired'),
      ('failed', 'push_self_test_failed')
    )
  then
    raise exception 'push_connection_test_audit_invalid' using errcode = '22023';
  end if;

  insert into dashboard_private.notification_audit_logs(
    entity_kind,
    entity_id,
    action,
    actor_profile_id,
    actor_kind,
    after_summary,
    reason_code
  ) values (
    'dashboard_push_connection',
    p_profile_id::text,
    'push_connection_tested',
    p_profile_id,
    'user',
    pg_catalog.jsonb_build_object('outcome', p_outcome, 'code', p_code),
    p_code
  );
end;
$$;

create or replace function public.rebind_dashboard_push_subscription_v1(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_subscription public.dashboard_push_subscriptions%rowtype;
begin
  if v_profile_id is null
    or not exists (
      select 1 from public.profiles profile where profile.id = v_profile_id
    )
  then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_endpoint is null
    or pg_catalog.octet_length(p_endpoint) not between 1 and 4096
    or p_endpoint ~ '[[:space:][:cntrl:]]'
    or p_endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|android\.googleapis\.com|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+notify\.windows\.com)(:443)?/[^?#[:space:][:cntrl:]][^#[:space:][:cntrl:]]*$'
    or p_p256dh is null
    or pg_catalog.octet_length(p_p256dh) not between 1 and 1024
    or p_p256dh !~ '^[A-Za-z0-9_-]+$'
    or p_auth is null
    or pg_catalog.octet_length(p_auth) not between 1 and 1024
    or p_auth !~ '^[A-Za-z0-9_-]+$'
    or p_user_agent is null
    or pg_catalog.octet_length(p_user_agent) > 512
    or p_user_agent ~ '[[:cntrl:]]'
  then
    raise exception 'push_subscription_rebind_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'push-subscription-endpoint:' || p_endpoint,
    0
  ));
  select subscription.* into v_subscription
  from public.dashboard_push_subscriptions subscription
  where subscription.endpoint = p_endpoint
  for update of subscription;
  if not found then
    raise exception 'push_subscription_rebind_not_found' using errcode = 'P0002';
  end if;
  if v_subscription.profile_id = v_profile_id then
    return pg_catalog.jsonb_build_object('ok', true, 'status', 'current');
  end if;
  if v_subscription.p256dh <> p_p256dh or v_subscription.auth <> p_auth then
    raise exception 'push_subscription_rebind_capability_mismatch' using errcode = '42501';
  end if;

  update public.dashboard_push_subscriptions subscription
  set profile_id = v_profile_id,
      user_agent = p_user_agent,
      last_seen_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where subscription.id = v_subscription.id;

  insert into dashboard_private.notification_audit_logs(
    entity_kind,
    entity_id,
    action,
    actor_profile_id,
    actor_kind,
    before_summary,
    after_summary,
    reason_code
  ) values (
    'dashboard_push_subscription',
    v_subscription.id::text,
    'push_subscription_rebound',
    v_profile_id,
    'user',
    pg_catalog.jsonb_build_object('ownership', 'other_profile'),
    pg_catalog.jsonb_build_object('ownership', 'current_profile'),
    'exact_subscription_capability'
  );

  return pg_catalog.jsonb_build_object('ok', true, 'status', 'rebound');
end;
$$;

create or replace function public.begin_notification_delivery_send_v1(
  p_delivery_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_dispatch_token uuid;
  v_connection public.google_chat_webhook_settings%rowtype;
  v_subscription public.dashboard_push_subscriptions%rowtype;
  v_push_subscription_valid boolean := false;
  v_connection_channel text;
  v_terminal_status text;
  v_terminal_reason text;
begin
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'notification_delivery_begin_invalid' using errcode = '22023';
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token <> p_claim_token
  then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;
  if v_delivery.channel_key = 'in_app' then
    raise exception 'notification_in_app_requires_atomic_commit' using errcode = '22023';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = v_delivery.rule_id;

  if v_delivery.channel_key = 'web_push' then
    begin
      select subscription.* into v_subscription
      from public.dashboard_push_subscriptions subscription
      where subscription.id = (v_delivery.target_snapshot ->> 'subscription_id')::uuid
      for share of subscription;
      v_push_subscription_valid := found
        and v_delivery.target_kind = 'push_subscription'
        and v_delivery.target_profile_id = v_subscription.profile_id
        and v_delivery.target_key = 'push_subscription:' || v_subscription.id::text
        and v_delivery.target_snapshot ->> 'endpoint' = v_subscription.endpoint
        and v_delivery.target_snapshot ->> 'p256dh' = v_subscription.p256dh
        and v_delivery.target_snapshot ->> 'auth' = v_subscription.auth;
    exception
      when invalid_text_representation then
        v_push_subscription_valid := false;
    end;
  end if;

  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update of ownership;

  if v_delivery.cancel_requested_at is not null then
    v_terminal_status := 'canceled';
    v_terminal_reason := case
      when v_delivery.cancel_reason in (
        'source_status_changed', 'source_schedule_changed', 'source_revision_changed',
        'rule_revision_changed', 'recipient_revoked', 'cutover_rollback'
      ) then v_delivery.cancel_reason
      else 'source_revision_changed'
    end;
  elsif v_rule.revision <> v_delivery.rule_revision or not v_rule.enabled then
    v_terminal_status := 'canceled';
    v_terminal_reason := 'rule_revision_changed';
  elsif v_delivery.target_profile_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = v_delivery.target_profile_id
  ) then
    v_terminal_status := 'canceled';
    v_terminal_reason := 'recipient_revoked';
  elsif v_delivery.target_snapshot ? 'active'
    and coalesce((v_delivery.target_snapshot ->> 'active')::boolean, false) is not true
  then
    v_terminal_status := 'canceled';
    v_terminal_reason := 'recipient_revoked';
  elsif v_delivery.channel_key = 'web_push' and not v_push_subscription_valid then
    v_terminal_status := 'canceled';
    v_terminal_reason := 'recipient_revoked';
  elsif not dashboard_private.notification_dispatch_enabled_v1(
    v_event.workflow_key, v_event.event_key
  ) then
    v_terminal_status := 'skipped';
    v_terminal_reason := case
      when dashboard_private.notification_shadow_enabled_v1() then 'shadow_mode'
      else 'legacy_skipped'
    end;
  elsif v_ownership.id is null
    or v_ownership.owner_kind <> 'canonical'
    or v_ownership.state <> 'reserved'
  then
    v_terminal_status := 'skipped';
    v_terminal_reason := 'legacy_deduped';
  end if;

  if v_terminal_status is not null then
    update dashboard_private.notification_deliveries delivery
    set status = v_terminal_status,
        status_reason = v_terminal_reason,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        next_attempt_at = null,
        cancel_requested_at = null,
        cancel_reason = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;
    if v_ownership.id is not null
      and v_ownership.owner_kind = 'canonical'
      and v_ownership.state = 'reserved'
    then
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed',
          updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;
    end if;
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      before_summary, after_summary, reason_code
    ) values (
      'notification_delivery', v_delivery.id::text,
      case when v_terminal_reason = 'legacy_deduped' then 'ownership_not_acquired'
        else 'delivery_closed_before_send' end,
      null, 'system',
      pg_catalog.jsonb_build_object('status', 'claimed'),
      pg_catalog.jsonb_build_object('status', v_terminal_status),
      v_terminal_reason
    );
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'status', v_terminal_status,
      'status_reason', v_terminal_reason
    );
  end if;

  if v_delivery.channel_key = 'google_chat' then
    v_connection_channel := case v_delivery.connection_key
      when 'google_chat.management' then 'admin'
      when 'google_chat.executive' then 'executive'
      when 'google_chat.math' then 'math'
      when 'google_chat.english' then 'english'
      else null
    end;
    select connection.* into v_connection
    from public.google_chat_webhook_settings connection
    where connection.channel = v_connection_channel
      and connection.connection_state in ('legacy_active', 'encrypted_active')
      and connection.webhook_url ~ '^https://chat\.googleapis\.com/v1/spaces/[A-Za-z0-9_-]{8,}/messages\?key=[^&[:space:]]+&token=[^&[:space:]]+$'
    for share of connection;
    if not found then
      update dashboard_private.notification_deliveries delivery
      set status = 'failed',
          status_reason = 'connection_missing',
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          last_error_code = 'connection_missing',
          last_error_summary = 'required connection is unavailable',
          resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where delivery.id = v_delivery.id;
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed', updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id and ownership.state = 'reserved';
      return pg_catalog.jsonb_build_object(
        'delivery_id', v_delivery.id,
        'status', 'failed',
        'status_reason', 'connection_missing'
      );
    end if;
  end if;

  if v_delivery.attempt_count >= v_delivery.max_attempts then
    update dashboard_private.notification_deliveries delivery
    set status = 'failed',
        status_reason = 'max_attempts_exhausted',
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        last_error_code = 'max_attempts_exhausted',
        last_error_summary = 'maximum attempts reached before send',
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state = 'closed', updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_ownership.id and ownership.state = 'reserved';
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'status', 'failed',
      'status_reason', 'max_attempts_exhausted'
    );
  end if;

  v_dispatch_token := gen_random_uuid();
  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'dispatch_started',
      dispatch_started_at = pg_catalog.clock_timestamp(),
      dispatch_token = v_dispatch_token,
      updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_ownership.id
    and ownership.owner_kind = 'canonical'
    and ownership.state = 'reserved';
  if not found then
    raise exception 'notification_delivery_ownership_conflict' using errcode = '40001';
  end if;

  update dashboard_private.notification_deliveries delivery
  set status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      last_attempt_started_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id;

  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    before_summary, after_summary, reason_code
  ) values (
    'notification_delivery', v_delivery.id::text, 'dispatch_started', null, 'system',
    pg_catalog.jsonb_build_object('status', 'claimed', 'attempt_count', v_delivery.attempt_count),
    pg_catalog.jsonb_build_object('status', 'sending', 'attempt_count', v_delivery.attempt_count + 1),
    'canonical_dispatch'
  );

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'claim_token', p_claim_token,
    'dispatch_token', v_dispatch_token,
    'status', 'sending',
    'channel_key', v_delivery.channel_key,
    'connection_key', v_delivery.connection_key,
    'webhook_url', case when v_delivery.channel_key = 'google_chat' then v_connection.webhook_url else null end,
    'subscription', case when v_delivery.channel_key = 'web_push' then pg_catalog.jsonb_build_object(
      'endpoint', v_delivery.target_snapshot ->> 'endpoint',
      'keys', pg_catalog.jsonb_build_object(
        'p256dh', v_delivery.target_snapshot ->> 'p256dh',
        'auth', v_delivery.target_snapshot ->> 'auth'
      )
    ) else null end,
    'customer_endpoint', case when v_delivery.channel_key = 'customer_message'
      then v_delivery.target_snapshot ->> 'endpoint' else null end,
    'rendered_title', v_delivery.rendered_title,
    'rendered_body', v_delivery.rendered_body,
    'href', v_delivery.href
  ));
exception
  when invalid_text_representation then
    raise exception 'notification_delivery_target_snapshot_invalid' using errcode = '22023';
end;
$$;

create or replace function public.commit_notification_in_app_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_notification_id uuid;
  v_subscription public.dashboard_push_subscriptions%rowtype;
  v_child_id uuid;
  v_push_count integer := 0;
begin
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token <> p_claim_token
    or v_delivery.channel_key <> 'in_app'
  then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = v_delivery.rule_id;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update of ownership;

  if v_delivery.cancel_requested_at is not null
    or v_rule.revision <> v_delivery.rule_revision
    or not v_rule.enabled
    or v_delivery.target_profile_id is null
    or not exists (
      select 1 from public.profiles profile where profile.id = v_delivery.target_profile_id
    )
  then
    update dashboard_private.notification_deliveries delivery
    set status = 'canceled',
        status_reason = case
          when v_delivery.cancel_reason in (
            'source_status_changed', 'source_schedule_changed', 'source_revision_changed',
            'rule_revision_changed', 'recipient_revoked', 'cutover_rollback'
          ) then v_delivery.cancel_reason
          when v_rule.revision <> v_delivery.rule_revision or not v_rule.enabled
            then 'rule_revision_changed'
          else 'recipient_revoked'
        end,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;
    if v_ownership.id is not null and v_ownership.state = 'reserved' then
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed', updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'notification_id', null,
      'push_children_created', 0,
      'status', 'canceled'
    );
  end if;

  if not dashboard_private.notification_dispatch_enabled_v1(
      v_event.workflow_key, v_event.event_key
    )
    or v_ownership.id is null
    or v_ownership.owner_kind <> 'canonical'
    or v_ownership.state <> 'reserved'
  then
    update dashboard_private.notification_deliveries delivery
    set status = 'skipped',
        status_reason = case
          when v_ownership.id is null or v_ownership.owner_kind <> 'canonical'
            then 'legacy_deduped'
          when dashboard_private.notification_shadow_enabled_v1() then 'shadow_mode'
          else 'legacy_skipped'
        end,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;
    if v_ownership.id is not null and v_ownership.owner_kind = 'canonical'
      and v_ownership.state = 'reserved'
    then
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed', updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'notification_id', null,
      'push_children_created', 0,
      'status', 'skipped'
    );
  end if;

  insert into public.dashboard_notifications(
    recipient_profile_id,
    actor_profile_id,
    type,
    title,
    body,
    href,
    metadata,
    read_at,
    source_delivery_id
  ) values (
    v_delivery.target_profile_id,
    v_event.actor_profile_id,
    'notification_control_plane',
    v_delivery.rendered_title,
    v_delivery.rendered_body,
    v_delivery.href,
    pg_catalog.jsonb_build_object(
      'workflow_key', v_event.workflow_key,
      'event_key', v_event.event_key,
      'source_type', v_event.source_type,
      'source_id', v_event.source_id,
      'delivery_id', v_delivery.id
    ),
    null,
    v_delivery.id
  )
  on conflict (source_delivery_id) where source_delivery_id is not null
  do nothing
  returning id into v_notification_id;
  if v_notification_id is null then
    select notification.id into strict v_notification_id
    from public.dashboard_notifications notification
    where notification.source_delivery_id = v_delivery.id;
  end if;

  for v_subscription in
    select subscription.*
    from public.dashboard_push_subscriptions subscription
    where subscription.profile_id = v_delivery.target_profile_id
    order by subscription.id
    for update of subscription
  loop
    v_child_id := gen_random_uuid();
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
      target_generation, target_set_hash, target_kind, target_key, target_profile_id,
      connection_key, target_snapshot, parent_delivery_id, status, status_reason,
      dedupe_key, rendered_title, rendered_body, href, scheduled_for,
      max_attempts, next_attempt_at
    ) values (
      v_child_id,
      v_delivery.event_id,
      v_delivery.rule_id,
      v_delivery.rule_revision,
      v_delivery.template_id,
      'web_push',
      v_delivery.audience_key,
      v_delivery.target_generation,
      v_delivery.target_set_hash || ':push',
      'push_subscription',
      'push_subscription:' || v_subscription.id::text,
      v_delivery.target_profile_id,
      null,
      pg_catalog.jsonb_build_object(
        'subscription_id', v_subscription.id,
        'endpoint', v_subscription.endpoint,
        'p256dh', v_subscription.p256dh,
        'auth', v_subscription.auth,
        'active', true
      ),
      v_delivery.id,
      'pending',
      null,
      pg_catalog.md5(v_delivery.dedupe_key || ':push:' || v_subscription.id::text),
      v_delivery.rendered_title,
      v_delivery.rendered_body,
      v_delivery.href,
      pg_catalog.clock_timestamp(),
      5,
      pg_catalog.clock_timestamp()
    )
    on conflict (dedupe_key) do nothing
    returning id into v_child_id;
    if found then
      perform dashboard_private.reserve_canonical_dispatch_ownership_v1(v_child_id);
      v_push_count := v_push_count + 1;
    end if;
  end loop;

  update dashboard_private.notification_deliveries delivery
  set status = 'sent',
      status_reason = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      next_attempt_at = null,
      sent_at = coalesce(delivery.sent_at, pg_catalog.clock_timestamp()),
      resolved_at = coalesce(delivery.resolved_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id;
  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed', updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_ownership.id
    and ownership.owner_kind = 'canonical'
    and ownership.state = 'reserved';

  return pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'notification_id', v_notification_id,
    'push_children_created', v_push_count,
    'status', 'sent'
  );
end;
$$;

create or replace function public.finalize_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_status text,
  p_status_reason text,
  p_provider_message_id text,
  p_provider_response_code text,
  p_error_code text,
  p_error_summary text,
  p_next_attempt_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_final_status text := p_status;
  v_final_reason text := p_status_reason;
  v_next_attempt_at timestamptz := p_next_attempt_at;
begin
  if p_delivery_id is null
    or p_claim_token is null
    or p_status is null
    or p_status not in ('sent', 'retry_wait', 'delivery_unknown', 'failed', 'canceled', 'skipped')
    or pg_catalog.octet_length(coalesce(p_provider_message_id, '')) > 512
    or pg_catalog.octet_length(coalesce(p_provider_response_code, '')) > 96
    or pg_catalog.octet_length(coalesce(p_error_code, '')) > 96
    or pg_catalog.octet_length(coalesce(p_error_summary, '')) > 512
    or (p_status = 'retry_wait' and p_next_attempt_at is null)
    or (p_status <> 'retry_wait' and p_next_attempt_at is not null)
    or (p_status = 'sent' and p_status_reason is not null)
    or (p_status <> 'sent' and p_status_reason is null)
  then
    raise exception 'notification_delivery_finalization_invalid' using errcode = '22023';
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or v_delivery.claim_token <> p_claim_token
    or v_delivery.status not in ('claimed', 'sending')
  then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;
  if v_delivery.status = 'claimed' and p_status not in ('failed', 'canceled', 'skipped') then
    raise exception 'notification_delivery_not_started' using errcode = '55000';
  end if;
  if v_delivery.status = 'sending' and p_status in ('canceled', 'skipped') then
    raise exception 'notification_delivery_dispatch_already_started' using errcode = '55000';
  end if;

  if p_status = 'retry_wait' then
    v_next_attempt_at := least(
      greatest(p_next_attempt_at, pg_catalog.clock_timestamp() + interval '5 seconds'),
      pg_catalog.clock_timestamp() + interval '24 hours'
    );
    if v_delivery.attempt_count >= v_delivery.max_attempts then
      v_final_status := 'failed';
      v_final_reason := 'max_attempts_exhausted';
      v_next_attempt_at := null;
    end if;
  end if;
  if v_final_status = 'delivery_unknown' then
    v_next_attempt_at := null;
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update of ownership;

  update dashboard_private.notification_deliveries delivery
  set status = v_final_status,
      status_reason = v_final_reason,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      next_attempt_at = v_next_attempt_at,
      provider_message_id = case when v_final_status = 'sent' then p_provider_message_id else null end,
      provider_response_code = p_provider_response_code,
      last_error_code = case when v_final_status = 'sent' then null else p_error_code end,
      last_error_summary = case when v_final_status = 'sent' then null else p_error_summary end,
      sent_at = case when v_final_status = 'sent' then pg_catalog.clock_timestamp() else null end,
      resolved_at = case when v_final_status in (
        'sent', 'delivery_unknown', 'failed', 'canceled', 'skipped'
      ) then pg_catalog.clock_timestamp() else null end,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id;

  if v_ownership.id is not null then
    if v_final_status = 'retry_wait'
      and v_ownership.owner_kind = 'canonical'
      and v_ownership.state = 'dispatch_started'
    then
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'reserved',
          dispatch_started_at = null,
          dispatch_token = null,
          provider_reference = null,
          updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;
    else
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed',
          provider_reference = case when v_final_status = 'sent' then p_provider_message_id else null end,
          updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'status', v_final_status,
    'status_reason', v_final_reason,
    'attempt_count', v_delivery.attempt_count,
    'next_attempt_at', v_next_attempt_at
  );
end;
$$;

create or replace function public.reap_notification_leases_v1(
  p_worker_id text,
  p_batch_size integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fanout integer := 0;
  v_rule integer := 0;
  v_target integer := 0;
  v_claimed integer := 0;
  v_sending integer := 0;
begin
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or p_batch_size is null
    or p_batch_size not between 1 and 100
  then
    raise exception 'notification_lease_reap_invalid' using errcode = '22023';
  end if;

  with expired as (
    select job.id
    from dashboard_private.notification_event_fanout_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_fanout from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_rule_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_rule from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_target from reaped;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'claimed'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'pending', status_reason = null,
        next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired',
        last_error_summary = 'worker lease expired before dispatch start',
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select count(*) into v_claimed from reaped;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'sending'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'delivery_unknown',
        status_reason = 'worker_lost_after_send_start',
        next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lost_after_send_start',
        last_error_summary = 'worker lease expired after dispatch start',
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select count(*) into v_sending from reaped;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed', updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_deliveries delivery,
       dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and delivery.status = 'delivery_unknown'
    and delivery.status_reason = 'worker_lost_after_send_start'
    and ownership.workflow_key = event_row.workflow_key
    and ownership.occurrence_key = event_row.occurrence_key
    and ownership.rule_id = delivery.rule_id
    and ownership.channel_key = delivery.channel_key
    and ownership.target_key = delivery.target_key
    and ownership.target_generation = delivery.target_generation
    and ownership.owner_kind = 'canonical'
    and ownership.state = 'dispatch_started';

  return pg_catalog.jsonb_build_object(
    'reaped_count', v_fanout + v_rule + v_target + v_claimed + v_sending,
    'fanout', v_fanout,
    'rule_reconciliation', v_rule,
    'target_reconciliation', v_target,
    'claimed_deliveries', v_claimed,
    'unknown_deliveries', v_sending,
    'worker_id', p_worker_id
  );
end;
$$;

create or replace function public.reconcile_notification_delivery_v1(
  p_delivery_id uuid,
  p_resolution text,
  p_reason text,
  p_request_id uuid,
  p_duplicate_risk_accepted boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_response jsonb;
begin
  v_role := public.current_dashboard_role();
  if (select auth.uid()) is null or v_role not in ('admin', 'staff') then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_delivery_id is null
    or p_resolution is null
    or p_resolution not in ('mark_sent', 'mark_failed', 'approve_retry')
    or nullif(pg_catalog.btrim(p_reason), '') is null
    or pg_catalog.octet_length(p_reason) > 96
    or p_request_id is null
    or p_duplicate_risk_accepted is null
  then
    raise exception 'notification_delivery_reconciliation_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'delivery_id', p_delivery_id,
    'resolution', p_resolution, 'reason', p_reason,
    'duplicate_risk_accepted', p_duplicate_risk_accepted
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'delivery_reconciliation'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found then
    raise exception 'notification_delivery_not_found' using errcode = 'P0002';
  end if;

  if v_delivery.status = 'delivery_unknown' then
    if v_role <> 'admin' or not p_duplicate_risk_accepted then
      raise exception 'notification_duplicate_risk_confirmation_required' using errcode = '42501';
    end if;
  elsif p_resolution = 'approve_retry' then
    if v_delivery.status <> 'failed'
      or v_delivery.status_reason not in (
        'connection_missing', 'provider_definite_rejection', 'retry_window_closed'
      )
    then
      raise exception 'notification_delivery_retry_not_allowed' using errcode = '55000';
    end if;
  else
    raise exception 'notification_delivery_reconciliation_not_allowed' using errcode = '55000';
  end if;

  if p_resolution = 'approve_retry' then
    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_delivery.event_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_event.workflow_key || ':' || v_event.occurrence_key || ':' ||
      v_delivery.rule_id::text || ':' || v_delivery.channel_key || ':' ||
      v_delivery.target_key || ':' || v_delivery.target_generation::text,
      0
    ));
    select ownership.* into v_ownership
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation
    for update of ownership;
    if not found
      or v_ownership.owner_kind <> 'canonical'
      or v_ownership.state <> 'closed'
    then
      raise exception 'notification_delivery_retry_ownership_conflict' using errcode = '40001';
    end if;

    update dashboard_private.notification_dispatch_ownership_claims ownership
    set owner_generation = ownership.owner_generation + 1,
        state = 'reserved',
        dispatch_started_at = null,
        dispatch_token = null,
        provider_reference = null,
        terminal_outcome = null,
        updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_ownership.id;
  end if;

  update dashboard_private.notification_deliveries delivery
  set status = case p_resolution when 'mark_sent' then 'sent'
      when 'mark_failed' then 'failed' else 'retry_wait' end,
      status_reason = case p_resolution when 'mark_sent' then null
        when 'mark_failed' then 'provider_definite_rejection'
        else 'manual_retry_approved' end,
      next_attempt_at = case when p_resolution = 'approve_retry'
        then pg_catalog.clock_timestamp() else null end,
      max_attempts = case when p_resolution = 'approve_retry'
        then greatest(delivery.max_attempts, delivery.attempt_count + 1)
        else delivery.max_attempts end,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      cancel_requested_at = case when p_resolution = 'approve_retry'
        then null else delivery.cancel_requested_at end,
      cancel_reason = case when p_resolution = 'approve_retry'
        then null else delivery.cancel_reason end,
      provider_message_id = case when p_resolution = 'approve_retry'
        then null else delivery.provider_message_id end,
      provider_response_code = case when p_resolution = 'approve_retry'
        then null else delivery.provider_response_code end,
      sent_at = case when p_resolution = 'mark_sent'
        then pg_catalog.clock_timestamp()
        when p_resolution = 'approve_retry' then null
        else delivery.sent_at end,
      resolved_at = case when p_resolution in ('mark_sent', 'mark_failed')
        then pg_catalog.clock_timestamp() else null end,
      last_error_code = case when p_resolution = 'mark_sent' then null else p_reason end,
      last_error_summary = case when p_resolution = 'mark_sent' then null
        else 'manually reconciled delivery' end,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id
  returning pg_catalog.jsonb_build_object(
    'delivery_id', delivery.id,
    'status', delivery.status,
    'status_reason', delivery.status_reason,
    'attempt_count', delivery.attempt_count,
    'next_attempt_at', delivery.next_attempt_at
  ) into v_response;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'delivery_reconciliation', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_delivery', p_delivery_id::text, 'delivery_manually_reconciled',
    (select auth.uid()), 'user', p_request_id,
    pg_catalog.jsonb_build_object('status', v_delivery.status, 'attempt_count', v_delivery.attempt_count),
    pg_catalog.jsonb_build_object(
      'status', v_response ->> 'status', 'attempt_count', v_delivery.attempt_count
    ),
    p_reason
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.visible_dashboard_notification_rows_v1(
  p_profile_id uuid
)
returns table (
  id uuid,
  recipient_profile_id uuid,
  recipient_team text,
  actor_profile_id uuid,
  notification_type text,
  title text,
  body text,
  href text,
  metadata jsonb,
  legacy_read_at timestamptz,
  receipt_read_at timestamptz,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.id,
    notification.recipient_profile_id,
    notification.recipient_team,
    notification.actor_profile_id,
    notification.type as notification_type,
    notification.title,
    notification.body,
    notification.href,
    notification.metadata,
    notification.read_at as legacy_read_at,
    receipt.read_at as receipt_read_at,
    coalesce(receipt.read_at, notification.read_at) as read_at,
    notification.created_at
  from public.dashboard_notifications notification
  left join public.dashboard_notification_read_receipts receipt
    on receipt.notification_id = notification.id
   and receipt.profile_id = p_profile_id
  where p_profile_id is not null
    and notification.revoked_at is null
    and (
      notification.recipient_profile_id = p_profile_id
      or (
        notification.recipient_profile_id is null
        and notification.recipient_team = '관리팀'
        and exists (
          select 1
          from public.profiles profile
          where profile.id = p_profile_id
            and profile.role in ('admin', 'staff')
        )
      )
    );
$$;

create or replace function public.get_dashboard_notification_inbox_v1(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_items jsonb;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_limit is null
    or p_limit not between 1 and 100
    or ((p_before_created_at is null) <> (p_before_id is null))
  then
    raise exception 'notification_inbox_cursor_invalid' using errcode = '22023';
  end if;

  with page as (
    select visible.*
    from dashboard_private.visible_dashboard_notification_rows_v1(v_profile_id) visible
    where p_before_created_at is null
       or (visible.created_at, visible.id) < (p_before_created_at, p_before_id)
    order by visible.created_at desc, visible.id desc
    limit p_limit
  ), numbered as (
    select page.*, pg_catalog.row_number() over (
      order by page.created_at desc, page.id desc
    ) as row_number
    from page
  )
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', numbered.id,
      'recipient_profile_id', numbered.recipient_profile_id,
      'recipient_team', numbered.recipient_team,
      'actor_profile_id', numbered.actor_profile_id,
      'type', numbered.notification_type,
      'title', numbered.title,
      'body', numbered.body,
      'href', numbered.href,
      'metadata', numbered.metadata,
      'read_at', numbered.read_at,
      'created_at', numbered.created_at
    ) order by numbered.created_at desc, numbered.id desc), '[]'::jsonb),
    (pg_catalog.array_agg(numbered.created_at order by numbered.row_number desc))[1],
    (pg_catalog.array_agg(numbered.id order by numbered.row_number desc))[1]
  into v_items, v_next_created_at, v_next_id
  from numbered;

  select count(*) into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(v_profile_id) visible
  where visible.read_at is null;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread_count,
    'next_cursor', case
      when pg_catalog.jsonb_array_length(v_items) < p_limit then null
      else pg_catalog.jsonb_build_object(
        'created_at', v_next_created_at,
        'id', v_next_id
      )
    end
  );
end;
$$;

create or replace function public.get_dashboard_notification_unread_count_v1() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  select count(*) into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(v_profile_id) visible
  where visible.read_at is null;
  return pg_catalog.jsonb_build_object('unread_count', v_unread_count);
end;
$$;

create or replace function public.mark_dashboard_notification_read_v1(
  p_notification_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_profile_role text;
  v_recipient_profile_id uuid;
  v_recipient_team text;
  v_revoked_at timestamptz;
  v_legacy_read_at timestamptz;
  v_existing_read_at timestamptz;
  v_read_at timestamptz;
  v_newly_read boolean := false;
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_notification_id is null then
    raise exception 'notification_read_invalid' using errcode = '22023';
  end if;

  -- Every read mutation locks identity before content. This blocks a role
  -- demotion or notification revoke/recipient change until the receipt and
  -- returned unread count have been committed from the same visibility state.
  select profile.role
  into v_profile_role
  from public.profiles profile
  where profile.id = v_profile_id
  for share of profile;
  if not found then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  select
    notification.recipient_profile_id,
    notification.recipient_team,
    notification.revoked_at,
    notification.read_at
  into
    v_recipient_profile_id,
    v_recipient_team,
    v_revoked_at,
    v_legacy_read_at
  from public.dashboard_notifications notification
  where notification.id = p_notification_id
  for share of notification;
  if not found
    or v_revoked_at is not null
    or not coalesce(
      v_recipient_profile_id = v_profile_id
      or (
        v_recipient_profile_id is null
        and v_recipient_team = '관리팀'
        and v_profile_role in ('admin', 'staff')
      ),
      false
    )
  then
    raise exception 'notification_not_visible' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-read:' || p_notification_id::text, 0)
  );
  select receipt.read_at
  into v_read_at
  from public.dashboard_notification_read_receipts receipt
  where receipt.notification_id = p_notification_id
    and receipt.profile_id = v_profile_id;
  v_existing_read_at := coalesce(v_read_at, v_legacy_read_at);
  v_read_at := v_existing_read_at;

  if v_existing_read_at is null then
    insert into public.dashboard_notification_read_receipts(
      notification_id, profile_id, read_at
    ) values (
      p_notification_id, v_profile_id, pg_catalog.clock_timestamp()
    )
    on conflict (notification_id, profile_id) do nothing
    returning read_at into v_read_at;
    v_newly_read := found;
  end if;
  if v_read_at is null then
    select coalesce(receipt.read_at, v_legacy_read_at)
    into v_read_at
    from public.dashboard_notification_read_receipts receipt
    where receipt.notification_id = p_notification_id
      and receipt.profile_id = v_profile_id;
  end if;

  select count(*) into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(v_profile_id) visible
  where visible.read_at is null;
  return pg_catalog.jsonb_build_object(
    'notification_id', p_notification_id,
    'newly_read', v_newly_read,
    'read_at', v_read_at,
    'unread_count', v_unread_count
  );
end;
$$;

create or replace function dashboard_private.reserve_canonical_dispatch_ownership_v1(
  p_delivery_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found then
    raise exception 'notification_delivery_not_found' using errcode = 'P0002';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_event.workflow_key || ':' || v_event.occurrence_key || ':' || v_delivery.rule_id::text || ':' ||
    v_delivery.channel_key || ':' || v_delivery.target_key || ':' || v_delivery.target_generation::text,
    0
  ));
  insert into dashboard_private.notification_dispatch_ownership_claims(
    workflow_key, occurrence_key, rule_id, channel_key, target_key,
    target_generation, owner_kind, owner_generation, state
  ) values (
    v_event.workflow_key, v_event.occurrence_key, v_delivery.rule_id,
    v_delivery.channel_key, v_delivery.target_key, v_delivery.target_generation,
    'canonical', 0, 'reserved'
  )
  on conflict (
    workflow_key, occurrence_key, rule_id, channel_key, target_key, target_generation
  ) do nothing
  returning * into v_claim;

  if not found then
    select ownership.* into strict v_claim
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation
    for update of ownership;
  end if;

  if v_claim.owner_kind <> 'canonical' or v_claim.state <> 'reserved' then
    if v_delivery.status in ('pending', 'retry_wait', 'claimed') then
      update dashboard_private.notification_deliveries delivery
      set status = 'skipped',
          status_reason = 'legacy_deduped',
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where delivery.id = v_delivery.id;
    end if;
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      before_summary, after_summary, reason_code
    ) values (
      'notification_delivery', v_delivery.id::text, 'ownership_not_acquired',
      null, 'system',
      pg_catalog.jsonb_build_object('owner_kind', v_claim.owner_kind),
      pg_catalog.jsonb_build_object('status', 'skipped'),
      'legacy_deduped'
    );
    return null;
  end if;
  return v_claim.id;
end;
$$;

create or replace function public.begin_legacy_notification_dispatch_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_legacy_owner_key text,
  p_expected_owner_generation bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_dispatch_token uuid;
  v_response jsonb;
begin
  if p_workflow_key is null
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_rule_id is null
    or p_channel_key is null
    or p_channel_key not in ('in_app', 'web_push', 'google_chat', 'customer_message')
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_generation is null or p_target_generation < 0
    or nullif(pg_catalog.btrim(p_legacy_owner_key), '') is null
    or pg_catalog.octet_length(p_legacy_owner_key) > 96
    or p_expected_owner_generation is null or p_expected_owner_generation < 0
    or p_request_id is null
    or not exists (
      select 1 from dashboard_private.notification_rules rule
      where rule.id = p_rule_id
        and rule.workflow_key = p_workflow_key
        and rule.channel_key = p_channel_key
    )
  then
    raise exception 'notification_legacy_dispatch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'workflow_key', p_workflow_key, 'occurrence_key', p_occurrence_key,
    'rule_id', p_rule_id, 'channel_key', p_channel_key, 'target_key', p_target_key,
    'target_generation', p_target_generation::text,
    'legacy_owner_key', p_legacy_owner_key,
    'expected_owner_generation', p_expected_owner_generation::text
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'legacy_dispatch_begin'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workflow_key || ':' || p_occurrence_key || ':' || p_rule_id::text || ':' ||
    p_channel_key || ':' || p_target_key || ':' || p_target_generation::text,
    0
  ));
  insert into dashboard_private.notification_dispatch_ownership_claims(
    workflow_key, occurrence_key, rule_id, channel_key, target_key,
    target_generation, owner_kind, owner_generation, state
  ) values (
    p_workflow_key, p_occurrence_key, p_rule_id, p_channel_key, p_target_key,
    p_target_generation, 'legacy', p_expected_owner_generation, 'reserved'
  )
  on conflict (
    workflow_key, occurrence_key, rule_id, channel_key, target_key, target_generation
  ) do nothing
  returning * into v_claim;
  if not found then
    select ownership.* into strict v_claim
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = p_workflow_key
      and ownership.occurrence_key = p_occurrence_key
      and ownership.rule_id = p_rule_id
      and ownership.channel_key = p_channel_key
      and ownership.target_key = p_target_key
      and ownership.target_generation = p_target_generation
    for update of ownership;
  end if;

  if v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_expected_owner_generation
    or v_claim.state <> 'reserved'
  then
    v_response := pg_catalog.jsonb_build_object(
      'acquired', false,
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'status', 'legacy_deduped',
      'reason', 'ownership_not_acquired'
    );
  else
    v_dispatch_token := gen_random_uuid();
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state = 'dispatch_started',
        dispatch_started_at = pg_catalog.clock_timestamp(),
        dispatch_token = v_dispatch_token,
        updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_claim.id;
    v_response := pg_catalog.jsonb_build_object(
      'acquired', true,
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'dispatch_token', v_dispatch_token,
      'status', 'dispatch_started'
    );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'legacy_dispatch_begin', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text,
    case when (v_response ->> 'acquired')::boolean then 'legacy_dispatch_started'
      else 'ownership_not_acquired' end,
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object('owner_kind', v_claim.owner_kind, 'state', v_claim.state),
    pg_catalog.jsonb_build_object('status', v_response ->> 'status'),
    p_legacy_owner_key
  );
  return v_response;
end;
$$;

create or replace function public.finalize_legacy_notification_dispatch_v1(
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  if p_claim_id is null or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'notification_legacy_finalize_invalid' using errcode = '22023';
  end if;
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
    or v_claim.state not in ('dispatch_started', 'closed')
  then
    raise exception 'notification_legacy_ownership_mismatch' using errcode = '40001';
  end if;
  if v_claim.state = 'closed' then
    if v_claim.terminal_outcome is distinct from p_outcome
      or v_claim.provider_reference is distinct from p_provider_reference
    then
      raise exception 'notification_legacy_finalize_replay_mismatch' using errcode = '40001';
    end if;
    return pg_catalog.jsonb_build_object(
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'status', 'closed',
      'outcome', v_claim.terminal_outcome,
      'replayed', true
    );
  end if;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed',
      provider_reference = p_provider_reference,
      terminal_outcome = p_outcome,
      updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_claim.id;
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text, 'legacy_dispatch_finalized',
    null, 'system',
    pg_catalog.jsonb_build_object('state', 'dispatch_started'),
    pg_catalog.jsonb_build_object('state', 'closed', 'outcome', p_outcome),
    p_outcome
  );
  return pg_catalog.jsonb_build_object(
    'claim_id', v_claim.id,
    'owner_generation', v_claim.owner_generation::text,
    'status', 'closed',
    'outcome', p_outcome,
    'replayed', false
  );
end;
$$;

create or replace function public.commit_legacy_notification_in_app_projection_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_notification_id uuid;
begin
  if p_delivery_id is null or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
  then
    raise exception 'notification_legacy_projection_invalid' using errcode = '22023';
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found or v_delivery.channel_key <> 'in_app'
    or v_delivery.target_profile_id is null
  then
    raise exception 'notification_legacy_projection_delivery_invalid' using errcode = '22023';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.workflow_key <> v_event.workflow_key
    or v_claim.occurrence_key <> v_event.occurrence_key
    or v_claim.rule_id <> v_delivery.rule_id
    or v_claim.channel_key <> v_delivery.channel_key
    or v_claim.target_key <> v_delivery.target_key
    or v_claim.target_generation <> v_delivery.target_generation
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
    or v_claim.state not in ('dispatch_started', 'closed')
  then
    raise exception 'notification_legacy_ownership_mismatch' using errcode = '40001';
  end if;

  if v_delivery.status = 'sent' and v_claim.state = 'closed' then
    select notification.id into strict v_notification_id
    from public.dashboard_notifications notification
    where notification.source_delivery_id = v_delivery.id;
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'notification_id', v_notification_id,
      'status', 'sent',
      'replayed', true
    );
  end if;
  if v_claim.state <> 'dispatch_started'
    or v_delivery.status not in ('pending', 'claimed', 'skipped')
  then
    raise exception 'notification_legacy_projection_state_invalid' using errcode = '55000';
  end if;

  insert into public.dashboard_notifications(
    recipient_profile_id, actor_profile_id, type, title, body, href,
    metadata, read_at, source_delivery_id
  ) values (
    v_delivery.target_profile_id,
    v_event.actor_profile_id,
    'notification_control_plane',
    v_delivery.rendered_title,
    v_delivery.rendered_body,
    v_delivery.href,
    pg_catalog.jsonb_build_object(
      'workflow_key', v_event.workflow_key,
      'event_key', v_event.event_key,
      'source_type', v_event.source_type,
      'source_id', v_event.source_id,
      'delivery_id', v_delivery.id,
      'legacy_projection', true
    ),
    null,
    v_delivery.id
  )
  on conflict (source_delivery_id) where source_delivery_id is not null
  do nothing returning id into v_notification_id;
  if v_notification_id is null then
    select notification.id into strict v_notification_id
    from public.dashboard_notifications notification
    where notification.source_delivery_id = v_delivery.id;
  end if;

  update dashboard_private.notification_deliveries delivery
  set status = 'sent', status_reason = null,
      claimed_by = null, claim_token = null, lease_expires_at = null,
      next_attempt_at = null,
      sent_at = coalesce(delivery.sent_at, pg_catalog.clock_timestamp()),
      resolved_at = coalesce(delivery.resolved_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id;
  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed', updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_claim.id;

  return pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'notification_id', v_notification_id,
    'status', 'sent',
    'replayed', false
  );
end;
$$;

create or replace function public.transfer_notification_dispatch_ownership_v1(
  p_claim_id uuid,
  p_expected_owner_generation bigint,
  p_to_owner_kind text,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_response jsonb;
begin
  if p_claim_id is null
    or p_expected_owner_generation is null or p_expected_owner_generation < 0
    or p_to_owner_kind is null
    or p_to_owner_kind not in ('legacy', 'canonical')
    or p_request_id is null
    or nullif(pg_catalog.btrim(p_reason_code), '') is null
    or pg_catalog.octet_length(p_reason_code) > 96
  then
    raise exception 'notification_ownership_transfer_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'claim_id', p_claim_id,
    'expected_owner_generation', p_expected_owner_generation::text,
    'to_owner_kind', p_to_owner_kind,
    'reason_code', p_reason_code
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'dispatch_ownership_transfer'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found then
    raise exception 'notification_ownership_claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.state <> 'reserved'
    or v_claim.owner_generation <> p_expected_owner_generation
    or v_claim.owner_kind = p_to_owner_kind
    or v_claim.dispatch_started_at is not null
    or v_claim.dispatch_token is not null
    or v_claim.provider_reference is not null
  then
    raise exception 'notification_ownership_transfer_conflict' using errcode = '40001';
  end if;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set owner_kind = p_to_owner_kind,
      owner_generation = ownership.owner_generation + 1,
      updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_claim.id
  returning pg_catalog.jsonb_build_object(
    'claim_id', ownership.id,
    'owner_kind', ownership.owner_kind,
    'owner_generation', ownership.owner_generation::text,
    'state', ownership.state,
    'reason_code', p_reason_code
  ) into v_response;

  if p_to_owner_kind = 'canonical' then
    update dashboard_private.notification_deliveries delivery
    set status = 'pending',
        status_reason = null,
        next_attempt_at = pg_catalog.clock_timestamp(),
        resolved_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_claim.workflow_key
      and event_row.occurrence_key = v_claim.occurrence_key
      and delivery.rule_id = v_claim.rule_id
      and delivery.channel_key = v_claim.channel_key
      and delivery.target_key = v_claim.target_key
      and delivery.target_generation = v_claim.target_generation
      and delivery.status = 'skipped'
      and delivery.status_reason = 'legacy_deduped'
      and dashboard_private.notification_dispatch_enabled_v1(
        event_row.workflow_key, event_row.event_key
      );
  else
    update dashboard_private.notification_deliveries delivery
    set status = 'skipped',
        status_reason = 'legacy_deduped',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_claim.workflow_key
      and event_row.occurrence_key = v_claim.occurrence_key
      and delivery.rule_id = v_claim.rule_id
      and delivery.channel_key = v_claim.channel_key
      and delivery.target_key = v_claim.target_key
      and delivery.target_generation = v_claim.target_generation
      and delivery.status in ('pending', 'retry_wait', 'claimed');
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'dispatch_ownership_transfer', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text,
    'ownership_transferred_pre_dispatch', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'owner_kind', v_claim.owner_kind,
      'owner_generation', v_claim.owner_generation::text,
      'state', v_claim.state
    ),
    pg_catalog.jsonb_build_object(
      'owner_kind', p_to_owner_kind,
      'owner_generation', (v_claim.owner_generation + 1)::text,
      'state', 'reserved'
    ),
    p_reason_code
  );
  return v_response;
end;
$$;

revoke all on function dashboard_private.notification_worker_bounds_valid_v1(text, integer, integer)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_canonical_json_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_target_set_hash_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_dispatch_enabled_v1(text, text)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_shadow_enabled_v1()
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_initial_delivery_state_v1(text, text, boolean)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_safe_job_outcome_v1(jsonb)
  from public, anon, authenticated;
revoke all on function dashboard_private.materialize_notification_delivery_v1(
  uuid, uuid, bigint, uuid, bigint, text, text, text, uuid, text, jsonb,
  text, text, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.visible_dashboard_notification_rows_v1(uuid)
  from public, anon, authenticated;
revoke all on function dashboard_private.get_notification_render_snapshot_v1(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.apply_notification_fanout_batch_v1(
  uuid, uuid, text, uuid, bigint, bigint, text, jsonb, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.get_notification_render_snapshot_v1(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.apply_notification_fanout_batch_v1(
  uuid, uuid, text, uuid, bigint, bigint, text, jsonb, text, boolean
) from public, anon, authenticated;

revoke all on function dashboard_private.record_notification_event_v1(
  text, text, text, text, text, bigint, text, uuid, timestamptz, integer, jsonb, uuid, bigint
) from public, anon, authenticated;
revoke all on function dashboard_private.enqueue_notification_target_reconciliation_job_v1(
  text, text, text, bigint, uuid, text, bigint, text, text
) from public, anon, authenticated;
revoke all on function public.claim_notification_fanout_jobs_v1(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_notification_rule_reconciliation_jobs_v1(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_notification_target_reconciliation_jobs_v1(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.apply_notification_rule_reconciliation_batch_v1(
  uuid, uuid, text, jsonb, text, boolean
) from public, anon, authenticated;
revoke all on function public.apply_notification_target_reconciliation_batch_v1(
  uuid, uuid, text, jsonb, text, boolean
) from public, anon, authenticated;
revoke all on function public.finish_notification_orchestration_job_v1(
  text, uuid, uuid, text, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_notification_deliveries_v1(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.record_notification_worker_heartbeat_v1(text, uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.record_push_connection_test_audit_v1(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rebind_dashboard_push_subscription_v1(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_notification_delivery_send_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.commit_notification_in_app_delivery_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_notification_delivery_v1(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.reap_notification_leases_v1(text, integer)
  from public, anon, authenticated;
revoke all on function dashboard_private.reserve_canonical_dispatch_ownership_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.begin_legacy_notification_dispatch_v1(
  text, text, uuid, text, text, bigint, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_legacy_notification_dispatch_v1(
  uuid, bigint, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.commit_legacy_notification_in_app_projection_v1(
  uuid, uuid, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.transfer_notification_dispatch_ownership_v1(
  uuid, bigint, text, uuid, text
) from public, anon, authenticated;

grant execute on function dashboard_private.record_notification_event_v1(
  text, text, text, text, text, bigint, text, uuid, timestamptz, integer, jsonb, uuid, bigint
) to service_role;
grant execute on function public.get_notification_render_snapshot_v1(uuid, uuid, bigint)
  to service_role;
grant execute on function public.apply_notification_fanout_batch_v1(
  uuid, uuid, text, uuid, bigint, bigint, text, jsonb, text, boolean
) to service_role;
grant execute on function dashboard_private.enqueue_notification_target_reconciliation_job_v1(
  text, text, text, bigint, uuid, text, bigint, text, text
) to service_role;
grant execute on function public.claim_notification_fanout_jobs_v1(text, integer, integer)
  to service_role;
grant execute on function public.claim_notification_rule_reconciliation_jobs_v1(text, integer, integer)
  to service_role;
grant execute on function public.claim_notification_target_reconciliation_jobs_v1(text, integer, integer)
  to service_role;
grant execute on function public.apply_notification_rule_reconciliation_batch_v1(
  uuid, uuid, text, jsonb, text, boolean
) to service_role;
grant execute on function public.apply_notification_target_reconciliation_batch_v1(
  uuid, uuid, text, jsonb, text, boolean
) to service_role;
grant execute on function public.finish_notification_orchestration_job_v1(
  text, uuid, uuid, text, jsonb, text, timestamptz
) to service_role;
grant execute on function public.claim_notification_deliveries_v1(text, integer, integer)
  to service_role;
grant execute on function public.record_notification_worker_heartbeat_v1(text, uuid, text, jsonb, text)
  to service_role;
grant execute on function public.record_push_connection_test_audit_v1(uuid, text, text)
  to service_role;
grant execute on function public.rebind_dashboard_push_subscription_v1(text, text, text, text)
  to authenticated;
grant execute on function public.begin_notification_delivery_send_v1(uuid, uuid)
  to service_role;
grant execute on function public.commit_notification_in_app_delivery_v1(uuid, uuid)
  to service_role;
grant execute on function public.finalize_notification_delivery_v1(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.reap_notification_leases_v1(text, integer)
  to service_role;
grant execute on function dashboard_private.reserve_canonical_dispatch_ownership_v1(uuid)
  to service_role;
grant execute on function public.begin_legacy_notification_dispatch_v1(
  text, text, uuid, text, text, bigint, text, bigint, uuid
) to service_role;
grant execute on function public.finalize_legacy_notification_dispatch_v1(
  uuid, bigint, uuid, text, text
) to service_role;
grant execute on function public.commit_legacy_notification_in_app_projection_v1(
  uuid, uuid, bigint, uuid
) to service_role;
grant execute on function public.transfer_notification_dispatch_ownership_v1(
  uuid, bigint, text, uuid, text
) to service_role;

revoke all on function public.get_notification_orchestration_job_status_v1(text, uuid)
  from public, anon, authenticated;
revoke all on function public.retry_notification_orchestration_job_v1(text, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_notification_delivery_v1(uuid, text, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.get_dashboard_notification_inbox_v1(integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.get_dashboard_notification_unread_count_v1()
  from public, anon, authenticated;
revoke all on function public.mark_dashboard_notification_read_v1(uuid)
  from public, anon, authenticated;

grant execute on function public.get_notification_orchestration_job_status_v1(text, uuid)
  to authenticated;
grant execute on function public.retry_notification_orchestration_job_v1(text, uuid, integer, uuid)
  to authenticated;
grant execute on function public.reconcile_notification_delivery_v1(uuid, text, text, uuid, boolean)
  to authenticated;
grant execute on function public.get_dashboard_notification_inbox_v1(integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.get_dashboard_notification_unread_count_v1()
  to authenticated;
grant execute on function public.mark_dashboard_notification_read_v1(uuid)
  to authenticated;

commit;
