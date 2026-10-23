-- Local candidate: approved teacher read-only and assistant word-retest scope.
-- No business rows are rewritten. Existing function ACL/owner/config are retained.
-- This candidate is incomplete until safe references and common teacher reads pass.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

CREATE OR REPLACE FUNCTION dashboard_private.ai_agent_require_user_v1()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=actor and p.role in('admin','staff','teacher') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
  raise exception using errcode='42501',message='ai_agent_forbidden';
 end if;
 return actor;
end$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.ai_agent_lock_user_v1(p_admin boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ai_actor_role text;
begin
 if actor is null then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 select p.role into ai_actor_role from public.profiles p where p.id=actor for update;
 if not found or ai_actor_role is null or ai_actor_role not in('admin','staff','teacher') or (p_admin and ai_actor_role<>'admin') then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 return actor;
end$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.ai_agent_can_read_v1(p_requester uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role in('admin','staff','teacher') and (p.id=p_requester or p.role='admin') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.can_read_ops_task_v1(p_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
begin
  if p_task_id is null or v_actor is null then
    return false;
  end if;

  return exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and (v_role is distinct from 'assistant' or task.type = 'word_retest')
      and (
        v_role in ('admin', 'staff', 'assistant')
        or task.requested_by = v_actor
        or task.assignee_id = v_actor
        or task.secondary_assignee_id = v_actor
        or dashboard_private.is_ops_word_retest_teacher(task.id)
      )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.assert_ops_task_actor_v2(p_task ops_tasks DEFAULT NULL::ops_tasks, p_requested_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles profile where profile.id = v_actor
  ) then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  -- Decisive write scope before owner/assignee fallbacks or mutation replay.
  if p_task.id is not null and (
    (v_role = 'assistant' and p_task.type is distinct from 'word_retest')
    or (v_role = 'teacher' and p_task.type in ('registration','transfer','withdrawal'))
  ) then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  if p_task.id is not null
    and coalesce(v_role, '') not in ('admin', 'staff', 'assistant')
    and v_actor is distinct from p_task.requested_by
    and v_actor is distinct from p_task.assignee_id
    and v_actor is distinct from p_task.secondary_assignee_id
    and not dashboard_private.is_ops_word_retest_teacher(p_task.id)
  then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  if p_task.id is null
    and p_requested_by is not null
    and p_requested_by <> v_actor
    and coalesce(v_role, '') not in ('admin', 'staff', 'assistant')
  then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.create_ops_task_v2_impl(p_input jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := dashboard_private.assert_ops_task_actor_v2(null, null);
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'input', p_input
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail jsonb;
  v_source jsonb;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object' or p_request_id is null then
    raise exception 'ops_task_input_invalid' using errcode = '22023';
  end if;
  -- Use the same canonical nested/legacy shape and trim as the insert boundary.
  -- An outer type must never override the actual task type, including replay.
  if (public.current_dashboard_role() = 'assistant' and nullif(pg_catalog.btrim(dashboard_private.ops_task_input_task_v2(p_input)->>'type'),'') is distinct from 'word_retest')
    or (public.current_dashboard_role() = 'teacher' and nullif(pg_catalog.btrim(dashboard_private.ops_task_input_task_v2(p_input)->>'type'),'') in ('registration','transfer','withdrawal')) then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'create_ops_task_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'false', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_task := dashboard_private.insert_ops_task_from_json_v2(p_input, v_actor);
  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, v_task.type);
  perform dashboard_private.upsert_ops_task_detail_v2(v_task.id, v_task.type, v_detail);

  if v_task.type = 'transfer' then
    v_source := dashboard_private.record_ops_transition_notification_source_v1(
      v_task, 'transfer.submitted', p_request_id
    );
  elsif v_task.type = 'withdrawal' then
    v_source := dashboard_private.record_ops_transition_notification_source_v1(
      v_task, 'withdrawal.submitted', p_request_id
    );
  elsif v_task.type = 'general' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'task.created', p_request_id, 'type', null, v_task.type
    );
  elsif v_task.type = 'word_retest' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'word_retest.created', p_request_id, 'type', null, v_task.type,
      pg_catalog.jsonb_build_object(
        'test_at', v_detail ->> 'test_at',
        'retest_status', coalesce(nullif(v_detail ->> 'retest_status', ''), 'not_started')
      )
    );
  end if;

  if v_source is not null then
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;
  v_response := pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', v_source_event_ids
  );
  perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', '', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', '', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'create_ops_task_v2', v_fingerprint, v_response
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_textbook_request_v1(p_textbook_id uuid, p_requested_textbook_title text, p_class_id uuid, p_location_id uuid, p_student_requested_quantity integer, p_teacher_requested_quantity integer, p_memo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(public.current_dashboard_role(), '');
  v_requester_name text;
  v_order public.textbook_purchase_orders%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_actor_id is null or v_role not in ('admin', 'staff') then
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
$function$
;

-- Reuse the existing canonical/legacy in-app projection identity. A metadata
-- workflow tag alone is not proof that an alert belongs to the retest workflow.
create function dashboard_private.can_read_word_retest_notification_v1(p_id uuid,p_profile_id uuid) returns boolean
language sql stable security definer set search_path=''
as $function$
 select p_profile_id is not null and p_profile_id=auth.uid() and exists(
  select 1 from public.dashboard_notifications n
  join dashboard_private.notification_deliveries d on d.id=n.source_delivery_id
  join dashboard_private.notification_events e on e.id=d.event_id
  where n.id=p_id and n.recipient_profile_id=p_profile_id
   and d.target_profile_id=p_profile_id and d.channel_key='in_app'
   and e.workflow_key='word_retests' and n.type='notification_control_plane'
   and n.actor_profile_id is not distinct from e.actor_profile_id
   and n.title is not distinct from d.rendered_title
   and n.body is not distinct from d.rendered_body
   and n.href is not distinct from d.href
   and n.metadata @> jsonb_build_object('workflow_key',e.workflow_key,'event_key',e.event_key,'source_type',e.source_type,'source_id',e.source_id,'delivery_id',d.id)
   and n.metadata-array['workflow_key','event_key','source_type','source_id','delivery_id','legacy_projection']::text[]='{}'::jsonb
   and (not(n.metadata ? 'legacy_projection') or n.metadata->'legacy_projection'='true'::jsonb)
 )
$function$;
alter function dashboard_private.can_read_word_retest_notification_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.can_read_word_retest_notification_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function dashboard_private.can_read_word_retest_notification_v1(uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION dashboard_private.visible_dashboard_notification_rows_v1(p_profile_id uuid)
 RETURNS TABLE(id uuid, recipient_profile_id uuid, recipient_team text, actor_profile_id uuid, notification_type text, title text, body text, href text, metadata jsonb, legacy_read_at timestamp with time zone, receipt_read_at timestamp with time zone, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and notification.type <> 'registration_consultation_admin_chat'
    and (
      not exists (select 1 from public.profiles profile where profile.id=p_profile_id and profile.role='assistant')
      or dashboard_private.can_read_word_retest_notification_v1(notification.id,p_profile_id)
    )
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
$function$
;

-- Restrictive policies compose with every existing permissive policy.
create policy ops_tasks_assistant_word_retest_only_v1 on public.ops_tasks as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant' or type='word_retest')
with check ((select public.current_dashboard_role()) is distinct from 'assistant' or type='word_retest');
create policy dashboard_notifications_assistant_word_retest_only_v1 on public.dashboard_notifications as restrictive for select to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant' or dashboard_private.can_read_word_retest_notification_v1(id,(select auth.uid())));
-- Preserve own identity/profile reads and account settings. Only role escalation
-- by the restricted actor is denied; staff/admin/viewer retain existing rules.
create policy profiles_restricted_role_immutability_v1 on public.profiles as restrictive for update to authenticated
using (true)
with check (case (select public.current_dashboard_role()) when 'assistant' then role='assistant' when 'teacher' then role='teacher' else true end);

create policy students_assistant_word_retest_scope_v1 on public.students as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy classes_assistant_word_retest_scope_v1 on public.classes as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy teacher_catalogs_assistant_word_retest_scope_v1 on public.teacher_catalogs as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_curriculum_profiles_assistant_word_retest_scope_v1 on public.academic_curriculum_profiles as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_event_exam_details_assistant_word_retest_scope_v1 on public.academic_event_exam_details as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_events_assistant_word_retest_scope_v1 on public.academic_events as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_exam_days_assistant_word_retest_scope_v1 on public.academic_exam_days as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_exam_material_items_assistant_word_retest_scope_v1 on public.academic_exam_material_items as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_exam_material_plans_assistant_word_retest_scope_v1 on public.academic_exam_material_plans as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_exam_scopes_assistant_word_retest_scope_v1 on public.academic_exam_scopes as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_schools_assistant_word_retest_scope_v1 on public.academic_schools as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academic_supplement_materials_assistant_word_retest_scope_v1 on public.academic_supplement_materials as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academy_curriculum_materials_assistant_word_retest_scope_v1 on public.academy_curriculum_materials as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academy_curriculum_period_catalogs_assistant_word_retest_scope_v1 on public.academy_curriculum_period_catalogs as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academy_curriculum_period_items_assistant_word_retest_scope_v1 on public.academy_curriculum_period_items as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academy_curriculum_period_plans_assistant_word_retest_scope_v1 on public.academy_curriculum_period_plans as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy academy_curriculum_plans_assistant_word_retest_scope_v1 on public.academy_curriculum_plans as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy class_lesson_sessions_assistant_word_retest_scope_v1 on public.class_lesson_sessions as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy class_schedule_slots_assistant_word_retest_scope_v1 on public.class_schedule_slots as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy class_schedule_sync_group_members_assistant_word_retest_scope_v1 on public.class_schedule_sync_group_members as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy class_schedule_sync_groups_assistant_word_retest_scope_v1 on public.class_schedule_sync_groups as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy progress_logs_assistant_word_retest_scope_v1 on public.progress_logs as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy class_terms_assistant_word_retest_scope_v1 on public.class_terms as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy classroom_catalogs_assistant_word_retest_scope_v1 on public.classroom_catalogs as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_inventory_locations_assistant_word_retest_scope_v1 on public.textbook_inventory_locations as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_makeedu_payment_imports_assistant_word_retest_scope_v1 on public.textbook_makeedu_payment_imports as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_monthly_closings_assistant_word_retest_scope_v1 on public.textbook_monthly_closings as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_publisher_supplier_links_assistant_word_retest_scope_v1 on public.textbook_publisher_supplier_links as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_publishers_assistant_word_retest_scope_v1 on public.textbook_publishers as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_purchase_order_lines_assistant_word_retest_scope_v1 on public.textbook_purchase_order_lines as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_purchase_orders_assistant_word_retest_scope_v1 on public.textbook_purchase_orders as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_sale_lines_assistant_word_retest_scope_v1 on public.textbook_sale_lines as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_sales_assistant_word_retest_scope_v1 on public.textbook_sales as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_stock_counts_assistant_word_retest_scope_v1 on public.textbook_stock_counts as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_stock_moves_assistant_word_retest_scope_v1 on public.textbook_stock_moves as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_sub_subject_settings_assistant_word_retest_scope_v1 on public.textbook_sub_subject_settings as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_supplier_links_assistant_word_retest_scope_v1 on public.textbook_supplier_links as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbook_suppliers_assistant_word_retest_scope_v1 on public.textbook_suppliers as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy textbooks_assistant_word_retest_scope_v1 on public.textbooks as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy student_class_enrollment_history_assistant_word_retest_scope_v1 on public.student_class_enrollment_history as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');

create policy ops_registration_observations_assistant_word_retest_scope_v1 on public.ops_registration_observations as restrictive for all to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant')
with check ((select public.current_dashboard_role()) is distinct from 'assistant');


create function dashboard_private.assert_ops_task_write_scope_v1(p_task_id uuid) returns void
language plpgsql stable security definer set search_path='' as $function$
declare actor_role text:=public.current_dashboard_role(); task_row public.ops_tasks%rowtype;
begin
 if actor_role not in ('teacher','assistant') then return;end if;
 select task.* into task_row from public.ops_tasks task where task.id=p_task_id;
 if not found then raise exception 'ops_task_access_denied' using errcode='42501';end if;
 perform dashboard_private.assert_ops_task_actor_v2(task_row,null);
end $function$;
alter function dashboard_private.assert_ops_task_write_scope_v1(uuid) owner to postgres;
revoke all on function dashboard_private.assert_ops_task_write_scope_v1(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.update_ops_task_v2_impl(p_task_id uuid, p_input jsonb, p_expected_updated_at timestamp with time zone, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'input', p_input,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay jsonb;
  v_before public.ops_tasks%rowtype;
  v_after public.ops_tasks%rowtype;
  v_before_word public.ops_word_retests%rowtype;
  v_after_word public.ops_word_retests%rowtype;
  v_task_input jsonb;
  v_detail jsonb;
  v_detail_base jsonb := '{}'::jsonb;
  v_source jsonb;
  v_activity jsonb;
  v_activity_event_id uuid;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_event_key text;
  v_response jsonb;
begin
  if p_task_id is null or p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_expected_updated_at is null or p_request_id is null
  then
    raise exception 'ops_task_update_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'update_ops_task_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_before
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_before, null);
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'ops_task_stale_write' using errcode = '40001';
  end if;
  if v_before.type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;

  v_task_input := dashboard_private.ops_task_input_task_v2(p_input);
  if nullif(v_task_input ->> 'type', '') is not null
    and (v_task_input ->> 'type') <> v_before.type
  then
    raise exception 'ops_task_type_change_forbidden' using errcode = '22023';
  end if;
  if v_before.type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_before.type in ('transfer', 'withdrawal') then
    if v_before.status = 'done' then
      raise exception 'ops_transition_closed' using errcode = '40001';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'done' then
      raise exception 'ops_transition_completion_rpc_required' using errcode = '22023';
    end if;
    perform pg_catalog.set_config(
      'app.ops_transition_request_id', p_request_id::text, true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', 'false', true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_defer_details', 'true', true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', 'false', true
    );
  end if;
  if v_before.type = 'word_retest' then
    select detail.* into v_before_word
    from public.ops_word_retests detail
    where detail.task_id = p_task_id
    for update of detail;
    if not found then raise exception 'word_retest_not_found' using errcode = 'P0002'; end if;
    v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest');
    if not (
      v_before.status = 'in_progress'
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'in_progress'
      and v_before_word.retest_status = 'in_progress'
    ) and (
      (case when v_detail ? 'first_score' then nullif(v_detail ->> 'first_score', '')::numeric else v_before_word.first_score end)
        is distinct from v_before_word.first_score
      or (case when v_detail ? 'second_score' then nullif(v_detail ->> 'second_score', '')::numeric else v_before_word.second_score end)
        is distinct from v_before_word.second_score
      or (case when v_detail ? 'third_score' then nullif(v_detail ->> 'third_score', '')::numeric else v_before_word.third_score end)
        is distinct from v_before_word.third_score
      or (case when v_detail ? 'score_out_of_100' then nullif(v_detail ->> 'score_out_of_100', '')::numeric else v_before_word.score_out_of_100 end)
        is distinct from v_before_word.score_out_of_100
    ) then
      raise exception 'word_retest_score_update_not_allowed' using errcode = '40001';
    end if;
    if v_before.status in ('done', 'canceled')
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) <> v_before.status
    then
      raise exception 'word_retest_closed' using errcode = '40001';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'review_requested'
      and v_before.status <> 'review_requested'
    then
      raise exception 'word_retest_result_rpc_required' using errcode = '22023';
    end if;
    if v_before.status = 'review_requested'
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status)
        not in ('review_requested', 'done', 'canceled')
    then
      raise exception 'word_retest_revision_rpc_required' using errcode = '22023';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'done'
      and v_before.status <> 'review_requested'
    then
      raise exception 'word_retest_completion_not_allowed' using errcode = '40001';
    end if;
  end if;

  update public.ops_tasks task set
    title = coalesce(nullif(pg_catalog.btrim(v_task_input ->> 'title'), ''), task.title),
    status = coalesce(nullif(v_task_input ->> 'status', ''), task.status),
    priority = coalesce(nullif(v_task_input ->> 'priority', ''), task.priority),
    requested_by = coalesce(nullif(v_task_input ->> 'requested_by', '')::uuid, task.requested_by),
    requested_team = case when v_task_input ? 'requested_team' then nullif(v_task_input ->> 'requested_team', '') else task.requested_team end,
    assignee_id = case when v_task_input ? 'assignee_id' then nullif(v_task_input ->> 'assignee_id', '')::uuid else task.assignee_id end,
    assignee_team = case when v_task_input ? 'assignee_team' then nullif(v_task_input ->> 'assignee_team', '') else task.assignee_team end,
    secondary_assignee_id = case when v_task_input ? 'secondary_assignee_id' then nullif(v_task_input ->> 'secondary_assignee_id', '')::uuid else task.secondary_assignee_id end,
    student_id = case when v_task_input ? 'student_id' then nullif(v_task_input ->> 'student_id', '')::uuid else task.student_id end,
    class_id = case when v_task_input ? 'class_id' then nullif(v_task_input ->> 'class_id', '')::uuid else task.class_id end,
    textbook_id = case when v_task_input ? 'textbook_id' then nullif(v_task_input ->> 'textbook_id', '')::uuid else task.textbook_id end,
    student_name = case when v_task_input ? 'student_name' then nullif(v_task_input ->> 'student_name', '') else task.student_name end,
    class_name = case when v_task_input ? 'class_name' then nullif(v_task_input ->> 'class_name', '') else task.class_name end,
    textbook_title = case when v_task_input ? 'textbook_title' then nullif(v_task_input ->> 'textbook_title', '') else task.textbook_title end,
    campus = case when v_task_input ? 'campus' then nullif(v_task_input ->> 'campus', '') else task.campus end,
    subject = case when v_task_input ? 'subject' then nullif(v_task_input ->> 'subject', '') else task.subject end,
    start_at = case when v_task_input ? 'start_at' then nullif(v_task_input ->> 'start_at', '')::timestamptz else task.start_at end,
    due_at = case when v_task_input ? 'due_at' then nullif(v_task_input ->> 'due_at', '')::timestamptz else task.due_at end,
    completed_at = case
      when coalesce(nullif(v_task_input ->> 'status', ''), task.status) = 'done'
        then coalesce(nullif(v_task_input ->> 'completed_at', '')::timestamptz, task.completed_at, pg_catalog.clock_timestamp())
      else null
    end,
    memo = case when v_task_input ? 'memo' then nullif(v_task_input ->> 'memo', '') else task.memo end
  where task.id = p_task_id
  returning task.* into v_after;

  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, v_after.type);
  if v_after.type = 'word_retest' then
    v_detail_base := pg_catalog.to_jsonb(v_before_word)
      - 'task_id' - 'created_at' - 'updated_at'
      - 'retry_of_task_id' - 'retry_task_id';
  elsif v_after.type = 'transfer' then
    select pg_catalog.to_jsonb(detail) - 'task_id' - 'created_at' - 'updated_at'
    into v_detail_base
    from public.ops_transfer_details detail
    where detail.task_id = p_task_id;
  elsif v_after.type = 'withdrawal' then
    select pg_catalog.to_jsonb(detail) - 'task_id' - 'created_at' - 'updated_at'
    into v_detail_base
    from public.ops_withdrawal_details detail
    where detail.task_id = p_task_id;
  end if;
  v_detail := coalesce(v_detail_base, '{}'::jsonb) || v_detail;
  if v_after.type = 'word_retest' then
    if coalesce(
        v_after.student_id::text,
        nullif(pg_catalog.btrim(v_after.student_name), ''),
        nullif(pg_catalog.btrim(v_detail ->> 'student_name'), '')
      ) is null
      or coalesce(
        v_after.class_id::text,
        nullif(pg_catalog.btrim(v_after.class_name), ''),
        nullif(pg_catalog.btrim(v_detail ->> 'class_name'), '')
      ) is null
      or coalesce(
        nullif(v_detail ->> 'teacher_catalog_id', ''),
        nullif(pg_catalog.btrim(v_detail ->> 'teacher_name'), '')
      ) is null
      or nullif(v_detail ->> 'test_at', '') is null
    then
      raise exception 'word_retest_context_required' using errcode = '22023';
    end if;
    v_detail := v_detail || pg_catalog.jsonb_build_object(
      'retest_status', case
        when v_after.status in ('requested', 'confirmed') then 'not_started'
        when v_after.status = 'in_progress' then 'in_progress'
        when v_after.status = 'done' then case
          when v_before_word.retest_status = 'absent' then 'absent' else 'done'
        end
        when v_after.status = 'canceled' then 'absent'
        else v_before_word.retest_status
      end
    );
    if not (
      v_before.status = 'in_progress'
      and v_after.status = 'in_progress'
      and v_before_word.retest_status = 'in_progress'
    ) then
      v_detail := v_detail || pg_catalog.jsonb_build_object(
        'first_score', v_before_word.first_score,
        'second_score', v_before_word.second_score,
        'third_score', v_before_word.third_score,
        'score_out_of_100', v_before_word.score_out_of_100
      );
    end if;
  end if;
  perform dashboard_private.upsert_ops_task_detail_v2(v_after.id, v_after.type, v_detail);
  if v_after.type = 'word_retest' then
    select detail.* into v_after_word
    from public.ops_word_retests detail
    where detail.task_id = p_task_id;
  end if;
  -- SECURITY DEFINER가 기존 UPDATE RLS의 WITH CHECK를 우회하지 않도록
  -- 수정된 최종 소유권/담당자/연결 교사 기준으로 다시 권한을 확인한다.
  perform dashboard_private.assert_ops_task_actor_v2(v_after, null);

  if v_after.type = 'general' then
    if v_before.assignee_id is distinct from v_after.assignee_id
      or v_before.secondary_assignee_id is distinct from v_after.secondary_assignee_id
      or v_before.assignee_team is distinct from v_after.assignee_team
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'task.assignee_changed', p_request_id, 'assignee',
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_before.assignee_id,
          'secondary_profile_id', v_before.secondary_assignee_id,
          'team', v_before.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_after.assignee_id,
          'secondary_profile_id', v_after.secondary_assignee_id,
          'team', v_after.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'before_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_before.assignee_id,
            'secondary_profile_id', v_before.secondary_assignee_id,
            'team', v_before.assignee_team
          ),
          'after_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_after.assignee_id,
            'secondary_profile_id', v_after.secondary_assignee_id,
            'team', v_after.assignee_team
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.start_at is distinct from v_after.start_at or v_before.due_at is distinct from v_after.due_at then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'task.due_changed', p_request_id, 'schedule',
        pg_catalog.jsonb_build_object('start_at', v_before.start_at, 'due_at', v_before.due_at)::text,
        pg_catalog.jsonb_build_object('start_at', v_after.start_at, 'due_at', v_after.due_at)::text,
        pg_catalog.jsonb_build_object(
          'before_schedule', pg_catalog.jsonb_build_object(
            'start_at', v_before.start_at, 'due_at', v_before.due_at
          ),
          'after_schedule', pg_catalog.jsonb_build_object(
            'start_at', v_after.start_at, 'due_at', v_after.due_at
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.status is distinct from v_after.status then
      v_event_key := case
        when v_after.status = 'done' then 'task.completed'
        when v_after.status = 'canceled' then 'task.canceled'
        when v_before.status in ('done', 'canceled') then 'task.reopened'
        else 'task.status_changed'
      end;
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
  elsif v_after.type = 'word_retest' then
    if v_before.assignee_id is distinct from v_after.assignee_id
      or v_before.secondary_assignee_id is distinct from v_after.secondary_assignee_id
      or v_before.assignee_team is distinct from v_after.assignee_team
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'word_retest.assigned', p_request_id, 'assignee',
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_before.assignee_id,
          'secondary_profile_id', v_before.secondary_assignee_id,
          'team', v_before.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_after.assignee_id,
          'secondary_profile_id', v_after.secondary_assignee_id,
          'team', v_after.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'before_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_before.assignee_id,
            'secondary_profile_id', v_before.secondary_assignee_id,
            'team', v_before.assignee_team
          ),
          'after_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_after.assignee_id,
            'secondary_profile_id', v_after.secondary_assignee_id,
            'team', v_after.assignee_team
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.start_at is distinct from v_after.start_at
      or v_before.due_at is distinct from v_after.due_at
      or v_before_word.test_at is distinct from v_after_word.test_at
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'word_retest.schedule_changed', p_request_id, 'schedule',
        pg_catalog.jsonb_build_object(
          'test_at', v_before_word.test_at,
          'start_at', v_before.start_at,
          'due_at', v_before.due_at
        )::text,
        pg_catalog.jsonb_build_object(
          'test_at', v_after_word.test_at,
          'start_at', v_after.start_at,
          'due_at', v_after.due_at
        )::text,
        pg_catalog.jsonb_build_object(
          'before_schedule', pg_catalog.jsonb_build_object(
            'test_at', v_before_word.test_at,
            'start_at', v_before.start_at,
            'due_at', v_before.due_at
          ),
          'after_schedule', pg_catalog.jsonb_build_object(
            'test_at', v_after_word.test_at,
            'start_at', v_after.start_at,
            'due_at', v_after.due_at
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.status is distinct from v_after.status then
      v_event_key := case
        when v_after.status = 'in_progress' then 'word_retest.started'
        when v_after.status = 'done' then 'word_retest.completed'
        when v_after.status = 'canceled' then 'word_retest.canceled'
        else null
      end;
      if v_event_key is not null then
        v_source := dashboard_private.record_ops_task_notification_source_v2(
          v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
        );
        v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
      end if;
    end if;
  end if;

  if v_after.type in ('transfer', 'withdrawal') then
    select coalesce(
      pg_catalog.jsonb_agg(event_row.id::text order by event_row.created_at, event_row.id),
      '[]'::jsonb
    )
    into v_source_event_ids
    from public.ops_task_events event_row
    where event_row.task_id = v_after.id
      and event_row.request_id = p_request_id
      and pg_catalog.split_part(event_row.event_type, '.', 1) = v_after.type;
    perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', '', true
    );
    perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', '', true
    );
  elsif v_after.type = 'textbook' then
    v_activity := dashboard_private.insert_ops_task_activity_event_v1(
      v_after, v_actor, 'updated', 'task', v_before.title, v_after.title, p_request_id
    );
    v_activity_event_id := (v_activity ->> 'sourceEventId')::uuid;
  end if;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_after),
    'sourceEventIds', v_source_event_ids,
    'activityEventId', v_activity_event_id
  ));
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'update_ops_task_v2', v_fingerprint, v_response
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.transition_ops_task_status_v2_impl(p_task_id uuid, p_status text, p_expected_updated_at timestamp with time zone, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay jsonb;
  v_before public.ops_tasks%rowtype;
  v_after public.ops_tasks%rowtype;
  v_event_key text;
  v_source jsonb;
  v_activity jsonb;
  v_activity_event_id uuid;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_status is null or p_status not in (
    'requested', 'confirmed', 'in_progress', 'review_requested', 'done', 'on_hold', 'canceled'
  ) or p_expected_updated_at is null or p_request_id is null then
    raise exception 'ops_task_status_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'transition_ops_task_status_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_before
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_before, null);
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'ops_task_stale_write' using errcode = '40001';
  end if;
  if v_before.type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;
  if v_before.type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_before.type in ('transfer', 'withdrawal') then
    if v_before.status = 'done' and p_status <> 'done' then
      raise exception 'ops_transition_closed' using errcode = '40001';
    end if;
    if p_status = 'done' and v_before.status <> 'done' then
      raise exception 'ops_transition_completion_rpc_required' using errcode = '22023';
    end if;
    perform pg_catalog.set_config(
      'app.ops_transition_request_id', p_request_id::text, true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', 'false', true
    );
    perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', 'false', true
    );
  end if;
  if v_before.type = 'word_retest' then
    if v_before.status in ('done', 'canceled') and p_status <> v_before.status then
      raise exception 'word_retest_closed' using errcode = '40001';
    end if;
    if p_status = 'review_requested' and v_before.status <> 'review_requested' then
      raise exception 'word_retest_result_rpc_required' using errcode = '22023';
    end if;
    if v_before.status = 'review_requested'
      and p_status not in ('review_requested', 'done', 'canceled')
    then
      raise exception 'word_retest_revision_rpc_required' using errcode = '22023';
    end if;
    if p_status = 'done' and v_before.status <> 'review_requested' then
      raise exception 'word_retest_completion_not_allowed' using errcode = '40001';
    end if;
  end if;

  update public.ops_tasks task set
    status = p_status,
    completed_at = case when p_status = 'done'
      then coalesce(task.completed_at, pg_catalog.clock_timestamp()) else null end
  where task.id = p_task_id
  returning task.* into v_after;

  if v_after.type = 'word_retest' then
    update public.ops_word_retests detail
    set retest_status = case
      when p_status in ('requested', 'confirmed') then 'not_started'
      when p_status = 'in_progress' then 'in_progress'
      when p_status = 'review_requested' then case
        when detail.retest_status in ('done', 'absent') then detail.retest_status
        else 'in_progress'
      end
      when p_status = 'done' then case
        when detail.retest_status = 'absent' then 'absent'
        else 'done'
      end
      when p_status = 'canceled' then 'absent'
      else detail.retest_status
    end
    where detail.task_id = p_task_id;
    if not found then
      raise exception 'word_retest_not_found' using errcode = 'P0002';
    end if;
  end if;

  if v_before.status is distinct from v_after.status and v_after.type = 'general' then
    v_event_key := case
      when v_after.status = 'done' then 'task.completed'
      when v_after.status = 'canceled' then 'task.canceled'
      when v_before.status in ('done', 'canceled') then 'task.reopened'
      else 'task.status_changed'
    end;
  elsif v_before.status is distinct from v_after.status and v_after.type = 'word_retest' then
    v_event_key := case
      when v_after.status = 'in_progress' then 'word_retest.started'
      when v_after.status = 'done' then 'word_retest.completed'
      when v_after.status = 'canceled' then 'word_retest.canceled'
      else null
    end;
  end if;
  if v_event_key is not null then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
    );
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;
  if v_after.type in ('transfer', 'withdrawal') then
    select coalesce(
      pg_catalog.jsonb_agg(event_row.id::text order by event_row.created_at, event_row.id),
      '[]'::jsonb
    )
    into v_source_event_ids
    from public.ops_task_events event_row
    where event_row.task_id = v_after.id
      and event_row.request_id = p_request_id
      and pg_catalog.split_part(event_row.event_type, '.', 1) = v_after.type;
    perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', '', true
    );
    perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', '', true
    );
  elsif v_after.type = 'textbook' then
    v_activity := dashboard_private.insert_ops_task_activity_event_v1(
      v_after, v_actor, 'status_changed', 'status',
      v_before.status, v_after.status, p_request_id
    );
    v_activity_event_id := (v_activity ->> 'sourceEventId')::uuid;
  end if;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_after),
    'sourceEventIds', v_source_event_ids,
    'activityEventId', v_activity_event_id
  ));
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'transition_ops_task_status_v2', v_fingerprint, v_response
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.add_ops_task_comment_v2_impl(p_task_id uuid, p_body text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id,
    'body', pg_catalog.btrim(p_body)
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_comment public.ops_task_comments%rowtype;
  v_event_key text;
  v_source jsonb;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_task_id is null or nullif(pg_catalog.btrim(p_body), '') is null
    or pg_catalog.char_length(pg_catalog.btrim(p_body)) > 4000
    or p_request_id is null
  then
    raise exception 'ops_task_comment_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'add_ops_task_comment_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.type not in (
    'general', 'word_retest', 'registration', 'transfer', 'withdrawal', 'textbook'
  ) then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;

  insert into public.ops_task_comments(task_id, author_id, body)
  values (p_task_id, v_actor, pg_catalog.btrim(p_body))
  returning * into v_comment;

  v_event_key := case
    when v_task.type = 'general' then 'task.comment_added'
    when v_task.type = 'word_retest' then null
    else null
  end;
  if v_event_key is not null then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, v_event_key, p_request_id, 'comment', null, v_comment.id::text,
      pg_catalog.jsonb_build_object('comment_id', v_comment.id), v_comment.id
    );
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'comment', pg_catalog.to_jsonb(v_comment),
    'sourceId', v_comment.id,
    'sourceEventIds', v_source_event_ids
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'add_ops_task_comment_v2', v_fingerprint, v_response
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION dashboard_private.record_ops_task_activity_event_v1_impl(p_task_id uuid, p_event_type text, p_field_name text, p_before_value text, p_after_value text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_event_type text := nullif(pg_catalog.btrim(p_event_type), '');
  v_field_name text := nullif(pg_catalog.btrim(p_field_name), '');
  v_before_value text := nullif(pg_catalog.btrim(p_before_value), '');
  v_after_value text := nullif(pg_catalog.btrim(p_after_value), '');
  v_fingerprint text;
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_response jsonb;
begin
  -- 이 공개 호환 경계는 권위 업무 행을 바꾸지 않는 운영 활동만 받는다.
  -- 생성·수정·상태 전이는 행을 잠근 create/update/transition RPC가 직접 기록한다.
  if p_task_id is null
    or p_request_id is null
    or v_event_type is null
    or v_event_type not in (
      'auto_synced', 'manual_checked', 'manual_unchecked', 'auto_checked', 'rollback'
    )
    or pg_catalog.char_length(coalesce(v_field_name, '')) > 160
    or pg_catalog.char_length(coalesce(v_before_value, '')) > 4000
    or pg_catalog.char_length(coalesce(v_after_value, '')) > 4000
  then
    raise exception 'ops_task_activity_event_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'task_id', p_task_id,
    'event_type', v_event_type,
    'field_name', v_field_name,
    'before_value', v_before_value,
    'after_value', v_after_value
  )::text);
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'record_ops_task_activity_event_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for share of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.type not in ('registration', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_activity_event_type_forbidden' using errcode = '22023';
  end if;

  v_response := dashboard_private.insert_ops_task_activity_event_v1(
    v_task, v_actor, v_event_type, v_field_name,
    v_before_value, v_after_value, p_request_id
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'record_ops_task_activity_event_v1', v_fingerprint, v_response
  );
