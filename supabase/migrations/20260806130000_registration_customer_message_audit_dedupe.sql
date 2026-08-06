begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if exists (
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind in (
      'level_test_booking',
      'visit_consultation_booking',
      'appointment_reminder'
    )
    group by message.appointment_id, message.message_kind, message.source_revision
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_customer_message_appointment_duplicate_preflight_failed'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind = 'waiting_notice'
    group by message.track_id, message.message_kind
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_customer_message_waiting_duplicate_preflight_failed'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind = 'admission_application'
    group by message.task_id, message.message_kind
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_customer_message_admission_duplicate_preflight_failed'
      using errcode = '23505';
  end if;
end
$$;

create unique index ops_reg_customer_msg_appointment_once_idx
  on public.ops_registration_customer_messages (
    appointment_id,
    message_kind,
    source_revision
  )
  where message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder'
  );

create unique index ops_reg_customer_msg_waiting_once_idx
  on public.ops_registration_customer_messages (track_id, message_kind)
  where message_kind = 'waiting_notice';

create unique index ops_reg_customer_msg_admission_once_idx
  on public.ops_registration_customer_messages (task_id, message_kind)
  where message_kind = 'admission_application';

alter function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) rename to registration_customer_message_result_legacy_v1;

revoke all on function dashboard_private.registration_customer_message_result_legacy_v1(
  uuid, boolean, boolean, boolean
) from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_result_v1(
  p_message_id uuid,
  p_owner boolean,
  p_idempotent boolean,
  p_include_tokens boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_result jsonb;
  v_confirmed_by_name text;
begin
  v_result := dashboard_private.registration_customer_message_result_legacy_v1(
    p_message_id,
    p_owner,
    p_idempotent,
    p_include_tokens
  );

  select coalesce(
    nullif(pg_catalog.btrim(profile.name), ''),
    case profile.role
      when 'admin' then '관리자'
      when 'staff' then '운영팀'
      when 'teacher' then '담당 선생님'
      when 'assistant' then '보조 담당자'
      else '담당자'
    end
  )
  into v_confirmed_by_name
  from public.ops_registration_customer_messages message
  join public.profiles profile on profile.id = message.confirmed_by
  where message.id = p_message_id;

  if v_confirmed_by_name is null then
    raise exception 'registration_customer_message_actor_not_found'
      using errcode = 'P0002';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'confirmedByName', v_confirmed_by_name
  );
end;
$$;

alter function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) owner to postgres;
revoke all on function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) from public, anon, authenticated, service_role;

alter function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) rename to registration_customer_solapi_readiness_legacy_v1;

alter function public.registration_customer_solapi_readiness_legacy_v1(
  uuid, text, uuid, jsonb
) set schema dashboard_private;

revoke all on function dashboard_private.registration_customer_solapi_readiness_legacy_v1(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.get_registration_customer_solapi_readiness_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_template_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_readiness jsonb;
  v_source jsonb;
  v_duplicate_locked boolean := false;
  v_blockers jsonb;
begin
  v_readiness := dashboard_private.registration_customer_solapi_readiness_legacy_v1(
    p_actor_profile_id,
    p_message_kind,
    p_source_id,
    p_template_contract
  );

  if coalesce((v_readiness ->> 'sourceValid')::boolean, false) then
    v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
      p_message_kind,
      p_source_id
    );

    select exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.message_kind = p_message_kind
        and (
          (
            p_message_kind in (
              'level_test_booking',
              'visit_consultation_booking',
              'appointment_reminder'
            )
            and message.appointment_id = p_source_id
            and message.source_revision = nullif(v_source ->> 'sourceRevision', '')::bigint
          )
          or (
            p_message_kind = 'waiting_notice'
            and message.track_id = p_source_id
          )
          or (
            p_message_kind = 'admission_application'
            and message.task_id = p_source_id
          )
        )
    ) into v_duplicate_locked;
  end if;

  v_blockers := coalesce(v_readiness -> 'blockers', '[]'::jsonb)
    - 'duplicate_locked';
  if v_duplicate_locked then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('duplicate_locked');
  end if;

  v_readiness := pg_catalog.jsonb_set(
    v_readiness,
    array['blockers']::text[],
    v_blockers,
    true
  );
  return pg_catalog.jsonb_set(
    v_readiness,
    array['sendAllowed']::text[],
    pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_blockers) = 0),
    true
  );
end;
$$;

alter function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) owner to postgres;
revoke all on function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) to service_role;

create or replace function public.list_registration_customer_messages_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_actor_role text;
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'registration_customer_message_limit_invalid'
      using errcode = '22023';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );
  v_actor_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_task_id,
    'history'
  );

  if v_actor_role in ('admin', 'staff') then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageId', message.id,
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedByName', message.confirmed_by_name,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at,
          'recipientLast4', message.recipient_last4,
          'canCheck', (
            message.provider_attempt_count = 1
            and message.provider_attempt_started_at
              <= pg_catalog.clock_timestamp() - interval '15 minutes'
            and message.status in ('pending', 'unknown')
          )
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    )
    into v_result
    from (
      select outbox.*,
        coalesce(
          nullif(pg_catalog.btrim(profile.name), ''),
          case profile.role
            when 'admin' then '관리자'
            when 'staff' then '운영팀'
            when 'teacher' then '담당 선생님'
            when 'assistant' then '보조 담당자'
            else '담당자'
          end
        ) as confirmed_by_name
      from public.ops_registration_customer_messages outbox
      join public.profiles profile on profile.id = outbox.confirmed_by
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  else
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedByName', message.confirmed_by_name,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    )
    into v_result
    from (
      select outbox.*,
        coalesce(
          nullif(pg_catalog.btrim(profile.name), ''),
          case profile.role
            when 'admin' then '관리자'
            when 'staff' then '운영팀'
            when 'teacher' then '담당 선생님'
            when 'assistant' then '보조 담당자'
            else '담당자'
          end
        ) as confirmed_by_name
      from public.ops_registration_customer_messages outbox
      join public.profiles profile on profile.id = outbox.confirmed_by
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  end if;
  return v_result;
end;
$$;

alter function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) owner to postgres;
revoke all on function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) to service_role;

commit;
