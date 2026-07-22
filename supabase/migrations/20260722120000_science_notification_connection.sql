begin;

set local lock_timeout = '5s';

-- This forward-only package may add a disconnected slot only while every
-- notification runtime flag remains off. Row locks keep that assertion true
-- until the transaction commits.
do $$
begin
  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  order by flag_row.flag_key
  for share of flag_row;

  if exists (
    select 1
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.enabled is true
  ) then
    raise exception 'science_notification_provider_zero_required'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.google_chat_webhook_settings
  drop constraint if exists google_chat_webhook_settings_channel_check;

alter table public.google_chat_webhook_settings
  add constraint google_chat_webhook_settings_channel_check
  check (channel in ('executive', 'admin', 'math', 'english', 'science'));

insert into public.google_chat_webhook_settings(
  channel,
  webhook_url,
  webhook_url_ciphertext,
  webhook_url_mask,
  connection_state,
  revision,
  updated_by,
  last_verified_at,
  last_error_code
) values (
  'science',
  '',
  null,
  null,
  'disconnected',
  1,
  null,
  null,
  null
)
on conflict (channel) do nothing;

create or replace function dashboard_private.notification_google_chat_audience_ready_v1(
  p_audience_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channels text[];
  v_channel text;
  v_row public.google_chat_webhook_settings%rowtype;
  v_expected_mask text;
begin
  v_channels := case p_audience_key
    when 'management_team' then array['admin']::text[]
    when 'executive_team' then array['executive']::text[]
    when 'subject_team' then array['english', 'math', 'science']::text[]
    else null
  end;
  if v_channels is null then
    return false;
  end if;

  foreach v_channel in array v_channels
  loop
    select connection_row.*
    into v_row
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = v_channel;
    if not found
      or v_row.connection_state not in ('legacy_active', 'encrypted_active')
      or v_row.last_error_code is not null
    then
      return false;
    end if;
    begin
      v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
        v_row.webhook_url
      );
    exception
      when sqlstate '22023' then
        return false;
    end;
    if v_row.connection_state = 'encrypted_active' and (
      nullif(pg_catalog.btrim(v_row.webhook_url_ciphertext), '') is null
      or v_row.webhook_url_mask is distinct from v_expected_mask
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function dashboard_private.replace_google_chat_connection_v1_impl(
  p_actor uuid,
  p_channel text,
  p_webhook_url text,
  p_webhook_url_ciphertext text,
  p_webhook_url_mask text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_replace';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_before_summary jsonb;
  v_response jsonb;
  v_expected_mask text;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english', 'science') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;
  if p_webhook_url_ciphertext is null
    or p_webhook_url_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_webhook_url_mask is null
  then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;
  v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
    p_webhook_url
  );
  if p_webhook_url_mask <> v_expected_mask then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'webhook_url', p_webhook_url,
      'webhook_url_mask', p_webhook_url_mask,
      'expected_revision', p_expected_revision::text
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  v_row_found := found;
  if v_row_found then
    if v_row.revision <> p_expected_revision then
      raise exception 'notification_connection_revision_conflict' using errcode = '40001';
    end if;
    v_before_summary := pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', v_row.connection_state <> 'disconnected'
    );
    update public.google_chat_webhook_settings connection_row
    set webhook_url = p_webhook_url,
        webhook_url_ciphertext = p_webhook_url_ciphertext,
        webhook_url_mask = p_webhook_url_mask,
        connection_state = 'encrypted_active',
        revision = connection_row.revision + 1,
        updated_by = p_actor,
        last_verified_at = null,
        last_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where connection_row.channel = p_channel
    returning connection_row.* into v_row;
  else
    if p_expected_revision <> 0 then
      raise exception 'notification_connection_revision_conflict' using errcode = '40001';
    end if;
    v_before_summary := null;
    insert into public.google_chat_webhook_settings(
      channel,
      webhook_url,
      webhook_url_ciphertext,
      webhook_url_mask,
      connection_state,
      revision,
      updated_by,
      last_verified_at,
      last_error_code
    ) values (
      p_channel,
      p_webhook_url,
      p_webhook_url_ciphertext,
      p_webhook_url_mask,
      'encrypted_active',
      1,
      p_actor,
      null,
      null
    )
    returning * into v_row;
  end if;

  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);
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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_replaced',
    p_actor,
    'user',
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true
    ),
    'operator_connection_replace'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.disconnect_google_chat_connection_v1_impl(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_disconnect';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_before_summary jsonb;
  v_response jsonb;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english', 'science') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;

  if v_row.connection_state = 'disconnected'
    and v_row.webhook_url = ''
    and v_row.webhook_url_ciphertext is null
    and v_row.webhook_url_mask is null
  then
    v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);
    insert into dashboard_private.notification_request_ledger(
      request_id,
      request_kind,
      request_fingerprint,
      response_payload
    ) values (
      p_request_id,
      v_request_kind,
      v_fingerprint,
      v_response
    );
    return v_response;
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set webhook_url = '',
      webhook_url_ciphertext = null,
      webhook_url_mask = null,
      connection_state = 'disconnected',
      revision = connection_row.revision + 1,
      updated_by = p_actor,
      last_verified_at = null,
      last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_disconnected',
    p_actor,
    'user',
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', 'disconnected',
      'revision', v_row.revision::text,
      'configured', false
    ),
    'operator_connection_disconnect'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.begin_google_chat_connection_verification_v1_impl(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_verification';
  v_reservation_ttl constant interval := interval '2 minutes';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_reserved_at timestamp with time zone;
  v_expires_at timestamp with time zone;
  v_terminal_at timestamp with time zone;
  v_safe_connection jsonb;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english', 'science') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id
  for update of ledger;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    if v_ledger_response ->> 'state' = 'completed'
      and pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') in ('object', 'null')
    then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', false,
        'connection', v_ledger_response -> 'connection'
      );
    end if;
    if v_ledger_response ->> 'state' in ('superseded', 'expired')
      and pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') in ('object', 'null')
    then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', false,
        'terminal_code', case v_ledger_response ->> 'state'
          when 'expired' then 'verification_expired'
          else 'verification_superseded'
        end,
        'connection', v_ledger_response -> 'connection'
      );
    end if;
    if v_ledger_response ->> 'state' <> 'reserved'
      or v_ledger_response ->> 'actor' <> p_actor::text
      or v_ledger_response ->> 'channel' <> p_channel
      or v_ledger_response ->> 'revision' <> p_expected_revision::text
      or v_ledger_response ->> 'reserved_at' is null
      or v_ledger_response ->> 'expires_at' is null
    then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end if;
    begin
      v_expires_at := (v_ledger_response ->> 'expires_at')::timestamp with time zone;
    exception
      when others then
        raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end;
    if v_expires_at > pg_catalog.clock_timestamp() then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', true,
        'connection', null
      );
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
    );
    select connection_row.*
    into v_row
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = p_channel
    for update of connection_row;
    v_row_found := found;
    v_safe_connection := case
      when v_row_found
        then dashboard_private.notification_connection_safe_json_v1(v_row, true)
      else 'null'::jsonb
    end;
    v_terminal_at := pg_catalog.clock_timestamp();
    update dashboard_private.notification_request_ledger ledger
    set response_payload = pg_catalog.jsonb_build_object(
      'state', 'expired',
      'terminal_code', 'verification_expired',
      'terminal_reason', 'reservation_expired',
      'reserved_at', v_ledger_response ->> 'reserved_at',
      'expires_at', v_ledger_response ->> 'expires_at',
      'terminal_at', v_terminal_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text,
      'connection', v_safe_connection
    )
    where ledger.request_id = p_request_id;
    return pg_catalog.jsonb_build_object(
      'should_send', false,
      'pending', false,
      'terminal_code', 'verification_expired',
      'connection', v_safe_connection
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found
    or v_row.connection_state = 'disconnected'
    or (
      v_row.connection_state = 'legacy_active'
      and nullif(pg_catalog.btrim(v_row.webhook_url), '') is null
    )
    or (
      v_row.connection_state = 'encrypted_active'
      and nullif(pg_catalog.btrim(v_row.webhook_url_ciphertext), '') is null
    )
  then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;

  v_reserved_at := pg_catalog.clock_timestamp();
  v_expires_at := v_reserved_at + v_reservation_ttl;

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    pg_catalog.jsonb_build_object(
      'state', 'reserved',
      'reserved_at', v_reserved_at,
      'expires_at', v_expires_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text
    )
  );
  return pg_catalog.jsonb_build_object(
    'should_send', true,
    'pending', false,
    'connection', null
  );
