begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.finalize_registration_customer_reminder_dispatch_v1(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb,
  p_provider_payload_checksum text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_result jsonb;
  v_stored_checksum text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  if p_result = 'accepted'
    and (
      p_provider_payload_checksum is null
      or p_provider_payload_checksum !~ '^[a-f0-9]{64}$'
    )
  then
    raise exception 'registration_customer_reminder_finalize_invalid'
      using errcode = '22023';
  end if;
  if p_provider_payload_checksum is not null
    and p_provider_payload_checksum !~ '^[a-f0-9]{64}$'
  then
    raise exception 'registration_customer_reminder_finalize_invalid'
      using errcode = '22023';
  end if;

  v_result := public.finalize_registration_customer_reminder_dispatch_v1(
    p_message_id,
    p_dispatch_token,
    p_result,
    p_provider_result
  );

  if p_provider_payload_checksum is not null then
    update public.ops_registration_customer_messages message
    set provider_payload_checksum = p_provider_payload_checksum,
        updated_at = pg_catalog.clock_timestamp()
    where message.id = p_message_id
      and message.delivery_origin = 'scheduled'
      and message.dispatch_token = p_dispatch_token
      and message.provider_attempt_count = 1
      and message.status = p_result
      and message.provider_payload_checksum is null;

    select message.provider_payload_checksum
    into v_stored_checksum
    from public.ops_registration_customer_messages message
    where message.id = p_message_id
      and message.delivery_origin = 'scheduled'
      and message.dispatch_token = p_dispatch_token
      and message.provider_attempt_count = 1;
    if not found or v_stored_checksum is distinct from p_provider_payload_checksum then
      raise exception 'registration_customer_reminder_finalize_not_allowed'
        using errcode = '40001';
    end if;
  end if;

  return v_result;
end;
$$;

alter function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb, text
) owner to postgres;
revoke all on function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb, text
) to service_role;

revoke execute on function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb
) from service_role;

commit;
