begin;

set local lock_timeout = '5s';

alter table public.makeup_request_events
  add column if not exists mutation_request_id uuid,
  add column if not exists payload jsonb;

create unique index if not exists makeup_request_events_mutation_request_uidx
  on public.makeup_request_events(mutation_request_id)
  where mutation_request_id is not null;

create table if not exists dashboard_private.notification_makeup_legacy_imports (
  legacy_delivery_id uuid primary key
    references public.makeup_notification_deliveries(id) on delete restrict,
  source_event_id uuid not null
    references public.makeup_request_events(id) on delete restrict,
  legacy_snapshot jsonb not null,
  source_checksum text not null,
  event_id uuid not null references dashboard_private.notification_events(id),
  canonical_delivery_id uuid not null references dashboard_private.notification_deliveries(id),
  ownership_claim_id uuid not null references dashboard_private.notification_dispatch_ownership_claims(id),
  dashboard_notification_id uuid references public.dashboard_notifications(id) on delete set null,
  imported_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint notification_makeup_legacy_import_snapshot_check
    check (pg_catalog.jsonb_typeof(legacy_snapshot) = 'object'),
  constraint notification_makeup_legacy_import_checksum_check
    check (source_checksum ~ '^[0-9a-f]{64}$')
);

create table if not exists dashboard_private.notification_makeup_retention_snapshots (
  singleton boolean primary key default true check (singleton),
  retained_count bigint not null,
  retained_checksum text not null,
  oldest_created_at timestamptz,
  newest_created_at timestamptz,
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint notification_makeup_retention_count_check check (retained_count >= 0),
  constraint notification_makeup_retention_checksum_check
    check (retained_checksum ~ '^[0-9a-f]{64}$')
);

create table if not exists dashboard_private.notification_makeup_retention_observations (
  id uuid primary key default gen_random_uuid(),
  observation_kind text not null,
  retained_count bigint not null,
  retained_checksum text not null,
  imported_count bigint not null,
  imported_checksum text not null,
  unimported_count bigint not null,
  oldest_created_at timestamptz,
  newest_created_at timestamptz,
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint notification_makeup_retention_observation_kind_check
    check (pg_catalog.btrim(observation_kind) <> ''),
  constraint notification_makeup_retention_observation_count_check
    check (
      retained_count >= 0
      and imported_count >= 0
      and unimported_count >= 0
      and retained_count = imported_count + unimported_count
    ),
  constraint notification_makeup_retention_observation_checksum_check
    check (
      retained_checksum ~ '^[0-9a-f]{64}$'
      and imported_checksum ~ '^[0-9a-f]{64}$'
    )
);

create table if not exists dashboard_private.notification_makeup_reconcile_audits (
  audit_key text not null,
  rule_id uuid not null references dashboard_private.notification_rules(id),
  source_changed boolean not null,
  before_revision bigint not null,
  before_enabled boolean not null,
  before_template_id uuid not null references dashboard_private.notification_templates(id),
  before_template_checksum text not null,
  before_updated_by uuid,
  before_updated_actor_kind text not null,
  after_revision bigint,
  after_enabled boolean,
  after_template_id uuid references dashboard_private.notification_templates(id),
  after_template_checksum text,
  after_updated_by uuid,
  after_updated_actor_kind text,
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (audit_key, rule_id)
);

alter table dashboard_private.notification_makeup_legacy_imports enable row level security;
alter table dashboard_private.notification_makeup_retention_snapshots enable row level security;
alter table dashboard_private.notification_makeup_retention_observations enable row level security;
alter table dashboard_private.notification_makeup_reconcile_audits enable row level security;
revoke all on table dashboard_private.notification_makeup_legacy_imports
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_makeup_retention_snapshots
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_makeup_retention_observations
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_makeup_reconcile_audits
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_makeup_setting_checksum_v1(
  p_trigger_kind text,
  p_channel text,
  p_enabled boolean,
  p_title_template text,
  p_body_template text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'trigger_kind', p_trigger_kind,
          'channel', p_channel,
          'enabled', p_enabled,
          'title_template', p_title_template,
          'body_template', p_body_template
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

create or replace function dashboard_private.notification_reconcile_makeup_settings_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  legacy_source record;
  desired_enabled boolean;
  desired_title text;
  desired_body text;
  desired_checksum text;
  source_changed boolean;
  next_template_id uuid;
  next_template_version bigint;
  enabled_changed boolean;
  template_changed boolean;
  changed_count bigint := 0;
  metadata_count bigint := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-makeup-settings-reconcile-v1', 0)
  );

  if exists (
    select 1
    from public.makeup_notification_settings legacy_setting
    left join dashboard_private.notification_settings_import_metadata metadata
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
     and metadata.source_table = 'public.makeup_notification_settings'
    where metadata.source_key is null
  ) then
    raise exception 'notification_makeup_baseline_missing' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.makeup_notification_settings legacy_setting
    join dashboard_private.notification_settings_import_metadata metadata
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
     and metadata.source_table = 'public.makeup_notification_settings'
    cross join lateral pg_catalog.jsonb_array_elements_text(
      metadata.mapped_rule_ids
    ) mapped(rule_id_text)
    join dashboard_private.notification_rules rule_row
      on rule_row.id::text = mapped.rule_id_text
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
    where metadata.source_checksum <> dashboard_private.notification_makeup_setting_checksum_v1(
      legacy_setting.trigger_kind,
      legacy_setting.channel,
      legacy_setting.enabled,
      legacy_setting.title_template,
      legacy_setting.body_template
    )
      and (
        rule_row.updated_actor_kind <> 'system'
        or rule_row.updated_by is not null
        or rule_row.created_actor_kind <> 'system'
        or template_row.created_actor_kind <> 'system'
        or template_row.created_by is not null
      )
  ) then
    raise exception 'notification_makeup_operator_edit_conflict' using errcode = '55000';
  end if;

  if exists (
    select legacy_setting.trigger_kind
    from public.makeup_notification_settings legacy_setting
    where legacy_setting.channel in ('google_chat_english', 'google_chat_math')
    group by legacy_setting.trigger_kind
    having pg_catalog.count(*) <> 2
      or pg_catalog.count(distinct legacy_setting.enabled) <> 1
  ) then
    raise exception 'notification_makeup_subject_settings_review_required'
      using errcode = '55000';
  end if;

  for candidate in
    select
      rule_row.*,
      registry.source_trigger_kind,
      template_row.allowed_variables,
      template_row.payload_schema_version,
      template_row.title_template as current_title,
      template_row.body_template as current_body,
      template_row.checksum as current_checksum
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule_row.id
     and registry.workflow_key = 'makeup_requests'
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
    order by rule_row.id
    for update of rule_row
  loop
    select coalesce(pg_catalog.bool_or(
      metadata.source_checksum is distinct from
        dashboard_private.notification_makeup_setting_checksum_v1(
          legacy_setting.trigger_kind,
          legacy_setting.channel,
          legacy_setting.enabled,
          legacy_setting.title_template,
          legacy_setting.body_template
        )
    ), false)
    into source_changed
    from dashboard_private.notification_settings_import_metadata metadata
    join public.makeup_notification_settings legacy_setting
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
    where metadata.source_table = 'public.makeup_notification_settings'
      and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(candidate.id);

    -- Task 8 기준 뒤 실제 원본 내용이 바뀐 규칙만 조정한다. 공통 UI에서만
    -- 수정된 규칙은 레거시 원본이 그대로인 한 그대로 보존한다.
    if not source_changed then
      continue;
    end if;

    select pg_catalog.bool_and(legacy_setting.enabled)
    into desired_enabled
    from dashboard_private.notification_settings_import_metadata metadata
    join public.makeup_notification_settings legacy_setting
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
    where metadata.source_table = 'public.makeup_notification_settings'
      and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(candidate.id);

    select
      legacy_setting.title_template,
      legacy_setting.body_template
    into desired_title, desired_body
    from public.makeup_notification_settings legacy_setting
    where legacy_setting.trigger_kind = candidate.source_trigger_kind
      and legacy_setting.channel = 'dashboard_personal';

    desired_enabled := coalesce(desired_enabled, candidate.enabled);
    desired_title := nullif(pg_catalog.btrim(desired_title), '');
    desired_body := nullif(pg_catalog.btrim(desired_body), '');
    if desired_title is null
      or desired_body is null
      or not dashboard_private.notification_template_content_valid_v1(
        desired_title,
        desired_body,
        candidate.allowed_variables
      )
    then
      raise exception 'notification_makeup_template_review_required'
        using errcode = '55000';
    end if;
    desired_checksum := dashboard_private.notification_seed_template_checksum_v1(
      desired_title,
      desired_body,
      candidate.allowed_variables,
      candidate.payload_schema_version
    );
    enabled_changed := candidate.enabled is distinct from desired_enabled;
    template_changed := candidate.current_checksum is distinct from desired_checksum;

    if enabled_changed or template_changed then
      if candidate.updated_actor_kind <> 'system'
        or candidate.updated_by is not null
        or candidate.created_actor_kind <> 'system'
      then
        raise exception 'notification_makeup_operator_edit_conflict'
          using errcode = '55000';
      end if;

      next_template_id := candidate.active_template_id;
      if template_changed then
        select template_row.id
        into next_template_id
        from dashboard_private.notification_templates template_row
        where template_row.rule_id = candidate.id
          and template_row.checksum = desired_checksum
          and template_row.title_template = desired_title
          and template_row.body_template = desired_body
          and template_row.allowed_variables = candidate.allowed_variables
          and template_row.payload_schema_version = candidate.payload_schema_version
        order by template_row.version desc
        limit 1;

        if next_template_id is null then
          select coalesce(pg_catalog.max(template_row.version), 0) + 1
          into next_template_version
          from dashboard_private.notification_templates template_row
          where template_row.rule_id = candidate.id;
          next_template_id := dashboard_private.notification_deterministic_uuid_v1(
            'notification-makeup-template-reconcile-v1',
            candidate.id::text || '|' || desired_checksum
          );
          insert into dashboard_private.notification_templates(
            id,
            rule_id,
            version,
            title_template,
            body_template,
            allowed_variables,
            payload_schema_version,
            checksum,
            created_by,
            created_actor_kind
          ) values (
            next_template_id,
            candidate.id,
            next_template_version,
            desired_title,
            desired_body,
            candidate.allowed_variables,
            candidate.payload_schema_version,
            desired_checksum,
            null,
            'system'
          ) on conflict (id) do nothing;
        end if;
      end if;

      update dashboard_private.notification_rules rule_row
      set enabled = desired_enabled,
          active_template_id = next_template_id,
          revision = rule_row.revision + 1,
          updated_by = null,
          updated_actor_kind = 'system',
          updated_at = pg_catalog.clock_timestamp()
      where rule_row.id = candidate.id
        and (
          rule_row.enabled is distinct from desired_enabled
          or rule_row.active_template_id is distinct from next_template_id
        );
      if found then
        changed_count := changed_count + 1;
      end if;
    end if;
  end loop;

  for legacy_source in
    select
      legacy_setting.*,
      metadata.source_key,
      metadata.mapped_rule_ids,
      metadata.import_state,
      metadata.inactive_reason,
      metadata.event_key,
      dashboard_private.notification_makeup_setting_checksum_v1(
        legacy_setting.trigger_kind,
        legacy_setting.channel,
        legacy_setting.enabled,
        legacy_setting.title_template,
        legacy_setting.body_template
      ) as current_checksum
    from public.makeup_notification_settings legacy_setting
    join dashboard_private.notification_settings_import_metadata metadata
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
     and metadata.source_table = 'public.makeup_notification_settings'
    order by legacy_setting.trigger_kind, legacy_setting.channel
  loop
    insert into dashboard_private.notification_settings_import_metadata(
      source_key,
      source_table,
      source_revision,
      source_checksum,
      workflow_key,
      event_key,
      mapped_rule_ids,
      import_state,
      inactive_reason,
      source_snapshot,
      imported_at
    ) values (
      legacy_source.source_key,
      'public.makeup_notification_settings',
      pg_catalog.to_char(
        legacy_source.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      legacy_source.current_checksum,
      'makeup_requests',
      legacy_source.event_key,
      legacy_source.mapped_rule_ids,
      legacy_source.import_state,
      legacy_source.inactive_reason,
      pg_catalog.jsonb_build_object(
        'trigger_kind', legacy_source.trigger_kind,
        'channel', legacy_source.channel,
        'enabled', legacy_source.enabled,
        'title_template', legacy_source.title_template,
        'body_template', legacy_source.body_template
      ),
      pg_catalog.clock_timestamp()
    )
    on conflict (source_key) do update
    set source_revision = excluded.source_revision,
        source_checksum = excluded.source_checksum,
        source_snapshot = excluded.source_snapshot,
        imported_at = excluded.imported_at
    where dashboard_private.notification_settings_import_metadata.source_revision
        is distinct from excluded.source_revision
      or dashboard_private.notification_settings_import_metadata.source_checksum
        is distinct from excluded.source_checksum
      or dashboard_private.notification_settings_import_metadata.source_snapshot
        is distinct from excluded.source_snapshot;
    if found then
      metadata_count := metadata_count + 1;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'changed_rule_count', changed_count::text,
    'updated_metadata_count', metadata_count::text
  );