end;
$$;

create or replace function dashboard_private.record_google_chat_connection_verification_v1_impl(
  p_actor uuid,
  p_channel text,
  p_succeeded boolean,
  p_result_code text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_verification';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_before_summary jsonb;
  v_response jsonb;
  v_safe_connection jsonb;
  v_expires_at timestamp with time zone;
  v_terminal_at timestamp with time zone;
  v_terminal_state text;
  v_terminal_reason text;
  v_terminal_code text;
  v_audit_actor uuid;
  v_audit_actor_kind text;
  v_actor_is_admin boolean := false;
begin
  if p_actor is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  select profile.id, profile.role = 'admin'
  into v_audit_actor, v_actor_is_admin
  from public.profiles profile
  where profile.id = p_actor;
  v_actor_is_admin := coalesce(v_actor_is_admin, false);
  v_audit_actor_kind := case when v_audit_actor is null then 'system' else 'user' end;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english', 'science') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_succeeded is null
    or p_result_code is null
    or p_result_code
      !~ '^(accepted|configuration_error|provider_rejected|transport_error|http_[1-5][0-9]{2})$'
    or (p_succeeded and p_result_code <> 'accepted')
    or (not p_succeeded and p_result_code = 'accepted')
    or p_expected_revision is null
    or p_expected_revision < 1
    or p_request_id is null
  then
    raise exception 'notification_connection_result_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id
  for update of ledger;
  v_ledger_found := found;
  if not v_ledger_found then
    if not v_actor_is_admin then
      raise exception 'notification_access_denied' using errcode = '42501';
    end if;
    raise exception 'notification_connection_verification_not_reserved' using errcode = '55000';
  end if;
  if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
    if not v_actor_is_admin then
      raise exception 'notification_access_denied' using errcode = '42501';
    end if;
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_ledger_response ->> 'state' = 'completed' then
    if (v_ledger_response ->> 'succeeded')::boolean is distinct from p_succeeded
      or v_ledger_response ->> 'result_code' <> p_result_code
      or pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') <> 'object'
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response -> 'connection';
  end if;
  if v_ledger_response ->> 'state' in ('superseded', 'expired') then
    if v_ledger_response ? 'attempted_succeeded' then
      if (v_ledger_response ->> 'attempted_succeeded')::boolean is distinct from p_succeeded
        or v_ledger_response ->> 'attempted_result_code' <> p_result_code
      then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
    else
      v_ledger_response := v_ledger_response || pg_catalog.jsonb_build_object(
        'attempted_succeeded', p_succeeded,
        'attempted_result_code', p_result_code
      );
      update dashboard_private.notification_request_ledger ledger
      set response_payload = v_ledger_response
      where ledger.request_id = p_request_id;
    end if;
    if pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') is null
      or pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') not in ('object', 'null')
    then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'terminal_code', case v_ledger_response ->> 'state'
        when 'expired' then 'verification_expired'
        else 'verification_superseded'
      end,
      'connection', v_ledger_response -> 'connection'
    );
  end if;
  if v_ledger_response ->> 'state' <> 'reserved'
    or v_ledger_response ->> 'actor' <> p_actor::text
    or v_ledger_response ->> 'channel' <> p_channel
    or v_ledger_response ->> 'revision' <> p_expected_revision::text
    or v_ledger_response ->> 'reserved_at' is null
    or v_ledger_response ->> 'expires_at' is null
  then
    raise exception 'notification_connection_verification_invalid' using errcode = '55000';
  end if;
  begin
    v_expires_at := (v_ledger_response ->> 'expires_at')::timestamp with time zone;
  exception
    when others then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  v_row_found := found;
  v_safe_connection := case
    when v_row_found
      then dashboard_private.notification_connection_safe_json_v1(v_row, true)
    else 'null'::jsonb
  end;
  if v_expires_at <= pg_catalog.clock_timestamp()
    or not v_row_found
    or v_row.revision <> p_expected_revision
    or v_row.connection_state = 'disconnected'
  then
    v_terminal_at := pg_catalog.clock_timestamp();
    v_terminal_state := case
      when v_expires_at <= v_terminal_at then 'expired'
      else 'superseded'
    end;
    v_terminal_code := case v_terminal_state
      when 'expired' then 'verification_expired'
      else 'verification_superseded'
    end;
    v_terminal_reason := case
      when v_expires_at <= v_terminal_at then 'reservation_expired'
      when not v_row_found then 'connection_missing'
      when v_row.revision <> p_expected_revision then 'connection_revision_changed'
      else 'connection_disconnected'
    end;
    update dashboard_private.notification_request_ledger ledger
    set response_payload = pg_catalog.jsonb_build_object(
      'state', v_terminal_state,
      'terminal_code', v_terminal_code,
      'terminal_reason', v_terminal_reason,
      'reserved_at', v_ledger_response ->> 'reserved_at',
      'expires_at', v_ledger_response ->> 'expires_at',
      'terminal_at', v_terminal_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text,
      'current_revision', case when v_row_found then v_row.revision::text else null end,
      'attempted_succeeded', p_succeeded,
      'attempted_result_code', p_result_code,
      'connection', v_safe_connection
    )
    where ledger.request_id = p_request_id;
    return pg_catalog.jsonb_build_object(
      'terminal_code', v_terminal_code,
      'connection', v_safe_connection
    );
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set revision = connection_row.revision + 1,
      updated_by = v_audit_actor,
      last_verified_at = pg_catalog.clock_timestamp(),
      last_error_code = case when p_succeeded then null else p_result_code end,
      updated_at = pg_catalog.clock_timestamp()
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_verification_recorded',
    v_audit_actor,
    v_audit_actor_kind,
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true,
      'verification_result', p_result_code
    ),
    'operator_connection_verification'
  );
  update dashboard_private.notification_request_ledger ledger
  set response_payload = pg_catalog.jsonb_build_object(
    'state', 'completed',
    'reserved_at', v_ledger_response ->> 'reserved_at',
    'expires_at', v_ledger_response ->> 'expires_at',
    'completed_at', pg_catalog.clock_timestamp(),
    'actor', p_actor,
    'channel', p_channel,
    'revision', p_expected_revision::text,
    'succeeded', p_succeeded,
    'result_code', p_result_code,
    'connection', v_response
  )
  where ledger.request_id = p_request_id;
  return v_response;