end;
$function$
;

-- Minimal retest reference DTO; never returns contact, account or internal memo.
create function public.get_word_retest_reference_data_v1() returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='assistant' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
  raise exception 'word_retest_reference_access_denied' using errcode='42501';
 end if;
 with class_source as materialized (
  select c.id,c.name,c.subject,c.grade,c.teacher,c.room,
   coalesce(c.student_ids,'[]'::jsonb) student_ids,coalesce(c.waitlist_ids,'[]'::jsonb) waitlist_ids,coalesce(c.textbook_ids,'[]'::jsonb) textbook_ids
  from public.classes c where lower(btrim(coalesce(c.subject,''))) in ('영어','영어팀','english')
   or exists(select 1 from public.ops_tasks t where t.type='word_retest' and t.class_id=c.id)
 ), student_source as materialized (
  select s.id,s.name,s.school,s.grade,s.status,
   coalesce((select jsonb_agg(c.id order by c.id) from class_source c where c.student_ids ? s.id::text or coalesce(s.class_ids,'[]'::jsonb) ? c.id::text),'[]'::jsonb) class_ids,
   coalesce((select jsonb_agg(c.id order by c.id) from class_source c where c.waitlist_ids ? s.id::text or coalesce(s.waitlist_class_ids,'[]'::jsonb) ? c.id::text),'[]'::jsonb) waitlist_class_ids
  from public.students s where exists(select 1 from class_source c where c.student_ids ? s.id::text or c.waitlist_ids ? s.id::text or coalesce(s.class_ids,'[]'::jsonb) ? c.id::text or coalesce(s.waitlist_class_ids,'[]'::jsonb) ? c.id::text)
   or exists(select 1 from public.ops_tasks t where t.type='word_retest' and t.student_id=s.id)
 ), teacher_source as materialized (
  select t.id,t.name,t.subjects,t.is_visible,t.sort_order,t.profile_id from public.teacher_catalogs t
  where t.subjects && array['영어','영어팀','english']::text[]
    or exists(select 1 from public.ops_word_retests w join public.ops_tasks task on task.id=w.task_id and task.type='word_retest' where w.teacher_catalog_id=t.id)
 ), book_source as materialized (
  select b.id,b.name,b.title,b.subject,b.publisher,b.status from public.textbooks b
  where lower(btrim(coalesce(b.subject,''))) in ('영어','영어팀','english')
    or exists(select 1 from class_source c where c.textbook_ids ? b.id::text)
    or exists(select 1 from public.ops_tasks task where task.type='word_retest' and task.textbook_id=b.id)
 )
 select jsonb_build_object(
  'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role) order by p.id) from public.profiles p where p.role in ('admin','staff','assistant') or exists(select 1 from teacher_source t where t.profile_id=p.id)),'[]'::jsonb),
  'students',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from student_source s),'[]'::jsonb),
  'classes',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from class_source c),'[]'::jsonb),
  'textbooks',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from book_source b),'[]'::jsonb),
  'teachers',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from teacher_source t),'[]'::jsonb)
 ) into result;
 return result;