end;
$$;

create or replace function public.reconcile_makeup_notification_settings_after_write_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.notification_reconcile_makeup_settings_v1();
  return null;
end;
$$;

drop trigger if exists reconcile_makeup_notification_settings_after_write_v1
  on public.makeup_notification_settings;
create trigger reconcile_makeup_notification_settings_after_write_v1
after insert or update on public.makeup_notification_settings
for each statement
execute function public.reconcile_makeup_notification_settings_after_write_v1();

create or replace function dashboard_private.notification_makeup_legacy_snapshot_v1(
  p_delivery_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'legacyDeliveryId', delivery.id,
    'requestId', delivery.request_id,
    'triggerKind', delivery.trigger_kind,
    'channel', delivery.channel,
    'target', pg_catalog.jsonb_build_object(
      'type', delivery.target_type,
      'label', delivery.target_label,
      'recipientProfileId', delivery.recipient_profile_id,
      'recipientTeam', delivery.recipient_team,
      'googleChatChannel', delivery.google_chat_channel
    ),
    'status', delivery.status,
    'dedupeKey', delivery.dedupe_key,
    'title', delivery.title,
    'body', delivery.body,
    'actorProfileId', delivery.actor_profile_id,
    'createdAt', pg_catalog.to_char(
      delivery.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  )
  from public.makeup_notification_deliveries delivery
  where delivery.id = p_delivery_id;
$$;

alter function dashboard_private.notification_makeup_legacy_snapshot_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.notification_makeup_legacy_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_record_makeup_retention_observation_v1(
  p_observation_kind text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  retained_count bigint;
  retained_checksum text;
  imported_count bigint;
  imported_checksum text;
  unimported_count bigint;
  oldest_created_at timestamptz;
  newest_created_at timestamptz;
begin
  if p_observation_kind is null
    or pg_catalog.btrim(p_observation_kind) = ''
  then
    raise exception 'notification_makeup_retention_observation_invalid'
      using errcode = '22023';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              delivery.id::text || ':'
                || dashboard_private.notification_makeup_legacy_snapshot_v1(
                  delivery.id
                )::text,
              '|' order by delivery.id
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    ),
    pg_catalog.min(delivery.created_at),
    pg_catalog.max(delivery.created_at)
  into retained_count, retained_checksum, oldest_created_at, newest_created_at
  from public.makeup_notification_deliveries delivery;

  select
    pg_catalog.count(*),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              receipt.legacy_delivery_id::text || ':' || receipt.legacy_snapshot::text,
              '|' order by receipt.legacy_delivery_id
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  into imported_count, imported_checksum
  from dashboard_private.notification_makeup_legacy_imports receipt;

  unimported_count := retained_count - imported_count;

  insert into dashboard_private.notification_makeup_retention_snapshots(
    singleton,
    retained_count,
    retained_checksum,
    oldest_created_at,
    newest_created_at,
    observed_at
  ) values (
    true,
    retained_count,
    retained_checksum,
    oldest_created_at,
    newest_created_at,
    pg_catalog.clock_timestamp()
  )
  on conflict (singleton) do update
  set retained_count = excluded.retained_count,
      retained_checksum = excluded.retained_checksum,
      oldest_created_at = excluded.oldest_created_at,
      newest_created_at = excluded.newest_created_at,
      observed_at = excluded.observed_at;

  insert into dashboard_private.notification_makeup_retention_observations(
    observation_kind,
    retained_count,
    retained_checksum,
    imported_count,
    imported_checksum,
    unimported_count,
    oldest_created_at,
    newest_created_at,
    observed_at
  ) values (
    pg_catalog.btrim(p_observation_kind),
    retained_count,
    retained_checksum,
    imported_count,
    imported_checksum,
    unimported_count,
    oldest_created_at,
    newest_created_at,
    pg_catalog.clock_timestamp()
  );

  return pg_catalog.jsonb_build_object(
    'retained_count', retained_count::text,
    'retained_checksum', retained_checksum,
    'imported_count', imported_count::text,
    'imported_checksum', imported_checksum,
    'unimported_count', unimported_count::text
  );
end;
$$;

alter function dashboard_private.notification_record_makeup_retention_observation_v1(text)
  owner to postgres;
revoke all on function dashboard_private.notification_record_makeup_retention_observation_v1(text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_refresh_makeup_retention_snapshot_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.notification_record_makeup_retention_observation_v1(
    'source_refresh'
  );

  -- 이전 500건 삭제 정책은 매 관측 append-only 증거로만 남긴다. 보관 이력은 삭제하지 않는다.
end;
$$;

create or replace function public.prune_makeup_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.notification_refresh_makeup_retention_snapshot_v1();
  return null;
end;
$$;

create or replace function dashboard_private.notification_makeup_event_key_v1(
  p_trigger_kind text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select case p_trigger_kind
    when 'submitted' then 'makeup.submitted'
    when 'approved' then 'makeup.approved'
    when 'returned' then 'makeup.revision_requested'
    when 'rejected' then 'makeup.rejected'
    when 'refund_requested' then 'makeup.refund_requested'
    when 'completed' then 'makeup.refund_completed'
    when 'canceled' then 'makeup.approval_canceled'
    else null
  end;
$$;

create or replace function dashboard_private.notification_makeup_source_event_types_v1(
  p_trigger_kind text
)
returns text[]
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select case p_trigger_kind
    when 'submitted' then array['submitted', 'resubmitted']::text[]
    when 'approved' then array['approved']::text[]
    when 'returned' then array['returned', 'revision_requested']::text[]
    when 'rejected' then array['rejected']::text[]
    when 'refund_requested' then array['refund_requested']::text[]
    when 'completed' then array['completed', 'refund_completed']::text[]
    when 'canceled' then array['canceled', 'approval_canceled', 'completed_canceled']::text[]
    else array[]::text[]
  end;
$$;

alter function dashboard_private.notification_makeup_source_event_types_v1(text)
  owner to postgres;
revoke all on function dashboard_private.notification_makeup_source_event_types_v1(text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_assert_makeup_retained_import_complete_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  retained_count bigint;
  imported_count bigint;
  retained_checksum text;
  imported_checksum text;
begin
  if exists (
    select 1
    from public.makeup_notification_deliveries legacy_delivery
    left join dashboard_private.notification_makeup_legacy_imports receipt
      on receipt.legacy_delivery_id = legacy_delivery.id
    where receipt.legacy_delivery_id is null
  ) then
    raise exception 'notification_makeup_legacy_import_incomplete'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join public.makeup_notification_deliveries legacy_delivery
      on legacy_delivery.id = receipt.legacy_delivery_id
    where receipt.legacy_snapshot
        is distinct from dashboard_private.notification_makeup_legacy_snapshot_v1(
          legacy_delivery.id
        )
       or receipt.source_checksum is distinct from pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(receipt.legacy_snapshot::text, 'UTF8')
         ),
         'hex'
       )
  ) then
    raise exception 'notification_makeup_legacy_snapshot_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join public.makeup_notification_deliveries legacy_delivery
      on legacy_delivery.id = receipt.legacy_delivery_id
    join public.makeup_request_events source_event
      on source_event.id = receipt.source_event_id
    join dashboard_private.notification_events canonical_event
      on canonical_event.id = receipt.event_id
    join dashboard_private.notification_deliveries canonical_delivery
      on canonical_delivery.id = receipt.canonical_delivery_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.id = receipt.ownership_claim_id
    where source_event.request_id is distinct from legacy_delivery.request_id
       or not (
         source_event.event_type = any (
           dashboard_private.notification_makeup_source_event_types_v1(
             legacy_delivery.trigger_kind
           )
         )
       )
       or source_event.created_at > legacy_delivery.created_at
       or source_event.id is distinct from (
         select candidate.id
         from public.makeup_request_events candidate
         where candidate.request_id = legacy_delivery.request_id
           and candidate.event_type = any (
             dashboard_private.notification_makeup_source_event_types_v1(
               legacy_delivery.trigger_kind
             )
           )
           and candidate.created_at <= legacy_delivery.created_at
         order by candidate.created_at desc, candidate.id desc
         limit 1
       )
       or canonical_event.workflow_key <> 'makeup_requests'
       or canonical_event.event_key is distinct from
         dashboard_private.notification_makeup_event_key_v1(
           legacy_delivery.trigger_kind
         )
       or canonical_event.source_type <> 'makeup_request_event'
       or canonical_event.source_id <> source_event.id::text
       or canonical_event.occurrence_key <> source_event.id::text
       or canonical_delivery.event_id <> canonical_event.id
       or ownership.workflow_key <> 'makeup_requests'
       or ownership.occurrence_key <> source_event.id::text
       or ownership.rule_id <> canonical_delivery.rule_id
       or ownership.channel_key <> canonical_delivery.channel_key
       or ownership.target_key <> canonical_delivery.target_key
       or ownership.target_generation <> canonical_delivery.target_generation
  ) then
    raise exception 'notification_makeup_legacy_lineage_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join dashboard_private.notification_event_fanout_jobs fanout
      on fanout.event_id = receipt.event_id
  ) then
    raise exception 'notification_makeup_legacy_fanout_forbidden'
      using errcode = '55000';
  end if;

  if exists (
    select receipt.source_event_id
    from dashboard_private.notification_makeup_legacy_imports receipt
    group by receipt.source_event_id
    having pg_catalog.count(distinct receipt.event_id) <> 1
  ) then
    raise exception 'notification_makeup_legacy_occurrence_split'
      using errcode = '55000';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              legacy_delivery.id::text || ':'
                || dashboard_private.notification_makeup_legacy_snapshot_v1(
                  legacy_delivery.id
                )::text,
              '|' order by legacy_delivery.id
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  into retained_count, retained_checksum
  from public.makeup_notification_deliveries legacy_delivery;

  select
    pg_catalog.count(*),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              receipt.legacy_delivery_id::text || ':' || receipt.legacy_snapshot::text,
              '|' order by receipt.legacy_delivery_id
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  into imported_count, imported_checksum
  from dashboard_private.notification_makeup_legacy_imports receipt;

  if retained_count <> imported_count
    or retained_checksum <> imported_checksum
  then
    raise exception 'notification_makeup_legacy_checksum_parity_failed'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'retained_count', retained_count::text,
    'imported_count', imported_count::text,
    'unimported_count', '0',
    'retained_checksum', retained_checksum,
    'imported_checksum', imported_checksum
  );
end;
$$;

alter function dashboard_private.notification_assert_makeup_retained_import_complete_v1()
  owner to postgres;
