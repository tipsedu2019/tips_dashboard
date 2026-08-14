begin;

create function public.list_current_registration_observation_customer_messages_v1(
  p_actor_profile_id uuid,
  p_task_id uuid,
  p_message_kind text,
  p_observation_id uuid,
  p_source_revision integer,
  p_source_fingerprint text,
  p_recipient_hash text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor_role text;
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  if p_message_kind not in ('observation_booking', 'observation_reminder')
    or p_task_id is null
    or p_observation_id is null
    or p_source_revision is null
    or p_source_revision < 1
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[0-9a-f]{64}$'
    or p_recipient_hash is null
    or p_recipient_hash !~ '^[0-9a-f]{64}$'
    or p_limit is null
    or p_limit < 1
    or p_limit > 50 then
    raise exception 'registration_customer_message_history_input_invalid'
      using errcode = '22023';
  end if;

  v_actor_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    p_task_id,
    'history'
  );
  perform 1
  from public.ops_registration_observations observation
  where observation.id = p_observation_id
    and observation.task_id = p_task_id;
  if not found then
    raise exception 'registration_customer_message_source_not_found' using errcode = 'P0002';
  end if;

  if v_actor_role in ('admin', 'staff') then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'messageId', message.id,
        'messageKind', message.message_kind,
        'currentStatus', message.status,
        'confirmedByName', case
          when message.delivery_origin = 'scheduled' then '자동 발송'
          else coalesce(nullif(pg_catalog.btrim(profile.name), ''), '담당자')
        end,
        'confirmedAt', message.confirmed_at,
        'updatedAt', message.updated_at,
        'recipientLast4', message.recipient_last4,
        'canCheck', (
          message.delivery_origin = 'manual'
          and message.provider_attempt_count = 1
          and message.provider_attempt_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
          and message.status in ('pending', 'unknown')
        )
      ) order by message.created_at desc, message.id desc
    ), '[]'::jsonb)
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = p_task_id
        and outbox.observation_id = p_observation_id
        and outbox.message_kind = p_message_kind
        and outbox.source_revision = p_source_revision
        and outbox.source_fingerprint = p_source_fingerprint
        and outbox.recipient_hash = p_recipient_hash
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message
    left join public.profiles profile on profile.id = message.confirmed_by;
  else
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'messageKind', message.message_kind,
        'currentStatus', message.status,
        'confirmedByName', case
          when message.delivery_origin = 'scheduled' then '자동 발송'
          else coalesce(nullif(pg_catalog.btrim(profile.name), ''), '담당자')
        end,
        'confirmedAt', message.confirmed_at,
        'updatedAt', message.updated_at
      ) order by message.created_at desc, message.id desc
    ), '[]'::jsonb)
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = p_task_id
        and outbox.observation_id = p_observation_id
        and outbox.message_kind = p_message_kind
        and outbox.source_revision = p_source_revision
        and outbox.source_fingerprint = p_source_fingerprint
        and outbox.recipient_hash = p_recipient_hash
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message
    left join public.profiles profile on profile.id = message.confirmed_by;
  end if;
  return v_result;
end;
$$;

alter function public.list_current_registration_observation_customer_messages_v1(
  uuid, uuid, text, uuid, integer, text, text, integer
) owner to postgres;
revoke all on function public.list_current_registration_observation_customer_messages_v1(
  uuid, uuid, text, uuid, integer, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_current_registration_observation_customer_messages_v1(
  uuid, uuid, text, uuid, integer, text, text, integer
) to service_role;

commit;