end;
$$;

create or replace function dashboard_private.notification_connection_safe_json_v1(
  p_row public.google_chat_webhook_settings,
  p_editable boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection_key text;
  v_safe_mask text;
  v_safe_error_code text;
begin
  v_connection_key := case p_row.channel
    when 'admin' then 'google_chat.management'
    when 'executive' then 'google_chat.executive'
    when 'math' then 'google_chat.math'
    when 'english' then 'google_chat.english'
    when 'science' then 'google_chat.science'
    else null
  end;

  if v_connection_key is null then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;

  v_safe_error_code := case
    when p_row.last_error_code
      ~ '^(accepted|configuration_error|provider_rejected|transport_error|http_[1-5][0-9]{2})$'
    then p_row.last_error_code
    else null
  end;
  if p_row.connection_state = 'legacy_active' then
    begin
      v_safe_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
        p_row.webhook_url
      );
    exception
      when sqlstate '22023' then
        v_safe_mask := 'chat.googleapis.com/v1/spaces/…/messages';
        v_safe_error_code := 'configuration_error';
    end;
  elsif p_row.connection_state = 'encrypted_active' then
    if p_row.webhook_url_mask = 'chat.googleapis.com/v1/spaces/…/messages'
      or p_row.webhook_url_mask
        ~ '^chat[.]googleapis[.]com/v1/spaces/[A-Za-z0-9_.-]{4}…[A-Za-z0-9_.-]{4}/messages$'
    then
      v_safe_mask := p_row.webhook_url_mask;
    else
      v_safe_mask := 'chat.googleapis.com/v1/spaces/…/messages';
      v_safe_error_code := 'configuration_error';
    end if;
  else
    v_safe_mask := null;
  end if;

  return pg_catalog.jsonb_build_object(
    'connection_key', v_connection_key,
    'connection_state', p_row.connection_state,
    'revision', p_row.revision::text,
    'configured', p_row.connection_state <> 'disconnected',
    'webhook_url_mask', v_safe_mask,
    'last_verified_at', p_row.last_verified_at,
    'last_error_code', v_safe_error_code,
    'editable', coalesce(p_editable, false)
  );
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
  select pg_catalog.jsonb_build_object(
    'scope_key', 'global',
    'workflow_key', p_workflow_key,
    'rules', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', rule_row.id,
            'workflow_key', rule_row.workflow_key,
            'event_key', rule_row.event_key,
            'event_label', registry_row.event_label,
            'group_label', registry_row.group_label,
            'trigger_description', registry_row.trigger_description,
            'sort_order', registry_row.event_sort * 100 + registry_row.cell_sort,
            'audience_key', rule_row.audience_key,
            'audience_label', registry_row.audience_label,
            'channel_key', rule_row.channel_key,
            'channel_label', registry_row.channel_label,
            'connection_key', case
              when rule_row.channel_key <> 'google_chat' then null
              when rule_row.audience_key = 'management_team'
                then 'google_chat.management'
              when rule_row.audience_key = 'executive_team'
                then 'google_chat.executive'
              else null
            end,
            'rule_variant_key', rule_row.rule_variant_key,
            'delivery_mode', rule_row.delivery_mode,
            'schedule_key', rule_row.schedule_key,
            'schedule_config', rule_row.schedule_config,
            'enabled', rule_row.enabled,
            'active_template_id', rule_row.active_template_id,
            'revision', rule_row.revision::text,
            'updated_at', rule_row.updated_at,
            'template', pg_catalog.jsonb_build_object(
              'id', template_row.id,
              'rule_id', template_row.rule_id,
              'version', template_row.version::text,
              'title_template', template_row.title_template,
              'body_template', template_row.body_template,
              'allowed_variables', template_row.allowed_variables,
              'payload_schema_version', template_row.payload_schema_version,
              'checksum', template_row.checksum
            )
          )
          order by
            registry_row.event_sort,
            registry_row.cell_sort,
            rule_row.id
        )
        from dashboard_private.notification_settings_ui_registry registry_row
        join dashboard_private.notification_rules rule_row
          on rule_row.id = registry_row.rule_id
         and rule_row.scope_key = 'global'
         and rule_row.workflow_key = registry_row.workflow_key
         and rule_row.event_key = registry_row.event_key
         and rule_row.audience_key = registry_row.audience_key
         and rule_row.channel_key = registry_row.channel_key
         and rule_row.rule_variant_key = registry_row.rule_variant_key
        join dashboard_private.notification_templates template_row
          on template_row.rule_id = rule_row.id
         and template_row.id = rule_row.active_template_id
        where registry_row.workflow_key = p_workflow_key
      ),
      '[]'::jsonb
    ),
    'connections', coalesce(
      (
        select pg_catalog.jsonb_agg(
          dashboard_private.notification_connection_safe_json_v1(
            connection_row,
            p_editable
          )
          order by case connection_row.channel
            when 'admin' then 1
            when 'executive' then 2
            when 'math' then 3
            when 'english' then 4
            when 'science' then 5
            else 99
          end
        )
        from public.google_chat_webhook_settings connection_row
        where connection_row.channel in ('admin', 'executive', 'math', 'english', 'science')
      ),
      '[]'::jsonb
    ),
    'delivery_summary', (
      select pg_catalog.jsonb_build_object(
        'pending_count', pg_catalog.count(*) filter (
          where delivery_row.status in ('pending', 'claimed', 'sending', 'retry_wait')
        ),
        'sent_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'sent'
        ),
        'failed_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'failed'
        ),
        'unknown_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'delivery_unknown'
        ),
        'latest_delivery_at', pg_catalog.max(delivery_row.updated_at)
      )
      from dashboard_private.notification_deliveries delivery_row
      join dashboard_private.notification_events event_row
        on event_row.id = delivery_row.event_id
      where event_row.scope_key = 'global'
        and event_row.workflow_key = p_workflow_key
    ),
    'loaded_at', pg_catalog.statement_timestamp()
  );
$$;