revoke all on function dashboard_private.notification_assert_makeup_retained_import_complete_v1()
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_import_makeup_retained_state_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  legacy_delivery public.makeup_notification_deliveries%rowtype;
  request_row public.makeup_requests%rowtype;
  source_event public.makeup_request_events%rowtype;
  rule_row dashboard_private.notification_rules%rowtype;
  event_id uuid;
  delivery_id uuid;
  claim_id uuid;
  notification_id uuid;
  v_event_key text;
  event_rule_snapshot jsonb;
  legacy_snapshot jsonb;
  source_checksum text;
  target_kind text;
  target_key text;
  target_profile_id uuid;
  connection_key text;
  target_snapshot jsonb;
  target_set_hash text;
  canonical_status text;
  canonical_reason text;
  validation jsonb;
  inserted_count bigint := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-makeup-retained-import-v1', 0)
  );

  for legacy_delivery in
    select delivery.*
    from public.makeup_notification_deliveries delivery
    left join dashboard_private.notification_makeup_legacy_imports receipt
      on receipt.legacy_delivery_id = delivery.id
    where receipt.legacy_delivery_id is null
    order by delivery.created_at, delivery.id
  loop
    v_event_key := dashboard_private.notification_makeup_event_key_v1(
      legacy_delivery.trigger_kind
    );
    if v_event_key is null then
      raise exception 'notification_makeup_legacy_trigger_unsupported'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    select candidate.* into source_event
    from public.makeup_request_events candidate
    where candidate.request_id = legacy_delivery.request_id
      and candidate.event_type = any (
        dashboard_private.notification_makeup_source_event_types_v1(
          legacy_delivery.trigger_kind
        )
      )
      and candidate.created_at <= legacy_delivery.created_at
    order by candidate.created_at desc, candidate.id desc
    limit 1;
    if not found then
      raise exception 'notification_makeup_legacy_source_missing'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    legacy_snapshot := dashboard_private.notification_makeup_legacy_snapshot_v1(
      legacy_delivery.id
    );
    if legacy_snapshot is null then
      raise exception 'notification_makeup_legacy_snapshot_missing'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;
    source_checksum := pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(legacy_snapshot::text, 'UTF8')
      ),
      'hex'
    );
    event_id := dashboard_private.notification_deterministic_uuid_v1(
      'notification-makeup-legacy-source-event-v2',
      source_event.id::text
    );
    delivery_id := null;
    claim_id := null;
    notification_id := null;

    select request.* into request_row
    from public.makeup_requests request
    where request.id = legacy_delivery.request_id;
    if not found then
      raise exception 'notification_makeup_legacy_request_missing'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    select rule.* into rule_row
    from dashboard_private.notification_rules rule
    where rule.workflow_key = 'makeup_requests'
      and rule.event_key = v_event_key
      and (
        (legacy_delivery.channel = 'dashboard_personal'
          and rule.channel_key = 'in_app'
          and (
            (legacy_delivery.trigger_kind in ('submitted', 'refund_requested')
              and rule.audience_key = 'approver_profile'
              and legacy_delivery.recipient_profile_id = request_row.approver_profile_id)
            or (legacy_delivery.trigger_kind in ('returned', 'rejected')
              and rule.audience_key = 'requester_profile'
              and legacy_delivery.recipient_profile_id = request_row.requester_id)
            or (legacy_delivery.trigger_kind in ('approved', 'completed', 'canceled')
              and (
                (rule.audience_key = 'approver_profile'
                  and legacy_delivery.recipient_profile_id = request_row.approver_profile_id)
                or (rule.audience_key = 'requester_profile'
                  and legacy_delivery.recipient_profile_id = request_row.requester_id)
              ))
          ))
        or (legacy_delivery.channel = 'dashboard_management'
          and rule.channel_key = 'in_app'
          and rule.audience_key = 'management_team')
        or (legacy_delivery.channel = 'google_chat_executive'
          and rule.channel_key = 'google_chat'
          and rule.audience_key = 'executive_team')
        or (legacy_delivery.channel = 'google_chat_admin'
          and rule.channel_key = 'google_chat'
          and rule.audience_key = 'management_team')
        or (legacy_delivery.channel in ('google_chat_math', 'google_chat_english')
          and rule.channel_key = 'google_chat'
          and rule.audience_key = 'subject_team')
      )
    order by
      case
        when legacy_delivery.channel = 'dashboard_personal'
          and rule.audience_key = 'approver_profile' then 0
        when legacy_delivery.channel = 'dashboard_personal'
          and rule.audience_key = 'requester_profile' then 1
        else 2
      end,
      rule.id
    limit 1;
    if not found then
      raise exception 'notification_makeup_legacy_rule_missing'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(snapshot.item order by snapshot.rule_id),
      '[]'::jsonb
    ) into event_rule_snapshot
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
      where rule.scope_key = 'global'
        and rule.workflow_key = 'makeup_requests'
        and rule.event_key = v_event_key
    ) snapshot;
    if pg_catalog.jsonb_array_length(event_rule_snapshot) = 0 then
      raise exception 'notification_makeup_legacy_event_rules_missing'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    insert into dashboard_private.notification_events(
      id,
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
      event_id,
      'global',
      'makeup_requests',
      v_event_key,
      'makeup_request_event',
      source_event.id::text,
      null,
      source_event.id::text,
      source_event.actor_id,
      source_event.created_at,
      1,
      pg_catalog.jsonb_build_object(
        'makeup_request_id', legacy_delivery.request_id,
        'source_event_id', source_event.id,
        'source_event_type', source_event.event_type,
        'occurred_at', source_event.created_at,
        'retained_history', true
      ),
      event_rule_snapshot,
      null,
      null
    ) on conflict (id) do nothing;

    if not exists (
      select 1
      from dashboard_private.notification_events canonical_event
      where canonical_event.id = event_id
        and canonical_event.workflow_key = 'makeup_requests'
        and canonical_event.event_key = v_event_key
        and canonical_event.source_type = 'makeup_request_event'
        and canonical_event.source_id = source_event.id::text
        and canonical_event.occurrence_key = source_event.id::text
        and canonical_event.occurred_at = source_event.created_at
        and canonical_event.rule_snapshot = event_rule_snapshot
    ) then
      raise exception 'notification_makeup_legacy_event_replay_mismatch'
        using errcode = '55000', detail = legacy_delivery.id::text;
    end if;

    if rule_row.channel_key = 'google_chat' then
        connection_key := case legacy_delivery.channel
          when 'google_chat_executive' then 'google_chat.executive'
          when 'google_chat_admin' then 'google_chat.management'
          when 'google_chat_math' then 'google_chat.math'
          when 'google_chat_english' then 'google_chat.english'
          else null
        end;
        target_kind := 'connection';
        target_key := 'connection:' || connection_key;
        target_profile_id := null;
        target_snapshot := pg_catalog.jsonb_build_object('connection_key', connection_key);
    elsif legacy_delivery.recipient_profile_id is not null then
        connection_key := null;
        target_kind := 'profile';
        target_key := 'profile:' || legacy_delivery.recipient_profile_id::text;
        target_profile_id := legacy_delivery.recipient_profile_id;
        target_snapshot := pg_catalog.jsonb_build_object(
          'profile_id', legacy_delivery.recipient_profile_id
        );
    else
        connection_key := null;
        target_kind := 'audience';
        target_key := 'audience:' || rule_row.audience_key;
        target_profile_id := null;
        target_snapshot := pg_catalog.jsonb_build_object(
          'audience_key', rule_row.audience_key,
          'legacy_recipient_team', legacy_delivery.recipient_team
        );
    end if;

    target_set_hash := dashboard_private.notification_target_set_hash_v1(
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'target_kind', target_kind,
          'target_key', target_key,
          'target_profile_id', target_profile_id,
          'connection_key', connection_key,
          'target_snapshot', target_snapshot
        ))
      );
    canonical_status := case legacy_delivery.status
        when 'sent' then 'sent'
        when 'failed' then 'failed'
        when 'disabled' then 'disabled'
        else 'skipped'
      end;
    canonical_reason := case legacy_delivery.status
        when 'failed' then 'provider_definite_rejection'
        when 'disabled' then 'rule_disabled'
        when 'deduped' then 'legacy_deduped'
        when 'skipped' then 'legacy_skipped'
        else null
      end;
    delivery_id := dashboard_private.notification_deterministic_uuid_v1(
        'notification-makeup-legacy-delivery-v1',
        legacy_delivery.id::text
      );

    insert into dashboard_private.notification_deliveries(
        id,
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
        status,
        status_reason,
        dedupe_key,
        rendered_title,
        rendered_body,
        href,
        scheduled_for,
        attempt_count,
        max_attempts,
        next_attempt_at,
        last_error_code,
        last_error_summary,
        sent_at,
        resolved_at,
        created_at,
        updated_at
      ) values (
        delivery_id,
        event_id,
        rule_row.id,
        rule_row.revision,
        rule_row.active_template_id,
        rule_row.channel_key,
        rule_row.audience_key,
        0,
        target_set_hash,
        target_kind,
        target_key,
        target_profile_id,
        connection_key,
        target_snapshot,
        canonical_status,
        canonical_reason,
        pg_catalog.md5('makeup-legacy:' || legacy_delivery.id::text),
        coalesce(nullif(pg_catalog.btrim(legacy_delivery.title), ''), '휴보강 알림'),
        coalesce(nullif(pg_catalog.btrim(legacy_delivery.body), ''), '휴보강 처리 이력'),
        '/admin/makeup-requests?requestId=' || legacy_delivery.request_id::text,
        legacy_delivery.created_at,
        case when legacy_delivery.status in ('sent', 'failed') then 1 else 0 end,
        1,
        null,
        case when legacy_delivery.status = 'failed' then 'legacy_delivery_failed' else null end,
        case when legacy_delivery.status = 'failed'
          then coalesce(nullif(legacy_delivery.error, ''), 'legacy delivery failed')
          else null end,
        case when legacy_delivery.status = 'sent' then legacy_delivery.created_at else null end,
        legacy_delivery.created_at,
        legacy_delivery.created_at,
        legacy_delivery.created_at
    ) on conflict (id) do nothing;

    claim_id := dashboard_private.notification_deterministic_uuid_v1(
        'notification-makeup-legacy-ownership-v1',
        legacy_delivery.id::text
      );
    insert into dashboard_private.notification_dispatch_ownership_claims(
        id,
        workflow_key,
        occurrence_key,
        rule_id,
        channel_key,
        target_key,
        target_generation,
        owner_kind,
        owner_generation,
        state,
        dispatch_started_at,
        dispatch_token,
        provider_reference,
        terminal_outcome,
        created_at,
        updated_at
      ) values (
        claim_id,
        'makeup_requests',
        source_event.id::text,
        rule_row.id,
        rule_row.channel_key,
        target_key,
        0,
        'legacy',
        0,
        'closed',
        case when legacy_delivery.status in ('sent', 'failed')
          then legacy_delivery.created_at else null end,
        case when legacy_delivery.status in ('sent', 'failed')
          then dashboard_private.notification_deterministic_uuid_v1(
            'notification-makeup-legacy-dispatch-token-v1',
            legacy_delivery.id::text
          ) else null end,
        legacy_delivery.id::text,
        case when legacy_delivery.status = 'sent' then 'sent'
          when legacy_delivery.status = 'failed' then 'failed'
          else null end,
        legacy_delivery.created_at,
        legacy_delivery.created_at
    ) on conflict (id) do nothing;

    select notification.id into notification_id
      from public.dashboard_notifications notification
      where legacy_delivery.dedupe_key is not null
        and notification.dedupe_key = legacy_delivery.dedupe_key
      order by notification.created_at, notification.id
      limit 1;
    if notification_id is not null then
      update public.dashboard_notifications notification
      set source_delivery_id = delivery_id
      where notification.id = notification_id
        and notification.source_delivery_id is null;
    end if;

    insert into dashboard_private.notification_makeup_legacy_imports(
      legacy_delivery_id,
      source_event_id,
      legacy_snapshot,
      source_checksum,
      event_id,
      canonical_delivery_id,
      ownership_claim_id,
      dashboard_notification_id
    ) values (
      legacy_delivery.id,
      source_event.id,
      legacy_snapshot,
      source_checksum,
      event_id,
      delivery_id,
      claim_id,
      notification_id
    ) on conflict (legacy_delivery_id) do nothing;
    if found then
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  validation := dashboard_private.notification_assert_makeup_retained_import_complete_v1();
  perform dashboard_private.notification_record_makeup_retention_observation_v1(
    'post_import'
  );

  if inserted_count > 0 then
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
      'makeup_notification_history',
      'legacy-retained-state-v1',
      'legacy_history_imported',
      null,
      'system',
      pg_catalog.jsonb_build_object('imported_count', '0'),
      pg_catalog.jsonb_build_object('imported_count', inserted_count::text),
      'retained_history_import'
    );
  end if;

  return validation || pg_catalog.jsonb_build_object(
    'imported_count', inserted_count::text,
    'total_count', (
      select pg_catalog.count(*)::text
      from dashboard_private.notification_makeup_legacy_imports
    )
  );
end;
$$;

create or replace function dashboard_private.notification_makeup_payload_v1(
  p_request_id uuid,
  p_source_event_id uuid,
  p_event_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'makeup_request_id', request.id,
    'process', case p_event_key
      when 'makeup.submitted' then '신청 제출'
      when 'makeup.refund_requested' then '환불 신청'
      when 'makeup.approved' then '결재 승인'
      when 'makeup.refund_completed' then '환불 완료'
      when 'makeup.approval_canceled' then '승인 취소'
      when 'makeup.revision_requested' then '보완 요청'
      when 'makeup.rejected' then '반려'
      when 'makeup.deleted' then '삭제'
      else p_event_key
    end,
    'status', case request.status
      when 'approval_pending' then '결재자 승인 대기'
      when 'revision_requested' then '보완 요청'
      when 'rejected' then '반려'
      when 'manager_pending' then '이전 관리팀 전달'
      when 'makeup_pending' then '보강대기'
      when 'refund_pending' then '환불대기'
      when 'completed' then '완료'
      when 'canceled' then '승인 취소'
      else request.status
    end,
    'workflow_status', request.status,
    'class_name', request.class_name,
    'subject', request.subject,
    'approval_group', request.approval_group,
    'subject_team_key', request.approval_group,
    'teacher_name', teacher.name,
    'reason', request.reason,
    'cancel_date', request.cancel_date,
    'makeup_at', coalesce(
      (
        select pg_catalog.string_agg(
          coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at', '')
            || case when coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at', '') = ''
              then '' else ' - ' || coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at') end,
          ', ' order by slot.ordinality
        )
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
            then request.makeup_slots else '[]'::jsonb end
        )
          with ordinality slot(value, ordinality)
      ),
      request.makeup_start_at::text
    ),
    'makeup_room_spaced', request.makeup_classroom,
    'makeup_room', request.makeup_classroom,
    'requester_name', requester.name,
    'requester_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.requester_id)
        then request.requester_id
      else null
    end,
    'approver_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.approver_profile_id)
        then request.approver_profile_id
      else null
    end,
    'management_profile_ids', (
      select coalesce(pg_catalog.jsonb_agg(profile.id order by profile.id), '[]'::jsonb)
      from public.profiles profile
      where profile.role in ('admin', 'staff')
        and dashboard_private.notification_profile_is_active_v1(profile.id)
    ),
    'submitted_at', coalesce(
      (
        select pg_catalog.max(history.created_at)
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type in ('submitted', 'resubmitted')
      ),
      request.created_at
    ),
    'revision_requested_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
    ),
    'revision_reason', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'approved_at', request.approved_at,
    'approval_note', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'approved'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.final_note
    ),
    'rejected_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'rejected'
    ),
    'rejected_reason', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'rejected'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.rejected_reason
    ),
    'canceled_at', request.canceled_at,
    'canceled_note', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type in ('approval_canceled', 'completed_canceled')
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'approver_name', approver.name,
    'fallback_title', '휴보강 알림',
    'fallback_body', request.class_name || ' · ' || request.status,
    'occurred_at', source_event.created_at
  ))
  from public.makeup_requests request
  join public.makeup_request_events source_event
    on source_event.id = p_source_event_id
   and source_event.request_id = request.id
  left join public.profiles requester on requester.id = request.requester_id
  left join public.teacher_catalogs teacher on teacher.id = request.teacher_catalog_id
  left join public.teacher_catalogs approver on approver.id = request.approver_teacher_catalog_id
  where request.id = p_request_id;