end $function$;
alter function public.get_word_retest_reference_data_v1() owner to postgres;
revoke all on function public.get_word_retest_reference_data_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_word_retest_reference_data_v1() to authenticated;

-- The client preflight returns only one boolean, with the same four references
-- and roster relation as the previous raw lookup. Authoritative producer
-- permission/state/CAS validation remains unchanged.
create function public.validate_word_retest_references_v1(p_student_id uuid,p_class_id uuid,p_textbook_id uuid,p_teacher_id uuid) returns boolean
language plpgsql stable security definer set search_path=''
as $function$
declare actor_role text; result boolean;
begin
 select p.role into actor_role from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
 if actor_role is null then raise exception 'word_retest_reference_access_denied' using errcode='42501';end if;
 select exists(select 1 from public.students s join public.classes c on c.id=p_class_id
  where s.id=p_student_id and (
   coalesce(s.class_ids,'[]'::jsonb) ? c.id::text
   and coalesce(c.student_ids,'[]'::jsonb) ? s.id::text)
  and (actor_role<>'assistant' or lower(btrim(coalesce(c.subject,''))) in ('영어','영어팀','english') or exists(select 1 from public.ops_tasks task where task.type='word_retest' and task.class_id=c.id and task.student_id=s.id)))
  and exists(select 1 from public.textbooks b where b.id=p_textbook_id)
  and exists(select 1 from public.teacher_catalogs t where t.id=p_teacher_id)
 into result;
 return result;
