begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.read_registration_customer_message_preview_target_v1(
  p_actor_profile_id uuid,
  p_preview_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview public.ops_registration_customer_message_previews%rowtype;
  v_source_id uuid;
begin
  select preview.*
  into v_preview
  from public.ops_registration_customer_message_previews preview
  where preview.id = p_preview_id;

  if not found then
    raise exception 'registration_customer_message_preview_not_found'
      using errcode = 'P0002';
  end if;
  if v_preview.created_by <> p_actor_profile_id then
    raise exception 'registration_customer_message_preview_owner_mismatch'
      using errcode = '42501';
  end if;

  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_preview.task_id,
    'send'
  );

  v_source_id := case
    when v_preview.appointment_id is not null then v_preview.appointment_id
    when v_preview.track_id is not null then v_preview.track_id
    else v_preview.task_id
  end;

  return pg_catalog.jsonb_build_object(
    'taskId', v_preview.task_id,
    'messageKind', v_preview.message_kind,
    'sourceId', v_source_id
  );
end;
$$;

alter function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  to service_role;

commit;