$$;

create or replace function dashboard_private.record_makeup_notification_source_v2(
  p_request_id uuid,
  p_event_type text,
  p_before_status text,
  p_after_status text,
  p_note text,
  p_mutation_request_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := coalesce(p_actor_id, (select auth.uid()));
  source_event_id uuid := gen_random_uuid();
  source_occurred_at timestamptz;
  event_key text;
  v_payload jsonb;
  canonical jsonb;
begin
  event_key := case p_event_type
    when 'submitted' then 'makeup.submitted'
    when 'resubmitted' then 'makeup.submitted'
    when 'approved' then 'makeup.approved'
    when 'revision_requested' then 'makeup.revision_requested'
    when 'rejected' then 'makeup.rejected'
    when 'refund_requested' then 'makeup.refund_requested'
    when 'refund_completed' then 'makeup.refund_completed'
    when 'approval_canceled' then 'makeup.approval_canceled'
    when 'completed_canceled' then 'makeup.approval_canceled'
    when 'deleted' then 'makeup.deleted'
    else null
  end;
  if event_key is null then
    raise exception 'makeup_notification_event_invalid' using errcode = '22023';
  end if;

  insert into public.makeup_request_events(
    id,
    request_id,
    actor_id,
    event_type,
    before_value,
    after_value,
    note,
    mutation_request_id
  ) values (
    source_event_id,
    p_request_id,
    actor_id,
    p_event_type,
    p_before_status,
    p_after_status,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    p_mutation_request_id
  ) returning created_at into source_occurred_at;

  v_payload := dashboard_private.notification_makeup_payload_v1(
    p_request_id,
    source_event_id,
    event_key
  );
  if v_payload is null then
    raise exception 'makeup_notification_source_unavailable' using errcode = 'P0002';
  end if;
  update public.makeup_request_events event_row
  set payload = v_payload
  where event_row.id = source_event_id;

  canonical := dashboard_private.record_notification_event_v1(
    'global',
    'makeup_requests',
    event_key,
    'makeup_request_event',
    source_event_id::text,
    null,
    source_event_id::text,
    actor_id,
    source_occurred_at,
    1,
    v_payload,
    null,
    null
  );
  return pg_catalog.jsonb_build_object(
    'source_event_id', source_event_id,
    'canonical_event_id', canonical ->> 'event_id',
    'event_key', event_key
  );
end;
$$;

create or replace function dashboard_private.cancel_makeup_unsent_deliveries_v1(
  p_makeup_request_id uuid,
  p_excluded_event_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  canceled_count bigint;
  requested_count bigint;
begin
  if p_makeup_request_id is null or p_excluded_event_id is null then
    raise exception 'makeup_notification_cancel_invalid' using errcode = '22023';
  end if;

  with canceled as (
    update dashboard_private.notification_deliveries delivery
    set status = 'canceled',
        status_reason = 'source_status_changed',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = 'makeup_requests'
      and event_row.id <> p_excluded_event_id
      and event_row.payload ->> 'makeup_request_id' = p_makeup_request_id::text
      and delivery.status in ('pending', 'retry_wait')
    returning delivery.id
  )
  select pg_catalog.count(*) into canceled_count from canceled;

  with requested as (
    update dashboard_private.notification_deliveries delivery
    set cancel_requested_at = coalesce(
          delivery.cancel_requested_at,
          pg_catalog.clock_timestamp()
        ),
        cancel_reason = 'source_status_changed',
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = 'makeup_requests'
      and event_row.id <> p_excluded_event_id
      and event_row.payload ->> 'makeup_request_id' = p_makeup_request_id::text
      and delivery.status = 'claimed'
    returning delivery.id
  )
  select pg_catalog.count(*) into requested_count from requested;

  return pg_catalog.jsonb_build_object(
    'canceled_count', canceled_count::text,
    'cancel_requested_count', requested_count::text
  );
end;
$$;

create or replace function dashboard_private.notification_makeup_input_valid_v1(
  p_input jsonb,
  p_effective_at timestamptz default pg_catalog.now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_input is not null
    and pg_catalog.jsonb_typeof(p_input) = 'object'
    and p_input ->> 'request_kind' in ('cancel_makeup', 'cancel_only', 'makeup_only')
    and p_input ->> 'approval_group' in ('math_middle', 'math_high', 'english', 'unknown')
    and nullif(pg_catalog.btrim(p_input ->> 'subject'), '') is not null
    and nullif(pg_catalog.btrim(p_input ->> 'class_name'), '') is not null
    and nullif(pg_catalog.btrim(p_input ->> 'reason'), '') is not null
    and nullif(p_input ->> 'requester_id', '') is not null
    and nullif(p_input ->> 'teacher_catalog_id', '') is not null
    and nullif(p_input ->> 'teacher_profile_id', '') is not null
    and nullif(p_input ->> 'class_id', '') is not null
    and nullif(p_input ->> 'approver_teacher_catalog_id', '') is not null
    and nullif(p_input ->> 'approver_profile_id', '') is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id::text = pg_catalog.lower(
        pg_catalog.btrim(p_input ->> 'requester_id')
      )
    )
    and exists (
      select 1
      from public.classes class_row
      join public.teacher_catalogs teacher
        on teacher.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'teacher_catalog_id')
        )
      join public.teacher_catalogs approver
        on approver.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'approver_teacher_catalog_id')
        )
      cross join lateral (
        select dashboard_private.resolve_registration_default_director(
          class_row.subject,
          class_row.grade,
          p_effective_at
        ) as resolution
      ) director
      where class_row.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'class_id')
        )
        and pg_catalog.btrim(class_row.name) = pg_catalog.btrim(
          p_input ->> 'class_name'
        )
        and pg_catalog.btrim(class_row.subject) = pg_catalog.btrim(
          p_input ->> 'subject'
        )
        and teacher.profile_id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'teacher_profile_id')
        )
        and pg_catalog.btrim(teacher.name) = pg_catalog.btrim(class_row.teacher)
        and approver.profile_id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'approver_profile_id')
        )
        and approver.is_visible
        and p_input ->> 'approval_group' = case
          when pg_catalog.btrim(class_row.subject) = '영어' then 'english'
          when pg_catalog.btrim(class_row.subject) = '수학'
            and coalesce(
              nullif(pg_catalog.btrim(class_row.grade), ''),
              nullif(pg_catalog.btrim(class_row.name), ''),
              ''
            ) ~* '(고|high)'
          then 'math_high'
          when pg_catalog.btrim(class_row.subject) = '수학'
            and coalesce(
              nullif(pg_catalog.btrim(class_row.grade), ''),
              nullif(pg_catalog.btrim(class_row.name), ''),
              ''
            ) ~* '(초|elementary|중|middle)'
          then 'math_middle'
          else 'unknown'
        end
        and (
          public.current_dashboard_role() in ('admin', 'staff')
          or (
            director.resolution ->> 'status' = 'resolved'
            and director.resolution ->> 'profileId' = approver.profile_id::text
          )
        )
    )
    and pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
    and case p_input ->> 'request_kind'
      when 'cancel_only' then
        nullif(p_input ->> 'cancel_date', '') is not null
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end = 0
        and nullif(p_input ->> 'makeup_start_at', '') is null
        and nullif(p_input ->> 'makeup_end_at', '') is null
        and nullif(p_input ->> 'makeup_classroom', '') is null
      when 'makeup_only' then
        nullif(p_input ->> 'cancel_date', '') is null
        and nullif(p_input ->> 'makeup_start_at', '') is not null
        and nullif(p_input ->> 'makeup_end_at', '') is not null
        and nullif(pg_catalog.btrim(p_input ->> 'makeup_classroom'), '') is not null
        and (p_input ->> 'makeup_end_at')::timestamptz
          > (p_input ->> 'makeup_start_at')::timestamptz
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end > 0
      else
        nullif(p_input ->> 'cancel_date', '') is not null
        and nullif(p_input ->> 'makeup_start_at', '') is not null
        and nullif(p_input ->> 'makeup_end_at', '') is not null
        and nullif(pg_catalog.btrim(p_input ->> 'makeup_classroom'), '') is not null
        and (p_input ->> 'makeup_end_at')::timestamptz
          > (p_input ->> 'makeup_start_at')::timestamptz
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end > 0
    end
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then coalesce(p_input -> 'makeup_slots', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) slot(value)
      where pg_catalog.jsonb_typeof(slot.value) <> 'object'
        or nullif(slot.value ->> 'startAt', '') is null
        or nullif(slot.value ->> 'endAt', '') is null
        or nullif(pg_catalog.btrim(slot.value ->> 'classroom'), '') is null
        or (slot.value ->> 'endAt')::timestamptz
          <= (slot.value ->> 'startAt')::timestamptz
    );
$$;

create or replace function public.create_makeup_request_v2(
  p_input jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := public.current_dashboard_role();
  request_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
begin
  if actor_id is null or p_request_id is null or p_input is null
    or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_input - array[
      'request_kind', 'subject', 'approval_group', 'requester_id',
      'teacher_catalog_id', 'teacher_profile_id', 'class_id', 'class_name',
      'reason', 'cancel_date', 'makeup_start_at', 'makeup_end_at',
      'makeup_classroom', 'makeup_slots', 'approver_teacher_catalog_id',
      'approver_profile_id'
    ]::text[] <> '{}'::jsonb
    or not coalesce(
      dashboard_private.notification_makeup_input_valid_v1(p_input),
      false
    )
  then
    raise exception 'makeup_request_input_invalid' using errcode = '22023';
  end if;
  if nullif(p_input ->> 'requester_id', '')::uuid is distinct from actor_id
    and coalesce(actor_role in ('admin', 'staff'), false) = false
  then
    raise exception 'makeup_request_create_forbidden' using errcode = '42501';
  end if;

  fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', actor_id,
    'input', p_input
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'create_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  insert into public.makeup_requests(
    status,
    request_kind,
    subject,
    approval_group,
    requester_id,
    teacher_catalog_id,
    teacher_profile_id,
    class_id,
    class_name,
    reason,
    cancel_date,
    makeup_start_at,
    makeup_end_at,
    makeup_classroom,
    makeup_slots,
    approver_teacher_catalog_id,
    approver_profile_id
  ) values (
    'approval_pending',
    p_input ->> 'request_kind',
    p_input ->> 'subject',
    p_input ->> 'approval_group',
    nullif(p_input ->> 'requester_id', '')::uuid,
    nullif(p_input ->> 'teacher_catalog_id', '')::uuid,
    nullif(p_input ->> 'teacher_profile_id', '')::uuid,
    nullif(p_input ->> 'class_id', '')::uuid,
    coalesce(p_input ->> 'class_name', ''),
    coalesce(p_input ->> 'reason', ''),
    nullif(p_input ->> 'cancel_date', '')::date,
    nullif(p_input ->> 'makeup_start_at', '')::timestamptz,
    nullif(p_input ->> 'makeup_end_at', '')::timestamptz,
    nullif(p_input ->> 'makeup_classroom', ''),
    coalesce(p_input -> 'makeup_slots', '[]'::jsonb),
    nullif(p_input ->> 'approver_teacher_catalog_id', '')::uuid,
    nullif(p_input ->> 'approver_profile_id', '')::uuid
  ) returning * into request_row;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    request_row.id,
    'submitted',
    null,
    request_row.status,
    null,
    p_request_id,
    actor_id
  );
  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(request_row),
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'create_makeup_request_v2', fingerprint, response);
  return response;
end;
$$;