end $function$;
alter function public.validate_word_retest_references_v1(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.validate_word_retest_references_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.validate_word_retest_references_v1(uuid,uuid,uuid,uuid) to authenticated;


create policy dashboard_notifications_assistant_insert_deny_v1 on public.dashboard_notifications as restrictive for insert to authenticated
with check ((select public.current_dashboard_role()) is distinct from 'assistant');
create policy dashboard_notifications_assistant_update_deny_v1 on public.dashboard_notifications as restrictive for update to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant') with check ((select public.current_dashboard_role()) is distinct from 'assistant');
create policy dashboard_notifications_assistant_delete_deny_v1 on public.dashboard_notifications as restrictive for delete to authenticated
using ((select public.current_dashboard_role()) is distinct from 'assistant');
CREATE OR REPLACE FUNCTION public.create_makeup_request_v2(p_input jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role()='teacher' then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.create_makeup_request_v2_unguarded(
    p_input,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transition_makeup_request_v2(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role()='teacher' then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(p_patch);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.transition_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_command,
    p_patch,
    p_expected_status,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$
;
CREATE OR REPLACE FUNCTION dashboard_private.transition_makeup_request_v2_unguarded(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if actor_role in ('teacher','assistant') then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
  perform dashboard_private.lock_timetable_operating_resources_v1();
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
    raise exception 'makeup_request_stale_status' using errcode = 'P0001';
  end if;

  if p_command = 'approve' then
    if before_row.status <> 'approval_pending'
      or (before_row.approver_profile_id is distinct from actor_id and coalesce(actor_role not in ('admin','staff'),true))
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
        raise exception 'makeup_request_source_changed' using errcode = 'P0001';
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
        raise exception 'makeup_request_source_changed' using errcode = 'P0001';
      end if;
      perform dashboard_private.notification_assert_makeup_room_available_v1(
        before_row.id
      );
      -- Only a validated server transition may establish schedule/audit context.
    -- Restore every setting so callers cannot retain direct-write permission.
    declare previous_context jsonb := '{}'::jsonb; context_key text;
    begin
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        previous_context := previous_context || jsonb_build_object(context_key, current_setting(context_key, true));
      end loop;
      perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
        before_row.class_id, p_request_id, 'makeup_' || p_command, coalesce(note, p_patch->>'final_note')
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
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        perform set_config(context_key, coalesce(previous_context->>context_key, ''), true);
      end loop;
    end;
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
      or (before_row.approver_profile_id is distinct from actor_id and coalesce(actor_role not in ('admin','staff'),true))
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
      or (before_row.approver_profile_id is distinct from actor_id and coalesce(actor_role not in ('admin','staff'),true))
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
      or (before_row.requester_id is distinct from actor_id and coalesce(actor_role not in ('admin','staff'),true))
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
        and (coalesce(before_row.approver_profile_id = actor_id, false) or coalesce(actor_role in ('admin','staff'),false)))
      or (before_row.status = 'makeup_pending'
        and (
          coalesce(before_row.approver_profile_id = actor_id, false)
          or coalesce(actor_role in ('admin', 'staff'), false)
        ))
    ) is not true then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    -- Only a validated server transition may establish schedule/audit context.
    -- Restore every setting so callers cannot retain direct-write permission.
    declare previous_context jsonb := '{}'::jsonb; context_key text;
    begin
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        previous_context := previous_context || jsonb_build_object(context_key, current_setting(context_key, true));
      end loop;
      perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
        before_row.class_id, p_request_id, 'makeup_' || p_command, coalesce(note, p_patch->>'final_note')
      );
    perform dashboard_private.notification_revert_makeup_calendar_effects_v1(
      before_row.id,
      before_row.class_id,
      before_row.schedule_plan_before,
      before_row.schedule_plan_after,
      before_row.cancel_academic_event_id,
      before_row.makeup_academic_event_id,
      before_row.makeup_academic_event_ids
    );
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        perform set_config(context_key, coalesce(previous_context->>context_key, ''), true);
      end loop;
    end;
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
$function$
;

-- Direct management/settings readers are not operational common readers.
CREATE OR REPLACE FUNCTION public.list_management_page_v1(p_kind text, p_filters jsonb, p_cursor_sort_key text, p_cursor_id uuid, p_limit integer)
 RETURNS TABLE(row_data jsonb, sort_key text, id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception 'management_page_limit_invalid' using errcode = '22023';
  end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then
    raise exception 'management_cursor_invalid' using errcode = '22023';
  end if;

  if p_kind = 'students' then
    return query
    with source as (
      select student.id,pg_catalog.jsonb_build_object(
        'name',student.name,'grade',student.grade,'school',student.school,
        'contact',student.contact,'parent_contact',student.parent_contact,'status',student.status,
        'school_category',school.category,'updated_at',student.created_at,'storedStatus',student.status
      ) || enrollment.value as raw
      from public.students student join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id
      left join public.academic_schools school on school.name = student.school
    ), filtered as (
      select source.*,
        coalesce(
          nullif(pg_catalog.regexp_replace(pg_catalog.btrim(source.raw ->> 'name'), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'name', source.raw ->> 'school', source.raw ->> 'grade') ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'schoolCategory') is null or coalesce(source.raw ->> 'school_category', source.raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory')
        and ((p_filters ->> 'school') is null or source.raw ->> 'school' = p_filters ->> 'school')
        and ((p_filters ->> 'grade') is null or source.raw ->> 'grade' = p_filters ->> 'grade')
    )
    select pg_catalog.jsonb_build_object(
        'kind','students','id',filtered.id,'name',coalesce(filtered.raw ->> 'name',''),
        'grade',filtered.raw -> 'grade','school',filtered.raw -> 'school',
        'contact',filtered.raw -> 'contact','parentContact',coalesce(filtered.raw -> 'parent_contact',filtered.raw -> 'parentContact'),
        'status',coalesce(filtered.raw ->> 'status',''),'storedStatus',coalesce(filtered.raw ->> 'storedStatus',''),
        'registeredCount',filtered.raw -> 'registeredCount','waitlistCount',filtered.raw -> 'waitlistCount',
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  elsif p_kind = 'classes' then
    return query
    with source as (
      select class.id, pg_catalog.jsonb_build_object(
        'name',class.name,'subject',class.subject,'grade',class.grade,'schedule',class.schedule,
        'teacher',class.teacher,'room',class.room,'capacity',class.capacity,'fee',class.fee,
        'status',class.status,'student_ids',class.student_ids,'updated_at',class.created_at
      ) as raw
      from public.classes class
    ), filtered as (
      select source.*,
        coalesce(
          nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(source.raw ->> 'name',source.raw ->> 'class_name')), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'name', source.raw ->> 'subject', coalesce(source.raw ->> 'teacher_name',source.raw ->> 'teacher'), coalesce(source.raw ->> 'classroom',source.raw ->> 'room')) ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'grade') is null or source.raw ->> 'grade' = p_filters ->> 'grade')
        and ((p_filters ->> 'teacher') is null or coalesce(source.raw ->> 'teacher',source.raw ->> 'teacher_name') = p_filters ->> 'teacher')
        and ((p_filters ->> 'classroom') is null or coalesce(source.raw ->> 'classroom',source.raw ->> 'room') = p_filters ->> 'classroom')
        and ((p_filters ->> 'periodId') is null or exists (
          select 1 from public.class_schedule_sync_group_members member
          where member.class_id = source.id and member.group_id::text = p_filters ->> 'periodId'
        ))
    )
    select pg_catalog.jsonb_build_object(
        'kind','classes','id',filtered.id,'name',coalesce(filtered.raw ->> 'name',filtered.raw ->> 'class_name',''),
        'subject',coalesce(filtered.raw ->> 'subject',''),
        'grade',filtered.raw -> 'grade','schedule',filtered.raw -> 'schedule',
        'teacherName',coalesce(filtered.raw ->> 'teacher_name',filtered.raw ->> 'teacher'),
        'classroom',coalesce(filtered.raw -> 'classroom',filtered.raw -> 'room'),
        'capacity',filtered.raw -> 'capacity','weeklyMinutes',coalesce(filtered.raw -> 'weekly_minutes',filtered.raw -> 'weeklyMinutes'),
        'fee',coalesce(filtered.raw -> 'fee',filtered.raw -> 'tuition'),
        'status',coalesce(filtered.raw ->> 'status',''),
        'studentCount',(select pg_catalog.count(distinct roster.student_id) from (
          select roster_id.student_id from pg_catalog.jsonb_array_elements_text(coalesce(filtered.raw -> 'student_ids','[]'::jsonb)) as roster_id(student_id)
          union all select enrollment.student_id::text from public.ops_registration_enrollments enrollment
          where enrollment.class_id=filtered.id and enrollment.status='enrolled' and enrollment.roster_active
          union all select student.id::text from public.students student where coalesce(student.class_ids,'[]'::jsonb) ? filtered.id::text
        ) roster),
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  else
    return query
    with source as (
      select textbook.id, pg_catalog.jsonb_build_object(
        'title',textbook.title,'name',textbook.name,'subject',textbook.subject,'publisher',textbook.publisher,
        'status',textbook.status,'price',textbook.price,'sale_price',textbook.sale_price,
        'list_price',textbook.list_price,'updated_at',textbook.updated_at
      ) as raw
      from public.textbooks textbook
    ), filtered as (
      select source.*,
        coalesce(
          nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(source.raw ->> 'title',source.raw ->> 'name')), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'title', source.raw ->> 'name', source.raw ->> 'subject', source.raw ->> 'publisher') ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'publisher') is null or source.raw ->> 'publisher' = p_filters ->> 'publisher')
    )
    select pg_catalog.jsonb_build_object(
        'kind','textbooks','id',filtered.id,'title',coalesce(filtered.raw ->> 'title',filtered.raw ->> 'name',''),
        'subject',coalesce(filtered.raw ->> 'subject',''),'publisher',filtered.raw -> 'publisher',
        'status',coalesce(filtered.raw ->> 'status',''),
        'price',coalesce(filtered.raw -> 'price',filtered.raw -> 'sale_price',filtered.raw -> 'list_price'),
        'activeClassCount',(select pg_catalog.count(*) from public.classes class where coalesce(class.textbook_ids,'[]'::jsonb) ? filtered.id::text),
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.list_management_numbered_page_v1(p_kind text, p_filters jsonb, p_page integer, p_page_size integer, p_sort jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_expected text[];
  v_keys text[];
  v_key text;
  v_sort jsonb;
  v_item jsonb;
  v_seen text[] := array[]::text[];
  v_sort_map jsonb;
  v_sort_fields text := '';
  v_order text := '';
  v_index integer := 0;
  v_expression text;
  v_direction text;
  v_source text;
  v_table text;
  v_row text;
  v_result jsonb;
  v_offset bigint;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) is distinct from 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) keys(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') is distinct from 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_page is null or p_page < 1 then
    raise exception 'management_page_invalid' using errcode = '22023';
  end if;
  if p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'management_page_size_invalid' using errcode = '22023';
  end if;
  -- Cast before multiplication: max int page * 20 must not overflow integer.
  v_offset := (p_page::bigint - 1) * p_page_size::bigint;
  if pg_catalog.jsonb_typeof(p_sort) is distinct from 'array' then
    raise exception 'management_sort_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_sort) > 2 then
    raise exception 'management_sort_invalid' using errcode = '22023';
  end if;
  v_sort := p_sort;
  if v_sort = '[]'::jsonb then
    v_sort := case p_kind
      when 'students' then '[{"id":"status","desc":false},{"id":"title","desc":false}]'::jsonb
      when 'classes' then '[{"id":"title","desc":false}]'::jsonb
      else '[{"id":"subject","desc":false},{"id":"title","desc":false}]'::jsonb end;
  end if;

  -- Only expressions in these maps enter SQL. All user values stay bound parameters.
  if p_kind = 'students' then
    v_table := 'public.students';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$case enrollment.value ->> 'status' when '재원' then 0 when '대기' then 1 else 2 end$e$,
      'school', $e$nullif(pg_catalog.btrim(record.school),'') collate dashboard_private.ko_numeric$e$,
      'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'contact', $e$nullif(pg_catalog.btrim(record.contact),'') collate dashboard_private.ko_numeric$e$,
      'parentContact', $e$nullif(pg_catalog.btrim(record.parent_contact),'') collate dashboard_private.ko_numeric$e$
    );
    v_source := $sql$
      from public.students record
      join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=record.id
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.name,record.school,record.grade) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or enrollment.value ->> 'status' = $1 ->> 'status')
        and (($1 ->> 'schoolCategory') is null or exists (
          select 1 from public.academic_schools school where school.name=record.school and school.category=$1 ->> 'schoolCategory'
        ))
        and (($1 ->> 'school') is null or record.school = $1 ->> 'school')
        and (($1 ->> 'grade') is null or record.grade = $1 ->> 'grade')
    $sql$;
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','students','id',record.id,'name',coalesce(record.name,''),
      'grade',record.grade,'school',record.school,'contact',record.contact,'parentContact',record.parent_contact,
      'storedStatus',coalesce(record.status,''),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.created_at) #>> '{}','')
    ) || dashboard_private.management_student_enrollment_summary_v1(record.id)$sql$;
  elsif p_kind = 'classes' then
    v_table := 'public.classes';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$nullif(pg_catalog.btrim(record.status),'') collate dashboard_private.ko_numeric$e$,
      'subject', $e$nullif(pg_catalog.btrim(record.subject),'') collate dashboard_private.ko_numeric$e$,
      'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'schedule', $e$nullif(pg_catalog.btrim(record.schedule),'') collate dashboard_private.ko_numeric$e$,
      'teacher', $e$nullif(pg_catalog.btrim(record.teacher),'') collate dashboard_private.ko_numeric$e$,
      'classroom', $e$nullif(pg_catalog.btrim(record.room),'') collate dashboard_private.ko_numeric$e$,
      'capacity', 'record.capacity', 'tuition', 'record.fee'
    );
    v_source := $sql$
      from public.classes record
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.name,record.subject,record.teacher,record.room) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'subject') is null or record.subject = $1 ->> 'subject')
        and (($1 ->> 'grade') is null or record.grade = $1 ->> 'grade')
        and (($1 ->> 'teacher') is null or record.teacher = $1 ->> 'teacher')
        and (($1 ->> 'classroom') is null or record.room = $1 ->> 'classroom')
        and (($1 ->> 'periodId') is null or exists (
          select 1 from public.class_schedule_sync_group_members member where member.class_id=record.id and member.group_id::text=$1 ->> 'periodId'
        ))
    $sql$;
    -- Matches the FINAL 20260825152044 roster patch, including enrolled + roster_active.
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','classes','id',record.id,'name',coalesce(record.name,''),'subject',coalesce(record.subject,''),
      'grade',record.grade,'schedule',record.schedule,'teacherName',record.teacher,'classroom',record.room,
      'capacity',record.capacity,'weeklyMinutes',null,'fee',record.fee,'status',coalesce(record.status,''),
      'studentCount',(select pg_catalog.count(distinct roster.student_id) from (
        select direct.student_id from pg_catalog.jsonb_array_elements_text(coalesce(record.student_ids,'[]'::jsonb)) direct(student_id)
        union all select enrollment.student_id::text from public.ops_registration_enrollments enrollment
          where enrollment.class_id=record.id and enrollment.status='enrolled' and enrollment.roster_active
        union all select student.id::text from public.students student where coalesce(student.class_ids,'[]'::jsonb) ? record.id::text
      ) roster),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.created_at) #>> '{}','')
    )$sql$;
  else
    v_table := 'public.textbooks';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(record.title,record.name)),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$nullif(pg_catalog.btrim(record.status),'') collate dashboard_private.ko_numeric$e$,
      'subject', $e$nullif(pg_catalog.btrim(record.subject),'') collate dashboard_private.ko_numeric$e$,
      'publisher', $e$nullif(pg_catalog.btrim(record.publisher),'') collate dashboard_private.ko_numeric$e$,
      'price','record.price','updatedAt','record.updated_at'
    );
    v_source := $sql$
      from public.textbooks record
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.title,record.name,record.subject,record.publisher) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'subject') is null or record.subject = $1 ->> 'subject')
        and (($1 ->> 'publisher') is null or record.publisher = $1 ->> 'publisher')
    $sql$;
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','textbooks','id',record.id,'title',coalesce(record.title,record.name,''),'subject',coalesce(record.subject,''),
      'publisher',record.publisher,'status',coalesce(record.status,''),'price',record.price,
      'activeClassCount',(select pg_catalog.count(*) from public.classes class where coalesce(class.textbook_ids,'[]'::jsonb) ? record.id::text),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(record.title,record.name)),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.updated_at) #>> '{}','')
    )$sql$;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_sort) items(value) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'management_sort_invalid' using errcode = '22023';
    end if;
    select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(v_item) keys(key);
    v_key := v_item ->> 'id';
    if v_keys is distinct from array['desc','id'] or pg_catalog.jsonb_typeof(v_item -> 'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'desc') is distinct from 'boolean'
      or not (v_sort_map ? v_key) or v_key = any(v_seen) then
      raise exception 'management_sort_invalid' using errcode = '22023';
    end if;
    v_seen := pg_catalog.array_append(v_seen,v_key);
    v_expression := v_sort_map ->> v_key;
    v_direction := case when (v_item ->> 'desc')::boolean then 'desc' else 'asc' end;
    v_sort_fields := v_sort_fields || pg_catalog.format(', %s as s%s',v_expression,v_index);
    v_order := v_order || pg_catalog.format('page.s%s %s nulls last, ',v_index,v_direction);
    v_index := v_index + 1;
  end loop;
  v_order := v_order || 'page.id asc';

  -- One MATERIALIZED predicate source is shared by count and page selection, under
  -- the invoker snapshot/RLS. It holds only parent ID plus at most two sort keys.
  -- The page fence prevents roster/class enrichment from running for skipped keys.
  execute pg_catalog.format($sql$
    with filtered as materialized (
      select record.id %s %s
    ), page as materialized (
      select page.* from filtered page order by %s offset $2 limit $3
    )
    select pg_catalog.jsonb_build_object(
      'rows',(select coalesce(pg_catalog.jsonb_agg(%s order by %s),'[]'::jsonb)
        from page join %s record on record.id=page.id),
      'page',$4,'pageSize',$3,'totalCount',(select pg_catalog.count(*) from filtered)
    )
  $sql$,v_sort_fields,v_source,v_order,v_row,v_order,v_table)
  into v_result using p_filters,v_offset,p_page_size,p_page;
  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_management_stats_v1(p_kind text, p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_kind = 'students' then
    with filtered as (
      select enrollment.value raw from public.students student
      join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id
      left join public.academic_schools school on school.name = student.school
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', student.name, student.school, student.grade) ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or enrollment.value ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'schoolCategory') is null or school.category = p_filters ->> 'schoolCategory')
        and ((p_filters ->> 'school') is null or student.school = p_filters ->> 'school')
        and ((p_filters ->> 'grade') is null or student.grade = p_filters ->> 'grade')
    )
    select pg_catalog.jsonb_build_object('total',coalesce(pg_catalog.sum(count_value),0),'byStatus',coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  elsif p_kind = 'classes' then
    with source as (
      select class.id,pg_catalog.jsonb_build_object(
        'name',class.name,'subject',class.subject,'grade',class.grade,'teacher',class.teacher,
        'room',class.room,'status',class.status
      ) raw
      from public.classes class
    ), filtered as (
      select source.raw from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', raw ->> 'name', raw ->> 'subject', raw ->> 'teacher', coalesce(raw ->> 'classroom',raw ->> 'room')) ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade')
        and ((p_filters ->> 'teacher') is null or raw ->> 'teacher' = p_filters ->> 'teacher')
        and ((p_filters ->> 'classroom') is null or coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom')
        and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id = source.id and member.group_id::text = p_filters ->> 'periodId'))
    )
    select pg_catalog.jsonb_build_object('total',coalesce(pg_catalog.sum(count_value),0),'byStatus',coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  else
    with source as (
      select pg_catalog.jsonb_build_object(
        'title',textbook.title,'name',textbook.name,'subject',textbook.subject,
        'publisher',textbook.publisher,'status',textbook.status
      ) raw
      from public.textbooks textbook
    ), filtered as (
      select source.raw from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'title', source.raw ->> 'name', source.raw ->> 'subject', source.raw ->> 'publisher') ilike '%' || (p_filters ->> 'search') || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'publisher') is null or source.raw ->> 'publisher' = p_filters ->> 'publisher')
    )
    select pg_catalog.jsonb_build_object('total',coalesce(pg_catalog.sum(count_value),0),'byStatus',coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  end if;
  return coalesce(v_result, pg_catalog.jsonb_build_object('total',0,'byStatus','{}'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION public.list_management_filter_options_v1(p_kind text, p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_kind = 'students' then
    with source as (
      select pg_catalog.jsonb_build_object(
        'status',enrollment.value ->> 'status','school_category',school.category,
        'school',student.school,'grade',student.grade
      ) raw
      from public.students student join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id
      left join public.academic_schools school on school.name = student.school
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',student.name,student.school,student.grade) ilike '%' || (p_filters ->> 'search') || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'status') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'schoolCategory') is null or coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value limit 500) option),
      'schoolCategory',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (coalesce(raw ->> 'school_category',raw ->> 'schoolCategory')) collate dashboard_private.ko_numeric value from source where nullif(coalesce(raw ->> 'school_category',raw ->> 'schoolCategory'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value limit 500) option),
      'school',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'school') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'school','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'schoolCategory') is null or coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value limit 500) option),
      'grade',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'grade') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'grade','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'schoolCategory') is null or coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') order by value limit 500) option)
    ) into v_result;
  elsif p_kind = 'classes' then
    with source as (
      select class.id,pg_catalog.jsonb_build_object(
        'name',class.name,'subject',class.subject,'grade',class.grade,'teacher',class.teacher,
        'room',class.room,'status',class.status
      ) raw
      from public.classes class
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',class.name,class.subject,class.teacher,class.room) ilike '%' || (p_filters ->> 'search') || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'status') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value limit 500) option),
      'subject',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'subject') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'subject','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value limit 500) option),
      'grade',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'grade') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'grade','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'teacher') is null or coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value limit 500) option),
      'teacher',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (coalesce(raw ->> 'teacher_name',raw ->> 'teacher')) collate dashboard_private.ko_numeric value from source where nullif(coalesce(raw ->> 'teacher_name',raw ->> 'teacher'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'classroom') is null or coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value limit 500) option),
      'classroom',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (coalesce(raw ->> 'classroom',raw ->> 'room')) collate dashboard_private.ko_numeric value from source where nullif(coalesce(raw ->> 'classroom',raw ->> 'room'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value limit 500) option),
      'periods',(select coalesce(pg_catalog.jsonb_agg(option order by option ->> 'label' collate dashboard_private.ko_numeric),'[]'::jsonb) from (select pg_catalog.jsonb_build_object('value',group_row.id,'label',group_row.name,'aliases',pg_catalog.jsonb_build_array(group_row.id::text,group_row.name),'isDefault',group_row.is_default) option from public.class_schedule_sync_groups group_row where exists (select 1 from public.class_schedule_sync_group_members member join source on source.id=member.class_id where member.group_id=group_row.id and ((p_filters ->> 'status') is null or source.raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'subject') is null or source.raw ->> 'subject'=p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or source.raw ->> 'grade'=p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or coalesce(source.raw ->> 'teacher_name',source.raw ->> 'teacher')=p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or coalesce(source.raw ->> 'classroom',source.raw ->> 'room')=p_filters ->> 'classroom')) order by group_row.name collate dashboard_private.ko_numeric,group_row.id limit 500) bounded)
    ) into v_result;
  else
    with source as (
      select pg_catalog.jsonb_build_object(
        'title',textbook.title,'subject',textbook.subject,'publisher',textbook.publisher,'status',textbook.status
      ) raw
      from public.textbooks textbook
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',textbook.title,textbook.subject,textbook.publisher) ilike '%' || (p_filters ->> 'search') || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'status') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'subject') is null or raw ->> 'subject'=p_filters ->> 'subject') and ((p_filters ->> 'publisher') is null or raw ->> 'publisher'=p_filters ->> 'publisher') order by value limit 500) option),
      'subject',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'subject') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'subject','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'publisher') is null or raw ->> 'publisher'=p_filters ->> 'publisher') order by value limit 500) option),
      'publisher',(select coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct (raw ->> 'publisher') collate dashboard_private.ko_numeric value from source where nullif(raw ->> 'publisher','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject'=p_filters ->> 'subject') order by value limit 500) option)
    ) into v_result;
  end if;
  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_management_detail_v1(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_raw jsonb;
  v_detail jsonb;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if p_kind not in ('students','classes','textbooks') or p_id is null then raise exception 'management_detail_invalid' using errcode = '22023'; end if;
  if p_kind = 'students' then
    select pg_catalog.to_jsonb(student) into v_raw from public.students student where student.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','students','record',pg_catalog.jsonb_build_object(
      'id',p_id,'name',v_raw ->> 'name','status',v_raw ->> 'status','uid',v_raw -> 'uid',
      'schoolCategory',coalesce(v_raw -> 'school_category',v_raw -> 'schoolCategory'),'school',v_raw -> 'school','grade',v_raw -> 'grade',
      'contact',v_raw -> 'contact','parentContact',coalesce(v_raw -> 'parent_contact',v_raw -> 'parentContact'),
      'enrollDate',coalesce(v_raw -> 'enroll_date',v_raw -> 'enrollDate'),'counselingNote',coalesce(v_raw -> 'counseling_note',v_raw -> 'counselingNote'),
      'recentIssue',coalesce(v_raw -> 'recent_issue',v_raw -> 'recentIssue'),'updatedAt',v_raw -> 'updated_at','storedStatus',v_raw ->> 'status') || dashboard_private.management_student_enrollment_summary_v1(p_id),
      'enrollments',public.list_management_detail_relation_page_v1('students',p_id,'enrollments') -> 'page',
      'lifecycleHistory',public.list_management_detail_relation_page_v1('students',p_id,'lifecycle_history') -> 'page',
      'classPicker',public.list_management_detail_relation_page_v1('students',p_id,'class_picker') -> 'page');
  elsif p_kind = 'classes' then
    select pg_catalog.to_jsonb(class) into v_raw from public.classes class where class.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','classes','record',pg_catalog.jsonb_build_object(
      'id',p_id,'name',v_raw ->> 'name','status',v_raw ->> 'status','classType',coalesce(v_raw -> 'class_type',v_raw -> 'classType'),
      'subject',v_raw ->> 'subject','subjectAreaKey',coalesce(v_raw -> 'subject_area_key',v_raw -> 'subjectAreaKey'),'grade',v_raw ->> 'grade',
      'teacher',v_raw ->> 'teacher','schedule',v_raw ->> 'schedule','classroom',coalesce(v_raw ->> 'classroom',v_raw ->> 'room'),'capacity',v_raw -> 'capacity','fee',v_raw -> 'fee',
      'textbookIds',coalesce(v_raw -> 'textbook_ids','[]'::jsonb),'textbookUsage',coalesce(v_raw -> 'textbook_usage','{}'::jsonb),'publicMemo',coalesce(v_raw ->> 'public_memo',''),'scheduleStorageMode',v_raw ->> 'schedule_storage_mode','updatedAt',v_raw -> 'updated_at'),
      'schedule',pg_catalog.jsonb_build_object(
        'plan',coalesce(v_raw -> 'schedule_plan','{}'::jsonb),
        'slots',case
          when pg_catalog.jsonb_typeof(v_raw -> 'schedule_plan' -> 'sessions')='array' then v_raw -> 'schedule_plan' -> 'sessions'
          when pg_catalog.jsonb_typeof(v_raw -> 'schedule_plan' -> 'session_list')='array' then v_raw -> 'schedule_plan' -> 'session_list'
          else '[]'::jsonb
        end),
      
      'registeredCount',(select count(*) from public.students student where coalesce(v_raw -> 'student_ids','[]'::jsonb) ? student.id::text),
      'waitlistCount',(select count(*) from public.students student where coalesce(v_raw -> 'waitlist_ids','[]'::jsonb) ? student.id::text),
      'registeredStudents',public.list_management_detail_relation_page_v1('classes',p_id,'registered_students') -> 'page',
      'waitlistedStudents',public.list_management_detail_relation_page_v1('classes',p_id,'waitlisted_students') -> 'page',
      'textbooks',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',textbook.id,'title',textbook.title,'subject',textbook.subject,'publisher',textbook.publisher,
        'schoolLevels',coalesce(pg_catalog.to_jsonb(textbook) -> 'school_levels','[]'::jsonb),
        'gradeLevels',coalesce(pg_catalog.to_jsonb(textbook) -> 'grade_levels','[]'::jsonb),
        'subSubject',pg_catalog.to_jsonb(textbook) -> 'sub_subject','subjectAreaKey',pg_catalog.to_jsonb(textbook) -> 'subject_area_key'
      ) order by textbook.title collate dashboard_private.ko_numeric,textbook.id),'[]'::jsonb) from public.textbooks textbook where coalesce(v_raw -> 'textbook_ids','[]'::jsonb) ? textbook.id::text),
      'groups',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',group_row.id,'name',group_row.name,'subject',group_row.subject,'isDefault',group_row.is_default
      ) order by group_row.sort_order,group_row.name collate dashboard_private.ko_numeric,group_row.id),'[]'::jsonb)
        from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id=member.group_id where member.class_id=p_id),
      'formReferences',pg_catalog.jsonb_build_object(
        'teacherCatalogs',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',catalog.id,'name',catalog.name,'subjects',catalog.subjects,'isVisible',catalog.is_visible,'sortOrder',catalog.sort_order) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id),'[]'::jsonb) from public.teacher_catalogs catalog where catalog.is_visible),
        'classroomCatalogs',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',catalog.id,'name',catalog.name,'subjects',catalog.subjects,'isVisible',catalog.is_visible,'sortOrder',catalog.sort_order) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id),'[]'::jsonb) from public.classroom_catalogs catalog where catalog.is_visible),
        'scienceSubjectAreas',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('subject',area.subject,'areaKey',area.area_key,'label',area.label,'sortOrder',area.sort_order) order by area.sort_order,area.area_key),'[]'::jsonb) from public.list_active_science_subject_areas_v1() area)
      ));
  else
    select pg_catalog.to_jsonb(textbook) into v_raw from public.textbooks textbook where textbook.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','textbooks','record',pg_catalog.jsonb_build_object(
      'id',p_id,'title',coalesce(v_raw ->> 'title',v_raw ->> 'name'),'subject',v_raw ->> 'subject','publisher',v_raw -> 'publisher',
      'price',coalesce(v_raw -> 'price',v_raw -> 'sale_price',v_raw -> 'list_price'),'tags',coalesce(v_raw -> 'tags','[]'::jsonb),
      'status',coalesce(v_raw ->> 'status',''),
      'updatedAt',v_raw -> 'updated_at'),
      'taxonomy',pg_catalog.jsonb_build_object('schoolLevels',coalesce(v_raw -> 'school_levels','[]'::jsonb),'gradeLevels',coalesce(v_raw -> 'grade_levels','[]'::jsonb),'subSubject',v_raw -> 'sub_subject'),
      'activeClasses',public.list_management_detail_relation_page_v1('textbooks',p_id,'active_classes') -> 'page',
      'progressSummary',pg_catalog.jsonb_build_object(
        'assignedClasses',(select pg_catalog.count(*) from public.classes class where coalesce(pg_catalog.to_jsonb(class) -> 'textbook_ids','[]'::jsonb) ? p_id::text),
        'updatedSessions',(select pg_catalog.count(*) from public.progress_logs progress where progress.textbook_id=p_id),
        'lastUpdatedAt',(select pg_catalog.max(progress.updated_at) from public.progress_logs progress where progress.textbook_id=p_id)),
      'purchaseHistory',public.list_management_detail_relation_page_v1('textbooks',p_id,'purchase_history') -> 'page');
  end if;
  return v_detail;
