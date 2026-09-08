begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The server may inspect a previously accepted delivery without releasing the
-- send lock or touching registration/admission state. Provider identities never
-- enter the browser response. Automatic reminder producers remain retired.
create function public.read_registration_customer_message_delivery_context_v1(
  p_actor_profile_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_message.task_id, 'send'
  );
  if v_message.status is distinct from 'accepted'
    or v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null
    or nullif(pg_catalog.btrim(v_message.provider_message_id), '') is null
  then
    raise exception 'registration_customer_message_delivery_check_not_allowed' using errcode = '23514';
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'providerMessageId', v_message.provider_message_id,
    'providerGroupId', v_message.provider_group_id,
    'requestKey', v_message.request_key
  ));
end;
$$;

alter function public.read_registration_customer_message_delivery_context_v1(uuid, uuid) owner to postgres;
revoke all on function public.read_registration_customer_message_delivery_context_v1(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_message_delivery_context_v1(uuid, uuid) to service_role;
commit;