create or replace function dashboard_private.notification_apply_makeup_calendar_effects_v1(
  p_request_id uuid,
  p_class_id uuid,
  p_schedule_plan_before jsonb,
  p_schedule_plan_after jsonb,
  p_cancel_academic_event_id uuid,
  p_makeup_academic_event_id uuid,
  p_makeup_academic_event_ids jsonb,
  p_calendar_events jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  calendar_event jsonb;
  allowed_event_ids uuid[];
begin
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
    or p_calendar_events is null
    or pg_catalog.jsonb_typeof(p_calendar_events) <> 'array'
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
    where item.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(distinct event_id), array[]::uuid[])
  into allowed_event_ids
  from (
    select p_cancel_academic_event_id as event_id
    union all
    select p_makeup_academic_event_id
    union all
    select item.value::uuid
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
  ) event_ids
  where event_id is not null;

  if pg_catalog.cardinality(allowed_event_ids) = 0
    or pg_catalog.jsonb_array_length(p_calendar_events)
      <> pg_catalog.cardinality(allowed_event_ids)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or item.value - array['id', 'title', 'date', 'type', 'grade', 'note']::text[]
          <> '{}'::jsonb
        or coalesce(item.value ->> 'id', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or nullif(pg_catalog.btrim(item.value ->> 'title'), '') is null
        or pg_catalog.length(item.value ->> 'title') > 200
        or coalesce(item.value ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(item.value ->> 'type', '') <> '팁스'
        or coalesce(item.value ->> 'grade', '') <> 'all'
        or nullif(pg_catalog.btrim(item.value ->> 'note'), '') is null
        or pg_catalog.length(item.value ->> 'note') > 4000
        or pg_catalog.strpos(item.value ->> 'note', '[[TIPS_MAKEUP]]') = 0
        or pg_catalog.strpos(item.value ->> 'note', p_request_id::text) = 0
    )
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    where not ((item.value ->> 'id')::uuid = any(allowed_event_ids))
  ) or (
    select pg_catalog.count(distinct (item.value ->> 'id')::uuid)
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
  ) <> pg_catalog.cardinality(allowed_event_ids)
  then
    raise exception 'makeup_calendar_effects_mismatch' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_after
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) = p_schedule_plan_before;
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = '40001';
  end if;

  for calendar_event in
    select item.value
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    order by item.value ->> 'id'
  loop
    insert into public.academic_events(id, title, date, type, grade, note)
    values (
      (calendar_event ->> 'id')::uuid,
      calendar_event ->> 'title',
      (calendar_event ->> 'date')::date,
      calendar_event ->> 'type',
      calendar_event ->> 'grade',
      calendar_event ->> 'note'
    )
    on conflict (id) do update
    set title = excluded.title,
        date = excluded.date,
        type = excluded.type,
        grade = excluded.grade,
        note = excluded.note
    where pg_catalog.strpos(
      coalesce(public.academic_events.note, ''), '[[TIPS_MAKEUP]]'
    ) > 0
      and pg_catalog.strpos(
        coalesce(public.academic_events.note, ''), p_request_id::text
      ) > 0;
    if not found then
      raise exception 'makeup_calendar_event_conflict' using errcode = '40001';
    end if;
  end loop;
end;
$$;

create or replace function dashboard_private.notification_revert_makeup_calendar_effects_v1(
  p_request_id uuid,
  p_class_id uuid,
  p_schedule_plan_before jsonb,
  p_schedule_plan_after jsonb,
  p_cancel_academic_event_id uuid,
  p_makeup_academic_event_id uuid,
  p_makeup_academic_event_ids jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
  then
    raise exception 'makeup_calendar_revert_invalid' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_before
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) in (
      p_schedule_plan_before,
      p_schedule_plan_after
    );
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = '40001';
  end if;

  delete from public.academic_events event_row
  where pg_catalog.strpos(coalesce(event_row.note, ''), '[[TIPS_MAKEUP]]') > 0
    and pg_catalog.strpos(coalesce(event_row.note, ''), p_request_id::text) > 0
    and (
      event_row.id = p_cancel_academic_event_id
      or event_row.id = p_makeup_academic_event_id
      or event_row.id::text in (
        select item.value
        from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
      )
    );
end;
$$;

create or replace function dashboard_private.notification_normalize_makeup_room_v1(
  p_room text
)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select
      pg_catalog.btrim(coalesce(p_room, '')) as original,
      pg_catalog.regexp_replace(
        pg_catalog.btrim(coalesce(p_room, '')),
        '[[:space:]]+',
        '',
        'g'
      ) as compact
  )
  select case normalized.compact
    when '본2' then '본관 2강'
    when '본2강' then '본관 2강'
    when '본3' then '본관 3강'
    when '본3강' then '본관 3강'
    when '본5' then '본관 5강'
    when '본5강' then '본관 5강'
    when '별3' then '별관 3강'
    when '별3강' then '별관 3강'
    when '별5' then '별관 5강'
    when '별5강' then '별관 5강'
    when '별7' then '별관 5강'
    when '별7강' then '별관 5강'
    else normalized.original
  end
  from normalized;
$$;

create or replace function dashboard_private.notification_makeup_room_slots_v1(
  p_request_id uuid
)
returns table(room_key text, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    dashboard_private.notification_normalize_makeup_room_v1(
      coalesce(slot.value ->> 'classroom', request_row.makeup_classroom)
    ) as room_key,
    coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at')::timestamptz as start_at,
    coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at')::timestamptz as end_at
  from public.makeup_requests request_row
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(coalesce(request_row.makeup_slots, '[]'::jsonb)) = 'array'
        and pg_catalog.jsonb_array_length(coalesce(request_row.makeup_slots, '[]'::jsonb)) > 0
      then request_row.makeup_slots
      when request_row.makeup_start_at is not null
        and request_row.makeup_end_at is not null
      then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'startAt', request_row.makeup_start_at,
        'endAt', request_row.makeup_end_at,
        'classroom', request_row.makeup_classroom
      ))
      else '[]'::jsonb
    end
  ) slot(value)
  where request_row.id = p_request_id
    and nullif(pg_catalog.btrim(coalesce(slot.value ->> 'classroom', request_row.makeup_classroom)), '') is not null
    and nullif(coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at'), '') is not null
    and nullif(coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at'), '') is not null
    and coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at')::timestamptz
      < coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at')::timestamptz;
$$;

create or replace function dashboard_private.notification_assert_makeup_room_available_v1(
  p_request_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room text;
begin
  if p_request_id is null or not exists (
    select 1 from public.makeup_requests request_row where request_row.id = p_request_id
  ) then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;

  -- 여러 슬롯의 잠금 순서를 고정해 교차 강의실 승인도 교착 없이 직렬화한다.
  for v_room in
    select distinct slot.room_key
    from dashboard_private.notification_makeup_room_slots_v1(p_request_id) slot
    order by slot.room_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('makeup-room:' || v_room, 0)
    );
  end loop;

  -- advisory lock 대기 뒤 최신 커밋 상태를 다시 읽는다. 먼저 완료된 승인만
  -- 점유로 간주하므로 동일 시각 동시 승인 두 건 중 하나만 성공한다.
  if exists (
    select 1
    from dashboard_private.notification_makeup_room_slots_v1(p_request_id) current_slot
    join public.makeup_requests other_request
      on other_request.id <> p_request_id
     and other_request.status in ('makeup_pending', 'completed')
    cross join lateral dashboard_private.notification_makeup_room_slots_v1(
      other_request.id
    ) occupied_slot
    where current_slot.room_key = occupied_slot.room_key
      and current_slot.start_at < occupied_slot.end_at
      and occupied_slot.start_at < current_slot.end_at
  ) then
    raise exception 'makeup_room_collision' using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.notification_normalize_makeup_room_v1(text)
  owner to postgres;
alter function dashboard_private.notification_makeup_room_slots_v1(uuid)
  owner to postgres;
alter function dashboard_private.notification_assert_makeup_room_available_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.notification_normalize_makeup_room_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_room_slots_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_assert_makeup_room_available_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.transition_makeup_request_v2(
  p_makeup_request_id uuid,
  p_command text,
  p_patch jsonb,
  p_expected_status text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role text;
  before_row public.makeup_requests%rowtype;
  after_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
  event_type text;
  note text := nullif(pg_catalog.btrim(coalesce(p_patch ->> 'note', '')), '');
  next_status text;
  latest_refund_at timestamptz;
  latest_submit_or_approve_at timestamptz;
begin
  if p_command = 'approve' then
    if (select auth.role()) is distinct from 'service_role' then
      raise exception 'makeup_approval_server_required' using errcode = '42501';
    end if;
    actor_id := nullif(p_patch ->> 'actor_profile_id', '')::uuid;
    select profile.role into actor_role
    from public.profiles profile
    where profile.id = actor_id;
  else
    actor_id := (select auth.uid());
    actor_role := public.current_dashboard_role();
  end if;
  if actor_id is null or p_makeup_request_id is null or p_request_id is null
    or p_command is null
    or p_expected_status is null or p_patch is null
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or p_command not in (
      'approve', 'revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'resubmit', 'approval_canceled'
    )
  then
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

    if (p_command = 'approve' and p_patch - array[
      'actor_profile_id', 'final_note', 'schedule_plan_before', 'schedule_plan_after',
      'cancel_academic_event_id', 'makeup_academic_event_id',
      'makeup_academic_event_ids', 'calendar_events'
    ]::text[] <> '{}'::jsonb)
    or (p_command in ('revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'approval_canceled')
      and p_patch - array['note']::text[] <> '{}'::jsonb)
    or (p_command = 'resubmit' and p_patch - array[
      'request_kind', 'subject', 'approval_group', 'teacher_catalog_id',
      'teacher_profile_id', 'class_id', 'class_name', 'reason', 'cancel_date',
      'makeup_start_at', 'makeup_end_at', 'makeup_classroom', 'makeup_slots',
      'approver_teacher_catalog_id', 'approver_profile_id'
    ]::text[] <> '{}'::jsonb)
  then
    raise exception 'makeup_request_transition_patch_invalid' using errcode = '22023';
  end if;

  fingerprint := pg_catalog.md5((case
    when p_command = 'approve' then pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'final_note', p_patch ->> 'final_note',
      'expected_status', p_expected_status
    )
    else pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'patch', p_patch,
      'expected_status', p_expected_status
    )
  end)::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'transition_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  select request.* into before_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if before_row.status <> p_expected_status then
    raise exception 'makeup_request_stale_status' using errcode = '40001';
  end if;

  if p_command = 'approve' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    select pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type = 'refund_requested'
    ), pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type in ('submitted', 'resubmitted', 'approved')
    ) into latest_refund_at, latest_submit_or_approve_at
    from public.makeup_request_events event_row
    where event_row.request_id = before_row.id;
    next_status := case
      when latest_refund_at is not null
        and latest_refund_at > coalesce(latest_submit_or_approve_at, '-infinity'::timestamptz)
        then 'refund_pending'
      when before_row.request_kind in ('cancel_makeup', 'makeup_only') then 'completed'
      else 'makeup_pending'
    end;
    if next_status = 'refund_pending' then
      if p_patch - array['actor_profile_id', 'final_note']::text[] <> '{}'::jsonb then
        raise exception 'makeup_refund_approval_patch_invalid' using errcode = '22023';
      end if;
    else
      if not (
        p_patch ? 'schedule_plan_before'
        and p_patch ? 'schedule_plan_after'
        and p_patch ? 'makeup_academic_event_ids'
        and p_patch ? 'calendar_events'
      ) then
        raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
      end if;
      perform 1
      from public.classes class_row
      where class_row.id = before_row.class_id
      for update of class_row;
      if not found then
        raise exception 'makeup_request_source_changed' using errcode = '40001';
      end if;
      if not exists (
        select 1
        from public.classes class_row
        join public.teacher_catalogs teacher
          on teacher.id = before_row.teacher_catalog_id
        join public.teacher_catalogs approver
          on approver.id = before_row.approver_teacher_catalog_id
        where class_row.id = before_row.class_id
          and pg_catalog.btrim(class_row.name) = pg_catalog.btrim(before_row.class_name)
          and pg_catalog.btrim(class_row.subject) = pg_catalog.btrim(before_row.subject)
          and pg_catalog.btrim(teacher.name) = pg_catalog.btrim(class_row.teacher)
          and teacher.profile_id is not distinct from before_row.teacher_profile_id
          and approver.profile_id is not distinct from before_row.approver_profile_id
      ) then
        raise exception 'makeup_request_source_changed' using errcode = '40001';
      end if;
      perform dashboard_private.notification_assert_makeup_room_available_v1(
        before_row.id
      );
      perform dashboard_private.notification_apply_makeup_calendar_effects_v1(
        before_row.id,
        before_row.class_id,
        p_patch -> 'schedule_plan_before',
        p_patch -> 'schedule_plan_after',
        nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid,
        nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid,
        p_patch -> 'makeup_academic_event_ids',
        p_patch -> 'calendar_events'
      );
    end if;
    update public.makeup_requests request
    set status = next_status,
        approved_by = actor_id,
        approved_at = pg_catalog.clock_timestamp(),
        completed_by = case when next_status = 'completed' then actor_id else null end,
        completed_at = case when next_status = 'completed'
          then pg_catalog.clock_timestamp() else null end,
        final_note = nullif(p_patch ->> 'final_note', ''),
        returned_reason = null,
        rejected_reason = null,
        schedule_plan_before = case when next_status = 'refund_pending'
          then request.schedule_plan_before else p_patch -> 'schedule_plan_before' end,
        schedule_plan_after = case when next_status = 'refund_pending'
          then request.schedule_plan_after else p_patch -> 'schedule_plan_after' end,
        cancel_academic_event_id = case when next_status = 'refund_pending'
          then request.cancel_academic_event_id
          else nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid end,
        makeup_academic_event_id = case when next_status = 'refund_pending'
          then request.makeup_academic_event_id
          else nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid end,
        makeup_academic_event_ids = case when next_status = 'refund_pending'
          then request.makeup_academic_event_ids
          else p_patch -> 'makeup_academic_event_ids' end
    where request.id = before_row.id
    returning * into after_row;
    event_type := 'approved';
    note := nullif(p_patch ->> 'final_note', '');
  elsif p_command = 'revision_requested' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'revision_requested', returned_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'revision_requested';
  elsif p_command = 'reject' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'rejected', rejected_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'rejected';
  elsif p_command = 'refund_requested' then
    if before_row.status <> 'makeup_pending'
      or not (
        coalesce(before_row.requester_id = actor_id, false)
        or coalesce(actor_role in ('admin', 'staff'), false)
      )
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null,
        final_note = null,
        returned_reason = null,
        rejected_reason = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_requested';
  elsif p_command = 'refund_completed' then
    if before_row.status <> 'refund_pending'
      or coalesce(actor_role in ('admin', 'staff'), false) = false
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'completed',
        completed_by = actor_id,
        completed_at = pg_catalog.clock_timestamp(),
        final_note = coalesce(note, request.final_note)
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_completed';
  elsif p_command = 'resubmit' then
    if before_row.status <> 'revision_requested'
      or before_row.requester_id is distinct from actor_id
      or not coalesce(
        dashboard_private.notification_makeup_input_valid_v1(
          p_patch || pg_catalog.jsonb_build_object('requester_id', before_row.requester_id),
          before_row.created_at
        ),
        false
      )
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        request_kind = p_patch ->> 'request_kind',
        subject = p_patch ->> 'subject',
        approval_group = p_patch ->> 'approval_group',
        teacher_catalog_id = nullif(p_patch ->> 'teacher_catalog_id', '')::uuid,
        teacher_profile_id = nullif(p_patch ->> 'teacher_profile_id', '')::uuid,
        class_id = nullif(p_patch ->> 'class_id', '')::uuid,
        class_name = coalesce(p_patch ->> 'class_name', ''),
        reason = coalesce(p_patch ->> 'reason', ''),
        cancel_date = nullif(p_patch ->> 'cancel_date', '')::date,
        makeup_start_at = nullif(p_patch ->> 'makeup_start_at', '')::timestamptz,
        makeup_end_at = nullif(p_patch ->> 'makeup_end_at', '')::timestamptz,
        makeup_classroom = nullif(p_patch ->> 'makeup_classroom', ''),
        makeup_slots = coalesce(p_patch -> 'makeup_slots', '[]'::jsonb),
        approver_teacher_catalog_id = nullif(
          p_patch ->> 'approver_teacher_catalog_id', ''
        )::uuid,
        approver_profile_id = nullif(p_patch ->> 'approver_profile_id', '')::uuid,
        returned_reason = null,
        rejected_reason = null,
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'resubmitted';
  elsif p_command = 'approval_canceled' then
    if (
      (before_row.status = 'completed'
        and coalesce(before_row.approver_profile_id = actor_id, false))
      or (before_row.status = 'makeup_pending'
        and (
          coalesce(before_row.approver_profile_id = actor_id, false)
          or coalesce(actor_role in ('admin', 'staff'), false)
        ))
    ) is not true then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    perform dashboard_private.notification_revert_makeup_calendar_effects_v1(
      before_row.id,
      before_row.class_id,
      before_row.schedule_plan_before,
      before_row.schedule_plan_after,
      before_row.cancel_academic_event_id,
      before_row.makeup_academic_event_id,
      before_row.makeup_academic_event_ids
    );
    update public.makeup_requests request
    set status = 'canceled',
        canceled_by = actor_id,
        canceled_at = pg_catalog.clock_timestamp()
    where request.id = before_row.id returning * into after_row;
    event_type := 'approval_canceled';
  else
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    after_row.id,
    event_type,
    before_row.status,
    after_row.status,
    note,
    p_request_id,
    actor_id
  );
  if event_type = 'approval_canceled' then
    perform dashboard_private.cancel_makeup_unsent_deliveries_v1(
      after_row.id,
      (source_result ->> 'canonical_event_id')::uuid
    );
  end if;
  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(after_row),
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'transition_makeup_request_v2', fingerprint, response);
  return response;