end
$function$;

CREATE OR REPLACE FUNCTION public.list_management_detail_relation_page_v1(p_kind text, p_id uuid, p_relation_kind text, p_cursor_sort_key text DEFAULT NULL::text, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_allowed boolean;
  v_rows jsonb;
  v_count integer;
  v_next_sort_key text;
  v_next_id uuid;
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  v_allowed := (p_kind = 'students' and p_relation_kind in ('enrollments','lifecycle_history','class_picker'))
    or (p_kind = 'classes' and p_relation_kind in ('registered_students','waitlisted_students'))
    or (p_kind = 'textbooks' and p_relation_kind in ('active_classes','purchase_history'));
  if not v_allowed or p_id is null then raise exception 'management_relation_invalid' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 30 then raise exception 'management_page_limit_invalid' using errcode = '22023'; end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then raise exception 'management_cursor_invalid' using errcode = '22023'; end if;

  if p_kind = 'students' and p_relation_kind = 'lifecycle_history' then
    with page as (
      select history.id, history.changed_at::text sort_value,
        pg_catalog.jsonb_build_object(
          'id',history.id,'classId',history.class_id,'className',class.name,'subject',class.subject,
          'teacher',class.teacher,
          'eventType',history.action,'action',history.action,
          'label',case history.action when 'enrolled' then '수강 등록' when 'waitlist' then '대기 등록' when 'removed' then '수강 해제' else history.action end,
          'occurredAt',history.changed_at,'changedAt',history.changed_at,'safeSummary',coalesce(history.memo,'')) row_data
      from public.student_class_enrollment_history history
      left join public.classes class on class.id=history.class_id
      where history.student_id = p_id and (p_cursor_sort_key is null or history.changed_at < p_cursor_sort_key::timestamptz or (history.changed_at = p_cursor_sort_key::timestamptz and history.id > p_cursor_id))
      order by history.changed_at desc, history.id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id asc) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id asc) ordinal from page) bounded;
  elsif p_kind = 'students' and p_relation_kind = 'class_picker' then
    with page as (
      select class.id, coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object(
          'id',class.id,'name',class.name,'subject',class.subject,'grade',class.grade,'status',class.status,
          'schedule',class.schedule,
          'teacher',class.teacher,
          'classroom',class.room
        ) row_data
      from public.classes class
      where p_cursor_sort_key is null or coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
        or (coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and class.id > p_cursor_id)
      order by sort_value asc,class.id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  elsif p_kind = 'students' then
    with canonical as (
      select class_id,status,sort_at,event_id from dashboard_private.management_student_enrollments_v1(p_id)
    ), page as (
      select canonical.event_id id,canonical.sort_at::text sort_value,
        pg_catalog.jsonb_build_object(
          'classId',class.id,'className',class.name,'name',class.name,'subject',class.subject,
          'teacher',class.teacher,
          'classroom',class.room,
          'schedule',class.schedule,'status',canonical.status,'startedOn',null,'endedOn',null) row_data
      from canonical join public.classes class on class.id=canonical.class_id
      where p_cursor_sort_key is null or canonical.sort_at < p_cursor_sort_key::timestamptz or (canonical.sort_at=p_cursor_sort_key::timestamptz and canonical.event_id > p_cursor_id)
      order by canonical.sort_at desc,canonical.event_id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id) ordinal from page) bounded;
  elsif p_kind = 'classes' then
    with selected_class as (
      select case when p_relation_kind='registered_students'
        then coalesce(class.student_ids,'[]'::jsonb)
        else coalesce(class.waitlist_ids,'[]'::jsonb)
      end student_ids
      from public.classes class where class.id = p_id
    ), page as (
      select student.id, coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object(
          'id',student.id,'name',student.name,'school',student.school,'grade',student.grade,'status',student.status,
          'contact',student.contact,'parentContact',student.parent_contact,
          'recentIssue',student.recent_issue) row_data
      from public.students student cross join selected_class
      where selected_class.student_ids ? student.id::text
        and (p_cursor_sort_key is null or coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
          or (coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and student.id > p_cursor_id))
      order by sort_value asc,student.id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  elsif p_relation_kind = 'active_classes' then
    with page as (
      select class.id, coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object(
          'id',class.id,'name',class.name,'subject',class.subject,
          'teacherName',class.teacher
        ) row_data
      from public.classes class where coalesce(class.textbook_ids,'[]'::jsonb) ? p_id::text
        and (p_cursor_sort_key is null or coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
          or (coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and class.id > p_cursor_id))
      order by sort_value asc,class.id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  else
    with page as (
      select line.id, line.created_at::text sort_value,
        pg_catalog.jsonb_build_object('id',line.id,'status',purchase_order.status,'quantity',line.requested_quantity,'requestedAt',line.created_at) row_data
      from public.textbook_purchase_order_lines line
      join public.textbook_purchase_orders purchase_order on purchase_order.id = line.purchase_order_id
      where line.textbook_id = p_id
        and (p_cursor_sort_key is null or line.created_at < p_cursor_sort_key::timestamptz or (line.created_at = p_cursor_sort_key::timestamptz and line.id > p_cursor_id))
      order by line.created_at desc,line.id asc limit p_limit + 1
    ) select coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id) ordinal from page) bounded;
  end if;
  return pg_catalog.jsonb_build_object('kind',p_kind,'relationKind',p_relation_kind,'page',pg_catalog.jsonb_build_object(
    'rows',v_rows,
    'hasMore',v_count > p_limit,
    'nextCursor',case when v_count > p_limit then pg_catalog.jsonb_build_object('sortValue',v_next_sort_key,'id',v_next_id) else null end
  ));