create or replace function dashboard_private.save_notification_control_plane_unchecked_v1(
  p_workflow_key text,
  p_expected_revisions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_request_kind constant text := 'notification_settings_save';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_rules_patch jsonb;
  v_rule_id_text text;
  v_rule_id uuid;
  v_seen_rule_ids uuid[] := '{}'::uuid[];
  v_rule_patch jsonb;
  v_enabled boolean;
  v_event_key text;
  v_channel_key text;
  v_audience_key text;
  v_schedule_key text;
  v_schedule_config jsonb;
  v_revision bigint;
  v_active_template_id uuid;
  v_template_version bigint;
  v_title_template text;
  v_body_template text;
  v_allowed_variables jsonb;
  v_payload_schema_version integer;
  v_next_enabled boolean;
  v_next_schedule_config jsonb;
  v_next_title_template text;
  v_next_body_template text;
  v_template_changed boolean;
  v_rule_changed boolean;
  v_new_template_id uuid;
  v_new_template_version bigint;
  v_new_checksum text;
  v_new_revision bigint;
  v_changed_revisions jsonb := '{}'::jsonb;
  v_job_id uuid;
  v_response jsonb;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null or p_workflow_key not in (
    'tasks',
    'word_retests',
    'registration',
    'transfer',
    'withdrawal',
    'makeup_requests',
    'approvals'
  ) then
    raise exception 'notification_workflow_unknown' using errcode = '22023';
  end if;
  if p_request_id is null
    or p_expected_revisions is null
    or p_patch is null
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', v_actor,
      'workflow_key', p_workflow_key,
      'expected_revisions', p_expected_revisions,
      'patch', p_patch
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );

  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'notification-control-plane-workflow:' || p_workflow_key,
      0
    )
  );

  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_settings_ui_enabled'
    and flag_row.enabled
  for share;
  if not found then
    raise exception 'notification_settings_ui_disabled' using errcode = '55000';
  end if;

  if pg_catalog.jsonb_typeof(p_expected_revisions) <> 'object'
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'rules')
    or p_patch - 'rules' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_patch -> 'rules') <> 'object'
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;
  v_rules_patch := p_patch -> 'rules';

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_revisions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    where not (p_expected_revisions ? patch_key.value)
  ) then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
    v_rule_id := v_rule_id_text::uuid;
    if v_rule_id::text <> v_rule_id_text
      or v_rule_id = any(v_seen_rule_ids)
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;
    v_seen_rule_ids := pg_catalog.array_append(v_seen_rule_ids, v_rule_id);
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    if pg_catalog.jsonb_typeof(v_rule_patch) <> 'object'
      or v_rule_patch = '{}'::jsonb
      or v_rule_patch - array[
        'enabled',
        'title_template',
        'body_template',
        'schedule_config'
      ]::text[] <> '{}'::jsonb
      or (
        v_rule_patch ? 'enabled'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'enabled') <> 'boolean'
      )
      or (
        v_rule_patch ? 'title_template'
        and (
          pg_catalog.jsonb_typeof(v_rule_patch -> 'title_template') <> 'string'
          or nullif(pg_catalog.btrim(v_rule_patch ->> 'title_template'), '') is null
        )
      )
      or (
        v_rule_patch ? 'body_template'
        and (
          pg_catalog.jsonb_typeof(v_rule_patch -> 'body_template') <> 'string'
          or nullif(pg_catalog.btrim(v_rule_patch ->> 'body_template'), '') is null
        )
      )
      or (
        v_rule_patch ? 'schedule_config'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config')
          not in ('object', 'null')
      )
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;

    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision
    from dashboard_private.notification_rules rule_row
    where rule_row.id = v_rule_id
      and rule_row.scope_key = 'global'
      and rule_row.workflow_key = p_workflow_key
    for update of rule_row;
    if not found then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
    if v_revision::text <> p_expected_revisions ->> v_rule_id_text then
      raise exception 'notification_revision_conflict' using errcode = '40001';
    end if;

    if v_rule_patch ? 'schedule_config' then
      v_next_schedule_config := case
        when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null'
          then null
        else v_rule_patch -> 'schedule_config'
      end;
      if not dashboard_private.notification_schedule_config_valid_v1(
        p_workflow_key,
        v_event_key,
        v_schedule_key,
        v_next_schedule_config
      ) then
        raise exception 'notification_patch_invalid' using errcode = '22023';
      end if;
    end if;

    if not v_enabled
      and v_channel_key = 'google_chat'
      and v_rule_patch ? 'enabled'
      and (v_rule_patch ->> 'enabled')::boolean
    then
      perform 1
      from public.google_chat_webhook_settings connection_row
      where connection_row.channel = any(
        case v_audience_key
          when 'management_team' then array['admin']::text[]
          when 'executive_team' then array['executive']::text[]
          when 'subject_team' then array['english', 'math', 'science']::text[]
          else '{}'::text[]
        end
      )
      order by connection_row.channel
      for share of connection_row;
      if not dashboard_private.notification_google_chat_audience_ready_v1(
        v_audience_key
      ) then
        raise exception 'notification_google_chat_connection_required' using errcode = '55000';
      end if;
    end if;
  end loop;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    v_rule_id := v_rule_id_text::uuid;
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision,
      rule_row.active_template_id,
      template_row.version,
      template_row.title_template,
      template_row.body_template,
      template_row.allowed_variables,
      template_row.payload_schema_version
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision,
      v_active_template_id,
      v_template_version,
      v_title_template,
      v_body_template,
      v_allowed_variables,
      v_payload_schema_version
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.rule_id = rule_row.id
     and template_row.id = rule_row.active_template_id
    where rule_row.id = v_rule_id;

    v_next_enabled := case
      when v_rule_patch ? 'enabled' then (v_rule_patch ->> 'enabled')::boolean
      else v_enabled
    end;
    v_next_title_template := case
      when v_rule_patch ? 'title_template' then v_rule_patch ->> 'title_template'
      else v_title_template
    end;
    v_next_body_template := case
      when v_rule_patch ? 'body_template' then v_rule_patch ->> 'body_template'
      else v_body_template
    end;
    v_next_schedule_config := case
      when not (v_rule_patch ? 'schedule_config') then v_schedule_config
      when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null' then null
      else v_rule_patch -> 'schedule_config'
    end;
    if not dashboard_private.notification_schedule_config_valid_v1(
      p_workflow_key,
      v_event_key,
      v_schedule_key,
      v_next_schedule_config
    ) or not dashboard_private.notification_template_content_valid_v1(
      v_next_title_template,
      v_next_body_template,
      v_allowed_variables
    ) then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;
    v_template_changed := v_next_title_template is distinct from v_title_template
      or v_next_body_template is distinct from v_body_template;
    v_rule_changed := v_template_changed
      or v_next_enabled is distinct from v_enabled
      or v_next_schedule_config is distinct from v_schedule_config;

    if not v_rule_changed then
      continue;
    end if;

    v_new_template_id := v_active_template_id;
    v_new_template_version := v_template_version;
    if v_template_changed then
      select coalesce(pg_catalog.max(template_row.version), 0) + 1
      into v_new_template_version
      from dashboard_private.notification_templates template_row
      where template_row.rule_id = v_rule_id;
      v_new_template_id := pg_catalog.gen_random_uuid();
      v_new_checksum := pg_catalog.md5(
        pg_catalog.jsonb_build_object(
          'title_template', v_next_title_template,
          'body_template', v_next_body_template,
          'allowed_variables', v_allowed_variables,
          'payload_schema_version', v_payload_schema_version
        )::text
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
        v_new_template_id,
        v_rule_id,
        v_new_template_version,
        v_next_title_template,
        v_next_body_template,
        v_allowed_variables,
        v_payload_schema_version,
        v_new_checksum,
        v_actor,
        'user'
      );
    end if;

    update dashboard_private.notification_rules rule_row
    set enabled = v_next_enabled,
        schedule_config = v_next_schedule_config,
        active_template_id = v_new_template_id,
        revision = rule_row.revision + 1,
        updated_by = v_actor,
        updated_actor_kind = 'user',
        updated_at = pg_catalog.clock_timestamp()
    where rule_row.id = v_rule_id
    returning rule_row.revision into v_new_revision;

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
      'notification_rule',
      v_rule_id::text,
      'settings_updated',
      v_actor,
      'user',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'enabled', v_enabled,
        'revision', v_revision::text,
        'active_template_id', v_active_template_id,
        'template_version', v_template_version::text,
        'schedule_config', v_schedule_config
      ),
      pg_catalog.jsonb_build_object(
        'enabled', v_next_enabled,
        'revision', v_new_revision::text,
        'active_template_id', v_new_template_id,
        'template_version', v_new_template_version::text,
        'schedule_config', v_next_schedule_config
      ),
      'operator_settings_save'
    );
    v_changed_revisions := v_changed_revisions || pg_catalog.jsonb_build_object(
      v_rule_id::text,
      v_new_revision::text
    );
  end loop;

  if v_changed_revisions <> '{}'::jsonb then
    insert into dashboard_private.notification_rule_reconciliation_jobs(
      workflow_key,
      rule_revision_map
    ) values (
      p_workflow_key,
      v_changed_revisions
    )
    returning id into v_job_id;
  end if;

  v_response := dashboard_private.notification_control_plane_snapshot_v1(
    p_workflow_key,
    v_role = 'admin'
  );
  if v_job_id is not null then
    v_response := v_response || pg_catalog.jsonb_build_object(
      'reconciliation_job', pg_catalog.jsonb_build_object(
        'job_kind', 'rule_reconciliation',
        'job_id', v_job_id,
        'status', 'pending',
        'attempt_count', 0
      )
    );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.backfill_google_chat_connection_encryption_v1(
  p_channel text,
  p_expected_revision bigint,
  p_expected_webhook_fingerprint text,
  p_webhook_url_ciphertext text,
  p_webhook_url_mask text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.google_chat_webhook_settings%rowtype;
  v_actual_fingerprint text;
  v_expected_mask text;
  v_before_summary jsonb;
  v_response jsonb;
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english', 'science') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null
    or p_expected_revision < 1
    or p_expected_revision = 9223372036854775807
    or p_expected_webhook_fingerprint is null
    or p_expected_webhook_fingerprint !~ '^[0-9a-f]{64}$'
    or p_webhook_url_ciphertext is null
    or p_webhook_url_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_webhook_url_mask is null
  then
    raise exception 'notification_connection_backfill_invalid' using errcode = '22023';
  end if;

  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;

  v_actual_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_row.webhook_url, 'UTF8')),
    'hex'
  );
  if v_actual_fingerprint <> p_expected_webhook_fingerprint then
    raise exception 'notification_connection_backfill_fingerprint_mismatch'
      using errcode = '40001';
  end if;

  begin
    v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
      v_row.webhook_url
    );
  exception
    when sqlstate '22023' then
      raise exception 'notification_connection_backfill_not_candidate'
        using errcode = '55000';
  end;
  if p_webhook_url_mask <> v_expected_mask then
    raise exception 'notification_connection_backfill_invalid' using errcode = '22023';
  end if;

  if v_row.connection_state = 'encrypted_active'
    and v_row.revision = p_expected_revision + 1
    and v_row.webhook_url_ciphertext = p_webhook_url_ciphertext
    and v_row.webhook_url_mask = p_webhook_url_mask
    and exists (
      select 1
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'google_chat_connection'
        and audit.entity_id = case p_channel
          when 'admin' then 'google_chat.management'
          when 'executive' then 'google_chat.executive'
          when 'math' then 'google_chat.math'
          when 'english' then 'google_chat.english'
          when 'science' then 'google_chat.science'
        end
        and audit.action = 'connection_encryption_backfilled'
        and audit.actor_kind = 'system'
        and audit.before_summary ->> 'revision' = p_expected_revision::text
        and audit.after_summary ->> 'revision' = v_row.revision::text
    )
  then
    return dashboard_private.notification_connection_safe_json_v1(v_row, false);
  end if;

  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;
  if v_row.connection_state <> 'legacy_active'
    or v_row.webhook_url_ciphertext is not null
  then
    raise exception 'notification_connection_backfill_not_candidate'
      using errcode = '55000';
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set webhook_url_ciphertext = p_webhook_url_ciphertext,
      webhook_url_mask = p_webhook_url_mask,
      connection_state = 'encrypted_active',
      revision = connection_row.revision + 1
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, false);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_encryption_backfilled',
    null,
    'system',
    null,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true
    ),
    'controlled_connection_encryption_backfill'
  );
  return v_response;