end;
$$;

create or replace function public.delete_makeup_request_v2(
  p_makeup_request_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := public.current_dashboard_role();
  request_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
begin
  if actor_id is null or p_makeup_request_id is null or p_request_id is null then
    raise exception 'makeup_request_delete_invalid' using errcode = '22023';
  end if;
  fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', actor_id,
    'makeup_request_id', p_makeup_request_id
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'delete_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  select request.* into request_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if actor_role <> 'admin'
    or request_row.status not in ('completed', 'rejected', 'canceled')
  then
    raise exception 'makeup_request_delete_forbidden' using errcode = '42501';
  end if;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    request_row.id,
    'deleted',
    request_row.status,
    'deleted',
    null,
    p_request_id,
    actor_id
  );
  perform dashboard_private.cancel_makeup_unsent_deliveries_v1(
    request_row.id,
    (source_result ->> 'canonical_event_id')::uuid
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind,
    entity_id,
    action,
    actor_profile_id,
    actor_kind,
    request_id,
    before_summary,
    after_summary,
    reason_code
  ) values (
    'makeup_request',
    request_row.id::text,
    'makeup_request_deleted',
    actor_id,
    'user',
    p_request_id,
    pg_catalog.jsonb_build_object('status', request_row.status),
    pg_catalog.jsonb_build_object('status', 'deleted'),
    'operator_hard_delete'
  );
  delete from public.makeup_requests request where request.id = request_row.id;

  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(request_row),
    'deleted', true,
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'delete_makeup_request_v2', fingerprint, response);
  return response;
end;
$$;

create or replace function dashboard_private.notification_makeup_render_template_v1(
  p_template text,
  p_payload jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  rendered text := p_template;
begin
  rendered := pg_catalog.replace(rendered, '{프로세스}', coalesce(p_payload ->> 'process', ''));
  rendered := pg_catalog.replace(rendered, '{상태}', coalesce(p_payload ->> 'status', ''));
  rendered := pg_catalog.replace(rendered, '{수업}', coalesce(p_payload ->> 'class_name', ''));
  rendered := pg_catalog.replace(rendered, '{과목}', coalesce(p_payload ->> 'subject', ''));
  rendered := pg_catalog.replace(rendered, '{선생님}', coalesce(p_payload ->> 'teacher_name', ''));
  rendered := pg_catalog.replace(rendered, '{사유}', coalesce(p_payload ->> 'reason', ''));
  rendered := pg_catalog.replace(rendered, '{휴강일}', coalesce(p_payload ->> 'cancel_date', ''));
  rendered := pg_catalog.replace(rendered, '{보강일시}', coalesce(p_payload ->> 'makeup_at', ''));
  rendered := pg_catalog.replace(rendered, '{보강 강의실}', coalesce(p_payload ->> 'makeup_room_spaced', ''));
  rendered := pg_catalog.replace(rendered, '{보강강의실}', coalesce(p_payload ->> 'makeup_room', ''));
  rendered := pg_catalog.replace(rendered, '{신청자}', coalesce(p_payload ->> 'requester_name', ''));
  rendered := pg_catalog.replace(rendered, '{상신일시}', coalesce(p_payload ->> 'submitted_at', ''));
  rendered := pg_catalog.replace(rendered, '{보완요청일시}', coalesce(p_payload ->> 'revision_requested_at', ''));
  rendered := pg_catalog.replace(rendered, '{보완 사유}', coalesce(p_payload ->> 'revision_reason', ''));
  rendered := pg_catalog.replace(rendered, '{승인일시}', coalesce(p_payload ->> 'approved_at', ''));
  rendered := pg_catalog.replace(rendered, '{승인 메모}', coalesce(p_payload ->> 'approval_note', ''));
  rendered := pg_catalog.replace(rendered, '{반려일시}', coalesce(p_payload ->> 'rejected_at', ''));
  rendered := pg_catalog.replace(rendered, '{반려 사유}', coalesce(p_payload ->> 'rejected_reason', ''));
  rendered := pg_catalog.replace(rendered, '{승인취소일시}', coalesce(p_payload ->> 'canceled_at', ''));
  rendered := pg_catalog.replace(rendered, '{승인취소 메모}', coalesce(p_payload ->> 'canceled_note', ''));
  rendered := pg_catalog.replace(rendered, '{결재자}', coalesce(p_payload ->> 'approver_name', ''));
  rendered := pg_catalog.replace(rendered, '{제목}', coalesce(p_payload ->> 'fallback_title', ''));
  rendered := pg_catalog.replace(rendered, '{본문}', coalesce(p_payload ->> 'fallback_body', ''));
  return rendered;
end;
$$;
create or replace function public.get_makeup_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_event public.makeup_request_events%rowtype;
  request_row public.makeup_requests%rowtype;
  actor_role text;
  canonical_event dashboard_private.notification_events%rowtype;
  items jsonb;
begin
  if p_source_event_id is null or p_actor_profile_id is null then
    raise exception 'makeup_legacy_dispatch_invalid' using errcode = '22023';
  end if;
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  select event_row.* into canonical_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'makeup_requests'
    and event_row.source_type = 'makeup_request_event'
    and event_row.source_id = p_source_event_id::text
    and event_row.occurrence_key = p_source_event_id::text;
  if not found then
    raise exception 'makeup_notification_canonical_event_not_found' using errcode = 'P0002';
  end if;
  select event_row.* into source_event
  from public.makeup_request_events event_row
  where event_row.id = p_source_event_id;
  if not found then
    if canonical_event.event_key <> 'makeup.deleted' then
      raise exception 'makeup_notification_source_not_found' using errcode = 'P0002';
    end if;
    if canonical_event.actor_profile_id is distinct from p_actor_profile_id
      and coalesce(actor_role in ('admin', 'staff'), false) = false
    then
      raise exception 'makeup_legacy_dispatch_forbidden' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object(
      'sourceEventId', p_source_event_id,
      'makeupRequestId', canonical_event.payload ->> 'makeup_request_id',
      'items', '[]'::jsonb
    );
  end if;
  select request.* into request_row
  from public.makeup_requests request
  where request.id = source_event.request_id;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if (
    coalesce(source_event.actor_id = p_actor_profile_id, false)
    or coalesce(request_row.requester_id = p_actor_profile_id, false)
    or coalesce(request_row.approver_profile_id = p_actor_profile_id, false)
    or coalesce(actor_role in ('admin', 'staff'), false)
  ) is not true then
    raise exception 'makeup_legacy_dispatch_forbidden' using errcode = '42501';
  end if;
  with enabled_rules as (
    select
      (snapshot.item ->> 'rule_id')::uuid as id,
      (snapshot.item ->> 'rule_revision')::bigint as revision,
      (snapshot.item ->> 'template_id')::uuid as active_template_id,
      snapshot.item ->> 'channel_key' as channel_key,
      snapshot.item ->> 'audience_key' as audience_key,
      template.checksum as template_checksum,
      template.title_template,
      template.body_template
    from pg_catalog.jsonb_array_elements(canonical_event.rule_snapshot) snapshot(item)
    join dashboard_private.notification_templates template
      on template.id = (snapshot.item ->> 'template_id')::uuid
     and template.rule_id = (snapshot.item ->> 'rule_id')::uuid
    where (snapshot.item ->> 'enabled')::boolean
  ), resolved_targets as (
    select
      rule.*,
      'profile'::text as target_kind,
      'profile:' || target.profile_id::text as target_key,
      target.profile_id as target_profile_id,
      null::text as connection_key,
      pg_catalog.jsonb_build_object('profile_id', target.profile_id) as target_snapshot
    from enabled_rules rule
    cross join lateral (
      select nullif(
        canonical_event.payload ->> 'requester_profile_id', ''
      )::uuid as profile_id
      where rule.channel_key = 'in_app'
        and rule.audience_key = 'requester_profile'
      union all
      select nullif(
        canonical_event.payload ->> 'approver_profile_id', ''
      )::uuid
      where rule.channel_key = 'in_app'
        and rule.audience_key = 'approver_profile'
      union all
      select member.profile_id::uuid
      from pg_catalog.jsonb_array_elements_text(
        case
          when pg_catalog.jsonb_typeof(
            canonical_event.payload -> 'management_profile_ids'
          ) = 'array'
          then canonical_event.payload -> 'management_profile_ids'
          else '[]'::jsonb
        end
      ) member(profile_id)
      where rule.channel_key = 'in_app'
        and rule.audience_key = 'management_team'
    ) target
    where target.profile_id is not null
      and dashboard_private.notification_profile_is_active_v1(target.profile_id)

    union all

    select
      rule.*,
      'connection'::text,
      'connection:' || connection.connection_key,
      null::uuid,
      connection.connection_key,
      pg_catalog.jsonb_build_object('connection_key', connection.connection_key)
    from enabled_rules rule
    cross join lateral (
      select case rule.audience_key
        when 'management_team' then 'google_chat.management'
        when 'executive_team' then 'google_chat.executive'
        when 'subject_team' then case canonical_event.payload ->> 'approval_group'
          when 'math_middle' then 'google_chat.math'
          when 'math_high' then 'google_chat.math'
          when 'english' then 'google_chat.english'
          else null
        end
        else null
      end as connection_key
    ) connection
    where rule.channel_key = 'google_chat'
      and connection.connection_key is not null
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', canonical_event.id,
    'eventKey', canonical_event.event_key,
    'occurrenceKey', canonical_event.occurrence_key,
    'ruleId', target.id,
    'ruleRevision', target.revision::text,
    'templateId', target.active_template_id,
    'templateChecksum', target.template_checksum,
    'channelKey', target.channel_key,
    'audienceKey', target.audience_key,
    'targetGeneration', '0',
    'targetKind', target.target_kind,
    'targetKey', target.target_key,
    'targetProfileId', target.target_profile_id,
    'connectionKey', target.connection_key,
    'targetSnapshot', target.target_snapshot,
    'renderedTitle', dashboard_private.notification_makeup_render_template_v1(
      target.title_template, canonical_event.payload
    ),
    'renderedBody', dashboard_private.notification_makeup_render_template_v1(
      target.body_template, canonical_event.payload
    ),
    'href', '/admin/makeup-requests?requestId=' || request_row.id::text,
    'scheduledFor', canonical_event.occurred_at
  ) order by target.id, target.target_key), '[]'::jsonb)
  into items
  from resolved_targets target;

  return pg_catalog.jsonb_build_object(
    'sourceEventId', p_source_event_id,
    'makeupRequestId', request_row.id,
    'items', items
  );