end
$function$;

CREATE OR REPLACE FUNCTION public.list_management_class_textbook_candidates_v1(p_class_id uuid, p_search text, p_filters jsonb, p_cursor_sort_key text, p_cursor_id uuid, p_limit integer)
 RETURNS TABLE(row_data jsonb, sort_key text, id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  return query
with valid_input as (
    select 1
    where pg_catalog.jsonb_typeof(p_filters) = 'object'
      and p_filters ?& array['subject','schoolLevel','gradeLevel','subSubject']
      and not exists (select 1 from pg_catalog.jsonb_object_keys(p_filters) key where key not in ('subject','schoolLevel','gradeLevel','subSubject'))
      and not exists (select 1 from pg_catalog.jsonb_each(p_filters) entry where pg_catalog.jsonb_typeof(entry.value) <> 'string')
  ), selected_class as (
    select class.id
    from public.classes class
    where class.id = p_class_id
  ), textbook_source as (
    select textbook.id,pg_catalog.jsonb_build_object(
      'title',textbook.title,'name',textbook.name,'subject',textbook.subject,'publisher',textbook.publisher,
      'school_level',textbook.school_level,'grade_level',textbook.grade_level,
      'school_levels',pg_catalog.to_jsonb(textbook.school_levels),'grade_levels',pg_catalog.to_jsonb(textbook.grade_levels),
      'sub_subject',textbook.sub_subject,'subject_area_key',textbook.subject_area_key
    ) raw
    from public.textbooks textbook
  ), candidate as (
    select textbook.id,textbook.raw,
      coalesce(
        nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(textbook.raw ->> 'title',textbook.raw ->> 'name')), '[[:space:]]+', ' ', 'g'), ''),
        U&'\FFFF'
      ) collate dashboard_private.ko_numeric normalized_sort
    from textbook_source textbook
    cross join selected_class
    cross join valid_input
    where p_search is not null
      and (p_search = '' or pg_catalog.concat_ws(' ',textbook.raw ->> 'title',textbook.raw ->> 'name',textbook.raw ->> 'subject',textbook.raw ->> 'publisher',textbook.raw ->> 'school_levels',textbook.raw ->> 'grade_levels',textbook.raw ->> 'sub_subject') ilike '%' || p_search || '%')
      and (p_filters ->> 'subject' = '' or textbook.raw ->> 'subject' = p_filters ->> 'subject')
      and (p_filters ->> 'schoolLevel' = '' or textbook.raw ->> 'school_level' = p_filters ->> 'schoolLevel' or coalesce(textbook.raw -> 'school_levels','[]'::jsonb) ? (p_filters ->> 'schoolLevel'))
      and (p_filters ->> 'gradeLevel' = '' or textbook.raw ->> 'grade_level' = p_filters ->> 'gradeLevel' or coalesce(textbook.raw -> 'grade_levels','[]'::jsonb) ? (p_filters ->> 'gradeLevel'))
      and (p_filters ->> 'subSubject' = '' or textbook.raw ->> 'sub_subject' = p_filters ->> 'subSubject')
  )
  select pg_catalog.jsonb_build_object(
      'id',candidate.id,
      'title',coalesce(candidate.raw ->> 'title',candidate.raw ->> 'name',''),
      'subject',candidate.raw ->> 'subject',
      'publisher',candidate.raw ->> 'publisher',
      'school_levels',coalesce(candidate.raw -> 'school_levels','[]'::jsonb),
      'grade_levels',coalesce(candidate.raw -> 'grade_levels','[]'::jsonb),
      'sub_subject',candidate.raw ->> 'sub_subject',
      'subject_area_key',candidate.raw ->> 'subject_area_key'
    ),candidate.normalized_sort::text,candidate.id
  from candidate
  where p_class_id is not null
    and p_limit between 1 and 30
    and ((p_cursor_sort_key is null and p_cursor_id is null)
      or candidate.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (candidate.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and candidate.id > p_cursor_id))
  order by candidate.normalized_sort asc,candidate.id asc
  limit p_limit + 1;
end
$function$;

CREATE OR REPLACE FUNCTION textbook_settings_private.guard_read_v1()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role() in ('teacher','assistant') then raise exception 'management_read_forbidden' using errcode='42501';end if;
  if auth.uid() is null
    or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff', 'teacher', 'assistant', 'viewer') then
    raise exception 'textbook_settings_forbidden' using errcode = '42501';
  end if;
end
$function$;

commit;