end;
$$;

create or replace function public.revalidate_immediate_notification_delivery_v1(
  p_workflow_key text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_scheduled_for timestamp with time zone,
  p_target jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_source_exists boolean := false;
  v_profile_role text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null
    or p_event_id is null
    or p_delivery_id is null
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or nullif(pg_catalog.btrim(p_source_type), '') is null
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or (
      p_source_revision is not null
      and not (
        p_workflow_key = 'registration'
        and p_source_type = 'registration_appointment'
      )
    )
    or (
      p_workflow_key = 'registration'
      and p_source_type = 'registration_appointment'
      and (p_source_revision is null or p_source_revision < 1)
    )
    or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_scheduled_for is null
    or p_target is null
    or pg_catalog.jsonb_typeof(p_target) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_target)) <> 5
    or not p_target ?& array[
      'target_kind', 'target_key', 'target_profile_id', 'connection_key', 'target_snapshot'
    ]
    or not exists (
      select 1
      from dashboard_private.notification_source_type_registry registry
      where registry.workflow_key = p_workflow_key
        and registry.source_type = p_source_type
    )
  then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;

  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id
    and event_row.workflow_key = p_workflow_key
    and event_row.event_key = p_event_key
    and event_row.source_type = p_source_type
    and event_row.source_id = p_source_id
    and event_row.source_revision is not distinct from p_source_revision;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.event_id = p_event_id
    and delivery.rule_id = p_rule_id
    and delivery.rule_revision = p_rule_revision
    and delivery.target_generation = p_target_generation
    and delivery.scheduled_for = p_scheduled_for
    and delivery.status = 'claimed';
  if not found
    or p_target ->> 'target_kind' is distinct from v_delivery.target_kind
    or p_target ->> 'target_key' is distinct from v_delivery.target_key
    or nullif(p_target ->> 'target_profile_id', '')::uuid
      is distinct from v_delivery.target_profile_id
    or p_target ->> 'connection_key' is distinct from v_delivery.connection_key
    or p_target -> 'target_snapshot' is distinct from v_delivery.target_snapshot
  then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;

  select rule_row.* into v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
    and rule_row.workflow_key = p_workflow_key
    and rule_row.event_key = p_event_key
    and rule_row.delivery_mode = 'immediate';
  if not found or not v_rule.enabled or v_rule.revision <> p_rule_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'rule_revision_changed'
    );
  end if;

  begin
    v_source_exists := case p_source_type
      when 'ops_task_event' then exists (
        select 1
        from public.ops_task_events source
        join public.ops_tasks task on task.id = source.task_id
        where source.id = p_source_id::uuid
          and task.id::text = v_event.payload ->> 'task_id'
          and (
            (
              p_workflow_key = 'registration'
              and source.event_type = 'registration_track_event'
              and task.type = 'registration'
              and task.id::text = v_event.payload ->> 'task_id'
              and dashboard_private.registration_track_event_key_v1(
                source.after_value::jsonb ->> 'event_type',
                coalesce(source.after_value::jsonb -> 'metadata', '{}'::jsonb)
              ) = p_event_key
            )
            or (
              p_workflow_key = 'tasks'
              and task.type = 'general'
              and source.event_type = p_event_key
            )
            or (
              p_workflow_key = 'word_retests'
              and task.type = 'word_retest'
              and source.event_type = p_event_key
            )
            or (
              p_workflow_key in ('transfer', 'withdrawal')
              and task.type = p_workflow_key
              and source.event_type = p_event_key
            )
          )
      )
      when 'ops_task_comment' then exists (
        select 1
        from public.ops_task_comments source
        join public.ops_tasks task on task.id = source.task_id
        where source.id = p_source_id::uuid
          and p_workflow_key = 'tasks'
          and p_event_key = 'task.comment_added'
          and task.type = 'general'
          and task.id::text = v_event.payload ->> 'task_id'
      )
      when 'makeup_request_event' then exists (
        select 1 from public.makeup_request_events source where source.id = p_source_id::uuid
      )
      when 'approval_event' then exists (
        select 1 from public.approval_events source
        where source.id = p_source_id::uuid
          and source.approval_id::text = v_event.payload ->> 'approval_id'
          and source.event_type = case p_event_key
            when 'approval.created' then 'created'
            when 'approval.submitted' then 'status_changed'
            when 'approval.resubmitted' then 'status_changed'
            when 'approval.review_started' then 'status_changed'
            when 'approval.approved' then 'status_changed'
            when 'approval.returned' then 'status_changed'
            when 'approval.canceled' then 'status_changed'
            when 'approval.approver_changed' then 'approver_changed'
            when 'approval.deleted' then 'deleted'
            else null
          end
      )
      when 'approval_comment' then exists (
        select 1 from public.approval_comments source
        where source.id = p_source_id::uuid
          and source.approval_id::text = v_event.payload ->> 'approval_id'
      )
      when 'registration_appointment' then exists (
        select 1
        from public.ops_registration_appointments appointment
        where p_workflow_key = 'registration'
          and p_event_key like 'registration.visit_%'
          and appointment.id = p_source_id::uuid
          and appointment.kind = 'visit_consultation'
          and appointment.task_id::text = v_event.payload ->> 'task_id'
          and appointment.id::text = v_event.payload ->> 'appointment_id'
          and appointment.notification_revision = p_source_revision
          and appointment.notification_revision::text
            = v_event.payload ->> 'notification_revision'
          and appointment.recipient_revision = p_target_generation
          and appointment.recipient_revision::text
            = v_event.payload ->> 'recipient_revision'
          and (
            (p_event_key = 'registration.visit_canceled' and appointment.status = 'canceled')
            or (
              p_event_key = 'registration.visit_replaced'
              and appointment.status in ('scheduled', 'canceled')
            )
            or (
              p_event_key not in (
                'registration.visit_canceled', 'registration.visit_replaced'
              )
              and appointment.status = 'scheduled'
            )
          )
      )
      when 'ops_registration_message' then exists (
        select 1
        from public.ops_registration_messages message
        where p_workflow_key = 'registration'
          and p_event_key = 'registration.admission_message_requested'
          and message.id = p_source_id::uuid
          and message.template_key = 'admission_application'
          and message.status = 'pending'
          and message.claim_active
          and message.task_id::text = v_event.payload ->> 'task_id'
          and message.id::text = v_event.payload ->> 'message_id'
          and message.request_key = v_event.payload ->> 'message_request_key'
          and v_delivery.target_kind = 'customer_endpoint'
          and v_delivery.target_key = 'registration-message:' || message.id::text
          and v_delivery.target_snapshot ->> 'message_id' = message.id::text
          and v_delivery.target_snapshot ->> 'request_key_hash'
            = pg_catalog.md5(message.request_key)
      )
      else false
    end;
  exception
    when invalid_text_representation then
      v_source_exists := false;
  end;
  if not v_source_exists then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'source_status_changed'
    );
  end if;

  if v_delivery.target_profile_id is not null then
    select profile.role into v_profile_role
    from public.profiles profile
    where profile.id = v_delivery.target_profile_id;
    if not found
      or not dashboard_private.notification_profile_is_active_v1(
        v_delivery.target_profile_id
      )
      or (v_delivery.audience_key in ('management_team', 'executive_team')
        and v_profile_role not in ('admin', 'staff'))
      or (v_delivery.audience_key = 'subject_team'
        and v_profile_role not in ('admin', 'staff', 'teacher'))
      or (
        p_workflow_key in ('tasks', 'word_retests')
        and p_source_type in ('ops_task_event', 'ops_task_comment')
        and v_delivery.audience_key in (
          'primary_assignee', 'assigned_assistant', 'secondary_assignee'
        )
        and not exists (
          select 1
          from public.ops_tasks task
          where task.id::text = v_event.payload ->> 'task_id'
            and (
              (
                p_workflow_key = 'tasks'
                and v_delivery.audience_key = 'primary_assignee'
                and task.assignee_id = v_delivery.target_profile_id
              )
              or (
                p_workflow_key = 'word_retests'
                and v_delivery.audience_key = 'assigned_assistant'
                and task.assignee_id = v_delivery.target_profile_id
              )
              or (
                v_delivery.audience_key = 'secondary_assignee'
                and task.secondary_assignee_id = v_delivery.target_profile_id
              )
            )
        )
      )
      or (
        p_workflow_key = 'registration'
        and p_source_type = 'registration_appointment'
        and v_delivery.audience_key = 'track_director'
        and not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_source_id::uuid
            and consultation.mode = 'visit'
            and consultation.director_profile_id = v_delivery.target_profile_id
        )
      )
      or (
        p_workflow_key = 'registration'
        and p_event_key = 'registration.phone_consultation_ready'
        and v_delivery.audience_key = 'track_director'
        and not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
            and consultation.mode = 'phone'
            and consultation.status = 'waiting'
            and consultation.recipient_revision = p_target_generation
            and consultation.director_profile_id = v_delivery.target_profile_id
        )
      )
    then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
      );
    end if;
  end if;
  if v_delivery.connection_key is not null and not exists (
    select 1
    from public.google_chat_webhook_settings connection
    where connection.channel = case v_delivery.connection_key
      when 'google_chat.management' then 'admin'
      when 'google_chat.executive' then 'executive'
      when 'google_chat.math' then 'math'
      when 'google_chat.english' then 'english'
      when 'google_chat.science' then 'science'
      else null
    end
      and connection.connection_state in ('legacy_active', 'encrypted_active')
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
    );
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
exception
  when invalid_text_representation then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
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
      when 'google_chat.science' then 'science'
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