end;
$$;

create or replace function public.materialize_makeup_legacy_in_app_v1(
  p_source_event_id uuid,
  p_rule_id uuid,
  p_profile_id uuid,
  p_target_generation bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  plan jsonb;
  item jsonb;
  delivery_id uuid;
  target_set_hash text;
  ownership jsonb;
  projection jsonb;
  projection_committed boolean := false;
begin
  if p_source_event_id is null or p_rule_id is null or p_profile_id is null
    or p_target_generation <> 0 or p_request_id is null
  then
    raise exception 'makeup_legacy_projection_invalid' using errcode = '22023';
  end if;
  plan := public.get_makeup_legacy_dispatch_plan_v1(
    p_source_event_id,
    p_profile_id
  );
  select value into item
  from pg_catalog.jsonb_array_elements(plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'targetProfileId' = p_profile_id::text
    and value ->> 'channelKey' = 'in_app'
  limit 1;
  if item is null then
    raise exception 'makeup_legacy_projection_forbidden' using errcode = '42501';
  end if;

  target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', item -> 'targetKind',
      'target_key', item -> 'targetKey',
      'target_profile_id', item -> 'targetProfileId',
      'connection_key', item -> 'connectionKey',
      'target_snapshot', item -> 'targetSnapshot'
    ))
  );
  delivery_id := dashboard_private.materialize_notification_delivery_v1(
    (item ->> 'eventId')::uuid,
    (item ->> 'ruleId')::uuid,
    (item ->> 'ruleRevision')::bigint,
    (item ->> 'templateId')::uuid,
    p_target_generation,
    target_set_hash,
    item ->> 'targetKind',
    item ->> 'targetKey',
    (item ->> 'targetProfileId')::uuid,
    null,
    item -> 'targetSnapshot',
    item ->> 'renderedTitle',
    item ->> 'renderedBody',
    item ->> 'href',
    (item ->> 'scheduledFor')::timestamptz,
    null
  );
  ownership := public.begin_legacy_notification_dispatch_v1(
    'makeup_requests',
    item ->> 'occurrenceKey',
    (item ->> 'ruleId')::uuid,
    item ->> 'channelKey',
    item ->> 'targetKey',
    p_target_generation,
    'makeup_legacy_bridge_v1',
    0,
    p_request_id
  );
  if (ownership ->> 'acquired')::boolean then
    projection := public.commit_legacy_notification_in_app_projection_v1(
      delivery_id,
      (ownership ->> 'claim_id')::uuid,
      (ownership ->> 'owner_generation')::bigint,
      (ownership ->> 'dispatch_token')::uuid
    );
    projection_committed := projection ->> 'status' = 'sent';
  else
    projection_committed := coalesce(ownership ->> 'status', '') = 'sent';
  end if;
  return pg_catalog.jsonb_build_object(
    'deliveryId', delivery_id,
    'occurrenceKey', item ->> 'occurrenceKey',
    'ruleId', item ->> 'ruleId',
    'channelKey', item ->> 'channelKey',
    'targetKey', item ->> 'targetKey',
    'targetGeneration', p_target_generation::text,
    'requestId', p_request_id,
    'acquired', (ownership ->> 'acquired')::boolean,
    'projectionCommitted', projection_committed,
    'claimId', ownership ->> 'claim_id',
    'ownerGeneration', ownership ->> 'owner_generation',
    'dispatchToken', ownership ->> 'dispatch_token'
  );
end;
$$;

create or replace function public.materialize_makeup_legacy_google_chat_v1(
  p_source_event_id uuid,
  p_rule_id uuid,
  p_connection_key text,
  p_target_generation bigint,
  p_actor_profile_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  plan jsonb;
  item jsonb;
  delivery_id uuid;
  target_set_hash text;
  ownership jsonb;
  claim_row dashboard_private.notification_dispatch_ownership_claims%rowtype;
  replay_outcome text;
  recovered_unknown boolean := false;
begin
  if p_source_event_id is null or p_rule_id is null
    or nullif(pg_catalog.btrim(p_connection_key), '') is null
    or p_target_generation <> 0 or p_actor_profile_id is null or p_request_id is null
  then
    raise exception 'makeup_legacy_google_chat_projection_invalid' using errcode = '22023';
  end if;
  plan := public.get_makeup_legacy_dispatch_plan_v1(
    p_source_event_id,
    p_actor_profile_id
  );
  select value into item
  from pg_catalog.jsonb_array_elements(plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'connectionKey' = p_connection_key
    and value ->> 'channelKey' = 'google_chat'
  limit 1;
  if item is null then
    raise exception 'makeup_legacy_google_chat_projection_forbidden'
      using errcode = '42501';
  end if;

  target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', item -> 'targetKind',
      'target_key', item -> 'targetKey',
      'target_profile_id', item -> 'targetProfileId',
      'connection_key', item -> 'connectionKey',
      'target_snapshot', item -> 'targetSnapshot'
    ))
  );
  delivery_id := dashboard_private.materialize_notification_delivery_v1(
    (item ->> 'eventId')::uuid,
    (item ->> 'ruleId')::uuid,
    (item ->> 'ruleRevision')::bigint,
    (item ->> 'templateId')::uuid,
    p_target_generation,
    target_set_hash,
    item ->> 'targetKind',
    item ->> 'targetKey',
    null,
    item ->> 'connectionKey',
    item -> 'targetSnapshot',
    item ->> 'renderedTitle',
    item ->> 'renderedBody',
    item ->> 'href',
    (item ->> 'scheduledFor')::timestamptz,
    null
  );
  ownership := public.begin_legacy_notification_dispatch_v1(
    'makeup_requests',
    item ->> 'occurrenceKey',
    (item ->> 'ruleId')::uuid,
    item ->> 'channelKey',
    item ->> 'targetKey',
    p_target_generation,
    'makeup_legacy_google_chat_v1',
    0,
    p_request_id
  );
  if not (ownership ->> 'acquired')::boolean then
    select claim.* into claim_row
    from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.id = (ownership ->> 'claim_id')::uuid
    for update of claim;
    if found
      and claim_row.owner_kind = 'legacy'
      and claim_row.state = 'dispatch_started'
      and claim_row.dispatch_token is not null
    then
      replay_outcome := 'delivery_unknown';
      recovered_unknown := true;
    elsif found and claim_row.state = 'closed' then
      replay_outcome := claim_row.terminal_outcome;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'deliveryId', delivery_id,
    'occurrenceKey', item ->> 'occurrenceKey',
    'ruleId', item ->> 'ruleId',
    'channelKey', item ->> 'channelKey',
    'targetKey', item ->> 'targetKey',
    'targetGeneration', p_target_generation::text,
    'requestId', p_request_id,
    'acquired', (ownership ->> 'acquired')::boolean,
    'claimId', ownership ->> 'claim_id',
    'ownerGeneration', coalesce(
      ownership ->> 'owner_generation',
      claim_row.owner_generation::text
    ),
    'dispatchToken', coalesce(
      ownership ->> 'dispatch_token',
      claim_row.dispatch_token::text
    ),
    'replayOutcome', replay_outcome,
    'recoveredUnknown', recovered_unknown
  );
end;
$$;

create or replace function public.finalize_makeup_legacy_google_chat_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  delivery_row dashboard_private.notification_deliveries%rowtype;
  event_row dashboard_private.notification_events%rowtype;
  claim_row dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  if p_delivery_id is null or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'makeup_legacy_google_chat_finalize_invalid' using errcode = '22023';
  end if;
  select delivery.* into delivery_row
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found or delivery_row.channel_key <> 'google_chat' then
    raise exception 'makeup_legacy_google_chat_delivery_invalid' using errcode = '22023';
  end if;
  select source_event.* into strict event_row
  from dashboard_private.notification_events source_event
  where source_event.id = delivery_row.event_id;
  select ownership.* into claim_row
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or claim_row.workflow_key <> event_row.workflow_key
    or claim_row.occurrence_key <> event_row.occurrence_key
    or claim_row.rule_id <> delivery_row.rule_id
    or claim_row.channel_key <> delivery_row.channel_key
    or claim_row.target_key <> delivery_row.target_key
    or claim_row.target_generation <> delivery_row.target_generation
    or claim_row.owner_kind <> 'legacy'
    or claim_row.owner_generation <> p_owner_generation
    or claim_row.dispatch_token <> p_dispatch_token
  then
    raise exception 'makeup_legacy_google_chat_ownership_mismatch' using errcode = '40001';
  end if;

  perform public.finalize_legacy_notification_dispatch_v1(
    p_claim_id,
    p_owner_generation,
    p_dispatch_token,
    p_outcome,
    p_provider_reference
  );
  return pg_catalog.jsonb_build_object(
    'deliveryId', delivery_row.id,
    'claimId', claim_row.id,
    'status', p_outcome,
    'canonicalDeliveryStatus', delivery_row.status,
    'canonicalDeliveryReason', delivery_row.status_reason
  );
end;
$$;

