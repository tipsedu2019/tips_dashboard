begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Past receipts belong to the registration case, independently of the current
-- appointment, subject, or workflow status. This read must never prepare a send.
create function public.list_registration_case_customer_messages_v1(
  p_actor_profile_id uuid,
  p_task_id uuid,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_role text;
  v_count integer;
  v_history jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    or dashboard_private.registration_actor_is_active_manager_v1(p_actor_profile_id) is not true
  then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  if p_page is null or p_page not between 1 and 100000
    or p_page_size is null or p_page_size not in (10, 15, 20)
  then
    raise exception 'registration_customer_message_history_page_invalid'
      using errcode = '22023';
  end if;

  v_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, p_task_id, 'history'
  );
  if v_role not in ('admin', 'staff') then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.ops_registration_customer_messages message
  where message.task_id = p_task_id;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'messageId', message.id,
      'messageKind', message.message_kind,
      'currentStatus', message.status,
      'confirmedByName', case
        when message.delivery_origin = 'scheduled' then '자동 발송'
        else coalesce(nullif(pg_catalog.btrim(profile.name), ''), '담당자')
      end,
      'confirmedAt', message.confirmed_at,
      'updatedAt', message.updated_at,
      'recipientLast4', case
        when message.recipient_last4 ~ '^[0-9]{4}$' then message.recipient_last4
        else null
      end,
      'canCheck', coalesce(
        message.delivery_origin = 'manual'
        and message.provider_attempt_count = 1
        and message.provider_attempt_started_at <= pg_catalog.now() - interval '15 minutes'
        and message.status in ('pending', 'unknown'), false
      ),
      'canCheckDelivery', coalesce(
        message.status = 'accepted'
        and message.provider_attempt_count = 1
        and nullif(pg_catalog.btrim(message.provider_message_id), '') is not null,
        false
      )
    )) order by message.created_at desc, message.id desc
  ), '[]'::jsonb) into v_history
  from (
    select outbox.id, outbox.message_kind, outbox.status, outbox.delivery_origin,
      outbox.confirmed_by, outbox.confirmed_at, outbox.updated_at,
      outbox.recipient_last4, outbox.provider_attempt_count,
      outbox.provider_attempt_started_at, outbox.provider_message_id, outbox.created_at
    from public.ops_registration_customer_messages outbox
    where outbox.task_id = p_task_id
    order by outbox.created_at desc, outbox.id desc
    limit p_page_size offset ((p_page - 1) * p_page_size)
  ) message
  left join public.profiles profile on profile.id = message.confirmed_by;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'page', p_page,
    'pageSize', p_page_size,
    'totalCount', v_count,
    'history', v_history
  );
end;
$$;

alter function public.list_registration_case_customer_messages_v1(uuid, uuid, integer, integer)
  owner to postgres;
revoke all on function public.list_registration_case_customer_messages_v1(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_registration_case_customer_messages_v1(uuid, uuid, integer, integer)
  to service_role;

comment on function public.list_registration_case_customer_messages_v1(uuid, uuid, integer, integer)
  is 'Read-only, masked, paginated registration case receipts, including canceled and previous appointments. Never resolves current send readiness.';

-- Configuration evidence only: a receipt is not a current provider preflight,
-- and activation is not a promise that a particular recipient can be sent to.
create function public.get_registration_customer_guidance_settings_v1(p_actor_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_result jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    or dashboard_private.registration_actor_is_active_manager_v1(p_actor_profile_id) is not true
  then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'messageKind', kind.name,
    'mode', coalesce(activation.mode, 'off'),
    'templateVerifiedAt', case when receipt.provider_status = 'sendable'
      and receipt.catalog_checksum = receipt.provider_checksum then receipt.verified_at else null end
  ) order by kind.ordinal) into v_result
  from (values
    (1, 'level_test_booking'), (2, 'visit_consultation_booking'),
    (3, 'observation_booking'), (4, 'waiting_notice'), (5, 'admission_application')
  ) kind(ordinal, name)
  left join dashboard_private.registration_customer_solapi_activation activation on activation.message_kind = kind.name
  left join dashboard_private.registration_customer_solapi_template_receipts receipt on receipt.message_kind = kind.name;
  return v_result;
end;
$$;

alter function public.get_registration_customer_guidance_settings_v1(uuid) owner to postgres;
revoke all on function public.get_registration_customer_guidance_settings_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_guidance_settings_v1(uuid) to service_role;

commit;