create or replace function public.prepare_notification_immediate_delivery_v1(
  p_workflow_key text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_scheduled_for timestamptz,
  p_target jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_source_uuid uuid;
  v_parent_uuid uuid;
  v_track_ids uuid[] := array[]::uuid[];
  v_target_profile_id uuid;
  v_dispatch_flag_key text;
  v_revalidation jsonb;
  v_status text;
  v_reason text;
  v_expected_scheduled_for timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null
    or p_event_id is null
    or p_delivery_id is null
    or p_claim_token is null
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or p_source_type not in (
      'ops_task_event', 'ops_task_comment', 'makeup_request_event',
      'approval_event', 'approval_comment', 'registration_appointment',
      'ops_registration_message'
    )
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_scheduled_for is null
    or p_target is null or pg_catalog.jsonb_typeof(p_target) <> 'object'
  then
    raise exception 'notification_delivery_prepare_invalid' using errcode = '22023';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;

  -- Dispatch activation takes flag -> source -> delivery -> ownership locks.
  select owner_row.dispatch_flag_key into strict v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
    p_workflow_key, p_event_key
  );
  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = v_dispatch_flag_key
  for share of flag_row;
  if not found then
    raise exception 'notification_dispatch_flag_missing' using errcode = '55000';
  end if;
  perform 1
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
    p_workflow_key, p_event_key
  )
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;
  if not found then
    raise exception 'notification_dispatch_owner_missing' using errcode = '55000';
  end if;

  begin
    v_source_uuid := p_source_id::uuid;
    v_target_profile_id := nullif(p_target ->> 'target_profile_id', '')::uuid;
  exception
    when invalid_text_representation then
      v_source_uuid := null;
      v_target_profile_id := null;
  end;

  -- Lock each mutable parent before its immutable history/source row. This is
  -- the same direction used by the domain mutations that cancel deliveries.
  if p_source_type = 'ops_task_event' and v_source_uuid is not null then
    select source.task_id into v_parent_uuid
    from public.ops_task_events source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    if p_workflow_key = 'registration'
      and nullif(v_event.payload ->> 'track_id', '') is not null
    then
      perform 1
      from public.ops_registration_subject_tracks track
      where track.task_id = v_parent_uuid
        and track.id::text = (v_event.payload ->> 'track_id')
      order by track.id
      for share of track;
      perform 1
      from public.academic_subject_settings setting
      where setting.subject in (
        select track.subject
        from public.ops_registration_subject_tracks track
        where track.task_id = v_parent_uuid
          and track.id::text = (v_event.payload ->> 'track_id')
      )
      order by setting.subject
      for share of setting;
    end if;
    if p_workflow_key = 'registration'
      and p_event_key = 'registration.phone_consultation_ready'
    then
      begin
        perform 1 from public.ops_registration_consultations consultation
        where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
        for share of consultation;
      exception when invalid_text_representation then null;
      end;
    end if;
    perform 1 from public.ops_task_events source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type = 'ops_task_comment' and v_source_uuid is not null then
    select source.task_id into v_parent_uuid
    from public.ops_task_comments source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    perform 1 from public.ops_task_comments source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type = 'makeup_request_event' and v_source_uuid is not null then
    select source.request_id into v_parent_uuid
    from public.makeup_request_events source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.makeup_requests request_row
      where request_row.id = v_parent_uuid for share of request_row;
    end if;
    perform 1 from public.makeup_request_events source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type in ('approval_event', 'approval_comment')
    and v_source_uuid is not null
  then
    if p_source_type = 'approval_event' then
      select source.approval_id into v_parent_uuid
      from public.approval_events source where source.id = v_source_uuid;
    else
      select source.approval_id into v_parent_uuid
      from public.approval_comments source where source.id = v_source_uuid;
    end if;
    -- A deleted approval event is valid even when its parent is already gone.
    if v_parent_uuid is not null then
      perform 1 from public.approval_requests request_row
      where request_row.id = v_parent_uuid for share of request_row;
    end if;
    if p_source_type = 'approval_event' then
      perform 1 from public.approval_events source
      where source.id = v_source_uuid for share of source;
    else
      perform 1 from public.approval_comments source
      where source.id = v_source_uuid for share of source;
    end if;
  elsif p_source_type = 'registration_appointment' and v_source_uuid is not null then
    select appointment.task_id into v_parent_uuid
    from public.ops_registration_appointments appointment
    where appointment.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
      perform 1 from public.ops_registration_details detail
      where detail.task_id = v_parent_uuid for share of detail;
      v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
        v_source_uuid
      );
      perform 1 from public.ops_registration_subject_tracks track
      where track.id = any(v_track_ids)
      order by track.id for share of track;
      perform 1
      from public.academic_subject_settings setting
      where setting.subject in (
        select track.subject
        from public.ops_registration_subject_tracks track
        where track.id = any(v_track_ids)
      )
      order by setting.subject
      for share of setting;
      select appointment.* into v_appointment
      from public.ops_registration_appointments appointment
      where appointment.id = v_source_uuid
      for share of appointment;
      perform 1 from public.ops_registration_level_tests level_test
      where level_test.appointment_id = v_source_uuid
      order by level_test.id for share of level_test;
      perform 1 from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_source_uuid
      order by consultation.id for share of consultation;
    end if;
  elsif p_source_type = 'ops_registration_message' and v_source_uuid is not null then
    select message.task_id into v_parent_uuid
    from public.ops_registration_messages message where message.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    perform 1 from public.ops_registration_messages message
    where message.id = v_source_uuid for share of message;
  end if;

  if v_target_profile_id is not null then
    perform 1 from auth.users user_row
    where user_row.id = v_target_profile_id for share of user_row;
    perform 1 from public.profiles profile
    where profile.id = v_target_profile_id for share of profile;
    perform 1 from public.teacher_catalogs teacher
    where teacher.profile_id = v_target_profile_id
    order by teacher.id for share of teacher;
  end if;

  select rule_row.* into v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
  for share of rule_row;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token <> p_claim_token
    or v_delivery.event_id <> p_event_id
    or v_delivery.rule_id <> p_rule_id
    or v_delivery.rule_revision <> p_rule_revision
    or v_delivery.target_generation <> p_target_generation
    or v_delivery.scheduled_for <> p_scheduled_for
  then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;

  if p_workflow_key = 'registration'
    and p_event_key = 'registration.appointment_reminder_due'
    and p_source_type = 'registration_appointment'
  then
    if v_event.workflow_key <> p_workflow_key
      or v_event.event_key <> p_event_key
      or v_event.source_type <> p_source_type
      or v_event.source_id <> p_source_id
      or v_event.source_revision is distinct from p_source_revision
      or p_target ->> 'target_kind' is distinct from v_delivery.target_kind
      or p_target ->> 'target_key' is distinct from v_delivery.target_key
      or v_target_profile_id is distinct from v_delivery.target_profile_id
      or p_target ->> 'connection_key' is distinct from v_delivery.connection_key
      or p_target -> 'target_snapshot' is distinct from v_delivery.target_snapshot
      or v_rule.id is null
      or v_rule.workflow_key <> p_workflow_key
      or v_rule.event_key <> p_event_key
      or v_rule.delivery_mode <> 'scheduled'
    then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
      );
    elsif not v_rule.enabled or v_rule.revision <> p_rule_revision then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'rule_revision_changed'
      );
    elsif v_appointment.id is null or v_appointment.status <> 'scheduled' then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'source_status_changed'
      );
    elsif v_appointment.notification_revision <> p_source_revision then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'source_revision_changed'
      );
    elsif (
        not (
          v_appointment.kind = 'visit_consultation'
          and v_delivery.audience_key = 'management_team'
          and v_delivery.channel_key = 'google_chat'
        )
        and (
          v_appointment.recipient_revision <> p_target_generation
        )
      )
      or (
        v_delivery.target_profile_id is not null
        and (
          not dashboard_private.notification_profile_is_active_v1(
            v_delivery.target_profile_id
          )
          or (
            v_delivery.audience_key = 'management_team'
            and not exists (
              select 1 from public.profiles profile
              where profile.id = v_delivery.target_profile_id
                and profile.role in ('admin', 'staff')
            )
          )
          or (
            v_delivery.audience_key = 'track_director'
            and not exists (
              select 1
              from public.ops_registration_subject_tracks track
              where track.id = any(
                dashboard_private.registration_appointment_track_ids_v1(
                  v_appointment.id
                )
              )
                and track.director_profile_id = v_delivery.target_profile_id
            )
          )
        )
      )
    then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
      );
    else
      v_expected_scheduled_for :=
        dashboard_private.calculate_registration_reminder_schedule_v1(
          v_rule.schedule_key, v_rule.schedule_config, v_appointment.scheduled_at
        );
      if v_expected_scheduled_for <> p_scheduled_for then
        v_revalidation := pg_catalog.jsonb_build_object(
          'ok', false, 'status', 'canceled', 'reason', 'source_schedule_changed'
        );
      elsif not (pg_catalog.clock_timestamp() < v_appointment.scheduled_at) then
        v_revalidation := pg_catalog.jsonb_build_object(
          'ok', false, 'status', 'failed', 'reason', 'retry_window_closed'
        );
      else
        v_revalidation := pg_catalog.jsonb_build_object('ok', true);
      end if;
    end if;
  else
    v_revalidation := public.revalidate_immediate_notification_delivery_v1(
      p_workflow_key, p_event_id, p_delivery_id, p_event_key, p_source_type,
      p_source_id, p_source_revision, p_rule_id, p_rule_revision,
      p_target_generation, p_scheduled_for, p_target
    );
  end if;

  if coalesce((v_revalidation ->> 'ok')::boolean, false)
    and p_workflow_key = 'registration'
    and v_delivery.audience_key = 'track_director'
    and (
      v_delivery.target_profile_id is null
      or not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = v_parent_uuid
          and track.director_profile_id = v_delivery.target_profile_id
          and dashboard_private.is_active_subject_director(
            v_delivery.target_profile_id,
            track.subject
          )
          and (
            (
              p_source_type = 'registration_appointment'
              and track.id = any(v_track_ids)
            )
            or (
              p_source_type = 'ops_task_event'
              and track.id::text = (v_event.payload ->> 'track_id')
            )
          )
      )
    )
  then
    v_revalidation := pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
    );
  end if;

  if coalesce((v_revalidation ->> 'ok')::boolean, false) is not true then
    v_status := v_revalidation ->> 'status';
    v_reason := v_revalidation ->> 'reason';
    if v_status not in ('failed', 'canceled', 'skipped')
      or nullif(pg_catalog.btrim(v_reason), '') is null
    then
      raise exception 'notification_revalidation_envelope_invalid' using errcode = '55000';
    end if;
    perform public.finalize_notification_delivery_v1(
      p_delivery_id, p_claim_token, v_status, v_reason,
      null, null, case when v_status = 'failed' then v_reason else null end,
      case when v_status = 'failed' then 'authoritative revalidation failed' else null end,
      null
    );
    return pg_catalog.jsonb_build_object(
      'prepared', false, 'delivery_id', p_delivery_id,
      'status', v_status, 'status_reason', v_reason
    );
  end if;

  if v_delivery.channel_key = 'in_app' then
    return public.commit_notification_in_app_delivery_v1(
      p_delivery_id, p_claim_token
    ) || pg_catalog.jsonb_build_object('prepared', true);
  end if;
  return public.begin_notification_delivery_send_v1(
    p_delivery_id, p_claim_token
  ) || pg_catalog.jsonb_build_object('prepared', true);
exception
  when invalid_text_representation then
    raise exception 'notification_delivery_prepare_invalid' using errcode = '22023';
end;
$$;

-- Recreated worker functions retain the active owner, sealed ACL, and empty search path.
alter function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) owner to postgres;
alter function public.begin_notification_delivery_send_v1(uuid, uuid)
  owner to postgres;

-- Recreated private functions retain their existing owner and sealed grants.
revoke all on function dashboard_private.notification_google_chat_audience_ready_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.replace_google_chat_connection_v1_impl(
  uuid, text, text, text, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.disconnect_google_chat_connection_v1_impl(
  uuid, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.begin_google_chat_connection_verification_v1_impl(
  uuid, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_google_chat_connection_verification_v1_impl(
  uuid, text, boolean, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_connection_safe_json_v1(
  public.google_chat_webhook_settings, boolean
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_notification_control_plane_unchecked_v1(
  text, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) from public, anon, authenticated;
revoke all on function public.begin_notification_delivery_send_v1(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) to service_role;
grant execute on function public.begin_notification_delivery_send_v1(uuid, uuid)
  to service_role;

commit;