create or replace function public.prepare_makeup_legacy_web_push_v1(
  p_parent_delivery_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  parent_delivery dashboard_private.notification_deliveries%rowtype;
  event_row dashboard_private.notification_events%rowtype;
  subscription_row public.dashboard_push_subscriptions%rowtype;
  child_delivery dashboard_private.notification_deliveries%rowtype;
  child_template dashboard_private.notification_templates%rowtype;
  child_id uuid;
  begin_request_id uuid;
  ownership jsonb;
  claim_row dashboard_private.notification_dispatch_ownership_claims%rowtype;
  replay_outcome text;
  recovered_unknown boolean;
  items jsonb := '[]'::jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_parent_delivery_id is null
    or p_request_id is null
  then
    raise exception 'makeup_legacy_web_push_prepare_invalid' using errcode = '42501';
  end if;

  select delivery.* into parent_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_parent_delivery_id
  for update of delivery;
  if not found
    or parent_delivery.channel_key <> 'in_app'
    or parent_delivery.target_profile_id is null
    or parent_delivery.status <> 'skipped'
    or parent_delivery.status_reason not in ('shadow_mode', 'legacy_skipped')
  then
    raise exception 'makeup_legacy_web_push_parent_invalid' using errcode = '22023';
  end if;
  select event.* into strict event_row
  from dashboard_private.notification_events event
  where event.id = parent_delivery.event_id;
  if event_row.workflow_key <> 'makeup_requests' then
    raise exception 'makeup_legacy_web_push_parent_invalid' using errcode = '22023';
  end if;
  select claim.* into claim_row
  from dashboard_private.notification_dispatch_ownership_claims claim
  where claim.workflow_key = event_row.workflow_key
    and claim.occurrence_key = event_row.occurrence_key
    and claim.rule_id = parent_delivery.rule_id
    and claim.channel_key = parent_delivery.channel_key
    and claim.target_key = parent_delivery.target_key
    and claim.target_generation = parent_delivery.target_generation
  for share of claim;
  if not found
    or claim_row.owner_kind <> 'legacy'
    or claim_row.state <> 'closed'
    or claim_row.terminal_outcome <> 'sent'
  then
    raise exception 'makeup_legacy_web_push_parent_receipt_missing'
      using errcode = '55000';
  end if;

  for subscription_row in
    select subscription.*
    from public.dashboard_push_subscriptions subscription
    where subscription.profile_id = parent_delivery.target_profile_id
    order by subscription.id
    for share of subscription
  loop
    child_id := dashboard_private.notification_deterministic_uuid_v1(
      'makeup-legacy-web-push-delivery-v1',
      parent_delivery.id::text || ':' || subscription_row.id::text
    );
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
      target_generation, target_set_hash, target_kind, target_key, target_profile_id,
      connection_key, target_snapshot, parent_delivery_id, status, status_reason,
      dedupe_key, rendered_title, rendered_body, href, scheduled_for,
      max_attempts, next_attempt_at
    ) values (
      child_id,
      parent_delivery.event_id,
      parent_delivery.rule_id,
      parent_delivery.rule_revision,
      parent_delivery.template_id,
      'web_push',
      parent_delivery.audience_key,
      parent_delivery.target_generation,
      parent_delivery.target_set_hash || ':push',
      'push_subscription',
      'push_subscription:' || subscription_row.id::text,
      parent_delivery.target_profile_id,
      null,
      pg_catalog.jsonb_build_object(
        'subscription_id', subscription_row.id,
        'endpoint', subscription_row.endpoint,
        'p256dh', subscription_row.p256dh,
        'auth', subscription_row.auth,
        'active', true
      ),
      parent_delivery.id,
      'skipped',
      parent_delivery.status_reason,
      pg_catalog.md5(parent_delivery.dedupe_key || ':push:' || subscription_row.id::text),
      parent_delivery.rendered_title,
      parent_delivery.rendered_body,
      parent_delivery.href,
      event_row.occurred_at,
      1,
      null
    ) on conflict (dedupe_key) do nothing;

    select delivery.* into strict child_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.dedupe_key = pg_catalog.md5(
      parent_delivery.dedupe_key || ':push:' || subscription_row.id::text
    );
    select template.* into strict child_template
    from dashboard_private.notification_templates template
    where template.id = child_delivery.template_id
      and template.rule_id = child_delivery.rule_id;
    begin_request_id := dashboard_private.notification_deterministic_uuid_v1(
      'makeup-legacy-web-push-begin-v1',
      p_request_id::text || ':' || child_delivery.id::text
    );
    ownership := public.begin_legacy_notification_dispatch_v1(
      'makeup_requests',
      event_row.occurrence_key,
      child_delivery.rule_id,
      'web_push',
      child_delivery.target_key,
      child_delivery.target_generation,
      'makeup_legacy_web_push_v1',
      0,
      begin_request_id
    );
    claim_row := null;
    replay_outcome := null;
    recovered_unknown := false;
    if not (ownership ->> 'acquired')::boolean then
      select claim.* into claim_row
      from dashboard_private.notification_dispatch_ownership_claims claim
      where claim.id = (ownership ->> 'claim_id')::uuid
      for update of claim;
      if found
        and claim_row.owner_kind = 'legacy'
        and claim_row.state = 'dispatch_started'
        and claim_row.dispatch_token is not null
      then
        replay_outcome := 'delivery_unknown';
        recovered_unknown := true;
      elsif found and claim_row.state = 'closed' then
        replay_outcome := claim_row.terminal_outcome;
      end if;
    end if;
    items := items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'deliveryId', child_delivery.id,
      'acquired', (ownership ->> 'acquired')::boolean,
      'claimId', ownership ->> 'claim_id',
      'ownerGeneration', coalesce(
        ownership ->> 'owner_generation',
        claim_row.owner_generation::text
      ),
      'dispatchToken', coalesce(
        ownership ->> 'dispatch_token',
        claim_row.dispatch_token::text
      ),
      'templateChecksum', child_template.checksum,
      'replayOutcome', replay_outcome,
      'recoveredUnknown', recovered_unknown,
      'subscription', pg_catalog.jsonb_build_object(
        'endpoint', subscription_row.endpoint,
        'keys', pg_catalog.jsonb_build_object(
          'p256dh', subscription_row.p256dh,
          'auth', subscription_row.auth
        )
      ),
      'renderedTitle', child_delivery.rendered_title,
      'renderedBody', child_delivery.rendered_body,
      'href', child_delivery.href
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'parentDeliveryId', parent_delivery.id,
    'requestId', p_request_id,
    'items', items
  );
end;
$$;

create or replace function public.finalize_makeup_legacy_web_push_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  delivery_row dashboard_private.notification_deliveries%rowtype;
  event_row dashboard_private.notification_events%rowtype;
  claim_row dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  if (select auth.role()) <> 'service_role'
    or p_delivery_id is null or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'makeup_legacy_web_push_finalize_invalid' using errcode = '42501';
  end if;
  select delivery.* into delivery_row
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or delivery_row.channel_key <> 'web_push'
    or delivery_row.parent_delivery_id is null
  then
    raise exception 'makeup_legacy_web_push_delivery_invalid' using errcode = '22023';
  end if;
  select event.* into strict event_row
  from dashboard_private.notification_events event
  where event.id = delivery_row.event_id;
  select ownership.* into claim_row
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or claim_row.workflow_key <> 'makeup_requests'
    or claim_row.occurrence_key <> event_row.occurrence_key
    or claim_row.rule_id <> delivery_row.rule_id
    or claim_row.channel_key <> 'web_push'
    or claim_row.target_key <> delivery_row.target_key
    or claim_row.target_generation <> delivery_row.target_generation
    or claim_row.owner_kind <> 'legacy'
    or claim_row.owner_generation <> p_owner_generation
    or claim_row.dispatch_token <> p_dispatch_token
  then
    raise exception 'makeup_legacy_web_push_ownership_mismatch' using errcode = '40001';
  end if;

  perform public.finalize_legacy_notification_dispatch_v1(
    p_claim_id,
    p_owner_generation,
    p_dispatch_token,
    p_outcome,
    p_provider_reference
  );
  return pg_catalog.jsonb_build_object(
    'deliveryId', delivery_row.id,
    'claimId', claim_row.id,
    'status', p_outcome,
    'canonicalDeliveryStatus', delivery_row.status,
    'canonicalDeliveryReason', delivery_row.status_reason
  );
end;
$$;

insert into dashboard_private.notification_makeup_reconcile_audits(
  audit_key,
  rule_id,
  source_changed,
  before_revision,
  before_enabled,
  before_template_id,
  before_template_checksum,
  before_updated_by,
  before_updated_actor_kind
)
select
  'task17-install-v1',
  rule_row.id,
  exists (
    select 1
    from dashboard_private.notification_settings_import_metadata metadata
    join public.makeup_notification_settings legacy_setting
      on metadata.source_key = 'makeup_notification_settings:'
        || legacy_setting.trigger_kind || ':' || legacy_setting.channel
    where metadata.source_table = 'public.makeup_notification_settings'
      and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(rule_row.id)
      and metadata.source_checksum is distinct from
        dashboard_private.notification_makeup_setting_checksum_v1(
          legacy_setting.trigger_kind,
          legacy_setting.channel,
          legacy_setting.enabled,
          legacy_setting.title_template,
          legacy_setting.body_template
        )
  ),
  rule_row.revision,
  rule_row.enabled,
  rule_row.active_template_id,
  template_row.checksum,
  rule_row.updated_by,
  rule_row.updated_actor_kind
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_templates template_row
  on template_row.id = rule_row.active_template_id
where rule_row.workflow_key = 'makeup_requests'
on conflict (audit_key, rule_id) do nothing;

select dashboard_private.notification_reconcile_makeup_settings_v1();

update dashboard_private.notification_makeup_reconcile_audits audit
set after_revision = rule_row.revision,
    after_enabled = rule_row.enabled,
    after_template_id = rule_row.active_template_id,
    after_template_checksum = template_row.checksum,
    after_updated_by = rule_row.updated_by,
    after_updated_actor_kind = rule_row.updated_actor_kind,
    observed_at = pg_catalog.clock_timestamp()
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_templates template_row
  on template_row.id = rule_row.active_template_id
where audit.audit_key = 'task17-install-v1'
  and audit.rule_id = rule_row.id
  and audit.after_revision is null;

select dashboard_private.notification_import_makeup_retained_state_v1();

revoke all on function dashboard_private.notification_makeup_setting_checksum_v1(
  text, text, boolean, text, text
) from public, anon, authenticated;
revoke all on function dashboard_private.notification_refresh_makeup_retention_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.prune_makeup_notification_deliveries()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_reconcile_makeup_settings_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_makeup_notification_settings_after_write_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_event_key_v1(text)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_import_makeup_retained_state_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_payload_v1(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function dashboard_private.record_makeup_notification_source_v2(
  uuid, text, text, text, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.cancel_makeup_unsent_deliveries_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_input_valid_v1(
  jsonb, timestamptz
)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_apply_makeup_calendar_effects_v1(
  uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_revert_makeup_calendar_effects_v1(
  uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_render_template_v1(text, jsonb)
  from public, anon, authenticated;

revoke all on function public.create_makeup_request_v2(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) from public, anon, authenticated;
revoke all on function public.delete_makeup_request_v2(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_makeup_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.materialize_makeup_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.materialize_makeup_legacy_google_chat_v1(
  uuid, uuid, text, bigint, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_makeup_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.prepare_makeup_legacy_web_push_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_makeup_legacy_web_push_v1(
  uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.create_makeup_request_v2(jsonb, uuid)
  to authenticated;
grant execute on function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) to authenticated, service_role;
grant execute on function public.delete_makeup_request_v2(uuid, uuid)
  to authenticated;
grant execute on function public.get_makeup_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;
grant execute on function public.materialize_makeup_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid
) to service_role;
grant execute on function public.materialize_makeup_legacy_google_chat_v1(
  uuid, uuid, text, bigint, uuid, uuid
) to service_role;
grant execute on function public.finalize_makeup_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) to service_role;
grant execute on function public.prepare_makeup_legacy_web_push_v1(uuid, uuid)
  to service_role;
grant execute on function public.finalize_makeup_legacy_web_push_v1(
  uuid, uuid, bigint, uuid, text, text
) to service_role;

alter function dashboard_private.notification_makeup_setting_checksum_v1(
  text, text, boolean, text, text
) owner to postgres;
alter function dashboard_private.notification_refresh_makeup_retention_snapshot_v1()
  owner to postgres;
alter function dashboard_private.notification_reconcile_makeup_settings_v1()
  owner to postgres;
alter function public.reconcile_makeup_notification_settings_after_write_v1()
  owner to postgres;
alter function public.prune_makeup_notification_deliveries() owner to postgres;
alter function dashboard_private.notification_makeup_event_key_v1(text)
  owner to postgres;
alter function dashboard_private.notification_import_makeup_retained_state_v1()
  owner to postgres;
alter function dashboard_private.notification_makeup_payload_v1(uuid, uuid, text)
  owner to postgres;
alter function dashboard_private.record_makeup_notification_source_v2(
  uuid, text, text, text, text, uuid, uuid
) owner to postgres;
alter function dashboard_private.cancel_makeup_unsent_deliveries_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.notification_makeup_input_valid_v1(jsonb, timestamptz)
  owner to postgres;
alter function dashboard_private.notification_apply_makeup_calendar_effects_v1(
  uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb, jsonb
) owner to postgres;
alter function dashboard_private.notification_revert_makeup_calendar_effects_v1(
  uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb
) owner to postgres;
alter function public.create_makeup_request_v2(jsonb, uuid) owner to postgres;
alter function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) owner to postgres;
alter function public.delete_makeup_request_v2(uuid, uuid) owner to postgres;
alter function dashboard_private.notification_makeup_render_template_v1(text, jsonb)
  owner to postgres;
alter function public.get_makeup_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function public.materialize_makeup_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid
) owner to postgres;
alter function public.materialize_makeup_legacy_google_chat_v1(
  uuid, uuid, text, bigint, uuid, uuid
) owner to postgres;
alter function public.finalize_makeup_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function public.prepare_makeup_legacy_web_push_v1(uuid, uuid)
  owner to postgres;
alter function public.finalize_makeup_legacy_web_push_v1(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;

commit;
