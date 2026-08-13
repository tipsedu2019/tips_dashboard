begin;

create or replace function public.create_textbook_request_v1(
  p_textbook_id uuid,
  p_requested_textbook_title text,
  p_class_id uuid,
  p_location_id uuid,
  p_student_requested_quantity integer,
  p_teacher_requested_quantity integer,
  p_memo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(public.current_dashboard_role(), '');
  v_requester_name text;
  v_order public.textbook_purchase_orders%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_actor_id is null or v_role not in ('admin', 'staff', 'teacher') then
    raise exception 'textbook_request_access_denied' using errcode = '42501';
  end if;

  if nullif(btrim(p_requested_textbook_title), '') is null then
    raise exception 'textbook_request_title_required' using errcode = '22023';
  end if;

  if greatest(coalesce(p_student_requested_quantity, 0), 0)::bigint
    + greatest(coalesce(p_teacher_requested_quantity, 0), 0)::bigint <= 0 then
    raise exception 'textbook_request_quantity_required' using errcode = '22023';
  end if;

  select nullif(btrim(teacher_catalogs.name), '')
  into v_requester_name
  from public.teacher_catalogs
  where teacher_catalogs.profile_id = v_actor_id
    and teacher_catalogs.is_visible
  limit 1;

  if v_requester_name is null then
    select nullif(btrim(profiles.name), '')
    into v_requester_name
    from public.profiles
    where profiles.id = v_actor_id;
  end if;

  v_requester_name := coalesce(
    v_requester_name,
    nullif(btrim(auth.jwt() ->> 'email'), ''),
    v_actor_id::text
  );

  insert into public.textbook_purchase_orders (status, requested_by, created_by)
  values ('requested', v_requester_name, v_actor_id)
  returning * into v_order;

  if greatest(coalesce(p_student_requested_quantity, 0), 0) > 0 then
    insert into public.textbook_purchase_order_lines (
      purchase_order_id,
      textbook_id,
      requested_textbook_title,
      class_id,
      location_id,
      requested_quantity,
      ordered_quantity, received_quantity,
      memo,
      copy_scope
    )
    values (
      v_order.id,
      p_textbook_id,
      btrim(p_requested_textbook_title),
      p_class_id,
      p_location_id,
      greatest(coalesce(p_student_requested_quantity, 0), 0),
      0, 0,
      coalesce(p_memo, ''),
      'student'
    );
  end if;

  if greatest(coalesce(p_teacher_requested_quantity, 0), 0) > 0 then
    insert into public.textbook_purchase_order_lines (
      purchase_order_id,
      textbook_id,
      requested_textbook_title,
      class_id,
      location_id,
      requested_quantity,
      ordered_quantity, received_quantity,
      memo,
      copy_scope
    )
    values (
      v_order.id,
      p_textbook_id,
      btrim(p_requested_textbook_title),
      p_class_id,
      p_location_id,
      greatest(coalesce(p_teacher_requested_quantity, 0), 0),
      0, 0,
      coalesce(p_memo, ''),
      'teacher'
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(lines)), '[]'::jsonb)
  into v_lines
  from public.textbook_purchase_order_lines as lines
  where lines.purchase_order_id = v_order.id;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'lines', v_lines
  );
end;
$$;

alter function public.create_textbook_request_v1(uuid, text, uuid, uuid, integer, integer, text) owner to postgres;
revoke all on function public.create_textbook_request_v1(uuid, text, uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.create_textbook_request_v1(uuid, text, uuid, uuid, integer, integer, text) to authenticated;

notify pgrst, 'reload schema';

commit;
