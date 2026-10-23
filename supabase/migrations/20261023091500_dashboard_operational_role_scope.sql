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
      and (v_role is distinct from 'teacher' or task.type not in('registration','transfer','withdrawal','textbook'))
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
    or (v_role = 'teacher' and p_task.type in ('registration','transfer','withdrawal','textbook'))
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
    or (public.current_dashboard_role() = 'teacher' and nullif(pg_catalog.btrim(dashboard_private.ops_task_input_task_v2(p_input)->>'type'),'') in ('registration','transfer','withdrawal','textbook')) then
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
  if v_actor_id is null or v_role not in ('admin', 'staff', 'teacher')
    or (v_role = 'teacher' and not exists (
      select 1 from auth.users u where u.id=v_actor_id and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
    )) then
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

-- A new teacher submission is the only operational write exception. Reuse the
-- existing atomic request ledger; this does not create an ops task or send alerts.
create function public.submit_teacher_textbook_request_v1(p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare fingerprint text; replay jsonb; result jsonb;
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=auth.uid() and p.role='teacher' and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=now())) then
  raise exception 'textbook_request_access_denied' using errcode='42501';
 end if;
 if p_request_id is null or jsonb_typeof(p_input) is distinct from 'object'
   or not (p_input ?& array['title','textbookId','classId','locationId','studentQuantity','teacherQuantity','memo'])
   or (select count(*) from jsonb_object_keys(p_input))<>7
   or jsonb_typeof(p_input->'title') is distinct from 'string'
   or jsonb_typeof(p_input->'memo') is distinct from 'string'
   or exists(select 1 from unnest(array['textbookId','classId','locationId'])k
     where jsonb_typeof(p_input->k) not in('string','null'))
   or exists(select 1 from unnest(array['studentQuantity','teacherQuantity'])k
     where jsonb_typeof(p_input->k) is distinct from 'number'
       or (p_input->>k)!~'^(0|[1-9][0-9]*)$'
       or (p_input->>k)::numeric>2147483647) then
  raise exception 'textbook_request_input_invalid' using errcode='22023';
 end if;
 fingerprint:=md5(jsonb_build_object('actor',auth.uid(),'input',p_input)::text);
 replay:=dashboard_private.ops_task_request_replay_v2(p_request_id,'submit_teacher_textbook_request_v1',fingerprint);
 if replay is not null then return replay;end if;
 result:=public.create_textbook_request_v1((p_input->>'textbookId')::uuid,p_input->>'title',
   (p_input->>'classId')::uuid,(p_input->>'locationId')::uuid,
   (p_input->>'studentQuantity')::integer,(p_input->>'teacherQuantity')::integer,p_input->>'memo');
 return dashboard_private.finish_ops_task_request_v2(p_request_id,'submit_teacher_textbook_request_v1',fingerprint,
   jsonb_build_object('orderId',result#>>'{order,id}'));
end $f$;
alter function public.submit_teacher_textbook_request_v1(uuid,jsonb) owner to postgres;
revoke all on function public.submit_teacher_textbook_request_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.submit_teacher_textbook_request_v1(uuid,jsonb) to authenticated;

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

create policy academy_curriculum_period_catalogs_assistant_scope_v1 on public.academy_curriculum_period_catalogs as restrictive for all to authenticated
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

create policy class_schedule_sync_group_members_assistant_scope_v1 on public.class_schedule_sync_group_members as restrictive for all to authenticated
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

create policy textbook_publisher_supplier_links_assistant_scope_v1 on public.textbook_publisher_supplier_links as restrictive for all to authenticated
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
    raise exception 'ops_task_stale_write' using errcode = '23514';
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
      raise exception 'ops_transition_closed' using errcode = '23514';
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
      raise exception 'word_retest_score_update_not_allowed' using errcode = '23514';
    end if;
    if v_before.status in ('done', 'canceled')
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) <> v_before.status
    then
      raise exception 'word_retest_closed' using errcode = '23514';
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
      raise exception 'word_retest_completion_not_allowed' using errcode = '23514';
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
    raise exception 'ops_task_stale_write' using errcode = '23514';
  end if;
  if v_before.type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;
  if v_before.type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_before.type in ('transfer', 'withdrawal') then
    if v_before.status = 'done' and p_status <> 'done' then
      raise exception 'ops_transition_closed' using errcode = '23514';
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
      raise exception 'word_retest_closed' using errcode = '23514';
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
      raise exception 'word_retest_completion_not_allowed' using errcode = '23514';
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
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role in('assistant','teacher') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
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


-- Teacher common operations read extension
create function dashboard_private.teacher_operational_common_ops_v1(p jsonb) returns jsonb language plpgsql stable set search_path='' as $f$
declare result jsonb;
begin
 if p is null then return null;end if;
 result:=jsonb_build_object('requestedTeam',coalesce(p->>'requestedTeam',''),'assigneeTeam',coalesce(p->>'assigneeTeam',''),'studentName',coalesce(p->>'studentName',''),'className',coalesce(p->>'className',''),'textbookTitle',coalesce(p->>'textbookTitle',''),'campus',coalesce(p->>'campus',''),'subject',coalesce(p->>'subject',''),'id',p->'id','type',p->'type','status',p->'status','priority',p->'priority','requestedById',p->'requestedById','assigneeId',p->'assigneeId','secondaryAssigneeId',p->'secondaryAssigneeId','studentId',p->'studentId','classId',p->'classId','textbookId',p->'textbookId','startAt',p->'startAt','dueAt',p->'dueAt','completedAt',p->'completedAt','createdAt',p->'createdAt','updatedAt',p->'updatedAt','completedById',p->'completedById','title',concat_ws(' ',case p->>'type' when 'registration' then '등록' when 'transfer' then '전반' else '퇴원' end,p->>'studentName'),'memo','','summaryFlags','[]'::jsonb,'requestedByLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=nullif(p->>'requestedById','')::uuid),''),'assigneeLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=nullif(p->>'assigneeId','')::uuid),''),'secondaryAssigneeLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=nullif(p->>'secondaryAssigneeId','')::uuid),''),'completedByLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=nullif(p->>'completedById','')::uuid),''));
 if p->>'type'='registration' then return result||jsonb_build_object('registration',jsonb_build_object('pipelineStatus',coalesce(p#>>'{registration,pipelineStatus}',''),'schoolGrade',coalesce(p#>>'{registration,schoolGrade}',''),'schoolName',coalesce(p#>>'{registration,schoolName}',''),'classStartSession',coalesce(p#>>'{registration,classStartSession}',''),'inquiryAt',p#>'{registration,inquiryAt}','levelTestAt',p#>'{registration,levelTestAt}','levelTestCompletedAt',p#>'{registration,levelTestCompletedAt}','phoneConsultationAt',p#>'{registration,phoneConsultationAt}','visitConsultationAt',p#>'{registration,visitConsultationAt}','consultationAt',p#>'{registration,consultationAt}','classStartDate',p#>'{registration,classStartDate}','parentPhone','','studentPhone','','levelTestResult','','levelTestPlace','','levelTestMaterialLink','','counselor','','requestNote',''),'registrationTracks',coalesce((select jsonb_agg(jsonb_build_object('directorName',coalesce(t->>'directorName',''),'waitingKind',coalesce(t->>'waitingKind',''),'waitingDetailKind',coalesce(t->>'waitingDetailKind',''),'id',t->'id','taskId',t->'taskId','subject',t->'subject','status',t->'status','workflowStatus',t->'workflowStatus','workflowRevision',t->'workflowRevision','workflowStatusEnteredAt',t->'workflowStatusEnteredAt','legacy',t->'legacy','directorProfileId',t->'directorProfileId','waitingDetailClassId',t->'waitingDetailClassId','migrationReviewRequired',t->'migrationReviewRequired','stageEnteredAt',t->'stageEnteredAt','phoneReadyAt',t->'phoneReadyAt','phoneReadySource',t->'phoneReadySource','levelTestScheduledAt',t->'levelTestScheduledAt','visitScheduledAt',t->'visitScheduledAt','observationCurrentId',t->'observationCurrentId','observationCurrentStatus',t->'observationCurrentStatus','observationCurrentAppointmentId',t->'observationCurrentAppointmentId','observationNearestScheduledAt',t->'observationNearestScheduledAt','observationNearestPlace',t->'observationNearestPlace','directorAssignmentSource','','directorAssignmentRuleKey','','waitingDetailRetakeDecision','','levelTestRetakeDecision','','enrollmentDetailRows','[]'::jsonb,'levelTestPlace',null,'visitPlace',null,'observationAttemptCount',null,'observationNotificationRevision',null,'observationRevision',null,'observationFeedbackRevision',null,'observationSummaryVisible',false) order by ord) from jsonb_array_elements(coalesce(p->'registrationTracks','[]')) with ordinality a(t,ord)),'[]'));
 elsif p->>'type'='withdrawal' then return result||jsonb_build_object('inlineState',jsonb_build_object('teacherName',coalesce(p#>>'{inlineState,teacherName}',''),'withdrawalSession',coalesce(p#>>'{inlineState,withdrawalSession}',''),'withdrawalDate',p#>'{inlineState,withdrawalDate}','makeeduWithdrawalDone',p#>'{inlineState,makeeduWithdrawalDone}','feeProcessed',p#>'{inlineState,feeProcessed}','textbookFeeProcessed',p#>'{inlineState,textbookFeeProcessed}','customerReason','','teacherOpinion','','undistributedTextbooks','','completedLessonHours',null,'fourWeekLessonHours',null),'displayValues',jsonb_build_object('status',coalesce(p#>>'{displayValues,status}',''),'subject',coalesce(p#>>'{displayValues,subject}',''),'teacher',coalesce(p#>>'{displayValues,teacher}',''),'className',coalesce(p#>>'{displayValues,className}',''),'student',coalesce(p#>>'{displayValues,student}',''),'withdrawalDate',coalesce(p#>>'{displayValues,withdrawalDate}',''),'withdrawalSession',coalesce(p#>>'{displayValues,withdrawalSession}',''),'completedLessonHours','','fourWeekLessonHours','','progress','','customerReason','','teacherOpinion','','undistributedTextbooks','','operationsChecklist',''));
 elsif p->>'type'='transfer' then return result||jsonb_build_object('inlineState',jsonb_build_object('fromTeacherName',coalesce(p#>>'{inlineState,fromTeacherName}',''),'toTeacherName',coalesce(p#>>'{inlineState,toTeacherName}',''),'fromClassName',coalesce(p#>>'{inlineState,fromClassName}',''),'toClassName',coalesce(p#>>'{inlineState,toClassName}',''),'fromClassEndSession',coalesce(p#>>'{inlineState,fromClassEndSession}',''),'toClassStartSession',coalesce(p#>>'{inlineState,toClassStartSession}',''),'fromClassId',p#>'{inlineState,fromClassId}','toClassId',p#>'{inlineState,toClassId}','fromClassEndDate',p#>'{inlineState,fromClassEndDate}','toClassStartDate',p#>'{inlineState,toClassStartDate}','makeeduTransferDone',p#>'{inlineState,makeeduTransferDone}','feeProcessed',p#>'{inlineState,feeProcessed}','textbookFeeProcessed',p#>'{inlineState,textbookFeeProcessed}','transferReason','','fromUndistributedTextbooks','','toUndistributedTextbooks',''),'displayValues',jsonb_build_object('status',coalesce(p#>>'{displayValues,status}',''),'subject',coalesce(p#>>'{displayValues,subject}',''),'fromTeacher',coalesce(p#>>'{displayValues,fromTeacher}',''),'fromClassName',coalesce(p#>>'{displayValues,fromClassName}',''),'student',coalesce(p#>>'{displayValues,student}',''),'fromClassEndDate',coalesce(p#>>'{displayValues,fromClassEndDate}',''),'fromClassEndSession',coalesce(p#>>'{displayValues,fromClassEndSession}',''),'toTeacher',coalesce(p#>>'{displayValues,toTeacher}',''),'toClassName',coalesce(p#>>'{displayValues,toClassName}',''),'toClassStartDate',coalesce(p#>>'{displayValues,toClassStartDate}',''),'toClassStartSession',coalesce(p#>>'{displayValues,toClassStartSession}',''),'transferReason','','fromUndistributedTextbooks','','toUndistributedTextbooks','','operationsChecklist',''));
 end if;
 raise exception 'operational_common_read_invalid' using errcode='22023';
end $f$;

create function dashboard_private.assert_teacher_operational_filters_v1(p_type text,p_filters jsonb) returns void language plpgsql stable set search_path='' as $f$
declare allowed text[];k text;
begin
 if p_type is null or p_type not in('registration','transfer','withdrawal') then raise exception 'operational_common_read_forbidden' using errcode='42501';end if;
 perform dashboard_private.ops_task_page_assert_filters_v1(p_type,p_filters);
 allowed:=case p_type when 'withdrawal' then array['status','subject','teacher','className','student','withdrawalDate','withdrawalSession'] else array['status','subject','fromTeacher','fromClassName','student','fromClassEndDate','fromClassEndSession','toTeacher','toClassName','toClassStartDate','toClassStartSession'] end;
 if p_type in('withdrawal','transfer') then
  foreach k in array array['filterColumn','sortColumn'] loop
   if nullif(p_filters->>k,'') is not null and not(p_filters->>k=any(allowed)) then raise exception 'operational_common_filter_forbidden' using errcode='42501';end if;
  end loop;
 end if;
end $f$;

CREATE OR REPLACE FUNCTION dashboard_private.ops_task_numbered_keys_v1(p_type text, p_filters jsonb)
 RETURNS TABLE(id uuid, matching_track_id uuid, task_status text, priority_rank integer, workflow_status_rank integer, date_bucket integer, primary_date timestamp with time zone, completed_sort_at timestamp with time zone, recency_at timestamp with time zone, effective_test_at timestamp with time zone, effective_created_at timestamp with time zone, registration_representative_priority integer, registration_representative_at timestamp with time zone, display_text text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Seoul'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$#variable_conflict use_column
begin
  return query

  with base as (
    select
      task.*, task as task_row,
      coalesce(nullif(pg_catalog.btrim(requester.name), ''), nullif(pg_catalog.btrim(requester.email), ''), '') as requester_label,
      coalesce(nullif(pg_catalog.btrim(assignee.name), ''), nullif(pg_catalog.btrim(assignee.email), ''), '') as assignee_label,
      case task.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as priority_rank,
      case task.status
        when 'requested' then 0 when 'confirmed' then 1 when 'in_progress' then 2
        when 'review_requested' then 3 when 'done' then 4 when 'on_hold' then 5 else 6
      end as workflow_status_rank,
      coalesce(task.due_at, task.start_at) as primary_date,
      case
        when coalesce(task.due_at, task.start_at) is null then 3
        when coalesce(task.due_at, task.start_at) < current_date then 0
        when coalesce(task.due_at, task.start_at) < current_date + interval '1 day' then 1
        else 2
      end as date_bucket
    from public.ops_tasks task
    left join public.profiles requester on p_type = 'word_retest' and p_filters ->> 'tableSortColumn' = 'teacher' and requester.id = task.requested_by
    left join public.profiles assignee on p_type = 'word_retest' and p_filters ->> 'tableSortColumn' = 'teacher' and assignee.id = task.assignee_id
    where case when p_type = 'general' then task.type in ('general','textbook') else task.type = p_type end
      and (
        pg_catalog.jsonb_array_length(p_filters -> 'statuses') = 0
        or task.status in (select item #>> '{}' from pg_catalog.jsonb_array_elements(p_filters -> 'statuses') item)
      )
      and (
        nullif(pg_catalog.btrim(p_filters ->> 'search'), '') is null
        or p_type = 'registration'
        or (p_type in ('withdrawal','transfer') and (p_filters -> 'filterColumn') <> 'null'::jsonb)
        or pg_catalog.concat_ws(' ', (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else task.title end), task.student_name, task.class_name, task.textbook_title, task.subject, task.campus)
          ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%'
      )

  ), common as (select * from base), shaped as (    select
      common.id,
      null::uuid as matching_track_id,
      common.status as task_status,
      common.priority_rank,
      common.workflow_status_rank,
      common.date_bucket,
      common.primary_date,
      coalesce(common.completed_at, common.updated_at, common.created_at) as completed_sort_at,
      coalesce(common.created_at, common.updated_at) as recency_at,
      null::timestamptz as effective_test_at,
      common.created_at as effective_created_at,
      null::integer as registration_representative_priority,
      null::timestamptz as registration_representative_at,
      ''::text as display_text
    from common
    where p_type = 'general'
      and (
        nullif(p_filters ->> 'requestedById','') is null
        or (p_filters ->> 'requestedById' = '__unassigned__' and common.requested_by is null)
        or common.requested_by::text = p_filters ->> 'requestedById'
      )
      and (
        nullif(p_filters ->> 'requestedTeam','') is null
        or (p_filters ->> 'requestedTeam' = '__unassigned__' and nullif(pg_catalog.btrim(common.requested_team), '') is null)
        or common.requested_team = p_filters ->> 'requestedTeam'
      )
      and (
        nullif(p_filters ->> 'assigneeId','') is null
        or (p_filters ->> 'assigneeId' = '__unassigned__' and common.assignee_id is null and common.secondary_assignee_id is null)
        or common.assignee_id::text = p_filters ->> 'assigneeId'
        or common.secondary_assignee_id::text = p_filters ->> 'assigneeId'
      )
      and (
        nullif(p_filters ->> 'assigneeTeam','') is null
        or (p_filters ->> 'assigneeTeam' = '__unassigned__' and nullif(pg_catalog.btrim(common.assignee_team), '') is null)
        or common.assignee_team = p_filters ->> 'assigneeTeam'
      )
      and (
        (p_filters ->> 'queue' = 'completed' and common.status in ('done','canceled'))
        or (p_filters ->> 'queue' = 'inbox' and common.status not in ('done','canceled') and (
          (common.status = 'review_requested' and common.requested_by = (select auth.uid()))
          or (common.status <> 'review_requested' and ((common.assignee_id = (select auth.uid())) or (common.secondary_assignee_id = (select auth.uid()))))
        ))
        or (p_filters ->> 'queue' = 'sent' and common.status not in ('done','canceled') and (
          (common.status = 'review_requested' and ((common.assignee_id = (select auth.uid())) or (common.secondary_assignee_id = (select auth.uid()))))
          or (common.status <> 'review_requested' and common.requested_by = (select auth.uid()))
        ))
      )
      and case p_filters ->> 'focus'
        when 'today' then common.primary_date >= current_date and common.primary_date < current_date + interval '1 day'
        when 'overdue' then common.primary_date < current_date and common.status not in ('done','canceled')
        when 'mine' then common.assignee_id = (select auth.uid()) or common.secondary_assignee_id = (select auth.uid())
        when 'unassigned' then common.assignee_id is null or common.primary_date is null
        when 'confirmation' then common.status = 'review_requested'
        else true
      end

    union all

    select
      common.id,
      matching_track.matching_track_id,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      matching_track.registration_representative_priority,
      matching_track.registration_representative_at,
      ''::text
    from common
    left join public.ops_registration_details detail on detail.task_id = common.id
    left join lateral (
      select
        summary.id as matching_track_id,
        case
          when p_filters ->> 'view' = 'consultation_requested'
            and summary.pipeline_status = 'consultation_waiting' then 0
          when p_filters ->> 'view' = 'consultation_requested' then 1
          else 0
        end as registration_representative_priority,
        case
          when p_filters ->> 'view' = 'consultation_requested'
            and summary.pipeline_status = 'consultation_waiting' then summary.phone_ready_at
          else null
        end as registration_representative_at
      from (
        select track.id, track.task_id, track.subject, track.pipeline_status,
          track.workflow_status, track.director_profile_id,
          active_visit.place as visit_place, active_phone.ready_at as phone_ready_at
        from public.ops_registration_subject_tracks track
        left join lateral (
          select appointment.place
          from public.ops_registration_consultations consultation
          join public.ops_registration_appointments appointment
            on appointment.id = consultation.appointment_id
          where consultation.track_id = track.id
            and consultation.mode = 'visit' and consultation.status = 'scheduled'
            and appointment.kind = 'visit_consultation' and appointment.status = 'scheduled'
          order by consultation.created_at desc, consultation.id desc
          limit 1
        ) active_visit on true
        left join lateral (
          select consultation.ready_at
          from public.ops_registration_consultations consultation
          where consultation.track_id = track.id
            and consultation.mode = 'phone' and consultation.status = 'waiting'
          order by consultation.created_at desc, consultation.id desc
          limit 1
        ) active_phone on true
        where track.archived_at is null
      ) summary
      left join public.profiles matching_director on matching_director.id = summary.director_profile_id
      where summary.task_id = common.id
        and case p_filters ->> 'view'
          when 'inquiry' then summary.workflow_status = 'inquiry'
          when 'level_test' then summary.workflow_status = 'level_test_requested'
          when 'consultation_requested' then summary.workflow_status = 'consultation_requested'
          when 'consultation_completed' then summary.workflow_status = 'consultation_completed'
          when 'waiting' then summary.workflow_status in ('waiting_current_class','waiting_new_class','waiting_next_opening')
          when 'observation' then summary.workflow_status in ('observation_requested','observation_feedback_pending','observation_completed')
          when 'enrollment' then summary.workflow_status = 'enrollment_requested'
          when 'payment' then summary.workflow_status = 'payment_in_progress'
          when 'completed' then summary.workflow_status in ('registered','not_registered','inquiry_only')
          else false
        end
        and (
          p_filters ->> 'view' not in ('consultation_requested','consultation_completed')
          or nullif(p_filters ->> 'consultationOwnerId','') is null
          or summary.director_profile_id::text = p_filters ->> 'consultationOwnerId'
        )
        and (
          nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g'), '') is null
          or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.concat_ws(' ',
            common.student_name,
            (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else common.title end),
            (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.parent_phone end),
            (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.student_phone end),
            detail.school_grade,
            detail.school_name,
            (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.request_note end),
            summary.subject,
            matching_director.name,
            case when (select public.current_dashboard_role())='teacher' then null else summary.visit_place end
          )), '[[:space:]-]+', '', 'g') like '%' ||
            pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          or exists (
            select 1
            from (select task_id, workflow_status, director_profile_id, subject
              from public.ops_registration_subject_tracks where archived_at is null) search_track
            where search_track.task_id = common.id
              and case p_filters ->> 'view'
                when 'inquiry' then search_track.workflow_status = 'inquiry'
                when 'level_test' then search_track.workflow_status = 'level_test_requested'
                when 'consultation_requested' then search_track.workflow_status = 'consultation_requested'
                when 'consultation_completed' then search_track.workflow_status = 'consultation_completed'
                when 'waiting' then search_track.workflow_status in ('waiting_current_class','waiting_new_class','waiting_next_opening')
                when 'observation' then search_track.workflow_status in ('observation_requested','observation_feedback_pending','observation_completed')
                when 'enrollment' then search_track.workflow_status = 'enrollment_requested'
                when 'payment' then search_track.workflow_status = 'payment_in_progress'
                when 'completed' then search_track.workflow_status in ('registered','not_registered','inquiry_only')
                else false
              end
              and (
                p_filters ->> 'view' not in ('consultation_requested','consultation_completed')
                or nullif(p_filters ->> 'consultationOwnerId','') is null
                or search_track.director_profile_id::text = p_filters ->> 'consultationOwnerId'
              )
              and pg_catalog.regexp_replace(pg_catalog.lower(search_track.subject), '[[:space:]-]+', '', 'g') like '%' ||
                pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          )
        )
      order by
        case when summary.pipeline_status = 'consultation_waiting' then 0 else 1 end,
        case when summary.pipeline_status = 'consultation_waiting' then summary.phone_ready_at end asc nulls last,
        summary.id asc
      limit 1
    ) matching_track on true
    where p_type = 'registration'
      and (
        matching_track.matching_track_id is not null
        or (
          p_filters ->> 'view' = 'inquiry'
          and not exists (
            select 1
            from (select task_id from public.ops_registration_subject_tracks
              where archived_at is null) active_track
            where active_track.task_id = common.id
          )
          and (
            nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g'), '') is null
            or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.concat_ws(' ', common.student_name, (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else common.title end), (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.parent_phone end), (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.student_phone end), detail.school_grade, detail.school_name, (case when public.current_dashboard_role()='teacher' and p_type in ('registration','transfer','withdrawal') then null else detail.request_note end))), '[[:space:]-]+', '', 'g') like '%' || pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          )
        )
      )

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      dashboard_private.ops_withdrawal_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'sortColumn')
    from common
    join public.ops_withdrawal_details detail on detail.task_id = common.id
    where p_type = 'withdrawal'
      and (nullif(p_filters ->> 'subject','') is null or common.subject = p_filters ->> 'subject' or (p_filters ->> 'subject' = '-' and nullif(pg_catalog.btrim(common.subject), '') is null))
      and (nullif(p_filters ->> 'teacher','') is null or detail.teacher_name = p_filters ->> 'teacher' or (p_filters ->> 'teacher' = '미지정' and nullif(pg_catalog.btrim(detail.teacher_name), '') is null))
      and case p_filters ->> 'view'
        when 'applicant' then common.status = 'requested'
        when 'operations' then common.status in ('confirmed','in_progress','on_hold','review_requested')
        else common.status in ('done','canceled')
      end
      and case p_filters ->> 'period'
        when 'today' then current_date = any(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date])
        when 'week' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7)
        when 'month' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value >= pg_catalog.date_trunc('month', current_date)::date and value < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date)
        when 'custom' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date)
        else true
      end
      and (nullif(p_filters ->> 'filterColumn','') is null or dashboard_private.ops_withdrawal_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      dashboard_private.ops_transfer_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'sortColumn')
    from common
    join public.ops_transfer_details detail on detail.task_id = common.id
    where p_type = 'transfer'
      and (nullif(p_filters ->> 'subject','') is null or common.subject = p_filters ->> 'subject' or (p_filters ->> 'subject' = '-' and nullif(pg_catalog.btrim(common.subject), '') is null))
      and (nullif(p_filters ->> 'teacher','') is null or detail.from_teacher_name = p_filters ->> 'teacher' or (p_filters ->> 'teacher' = '미지정' and nullif(pg_catalog.btrim(detail.from_teacher_name), '') is null))
      and case p_filters ->> 'view'
        when 'applicant' then common.status = 'requested'
        when 'operations' then common.status in ('confirmed','in_progress','on_hold','review_requested')
        else common.status in ('done','canceled')
      end
      and case p_filters ->> 'period'
        when 'today' then current_date = any(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date])
        when 'week' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7)
        when 'month' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value >= pg_catalog.date_trunc('month', current_date)::date and value < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date)
        when 'custom' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date)
        else true
      end
      and (nullif(p_filters ->> 'filterColumn','') is null or dashboard_private.ops_transfer_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, coalesce(detail.test_at, common.due_at, common.start_at),
      coalesce(common.created_at, common.updated_at),
      null::integer, null::timestamptz,
      dashboard_private.ops_word_retest_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'tableSortColumn', common.assignee_label, common.requester_label)
    from common
    join public.ops_word_retests detail on detail.task_id = common.id
    where p_type = 'word_retest'
      and (nullif(p_filters ->> 'branch','') is null or detail.branch = p_filters ->> 'branch')
      and (
        nullif(p_filters ->> 'teacherId','') is null
        or detail.teacher_catalog_id::text = p_filters ->> 'teacherId'
        or (
          p_filters ->> 'teacherId' like 'teacher_name:%'
          and nullif(pg_catalog.btrim(detail.teacher_name), '') = pg_catalog.substr(p_filters ->> 'teacherId', 14)
        )
        or (
          p_filters ->> 'teacherId' = '__unassigned__'
          and detail.teacher_catalog_id is null
          and nullif(pg_catalog.btrim(detail.teacher_name), '') is null
        )
      )
      and (
        nullif(p_filters ->> 'classId','') is null
        or common.class_id::text = p_filters ->> 'classId'
        or (
          p_filters ->> 'classId' like 'class_name:%'
          and coalesce(nullif(pg_catalog.btrim(common.class_name), ''), nullif(pg_catalog.btrim(detail.class_name), '')) = pg_catalog.substr(p_filters ->> 'classId', 12)
        )
        or (
          p_filters ->> 'classId' = '__unassigned__'
          and common.class_id is null
          and nullif(pg_catalog.btrim(coalesce(common.class_name, detail.class_name)), '') is null
        )
      )
      and ((p_filters ->> 'includeClosed')::boolean or common.status not in ('done','canceled'))
      and (
        ((p_filters ->> 'includeClosed')::boolean and common.status in ('done','canceled'))
        or (p_filters ->> 'queue' = 'assistant' and common.status in ('requested','confirmed','in_progress','on_hold'))
        or (p_filters ->> 'queue' = 'teacher' and common.status = 'review_requested')
      )
      and case p_filters ->> 'period'
        when 'today' then coalesce(detail.test_at, common.due_at, common.start_at)::date = current_date
        when 'week' then coalesce(detail.test_at, common.due_at, common.start_at)::date between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7
        when 'month' then coalesce(detail.test_at, common.due_at, common.start_at)::date >= pg_catalog.date_trunc('month', current_date)::date and coalesce(detail.test_at, common.due_at, common.start_at)::date < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date
        when 'custom' then coalesce(detail.test_at, common.due_at, common.start_at)::date between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date
        else true
      end
  )
  select * from shaped;
end;
$function$;

CREATE OR REPLACE FUNCTION dashboard_private.ops_registration_task_stats_v1(p_filters jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Seoul'
AS $function$
  with asserted as materialized (
    select dashboard_private.ops_task_page_assert_filters_v1('registration', p_filters)
  ), base as materialized (
    select
      task.id as task_id,
      task.status as task_status,
      case when public.current_dashboard_role()='teacher' then null else task.title end as title,
      task.student_name,
      case when public.current_dashboard_role()='teacher' then null else detail.parent_phone end as parent_phone,
      case when public.current_dashboard_role()='teacher' then null else detail.student_phone end as student_phone,
      detail.school_grade,
      detail.school_name,
      case when public.current_dashboard_role()='teacher' then null else detail.request_note end as request_note
    from asserted
    cross join public.ops_tasks task
    left join public.ops_registration_details detail on detail.task_id = task.id
    where task.type = 'registration'
      and (
        pg_catalog.jsonb_array_length(p_filters -> 'statuses') = 0
        or task.status in (
          select item #>> '{}'
          from pg_catalog.jsonb_array_elements(p_filters -> 'statuses') item
        )
      )
  ), memberships as materialized (
    select distinct
      base.task_id,
      base.task_status,
      case
        when summary.workflow_status = 'inquiry' then 'inquiry'
        when summary.workflow_status = 'level_test_requested' then 'level_test'
        when summary.workflow_status = 'consultation_requested' then 'consultation_requested'
        when summary.workflow_status = 'consultation_completed' then 'consultation_completed'
        when summary.workflow_status in (
          'waiting_current_class', 'waiting_new_class', 'waiting_next_opening'
        ) then 'waiting'
        when summary.workflow_status in (
          'observation_requested', 'observation_feedback_pending', 'observation_completed'
        ) then 'observation'
        when summary.workflow_status = 'enrollment_requested' then 'enrollment'
        when summary.workflow_status = 'payment_in_progress' then 'payment'
        when summary.workflow_status in ('registered', 'not_registered', 'inquiry_only') then 'completed'
        else null
      end as view_key,
      summary.director_profile_id
    from base
    join (
      select track.task_id, track.workflow_status, track.subject,
        track.director_profile_id, active_visit.place as visit_place
      from public.ops_registration_subject_tracks track
      left join lateral (
        select appointment.place
        from public.ops_registration_consultations consultation
        join public.ops_registration_appointments appointment
          on appointment.id = consultation.appointment_id
        where consultation.track_id = track.id
          and consultation.mode = 'visit' and consultation.status = 'scheduled'
          and appointment.kind = 'visit_consultation' and appointment.status = 'scheduled'
        order by consultation.created_at desc, consultation.id desc
        limit 1
      ) active_visit on true
      where track.archived_at is null
    ) summary
      on summary.task_id = base.task_id
    left join public.profiles director on director.id = summary.director_profile_id
    where nullif(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')),
        '[[:space:]-]+',
        '',
        'g'
      ),
      ''
    ) is null
    or pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.concat_ws(
        ' ',
        base.student_name,
        base.title,
        base.parent_phone,
        base.student_phone,
        base.school_grade,
        base.school_name,
        base.request_note,
        summary.subject,
        director.name,
        case when (select public.current_dashboard_role())='teacher' then null else summary.visit_place end
      )),
      '[[:space:]-]+',
      '',
      'g'
    ) like '%' || pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')),
      '[[:space:]-]+',
      '',
      'g'
    ) || '%'
  ), selected as materialized (
    select distinct memberships.task_id, memberships.task_status
    from memberships
    where memberships.view_key = p_filters ->> 'view'
      and (
        p_filters ->> 'view' not in ('consultation_requested', 'consultation_completed')
        or nullif(p_filters ->> 'consultationOwnerId', '') is null
        or memberships.director_profile_id::text = p_filters ->> 'consultationOwnerId'
      )
  ), status_counts as (
    select selected.task_status, pg_catalog.count(*) as count_value
    from selected
    group by selected.task_status
  ), view_keys(view_key) as (
    values
      ('inquiry'::text),
      ('level_test'::text),
      ('consultation_requested'::text),
      ('consultation_completed'::text),
      ('waiting'::text),
      ('observation'::text),
      ('enrollment'::text),
      ('payment'::text),
      ('completed'::text)
  ), view_counts as (
    select memberships.view_key, pg_catalog.count(distinct memberships.task_id) as count_value
    from memberships
    where memberships.view_key is not null
    group by memberships.view_key
  )
  select pg_catalog.jsonb_build_object(
    'total', (select pg_catalog.count(*) from selected),
    'byStatus', coalesce((
      select pg_catalog.jsonb_object_agg(status_counts.task_status, status_counts.count_value)
      from status_counts
    ), '{}'::jsonb),
    'byView', (
      select pg_catalog.jsonb_object_agg(
        view_keys.view_key,
        coalesce(view_counts.count_value, 0)
      )
      from view_keys
      left join view_counts using (view_key)
    ),
    'metrics', pg_catalog.jsonb_build_object(
      'consultationMine', case
        when p_filters ->> 'view' in ('consultation_requested', 'consultation_completed') then (
          select pg_catalog.count(distinct memberships.task_id)
          from memberships
          where memberships.view_key = p_filters ->> 'view'
            and memberships.director_profile_id = (select auth.uid())
        )
        else 0
      end,
      'consultationAll', case
        when p_filters ->> 'view' in ('consultation_requested', 'consultation_completed') then (
          select pg_catalog.count(distinct memberships.task_id)
          from memberships
          where memberships.view_key = p_filters ->> 'view'
        )
        else 0
      end
    ),
    'facets', '{}'::jsonb
  )
$function$;

CREATE OR REPLACE FUNCTION dashboard_private.ops_task_list_stats_legacy_v1(p_type text, p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  by_view jsonb := '{}'::jsonb;
  metrics jsonb := '{}'::jsonb;
  facets jsonb := '{}'::jsonb;
begin

  if public.current_dashboard_role()='teacher' and p_type in ('transfer','withdrawal') then
    perform dashboard_private.assert_teacher_operational_filters_v1(p_type,p_filters);
    with k as materialized(select * from dashboard_private.ops_task_numbered_keys_v1(p_type,p_filters)),sc as(select task_status,count(*) n from k group by task_status)
    select jsonb_build_object('total',(select count(*) from k),'byStatus',coalesce((select jsonb_object_agg(task_status,n) from sc),'{}')) into result;
    with views(v) as(values('applicant'),('operations'),('closed')),c as(select v,(select count(*) from dashboard_private.ops_task_numbered_keys_v1(p_type,jsonb_set(p_filters,'{view}',to_jsonb(v)))) n from views)
    select jsonb_object_agg(v,n) into by_view from c;
    with k as materialized(select * from dashboard_private.ops_task_numbered_keys_v1(p_type,jsonb_set(p_filters,'{subject}','null'))),c as(select coalesce(nullif(t.subject,''),'-') value,count(*) n from k join public.ops_tasks t on t.id=k.id group by 1)
    select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',value,'count',n) order by value collate dashboard_private.ko_numeric),'[]') into facets from c;
    result:=result||jsonb_build_object('byView',by_view,'metrics','{}'::jsonb,'facets',jsonb_build_object('subject',facets));
    with k as materialized(select * from dashboard_private.ops_task_numbered_keys_v1(p_type,jsonb_set(p_filters,'{teacher}','null'))),c as(
     select coalesce(nullif(case p_type when 'withdrawal' then w.teacher_name else x.from_teacher_name end,''),'미지정') value,count(*) n from k left join public.ops_withdrawal_details w on w.task_id=k.id left join public.ops_transfer_details x on x.task_id=k.id group by 1)
    select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',value,'count',n) order by value collate dashboard_private.ko_numeric),'[]') into facets from c;
    return jsonb_set(result,'{facets,teacher}',facets);
  end if;
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type, p_filters);
  with status_counts as (
    select source.task_status, pg_catalog.count(*) as count_value
    from dashboard_private.ops_task_page_source_v1(p_type, p_filters) source
    group by source.task_status
  )
  select pg_catalog.jsonb_build_object(
    'total', coalesce(pg_catalog.sum(status_counts.count_value), 0),
    'byStatus', coalesce(pg_catalog.jsonb_object_agg(status_counts.task_status, status_counts.count_value), '{}'::jsonb)
  )
  into result
  from status_counts;

  if p_type = 'general' then
    with sibling(view_key) as (
      values ('inbox'::text), ('sent'::text), ('completed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{queue}', pg_catalog.to_jsonb(sibling.view_key))
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    with focus_keys(metric_key) as (
      values ('today'::text), ('overdue'::text), ('mine'::text), ('unassigned'::text), ('confirmation'::text)
    ), counts as (
      select focus_keys.metric_key, pg_catalog.count(source.id) as count_value
      from focus_keys
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{focus}', pg_catalog.to_jsonb(focus_keys.metric_key))
      ) source on true
      group by focus_keys.metric_key
    )
    select pg_catalog.jsonb_object_agg(metric_key, count_value) into metrics from counts;

    select pg_catalog.jsonb_build_object(
      'requestedBy', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'requestedById', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'requestedByLabel', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{requestedById}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'requestedByLabel', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'requestedTeam', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{requestedTeam}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'assignee', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select candidate.value, candidate.label, pg_catalog.count(distinct candidate.task_id) as count_value
          from (
            with assignee_source as materialized (
              select source.id, source.row_data
              from dashboard_private.ops_task_page_source_v1(
                p_type,
                pg_catalog.jsonb_set(p_filters, '{assigneeId}', 'null'::jsonb)
              ) source
            )
            select
              source.id as task_id,
              source.row_data ->> 'assigneeId' as value,
              coalesce(nullif(source.row_data ->> 'assigneeLabel', ''), '미지정') as label
            from assignee_source source
            where nullif(source.row_data ->> 'assigneeId', '') is not null
            union all
            select
              source.id,
              source.row_data ->> 'secondaryAssigneeId',
              coalesce(nullif(source.row_data ->> 'secondaryAssigneeLabel', ''), '미지정')
            from assignee_source source
            where nullif(source.row_data ->> 'secondaryAssigneeId', '') is not null
            union all
            select source.id, '__unassigned__', '미지정'
            from assignee_source source
            where nullif(source.row_data ->> 'assigneeId', '') is null
              and nullif(source.row_data ->> 'secondaryAssigneeId', '') is null
          ) candidate
          group by candidate.value, candidate.label
          order by candidate.label collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'assigneeTeam', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{assigneeTeam}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  elsif p_type = 'registration' then
    with sibling(view_key) as (
      values
        ('inquiry'::text), ('level_test'::text), ('consultation_requested'::text),
        ('consultation_completed'::text), ('waiting'::text), ('observation'::text),
        ('enrollment'::text), ('payment'::text), ('completed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_filters, '{view}', pg_catalog.to_jsonb(sibling.view_key)),
          '{consultationOwnerId}',
          'null'::jsonb
        )
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'consultationMine', case when p_filters ->> 'view' in ('consultation_requested','consultation_completed') then (
        select pg_catalog.count(*) from dashboard_private.ops_task_page_source_v1(
          p_type,
          pg_catalog.jsonb_set(p_filters, '{consultationOwnerId}', pg_catalog.to_jsonb((select auth.uid())::text))
        )
      ) else 0 end,
      'consultationAll', case when p_filters ->> 'view' in ('consultation_requested','consultation_completed') then (
        select pg_catalog.count(*) from dashboard_private.ops_task_page_source_v1(
          p_type,
          pg_catalog.jsonb_set(p_filters, '{consultationOwnerId}', 'null'::jsonb)
        )
      ) else 0 end
    ) into metrics;
  elsif p_type in ('withdrawal','transfer') then
    with sibling(view_key) as (
      values ('applicant'::text), ('operations'::text), ('closed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{view}', pg_catalog.to_jsonb(sibling.view_key))
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'subject', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'subject', ''), '-') as value,
            coalesce(nullif(source.row_data ->> 'subject', ''), '-') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{subject}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'subject', ''), '-') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'teacher', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') as value,
            coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{teacher}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  else
    with sibling(view_key) as (
      values ('assistant'::text), ('teacher'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_filters, '{queue}', pg_catalog.to_jsonb(sibling.view_key)),
          '{includeClosed}',
          'false'::jsonb
        )
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'teacher', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then source.row_data #>> '{inlineState,teacherId}'
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then 'teacher_name:' || pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '__unassigned__'
            end as value,
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), '미지정')
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '미지정'
            end as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{teacherId}', 'null'::jsonb)) source
          group by 1,2
          order by (
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), '미지정')
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '미지정'
            end
          ) collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'class', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            case
              when nullif(source.row_data ->> 'classId', '') is not null then source.row_data ->> 'classId'
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then 'class_name:' || coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '__unassigned__'
            end as value,
            case
              when nullif(source.row_data ->> 'classId', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,class}', ''), '미지정')
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '미지정'
            end as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{classId}', 'null'::jsonb)) source
          group by 1,2
          order by (
            case
              when nullif(source.row_data ->> 'classId', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,class}', ''), '미지정')
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '미지정'
            end
          ) collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  end if;

  return result || pg_catalog.jsonb_build_object(
    'byView', coalesce(by_view, '{}'::jsonb),
    'metrics', coalesce(metrics, '{}'::jsonb),
    'facets', coalesce(facets, '{}'::jsonb)
  );
end
$function$;
CREATE OR REPLACE FUNCTION dashboard_private.list_ops_task_numbered_page_v1_common_impl_v1(p_type text, p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Seoul'
AS $function$
declare
  result jsonb;
  is_header boolean;
  key text;
  nullable_keys text[];
  date_from date;
  date_to date;
begin
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20)
    or p_type is null or p_type not in ('general','registration','withdrawal','transfer','word_retest')
    or pg_catalog.jsonb_typeof(p_filters) is distinct from 'object' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  -- Close JSON-null/three-valued-logic holes before the unchanged legacy validator.
  nullable_keys := case p_type
    when 'general' then array['requestedById','requestedTeam','assigneeId','assigneeTeam']
    when 'registration' then array['consultationOwnerId']
    when 'word_retest' then array['branch','classId','dateFrom','dateTo','tableSortColumn','tableSortDirection','teacherId']
    else array['subject','teacher','dateFrom','dateTo','filterColumn','sortColumn','sortDirection'] end;
  for key in select pg_catalog.jsonb_object_keys(p_filters) loop
    if not (key=any(nullable_keys)) and p_filters->key='null'::jsonb then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
  end loop;
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type,p_filters);
  if p_filters->>'sortColumn' = '' or p_filters->>'filterColumn' = '' or p_filters->>'tableSortColumn' = '' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  if p_type in ('withdrawal','transfer','word_retest') and p_filters->>'period'='custom' then
    if p_filters->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_filters->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
    begin
      date_from := (p_filters->>'dateFrom')::date; date_to := (p_filters->>'dateTo')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end;
    if date_from > date_to then raise exception using errcode='22023', message='ops_task_numbered_request_invalid'; end if;
  end if;
  is_header := case when p_type in ('withdrawal','transfer') then p_filters->>'sortColumn' is not null
    when p_type='word_retest' then p_filters->>'tableSortColumn' is not null else false end;
  with eligible as materialized (
    select * from dashboard_private.ops_task_numbered_keys_v1(p_type,p_filters)
  ), selected as materialized (
    select projected.*, row_number() over (order by
    case when p_type = 'general' and p_filters ->> 'queue' = 'completed' then projected.completed_sort_at end desc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'status' then projected.workflow_status_rank end asc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.date_bucket end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.primary_date end asc nulls last,
    case when p_type = 'general' and p_filters ->> 'sort' <> 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.recency_at end desc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_priority end asc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_at end asc nulls last,
    case when p_type in ('registration','withdrawal','transfer') and not is_header and not (p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested') then projected.recency_at end desc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'asc' then projected.display_text end collate dashboard_private.ko_numeric asc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'desc' then projected.display_text end collate dashboard_private.ko_numeric desc,
    case when p_type in ('withdrawal','transfer') and is_header then projected.recency_at end desc,
    case when p_type = 'word_retest' then projected.effective_test_at end asc nulls last,
    case when p_type = 'word_retest' then projected.effective_created_at end asc,
    projected.id asc
    ) as ordinal
    from eligible projected
    order by ordinal
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_input as (
    select pg_catalog.array_agg(id order by ordinal) as ids, pg_catalog.array_agg(matching_track_id order by ordinal) as matching_ids from selected
  ), projected as (
    select dto.id,dto.row_data from page_input
    cross join lateral dashboard_private.ops_task_numbered_project_v1(p_type,page_input.ids,page_input.matching_ids) dto
  )
  select pg_catalog.jsonb_build_object(
    'rows',coalesce((select pg_catalog.jsonb_agg(projected.row_data order by selected.ordinal) from projected join selected using(id)),'[]'::jsonb),
    'page',p_page,'pageSize',p_page_size,'totalCount',(select pg_catalog.count(*) from eligible)
  ) into result;
  return result;
end
$function$;

alter function dashboard_private.list_ops_task_numbered_page_v1_common_impl_v1(text,jsonb,integer,integer) owner to postgres;
revoke all on function dashboard_private.list_ops_task_numbered_page_v1_common_impl_v1(text,jsonb,integer,integer) from public,anon,authenticated,service_role;
-- Only this fixed owner boundary can read all operational rows for a teacher.
-- It never changes JWT/role state or accepts relation/function names.
create function dashboard_private.teacher_operational_read_v1(p_operation text,p_args jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; kind text;task_id uuid;row_payload jsonb;
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='teacher' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise exception 'operational_common_read_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_args) is distinct from 'object' then raise exception 'operational_common_read_invalid' using errcode='22023';end if;
 if p_operation in('ops_page','ops_stats') then
  kind:=p_args->>'p_type';
  perform dashboard_private.assert_teacher_operational_filters_v1(kind,p_args->'p_filters');
  if p_operation='ops_page' then
   result:=dashboard_private.list_ops_task_numbered_page_v1_common_impl_v1(kind,p_args->'p_filters',(p_args->>'p_page')::integer,(p_args->>'p_page_size')::integer);
   return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(dashboard_private.teacher_operational_common_ops_v1(r) order by ord) from jsonb_array_elements(result->'rows') with ordinality a(r,ord)),'[]'));
  end if;
  if kind='registration' then return dashboard_private.ops_registration_task_stats_v1(p_args->'p_filters');end if;
  return dashboard_private.ops_task_list_stats_legacy_v1(kind,p_args->'p_filters');
 elsif p_operation='ops_detail' then
  task_id:=(p_args->>'p_id')::uuid;
  if task_id is null then raise exception 'operational_common_read_invalid' using errcode='22023';end if;
  select type into kind from public.ops_tasks where id=task_id;
  if not found then return null;end if;
  if kind not in('registration','transfer','withdrawal') then raise exception 'operational_common_read_forbidden' using errcode='42501';end if;
  select row_data into row_payload from dashboard_private.ops_task_numbered_project_v1(kind,array[task_id],array[null::uuid]);
  return dashboard_private.teacher_operational_common_ops_v1(row_payload);

elsif p_operation in('makeup_page','makeup_detail') then
 if p_operation='makeup_detail' then return dashboard_private.teacher_common_makeup_v1(dashboard_private.get_makeup_detail_v1_common_impl_v1((p_args->>'p_id')::uuid));end if;
 if (nullif(p_args#>>'{p_filters,filterColumn}','') is not null and p_args#>>'{p_filters,filterColumn}' not in('status','className','subject','teacher','requester','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt'))
  or (nullif(p_args#>>'{p_filters,sortColumn}','') is not null and p_args#>>'{p_filters,sortColumn}' not in('status','className','subject','teacher','requester','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt')) then raise exception 'operational_common_filter_forbidden' using errcode='42501';end if;
 result:=dashboard_private.list_makeup_numbered_page_v1_common_impl_v1(p_args->'p_filters',(p_args->>'p_page')::integer,(p_args->>'p_page_size')::integer);
 return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(dashboard_private.teacher_common_makeup_v1(x) order by ord) from jsonb_array_elements(result->'rows') with ordinality a(x,ord)),'[]'));

elsif p_operation='dashboard' then return dashboard_private.get_dashboard_summary_sources_v1_common_impl_v1();
elsif p_operation='curriculum' then return dashboard_private.get_academic_curriculum_numbered_page_v2_common_impl_v1((p_args->'p_filters'),(p_args->>'p_page')::integer,(p_args->>'p_page_size')::integer,(p_args->>'p_include_scope_metadata')::boolean);
elsif p_operation='timetable' then return dashboard_private.get_academic_timetable_range_v1_common_impl_v1((p_args->>'p_date_from')::date,(p_args->>'p_date_to')::date,(p_args->>'p_class_group_id')::text,(p_args->>'p_status')::text,(p_args->>'p_subject')::text);
elsif p_operation='class_page' then return dashboard_private.get_operations_class_schedule_numbered_page_v1_common_impl_v1((p_args->'p_filters'),(p_args->>'p_page')::integer,(p_args->>'p_page_size')::integer);
elsif p_operation='class_detail' then result:=dashboard_private.get_operations_class_lesson_design_detail_v1_common_impl_v1((p_args->>'p_class_id')::uuid);if result is null then return null;end if;return jsonb_set(result,'{classItem,schedulePlan}',dashboard_private.teacher_common_schedule_plan_v1(result#>'{classItem,schedulePlan}'));
elsif p_operation='catalogs' then return dashboard_private.list_operations_catalogs_v1_common_impl_v1();
elsif p_operation='options' then
 return jsonb_build_object(
  'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role) order by id) from public.profiles),'[]'),
  'students',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'school',school,'grade',grade,'status',status,'class_ids',class_ids,'waitlist_class_ids',waitlist_class_ids) order by id) from public.students),'[]'),
  'classes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'subject',subject,'grade',grade,'teacher',teacher,'room',room,'student_ids',student_ids,'waitlist_ids',waitlist_ids,'textbook_ids',textbook_ids) order by id) from public.classes),'[]'),
  'textbooks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'title',title,'subject',subject,'publisher',publisher,'status',status) order by id) from public.textbooks),'[]'),
  'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'subjects',subjects,'profile_id',profile_id,'is_visible',is_visible,'sort_order',sort_order) order by id) from public.teacher_catalogs),'[]'));
elsif p_operation='book_request_options' then
 if coalesce(p_args->>'scope','') not in('textbooks','classes','locations')
   or jsonb_typeof(p_args->'search') is distinct from 'string'
   or (p_args->>'page')::integer is null or (p_args->>'page')::integer<1
   or p_args->>'pageSize' is distinct from '15' then
  raise exception 'operational_common_read_invalid' using errcode='22023';
 end if;
 with options as (
  select id,coalesce(nullif(title,''),name,'') label from public.textbooks where p_args->>'scope'='textbooks'
  union all select id,coalesce(name,'') from public.classes where p_args->>'scope'='classes'
  union all select id,coalesce(name,'') from public.textbook_inventory_locations where p_args->>'scope'='locations'
 ),eligible as materialized(select * from options where label ilike '%'||btrim(p_args->>'search')||'%'),page as (
  select * from eligible order by label,id offset (((p_args->>'page')::bigint-1)*15) limit 15
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label) order by label,id) from page),'[]'),
  'page',(p_args->>'page')::integer,'pageSize',15,'totalCount',(select count(*) from eligible)) into result;
 return result;
elsif p_operation in('book_page','book_detail') then
 if p_operation='book_detail' then
  task_id:=(p_args->>'p_anchor')::uuid;
  if task_id is null then raise exception 'operational_common_read_invalid' using errcode='22023';end if;
  p_args:=jsonb_build_object('p_search','','p_page',1,'p_page_size',15);
 end if;
 if (p_args->>'p_page')::integer is null or (p_args->>'p_page')::integer<1 or (p_args->>'p_page_size')::integer is null or (p_args->>'p_page_size')::integer not in(10,15,20) or jsonb_typeof(p_args->'p_search') is distinct from 'string' then raise exception 'operational_common_read_invalid' using errcode='22023';end if;
 with source as materialized(
  select md5(k.id) id,k.anchor,k.member_ids,
   coalesce(nullif(b.title,''),nullif(b.name,''),l.requested_textbook_title,'-') book_title,
   coalesce(c.name,'') class_name,
   coalesce((select nullif(btrim(p.name),'') from public.profiles p where p.id::text=o.requested_by or p.name=o.requested_by order by p.id limit 1),'신청자') requester,
   k.event_at requested_at,(k.quantities#>>'{student,requested}')::bigint student_quantity,(k.quantities#>>'{teacher,requested}')::bigint teacher_quantity
  from dashboard_private.textbook_workflow_purchase_keys_v1('{"mode":"request","search":"","boardScope":"all","requestFilter":"all","orderFilter":"all"}')k
  join public.textbook_purchase_order_lines l on l.id=k.primary_id
  left join public.textbook_purchase_orders o on o.id=l.purchase_order_id
  left join public.textbooks b on b.id=dashboard_private.textbook_workflow_book_id_v1(coalesce(l.textbook_id::text,nullif(dashboard_private.textbook_trim_v1(l.requested_textbook_title),'')))
  left join public.classes c on c.id=l.class_id
 ),eligible as materialized(select * from source where (p_operation<>'book_detail' or task_id=any(member_ids)) and (coalesce(p_args->>'p_search','')='' or concat_ws(' ',book_title,class_name,requester) ilike '%'||btrim(p_args->>'p_search')||'%')),page as(
  select * from eligible order by requested_at desc,anchor offset (((p_args->>'p_page')::bigint-1)*(p_args->>'p_page_size')::bigint) limit (p_args->>'p_page_size')::integer)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'anchorLineId',anchor,'bookTitle',book_title,'className',class_name,'requesterLabel',requester,'requestedAt',requested_at,'studentQuantity',student_quantity,'teacherQuantity',teacher_quantity) order by requested_at desc,anchor) from page),'[]'),'page',(p_args->>'p_page')::integer,'pageSize',(p_args->>'p_page_size')::integer,'totalCount',(select count(*) from eligible)) into result;
 return case when p_operation='book_detail' then result#>'{rows,0}' else result end;
 end if;
 raise exception 'operational_common_read_forbidden' using errcode='42501';
end $f$;
alter function dashboard_private.teacher_operational_read_v1(text,jsonb) owner to postgres;
revoke all on function dashboard_private.teacher_operational_read_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function dashboard_private.teacher_operational_read_v1(text,jsonb) to authenticated;

create function public.get_operational_common_detail_v1(p_id uuid) returns jsonb language sql stable set search_path='' as $f$
 select dashboard_private.teacher_operational_read_v1('ops_detail',jsonb_build_object('p_id',p_id))
$f$;
alter function public.get_operational_common_detail_v1(uuid) owner to postgres;
revoke all on function public.get_operational_common_detail_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operational_common_detail_v1(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.list_ops_task_numbered_page_v1(p_type text, p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Seoul'
AS $function$
declare
  result jsonb;
  is_header boolean;
  key text;
  nullable_keys text[];
  date_from date;
  date_to date;
begin
 if public.current_dashboard_role()='teacher' and p_type in('registration','transfer','withdrawal') then return dashboard_private.teacher_operational_read_v1('ops_page',jsonb_build_object('p_type',p_type,'p_filters',p_filters,'p_page',p_page,'p_page_size',p_page_size));end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20)
    or p_type is null or p_type not in ('general','registration','withdrawal','transfer','word_retest')
    or pg_catalog.jsonb_typeof(p_filters) is distinct from 'object' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  -- Close JSON-null/three-valued-logic holes before the unchanged legacy validator.
  nullable_keys := case p_type
    when 'general' then array['requestedById','requestedTeam','assigneeId','assigneeTeam']
    when 'registration' then array['consultationOwnerId']
    when 'word_retest' then array['branch','classId','dateFrom','dateTo','tableSortColumn','tableSortDirection','teacherId']
    else array['subject','teacher','dateFrom','dateTo','filterColumn','sortColumn','sortDirection'] end;
  for key in select pg_catalog.jsonb_object_keys(p_filters) loop
    if not (key=any(nullable_keys)) and p_filters->key='null'::jsonb then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
  end loop;
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type,p_filters);
  if p_filters->>'sortColumn' = '' or p_filters->>'filterColumn' = '' or p_filters->>'tableSortColumn' = '' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  if p_type in ('withdrawal','transfer','word_retest') and p_filters->>'period'='custom' then
    if p_filters->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_filters->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
    begin
      date_from := (p_filters->>'dateFrom')::date; date_to := (p_filters->>'dateTo')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end;
    if date_from > date_to then raise exception using errcode='22023', message='ops_task_numbered_request_invalid'; end if;
  end if;
  is_header := case when p_type in ('withdrawal','transfer') then p_filters->>'sortColumn' is not null
    when p_type='word_retest' then p_filters->>'tableSortColumn' is not null else false end;
  with eligible as materialized (
    select * from dashboard_private.ops_task_numbered_keys_v1(p_type,p_filters)
  ), selected as materialized (
    select projected.*, row_number() over (order by
    case when p_type = 'general' and p_filters ->> 'queue' = 'completed' then projected.completed_sort_at end desc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'status' then projected.workflow_status_rank end asc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.date_bucket end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.primary_date end asc nulls last,
    case when p_type = 'general' and p_filters ->> 'sort' <> 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.recency_at end desc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_priority end asc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_at end asc nulls last,
    case when p_type in ('registration','withdrawal','transfer') and not is_header and not (p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested') then projected.recency_at end desc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'asc' then projected.display_text end collate dashboard_private.ko_numeric asc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'desc' then projected.display_text end collate dashboard_private.ko_numeric desc,
    case when p_type in ('withdrawal','transfer') and is_header then projected.recency_at end desc,
    case when p_type = 'word_retest' then projected.effective_test_at end asc nulls last,
    case when p_type = 'word_retest' then projected.effective_created_at end asc,
    projected.id asc
    ) as ordinal
    from eligible projected
    order by ordinal
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_input as (
    select pg_catalog.array_agg(id order by ordinal) as ids, pg_catalog.array_agg(matching_track_id order by ordinal) as matching_ids from selected
  ), projected as (
    select dto.id,dto.row_data from page_input
    cross join lateral dashboard_private.ops_task_numbered_project_v1(p_type,page_input.ids,page_input.matching_ids) dto
  )
  select pg_catalog.jsonb_build_object(
    'rows',coalesce((select pg_catalog.jsonb_agg(projected.row_data order by selected.ordinal) from projected join selected using(id)),'[]'::jsonb),
    'page',p_page,'pageSize',p_page_size,'totalCount',(select pg_catalog.count(*) from eligible)
  ) into result;
  return result;
end
$function$;
CREATE OR REPLACE FUNCTION public.get_ops_task_list_stats_v1(p_type text, p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if public.current_dashboard_role()='teacher' and p_type in('registration','transfer','withdrawal') then return dashboard_private.teacher_operational_read_v1('ops_stats',jsonb_build_object('p_type',p_type,'p_filters',p_filters));end if;
  if p_type = 'registration' then
    return dashboard_private.ops_registration_task_stats_v1(p_filters);
  end if;

  return dashboard_private.ops_task_list_stats_legacy_v1(p_type, p_filters);
end
$function$
;

revoke all on function dashboard_private.teacher_operational_common_ops_v1(jsonb),dashboard_private.assert_teacher_operational_filters_v1(text,jsonb) from public,anon,authenticated,service_role;


create policy ops_tasks_teacher_common_gateway_v1 on public.ops_tasks as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher' or type not in('registration','transfer','withdrawal','textbook')) with check ((select public.current_dashboard_role()) is distinct from 'teacher' or type not in('registration','transfer','withdrawal','textbook'));

-- Teacher makeup and academic common read extension
create function dashboard_private.teacher_common_schedule_plan_v1(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $f$
declare result jsonb;map_key text;map_value jsonb;
begin
 result:=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(p)='object' then p else '{}'::jsonb end) where key=any(array['version','selectedDays','startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','totalSessions']));
 result:=result||jsonb_build_object('sessions',coalesce((select jsonb_agg(case when v='null'::jsonb then 'null'::jsonb else (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end) where key=any(array['id','sessionKey','sessionNumber','date','day','label','billingId','billingLabel','billingColor','startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','classroomUnresolved','state','scheduleState','originalDate','originalSessionId','makeupRequestId','makeupRequestRole','isForced','makeupDate','sourceSlotId','approvedOverrideVerified']))||case when v ? 'overrides' then jsonb_build_object('overrides',(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(v->'overrides')='object' then v->'overrides' else '{}'::jsonb end) where key=any(array['startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','classroomUnresolved']))) else '{}'::jsonb end end order by ord) from jsonb_array_elements(case when jsonb_typeof(p->'sessions')='array' then p->'sessions' else '[]'::jsonb end) with ordinality a(v,ord)),'[]'),'billingPeriods',coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end) where key=any(array['id','label','color','startDate','endDate','totalSessions'])) order by ord) from jsonb_array_elements(case when jsonb_typeof(p->'billingPeriods')='array' then p->'billingPeriods' else '[]'::jsonb end) with ordinality a(v,ord)),'[]'));
 for map_key in select unnest(array['sessionSchedules','sessionOverrides','sessionStates']) loop
  select coalesce(jsonb_object_agg(key,case when map_key='sessionStates' and value in('"active"','"exception"','"makeup"','"tbd"','"skipped"','"force_active"') then value else (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) where key=any(array['startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','classroomUnresolved','state','scheduleState','makeupDate','originalDate','originalSessionId'])) end),'{}') into map_value
  from jsonb_each(case when jsonb_typeof(p->map_key)='object' then p->map_key else '{}'::jsonb end) where key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  result:=result||jsonb_build_object(map_key,map_value);
 end loop;
 return result;
end $f$;

create function dashboard_private.teacher_common_profile_label_v1(p_id uuid) returns text language sql stable set search_path='' as $f$select nullif(btrim(name),'') from public.profiles where id=p_id$f$;

create function dashboard_private.teacher_common_makeup_v1(p jsonb) returns jsonb language sql stable set search_path='' as $f$
 select case when p is null then null else (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(p)='object' then p else '{}'::jsonb end) where key=any(array['id','status','approvalGroup','requestKind','requesterId','teacherCatalogId','teacherProfileId','classId','className','subject','cancelDate','makeupStartAt','makeupEndAt','makeupClassroom','approverTeacherCatalogId','approverProfileId','approvedBy','approvedAt','completedBy','completedAt','canceledBy','canceledAt','cancelAcademicEventId','makeupAcademicEventId','createdAt','updatedAt']))||jsonb_build_object('requesterLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(nullif(p->>'requesterId','')::uuid),'신청자'),'teacherLabel',coalesce((select nullif(btrim(name),'') from public.teacher_catalogs where id=nullif(p->>'teacherCatalogId','')::uuid),dashboard_private.teacher_common_profile_label_v1(nullif(p->>'teacherProfileId','')::uuid),'선생님'),'approverLabel',coalesce((select nullif(btrim(name),'') from public.teacher_catalogs where id=nullif(p->>'approverTeacherCatalogId','')::uuid),dashboard_private.teacher_common_profile_label_v1(nullif(p->>'approverProfileId','')::uuid),'결재자'),'approvedByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(nullif(p->>'approvedBy','')::uuid),''),'completedByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(nullif(p->>'completedBy','')::uuid),''),'canceledByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(nullif(p->>'canceledBy','')::uuid),''),'reason','','returnedReason','','rejectedReason','','finalNote','','events','[]'::jsonb,'schedulePlanBefore','{}'::jsonb,'schedulePlanAfter','{}'::jsonb,'makeupAcademicEventIds','[]'::jsonb,'makeupSlots',coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(s)='object' then s else '{}'::jsonb end) where key=any(array['startAt','endAt','classroom'])) order by ord) from jsonb_array_elements(coalesce(p->'makeupSlots','[]')) with ordinality a(s,ord)),'[]'::jsonb)) end
$f$;

CREATE OR REPLACE FUNCTION dashboard_private.list_makeup_numbered_page_v1_common_impl_v1(p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor uuid:=auth.uid(); read_all boolean; f jsonb:=p_filters; k text; date_value text; result jsonb; needs_keys boolean;
 columns text[]:=array['status','className','subject','teacher','requester','reason','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt','returnedReason','rejectedReason','finalNote','canceledNote'];
begin
 if actor is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not in(10,15,20) or jsonb_typeof(f) is distinct from 'object' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(f))<>10 or not f ?& array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search','sortColumn','sortDirection'] then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search'] loop if jsonb_typeof(f->k) is distinct from 'string' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; end loop;
 if f->>'view' not in('mine','approvalPending','makeupPending','refundPending','closed') or f->>'subject' not in('all','영어','수학','과학') or f->>'period' not in('all','today','week','month','custom')
  or not(f->>'filterColumn'=any(columns)) or not(f->>'teacher'='all' or f->>'teacher' ~ '^id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or f->>'teacher' ~ '^name:.+')
  or not coalesce((f->'sortColumn'='null'::jsonb and f->'sortDirection'='null'::jsonb) or (jsonb_typeof(f->'sortColumn')='string' and f->>'sortColumn'=any(columns) and f->>'sortDirection' in('asc','desc')),false) then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['dateFrom','dateTo'] loop
  date_value:=f->>k;
  if date_value<>'' then
   if date_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
   begin if to_char(date_value::date,'YYYY-MM-DD')<>date_value then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end;
  end if;
 end loop;
 if (f->>'period'='all' and (f->>'dateFrom'<>'' or f->>'dateTo'<>'')) or (f->>'period' in('today','week','month') and (f->>'dateFrom'='' or f->>'dateTo'='')) or (f->>'dateFrom'<>'' and f->>'dateTo'<>'' and f->>'dateFrom'>f->>'dateTo') then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 select coalesce(role in('admin','staff','teacher'),false) into read_all from public.profiles where id=actor;
 -- Branch before EXISTS: a nullable sortColumn otherwise causes an unused
 -- legacy-compatibility scan even during default browsing.
 if (f->>'period'<>'all' or f->>'sortColumn' in('makeupAt','makeupRoom') or (public.makeup_numbered_trim_v1(f->>'search')<>'' and f->>'filterColumn' in('makeupAt','makeupRoom'))) then
  if exists (
  select 1 from public.makeup_requests r where
   case f->>'view'
    when 'mine' then r.status='revision_requested' and (read_all or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'approvalPending' then r.status='approval_pending' and (read_all or (read_all or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id)))
    when 'makeupPending' then r.status='makeup_pending' and (read_all or (read_all or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id)))
    when 'refundPending' then r.status='refund_pending' and (read_all or (read_all or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id)))
    when 'closed' then r.status in('completed','rejected','canceled') else false end
   and (f->>'subject'='all' or public.makeup_numbered_trim_v1(r.subject)=f->>'subject')
   and (f->>'teacher'='all' or f->>'teacher'=case when r.teacher_catalog_id is not null then 'id:'||r.teacher_catalog_id else 'name:'||coalesce(dashboard_private.teacher_common_profile_label_v1(r.teacher_profile_id),'선생님') end)
   and public.makeup_numbered_legacy_slots_v1(to_jsonb(r))
 ) then raise exception 'makeup_legacy_slot_format_unsupported' using errcode='22023'; end if;
 end if;
 -- Default browsing uses only membership/facets and created_at/id ordering.
 -- Derive display/search keys only when a filter or sort actually consumes them.
 needs_keys:=public.makeup_numbered_trim_v1(f->>'search')<>'' or f->>'period'<>'all' or f->>'sortColumn' is not null;
 with authorized as materialized (
  select r.id,r.status,r.subject,r.teacher_catalog_id,r.teacher_profile_id,r.requester_id,r.approver_profile_id,
   r.class_name,r.reason,r.cancel_date,r.makeup_start_at,r.makeup_end_at,r.makeup_classroom,r.makeup_slots,r.approver_teacher_catalog_id,r.returned_reason,r.rejected_reason,r.final_note,r.approved_at,r.canceled_at,r.created_at,
   (r.requester_id=actor or r.teacher_profile_id=actor or r.approver_profile_id=actor) is true involved
  from public.makeup_requests r
 ), membership as materialized (
  select a.*,array_remove(array[
   case when (read_all or involved) and status='revision_requested' then 'mine' end,
   case when (read_all or involved) and status='approval_pending' then 'approvalPending' end,
   case when (read_all or involved) and status='makeup_pending' then 'makeupPending' end,
   case when (read_all or involved) and status='refund_pending' then 'refundPending' end,
   case when status in('completed','rejected','canceled') then 'closed' end],null) views
  from authorized a
 ), current_view as materialized (
  select a.*,coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.teacher_catalog_id),dashboard_private.teacher_common_profile_label_v1(a.teacher_profile_id),'선생님') teacher_label
  from membership a where f->>'view'=any(a.views)
 ), keyed as materialized (
  select a.id,a.created_at,case when needs_keys then public.makeup_numbered_values_v1(to_jsonb(a),coalesce(e.latest,'{}'),jsonb_build_object('teacher',a.teacher_label,'requester',coalesce(dashboard_private.teacher_common_profile_label_v1(a.requester_id),'신청자'),'approver',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.approver_teacher_catalog_id),dashboard_private.teacher_common_profile_label_v1(a.approver_profile_id),'결재자'))) else '{}'::jsonb end keys
  from current_view a
  left join lateral (
   select jsonb_object_agg(kind,jsonb_build_object('createdAt',to_jsonb(created_at)#>>'{}','note',public.makeup_numbered_trim_v1(note))) latest from (
    select distinct on(kind) case when public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled') then 'canceled' when public.makeup_numbered_trim_v1(event_type) in('submitted','resubmitted') then 'submitted' else public.makeup_numbered_trim_v1(event_type) end kind,created_at,id,note
    from public.makeup_request_events where needs_keys and request_id=a.id and public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled','submitted','resubmitted','revision_requested','approved','rejected') order by kind,created_at desc,id desc
   ) latest_events
  ) e on true
  where (f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject') and (f->>'teacher'='all' or f->>'teacher'=case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end)
 ), filtered as materialized (
  select * from keyed where (public.makeup_numbered_trim_v1(f->>'search')='' or strpos(lower(keys->>(f->>'filterColumn')),lower(public.makeup_numbered_trim_v1(f->>'search')))>0)
   and (f->>'period'='all' or exists(select 1 from jsonb_array_elements_text(keys->'dates')d where (f->>'dateFrom'='' or d>=f->>'dateFrom') and (f->>'dateTo'='' or d<=f->>'dateTo')))
 ), selected as materialized (
  select id,row_number() over(order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc) position
  from filtered order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc limit p_page_size offset (p_page::bigint-1)*p_page_size
 ), teacher_sources as (
  select 'id:'||t.id value,public.makeup_numbered_trim_v1(t.name) label,0::bigint count,0 source,t.sort_order sort_order
  from public.teacher_catalogs t where t.is_visible is distinct from false and (f->>'subject'='all' or exists(select 1 from regexp_split_to_table(case when jsonb_typeof(to_jsonb(t.subjects))='array' then (select string_agg(x,',') from jsonb_array_elements_text(to_jsonb(t.subjects))x) else t.subjects::text end,'[,，/]+')s where regexp_replace(translate(s,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',''),'(과목|팀)$','')=f->>'subject'))
  union all
  select case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end,a.teacher_label,count(*),1,0 from current_view a where f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject' group by 1,2
 ), teacher_options as (
  select distinct on(value) * from teacher_sources where value<>'' and label<>'' order by value,source,sort_order,label collate public.makeup_ko_numeric
 )
 select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*) from filtered),
  'viewCounts',(select jsonb_object_agg(v,(select count(*) from membership where v=any(views))) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v),
  'subjectOptions',(select jsonb_agg(jsonb_build_object('value',s,'label',s,'count',(select count(*) from current_view where public.makeup_numbered_trim_v1(subject)=s)) order by ord) from unnest(array['영어','수학','과학'])with ordinality subjects(s,ord)),
  'teacherOptions',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',label,'count',count) order by source,sort_order,label collate public.makeup_ko_numeric) from teacher_options),'[]'),
  'rows',coalesce((select jsonb_agg(dashboard_private.get_makeup_detail_v1_common_impl_v1(id) order by position) from selected),'[]')) into result;
 return result;
end $function$;

alter function dashboard_private.list_makeup_numbered_page_v1_common_impl_v1(jsonb,integer,integer) owner to postgres;
revoke all on function dashboard_private.list_makeup_numbered_page_v1_common_impl_v1(jsonb,integer,integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_makeup_detail_v1_common_impl_v1(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare r public.makeup_requests; result jsonb; k text; source_key text; events jsonb;
begin
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_id is null then raise exception 'makeup_detail_request_invalid' using errcode='22023'; end if;
 select * into r from public.makeup_requests where id=p_id;
 if not found then return null; end if;
 result:=jsonb_build_object('id',r.id,'status',r.status,'approvalGroup',r.approval_group,'requestKind',r.request_kind,
  'requesterLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(r.requester_id),'신청자'),
  'teacherLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.teacher_catalog_id),dashboard_private.teacher_common_profile_label_v1(r.teacher_profile_id),'선생님'),
  'approverLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.approver_teacher_catalog_id),dashboard_private.teacher_common_profile_label_v1(r.approver_profile_id),'결재자'),
  'approvedByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(r.approved_by),''),'completedByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(r.completed_by),''),'canceledByLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(r.canceled_by),''),
  'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(r)),
  'schedulePlanBefore',case when jsonb_typeof(r.schedule_plan_before)='object' then r.schedule_plan_before else '{}'::jsonb end,
  'schedulePlanAfter',case when jsonb_typeof(r.schedule_plan_after)='object' then r.schedule_plan_after else '{}'::jsonb end,
  'makeupAcademicEventIds',coalesce(r.makeup_academic_event_ids,'[]'));
 for k,source_key in select * from (values
  ('subject','subject'),('requesterId','requester_id'),('teacherCatalogId','teacher_catalog_id'),('teacherProfileId','teacher_profile_id'),('classId','class_id'),('className','class_name'),('reason','reason'),('cancelDate','cancel_date'),('makeupStartAt','makeup_start_at'),('makeupEndAt','makeup_end_at'),('makeupClassroom','makeup_classroom'),('approverTeacherCatalogId','approver_teacher_catalog_id'),('approverProfileId','approver_profile_id'),('returnedReason','returned_reason'),('rejectedReason','rejected_reason'),('finalNote','final_note'),('approvedBy','approved_by'),('approvedAt','approved_at'),('completedBy','completed_by'),('completedAt','completed_at'),('canceledBy','canceled_by'),('canceledAt','canceled_at'),('cancelAcademicEventId','cancel_academic_event_id'),('makeupAcademicEventId','makeup_academic_event_id'),('createdAt','created_at'),('updatedAt','updated_at'))m(k,s) loop
  result:=result||jsonb_build_object(k,public.makeup_numbered_trim_v1(to_jsonb(r)->>source_key));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'actorId',coalesce(e.actor_id::text,''),'actorLabel',coalesce(dashboard_private.teacher_common_profile_label_v1(e.actor_id),'시스템'),
  'eventType',public.makeup_numbered_trim_v1(e.event_type),'fieldName',public.makeup_numbered_trim_v1(e.field_name),'beforeValue',public.makeup_numbered_trim_v1(e.before_value),'afterValue',public.makeup_numbered_trim_v1(e.after_value),'note',public.makeup_numbered_trim_v1(e.note),'createdAt',to_jsonb(e.created_at)#>>'{}') order by e.created_at desc,e.id desc),'[]') into events from public.makeup_request_events e where e.request_id=p_id;
 return result||jsonb_build_object('events',events)||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(r)) then jsonb_build_object('rawMakeupSlots',r.makeup_slots) else '{}'::jsonb end;
end $function$;

alter function dashboard_private.get_makeup_detail_v1_common_impl_v1(uuid) owner to postgres;
revoke all on function dashboard_private.get_makeup_detail_v1_common_impl_v1(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_dashboard_summary_sources_v1_common_impl_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_build_object(
    'classes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          class.id,
          class.name,
          class.subject,
          class.grade,
          class.teacher,
          class.room,
          class.schedule,
          class.status,
          class.start_date,
          class.end_date,
          class.student_ids,
          class.waitlist_ids,
          class.schedule_storage_mode
        from public.classes class
      ) row_data
    ), '[]'::jsonb),
    'students', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          student.id,
          student.name,
          student.school,
          student.grade,
          student.status,
          student.class_ids,
          student.waitlist_class_ids
        from public.students student
      ) row_data
    ), '[]'::jsonb)
  );
$function$;

alter function dashboard_private.get_dashboard_summary_sources_v1_common_impl_v1() owner to postgres;
revoke all on function dashboard_private.get_dashboard_summary_sources_v1_common_impl_v1() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_academic_curriculum_numbered_page_v2_common_impl_v1(p_filters jsonb, p_page integer, p_page_size integer, p_include_scope_metadata boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_filters jsonb;
  v_keys text[];
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  -- Shape validation must precede jsonb expansion, and bigint math precedes OFFSET.
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['classroom','grade','periodId','search','status','subject','teacher','viewMode']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) or p_include_scope_metadata is null then
    raise exception 'academic_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case
    when key = 'search' then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    when key = 'viewMode' then pg_catalog.to_jsonb(coalesce(nullif(pg_catalog.btrim(value #>> '{}'),''),'all'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if v_filters ->> 'viewMode' not in ('all','unscheduled','unlinked','update','done')
    or ((v_filters ->> 'status') is not null and v_filters ->> 'status' not in ('수강','개강 준비','종강')) then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  if v_filters->>'viewMode'='unlinked' then v_filters:=jsonb_set(v_filters,'{viewMode}','"all"'); end if;
  with eligible_classes as materialized (
    select
      class.id, class.name, class.subject, class.subject_area_key, class.grade,
      class.teacher, class.room, class.schedule, class.status, class.start_date,
      class.end_date, class.term_id, class.period, class.schedule_storage_mode, class.schedule_plan,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), term.name, '') as term_name,
      0::integer as textbook_count,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), U&'\FFFF') collate dashboard_private.ko_numeric as sort_key
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(v_filters ->> 'periodId'), '') is null or exists (
        select 1
        from public.class_schedule_sync_group_members member
        join public.class_schedule_sync_groups group_row on group_row.id = member.group_id
        where member.class_id = class.id
          and (member.group_id::text = v_filters ->> 'periodId' or group_row.name = v_filters ->> 'periodId')
      ))
      and (nullif(pg_catalog.btrim(v_filters ->> 'status'), '') is null
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(v_filters ->> 'status'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'subject'), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(v_filters ->> 'subject'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'grade'), '') is null or pg_catalog.btrim(class.grade) = pg_catalog.btrim(v_filters ->> 'grade'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'teacher'), '') is null or coalesce(class.teacher, '') ilike '%' || pg_catalog.btrim(v_filters ->> 'teacher') || '%')
      and (
        nullif(pg_catalog.btrim(v_filters ->> 'classroom'), '') is null
        or exists (
          select 1
          from pg_catalog.regexp_split_to_table(coalesce(class.room, ''), '[,/&·]+') token
          where dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token))
            = dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(v_filters ->> 'classroom'))
        )
      )
      and (nullif(pg_catalog.btrim(v_filters ->> 'search'), '') is null or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, class.room, class.schedule) ilike '%' || pg_catalog.btrim(v_filters ->> 'search') || '%')
  ), session_classes as materialized (
    -- Only the all-view without scope metadata can page before session work.
    -- Other views need every class's counts to decide membership and totals.
    select * from eligible_classes order by sort_key,id
    offset case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then ((p_page::bigint-1)*p_page_size::bigint) else 0 end
    limit case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then p_page_size else null end
  ), saved_sessions (class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at) as materialized (
    select eligible.id, coalesce(nullif(item->>'id',''),nullif(item->>'sessionKey',''),eligible.id::text || ':' || ordinality),
      coalesce(nullif(item->>'sessionKey',''),nullif(item->>'id',''),eligible.id::text || ':' || ordinality),
      case when dashboard_private.is_canonical_class_date_v1(item->>'date') then nullif(item->>'date','')::date end, coalesce(item->>'startTime',''), coalesce(item->>'endTime',''),
      case when coalesce(item->>'scheduleState',item->>'state','active')='force_active' then 'active'
        else coalesce(item->>'scheduleState',item->>'state','active') end, ''
    from session_classes eligible
    cross join lateral jsonb_array_elements(case when jsonb_typeof(eligible.schedule_plan->'sessions')='array'
      then eligible.schedule_plan->'sessions' else '[]'::jsonb end) with ordinality entries(item,ordinality)
    where eligible.schedule_storage_mode <> 'normalized'
      and nullif(item->>'date','') is not null
      and coalesce(item->>'scheduleState',item->>'state','active') in ('active','force_active','exception','makeup','tbd')

  ), schedule_sessions as materialized (
    select session.class_id, session.id::text as id, session.session_key, session.session_date,
      session.start_time::text as start_time, session.end_time::text as end_time,
      session.schedule_state, session.updated_at::text as updated_at
    from public.class_lesson_sessions session
    join session_classes eligible on eligible.id=session.class_id
    where eligible.schedule_storage_mode='normalized' and session.schedule_state <> 'skipped'
    union all
    select class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at
    from saved_sessions where session_date is not null
  ), session_agg as materialized (
    select class_id, count(*)::integer as session_count,
      count(*) filter(where session_date < (current_timestamp at time zone 'Asia/Seoul')::date)::integer as planned_count,
      count(*) filter(where session_date >= (current_timestamp at time zone 'Asia/Seoul')::date)::integer as upcoming_count,
      max(updated_at) as last_updated_at
    from schedule_sessions group by class_id
  ), base as materialized (
    select
      eligible.id, eligible.name, eligible.subject, eligible.subject_area_key,
      eligible.grade, eligible.teacher, eligible.room, eligible.schedule,
      eligible.status, eligible.start_date, eligible.end_date, eligible.term_id,
      eligible.period, eligible.normalized_status,
      eligible.term_name, eligible.textbook_count, session_agg.last_updated_at,
      coalesce(session_agg.session_count, 0)::integer as session_count,
      coalesce(session_agg.planned_count, 0)::integer as planned_count,
      coalesce(session_agg.upcoming_count,0)::integer as upcoming_count,
      eligible.sort_key
    from eligible_classes eligible
    left join session_agg on session_agg.class_id = eligible.id
  ), classified as materialized (
    select
      base.id, base.name, base.subject, base.subject_area_key, base.grade,
      base.teacher, base.room, base.schedule, base.status, base.start_date,
      base.end_date, base.term_id, base.period,
      base.normalized_status, base.term_name, base.textbook_count, base.last_updated_at,
      base.session_count, base.planned_count, base.upcoming_count,
      base.sort_key,
      case
        when base.session_count = 0 then '회차 미생성'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then '일정 연장 필요'
        else '일정 편성'
      end as state_label,
      case
        when base.session_count = 0 then 'unscheduled'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then 'update'
        else 'done'
      end as view_mode
    from base
  ), filtered as materialized (
    select
      classified.id, classified.name, classified.subject, classified.subject_area_key,
      classified.grade, classified.teacher, classified.room, classified.schedule,
      classified.status, classified.start_date, classified.end_date, classified.term_id,
      classified.period, classified.normalized_status,
      classified.term_name, classified.textbook_count, classified.session_count, classified.last_updated_at,
      classified.planned_count,
      classified.sort_key, classified.state_label, classified.view_mode
    from classified
    where coalesce(nullif(pg_catalog.btrim(v_filters ->> 'viewMode'), ''), 'all') = 'all'
       or view_mode = pg_catalog.btrim(v_filters ->> 'viewMode')
  ), page_keys as materialized (
    select id, sort_key from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), next_unplanned as materialized (
    select distinct on (session.class_id) session.class_id,
      session.id as next_session_id,session.session_key as next_session_key,
      session.session_date as next_session_date,session.start_time as next_start_time,
      session.end_time as next_end_time,session.schedule_state as next_schedule_state
    from schedule_sessions session join page_keys selected on selected.id=session.class_id
    where session.session_date >= (current_timestamp at time zone 'Asia/Seoul')::date
    order by session.class_id,session.session_date,session.start_time nulls last,session.id
  ), page_candidates as materialized (
    select filtered.*, next_unplanned.next_session_id, next_unplanned.next_session_key,
      next_unplanned.next_session_date, next_unplanned.next_start_time,
      next_unplanned.next_end_time, next_unplanned.next_schedule_state
    from page_keys selected
    join filtered on filtered.id = selected.id
    left join next_unplanned on next_unplanned.class_id = selected.id
  ), page_rows as materialized (
    select
      id,
      sort_key::text as sort_key,
      pg_catalog.jsonb_build_object(
        'id', id,
        'title', pg_catalog.regexp_replace(coalesce(name, ''), '^\[[^]]+\]\s*', ''),
        'fullTitle', coalesce(name, ''),
        'subject', coalesce(subject, ''),
        'subjectAreaKey', coalesce(subject_area_key, ''),
        'grade', coalesce(grade, ''),
        'term', term_name,
        'teacherNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(teacher, ''), '\s*[,/&·]\s*')),
        'teacherSummary', coalesce(teacher, ''),
        'classroomNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(room, ''), '\s*[,/&·]\s*')),
        'classroomSummary', coalesce(room, ''),
        'schedule', coalesce(schedule, ''),
        'status', normalized_status,
        'statusFilter', normalized_status,
        'classGroupIds', coalesce((select pg_catalog.jsonb_agg(member.group_id::text order by member.sort_order, member.group_id) from public.class_schedule_sync_group_members member where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupNames', coalesce((select pg_catalog.jsonb_agg(group_row.name order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupLabel', coalesce((select pg_catalog.string_agg(group_row.name, ', ' order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '미분류'),
        'textbookCount', textbook_count,
        'textbookCatalog', '[]'::jsonb,
        'textbookTitles', '[]'::jsonb,
        'textbookSummary', '',
        'textbookOverflowCount', 0,
        'textbookScopeLabels', '[]'::jsonb,
        'totalSessions', session_count,
        'completedSessions', planned_count,
        'updatedSessions', planned_count,
        'delayedSessions', greatest(session_count - planned_count, 0),
        'plannedSessions', planned_count,
        'progressTargetSessions', case when textbook_count > 0 then session_count else 0 end,
        'delayedProgressSessions', case when textbook_count > 0 then greatest(session_count - planned_count, 0) else 0 end,
        'plannedProgressSessions', planned_count,
        'progressPercent', case when session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'progressTargetPercent', case when textbook_count > 0 and session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'lastUpdatedAt', coalesce(last_updated_at::text, ''),
        'stateLabel', state_label,
        'latestNoteSummary', '',
        'latestNoteSessionLabel', '',
        'pendingSessionLabels', '[]'::jsonb,
        'nextSession', case when next_session_id is null then null else pg_catalog.jsonb_build_object(
          'sessionId', next_session_id,
          'sessionKey', next_session_key,
          'sessionOrder', 0,
          'label', pg_catalog.to_char(next_session_date, 'YYYY-MM-DD'),
          'progressStatus', 'pending',
          'hasActualContent', false,
          'updatedAt', '',
          'noteSummary', '',
          'dateValue', next_session_date,
          'dateLabel', next_session_date,
          'periodLabel', pg_catalog.concat_ws('~', next_start_time::text, next_end_time::text),
          'scheduleState', next_schedule_state,
          'scheduleMemo', '',
          'makeupMemo', '',
          'makeupDate', '',
          'hasPlanContent', false,
          'planSummary', '',
          'textbookEntryCount', 0,
          'textbookEntries', '[]'::jsonb
        ) end,
        'sessionSummaries', '[]'::jsonb,
        'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', name, subject, grade, teacher, room, schedule, state_label))
      ) as row_data
    from page_candidates
  ), stats as materialized (
    select pg_catalog.jsonb_build_object(
      'total', pg_catalog.count(*)::integer,
      'managedClassCount', pg_catalog.count(*) filter (where session_count > 0)::integer,
      'totalSessions', coalesce(pg_catalog.sum(session_count),0)::integer,
      'completedSessions', coalesce(pg_catalog.sum(planned_count),0)::integer,
      'pendingSessions', coalesce(pg_catalog.sum(greatest(session_count-planned_count,0)),0)::integer,
      'linkedTextbooks', coalesce(pg_catalog.sum(textbook_count),0)::integer,
      'unlinkedClassCount', 0,
      'noScheduleClassCount', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
      'updateNeededClassCount', pg_catalog.count(*) filter (where state_label='일정 연장 필요')::integer,
      'completedClassCount', pg_catalog.count(*) filter (where state_label='일정 편성')::integer,
      'viewModeCounts', (
        select pg_catalog.jsonb_build_object(
          'all', pg_catalog.count(*)::integer,
          'unlinked', pg_catalog.count(*) filter (where view_mode='unlinked')::integer,
          'unscheduled', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
          'update', pg_catalog.count(*) filter (where view_mode='update')::integer,
          'done', pg_catalog.count(*) filter (where view_mode='done')::integer
        )
        from classified
      )
    ) as data from filtered
    where p_include_scope_metadata
  ), filter_options as materialized (
    select pg_catalog.jsonb_build_object(
      'periods', '[]'::jsonb,
      'statuses', pg_catalog.to_jsonb(array['수강','개강 준비','종강']),
      'subjects', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct subject as value from base where nullif(pg_catalog.btrim(subject),'') is not null order by subject limit 500) bounded), '[]'::jsonb),
      'grades', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct grade as value from base where nullif(pg_catalog.btrim(grade),'') is not null order by grade limit 500) bounded), '[]'::jsonb),
      'teachers', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct pg_catalog.btrim(token) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(teacher,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb),
      'classrooms', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token)) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(room,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb)
    ) as data
    where p_include_scope_metadata
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows), '[]'::jsonb),
    'page', p_page, 'pageSize', p_page_size,
    'totalCount', (select pg_catalog.count(*) from filtered),
    'stats', case when p_include_scope_metadata then (select data from stats) else null end,
    'filterOptions', case when p_include_scope_metadata then (select data from filter_options) else null end,
    'resolvedPeriodId', v_filters ->> 'periodId'
  ) into v_result;

  return v_result;
end;
$function$;

alter function dashboard_private.get_academic_curriculum_numbered_page_v2_common_impl_v1(jsonb,integer,integer,boolean) owner to postgres;
revoke all on function dashboard_private.get_academic_curriculum_numbered_page_v2_common_impl_v1(jsonb,integer,integer,boolean) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_academic_timetable_range_v1_common_impl_v1(p_date_from date, p_date_to date, p_class_group_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_subject text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb := '[]'::jsonb;
  v_class_summaries jsonb := '[]'::jsonb;
  v_terms jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_teachers jsonb := '[]'::jsonb;
  v_classrooms jsonb := '[]'::jsonb;
  v_status_options jsonb := '[]'::jsonb;
  v_subject_options jsonb := '[]'::jsonb;
  v_collection text;
  v_class_group_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from
     or (p_date_to - p_date_from) > 13 then
    raise exception 'academic_timetable_range_invalid' using errcode = '22023';
  end if;
  -- Weekly templates are selected by class status, never by a historical semester.
  -- Keep the retired argument and empty metadata keys for old client compatibility.
  v_class_group_id := null;

  with eligible as materialized (
    select
      class.id,
      class.name,
      class.subject,
      class.subject_area_key,
      class.grade,
      class.teacher,
      class.room,
      class.schedule,
      class.schedule_storage_mode,
      class.status,
      class.start_date,
      class.end_date,
      class.term_id,
      class.period,
      coalesce(term.academic_year, nullif(pg_catalog.substring(class.period, '([0-9]{4})'), '')::integer, pg_catalog.date_part('year', current_date)::integer) as academic_year,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), '')) as term_name,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(p_status), '') is null
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(p_status))
      and (nullif(pg_catalog.btrim(p_subject), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(p_subject))
  ), parsed as materialized (
    select
      class.*,
      '[]'::jsonb as group_ids,
      '[]'::jsonb as group_names,
      matched.parts,
      day_value.day,
      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.teacher_name, '') else case when (pg_catalog.length(coalesce(matched.parts[4], '')) - pg_catalog.length(pg_catalog.replace(coalesce(matched.parts[4], ''), ',', '')) = 1) then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 1)) else coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) end end as row_teacher,
      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.classroom_name, '') else case when (pg_catalog.length(coalesce(matched.parts[4], '')) - pg_catalog.length(pg_catalog.replace(coalesce(matched.parts[4], ''), ',', '')) = 1) then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 2)) else dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) end end as row_classroom

    from eligible class
    cross join lateral pg_catalog.regexp_matches(
      coalesce(class.schedule, ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?',
      'g'
    ) matched(parts)
    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    left join public.class_schedule_slots normalized_slot
      on class.schedule_storage_mode = 'normalized'
      and normalized_slot.class_id = class.id
      and normalized_slot.weekday = case day_value.day
        when '월' then 1 when '화' then 2 when '수' then 3 when '목' then 4
        when '금' then 5 when '토' then 6 else 0 end
      and normalized_slot.start_time = case
        when matched.parts[2] ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        then matched.parts[2]::time end
      and normalized_slot.end_time = case
        when matched.parts[3] ~ '^(([01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        then matched.parts[3]::time end
    where day_value.day in ('월','화','수','목','금','토','일')
  ), row_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', parsed.id::text || ':' || parsed.day || ':' || parsed.parts[2] || ':' || parsed.parts[3],
      'classId', parsed.id,
      'title', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''),
      'fullTitle', coalesce(parsed.name, ''),
      'academicYear', parsed.academic_year::text,
      'subject', coalesce(parsed.subject, ''),
      'subjectAreaKey', coalesce(parsed.subject_area_key, ''),
      'grade', coalesce(parsed.grade, ''),
      'teacher', parsed.row_teacher,
      'classroom', parsed.row_classroom,
      'term', coalesce(parsed.term_name, ''),
      'schedule', coalesce(parsed.schedule, ''),
      'status', parsed.normalized_status,
      'statusFilter', parsed.normalized_status,
      'classGroupIds', parsed.group_ids,
      'classGroupNames', parsed.group_names,
      'classGroupLabel', coalesce((select pg_catalog.string_agg(value, ', ') from pg_catalog.jsonb_array_elements_text(parsed.group_names) value), '미분류'),
      'day', parsed.day,
      'dayIndex', case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      'start', parsed.parts[2],
      'end', parsed.parts[3],
      'startMinutes', pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[2], ':', 2)::integer,
      'endMinutes', pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer,
      'durationMinutes', greatest(0,
        pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer
        - pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 - pg_catalog.split_part(parsed.parts[2], ':', 2)::integer),
      'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''), parsed.subject, parsed.grade, parsed.row_teacher, parsed.row_classroom, parsed.normalized_status, parsed.term_name, parsed.schedule))
    ) as row_data,
    parsed.day,
    parsed.parts[2] as start_time,
    parsed.id
    from parsed
    order by case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      parsed.parts[2], parsed.id
    limit 2001
  ), class_summary_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', class.id,
      'subject', class.subject,
      'grade', class.grade,
      'term_id', class.term_id,
      'period', class.period,
      'academic_year', class.academic_year
    ) as row_data
    from eligible class order by class.name collate dashboard_private.ko_numeric, class.id limit 501
  ), teacher_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.teacher_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.teacher, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  ), classroom_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.classroom_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.room, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by day, start_time, id) from row_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from class_summary_limited), '[]'::jsonb),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    coalesce((select pg_catalog.jsonb_agg(row_data) from teacher_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from classroom_limited), '[]'::jsonb),
    pg_catalog.jsonb_build_array('수강','개강 준비','종강'),
    coalesce((select pg_catalog.jsonb_agg(distinct subject order by subject) filter (where nullif(pg_catalog.btrim(subject), '') is not null) from eligible), '[]'::jsonb)
  into v_rows, v_class_summaries, v_terms, v_groups, v_members, v_teachers, v_classrooms, v_status_options, v_subject_options;

  if pg_catalog.jsonb_array_length(v_rows) > 2000 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'visible_range_too_dense',
      'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
      'rows', '[]'::jsonb, 'observedRowsAtLeast', 2001, 'suggestedDays', 7
    );
  end if;

  foreach v_collection in array array['class_summaries','class_terms','class_groups','class_group_members','teacher_catalogs','classroom_catalogs'] loop
    if pg_catalog.jsonb_array_length(case v_collection
      when 'class_summaries' then v_class_summaries when 'class_terms' then v_terms
      when 'class_groups' then v_groups when 'class_group_members' then v_members
      when 'teacher_catalogs' then v_teachers else v_classrooms end) > 500 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'timetable_collection_too_dense',
        'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
        'collection', v_collection, 'observedItemsAtLeast', 501,
        'action', 'narrow_filters', 'rows', '[]'::jsonb
      );
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
    'resolvedClassGroupId', v_class_group_id,
    'rows', v_rows,
    'classSummaries', v_class_summaries,
    'classTerms', v_terms,
    'classGroups', v_groups,
    'classGroupMembers', v_members,
    'teacherCatalogs', v_teachers,
    'classroomCatalogs', v_classrooms,
    'statusOptions', v_status_options,
    'subjectOptions', v_subject_options,
    'complete', true
  );
end;
$function$;

alter function dashboard_private.get_academic_timetable_range_v1_common_impl_v1(date,date,text,text,text) owner to postgres;
revoke all on function dashboard_private.get_academic_timetable_range_v1_common_impl_v1(date,date,text,text,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_operations_class_schedule_numbered_page_v1_common_impl_v1(p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_keys text[];
  v_filters jsonb;
  v_rows jsonb;
  v_stats jsonb;
  v_options jsonb;
  v_group_counts jsonb;
begin
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['grade','search','subject','syncGroupId','teacher','termId']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'operations_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case when key = 'search'
    then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if exists (select 1 from pg_catalog.jsonb_each_text(v_filters) field
    where key in ('termId','syncGroupId') and value is not null
      and value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;

  with filtered as materialized (
    select class.id, class.status,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), '') collate dashboard_private.ko_numeric as sort_key,
      (select member.group_id
        from public.class_schedule_sync_group_members member
        where member.class_id = class.id
        order by (member.group_id::text = v_filters ->> 'syncGroupId') desc, member.sort_order asc, member.group_id asc
        limit 1) as sync_group_id
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (v_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, term.name) ilike '%' || (v_filters ->> 'search') || '%')
      and ((v_filters ->> 'termId') is null or class.term_id::text = v_filters ->> 'termId')
      and ((v_filters ->> 'subject') is null or class.subject = v_filters ->> 'subject')
      and ((v_filters ->> 'grade') is null or class.grade = v_filters ->> 'grade')
      and ((v_filters ->> 'teacher') is null or exists (
        select 1
        from pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value)
        where pg_catalog.btrim(teacher_name.value) = v_filters ->> 'teacher'
      ))
      and ((v_filters ->> 'syncGroupId') is null or exists (
        select 1 from public.class_schedule_sync_group_members as member
        where member.class_id = class.id and member.group_id::text = v_filters ->> 'syncGroupId'
      ))
  ), page_keys as materialized (
    select id, sort_key, sync_group_id from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_rows as (
    select selected.id, selected.sort_key,
      pg_catalog.jsonb_build_object(
        'id', class.id, 'name', coalesce(class.name,''),
        'subject', coalesce(class.subject,''), 'grade', coalesce(class.grade,''),
        'schedule', coalesce(class.schedule,''), 'termId', class.term_id,
        'teacherName', nullif(pg_catalog.btrim(class.teacher),''),
        'termName', term.name, 'syncGroupId', selected.sync_group_id,
        'syncGroupName', group_row.name, 'status', coalesce(class.status,''),
        'updatedAt', class.created_at
      ) as row_data
    from page_keys selected
    join public.classes class on class.id = selected.id
    left join public.class_terms term on term.id = class.term_id
    left join public.class_schedule_sync_groups group_row on group_row.id = selected.sync_group_id
  ), catalog_groups as materialized (
    select id, sort_order, name from public.class_schedule_sync_groups
    order by sort_order, name collate dashboard_private.ko_numeric, id limit 200
  ), group_counts as (
    select sync_group_id, pg_catalog.count(*) as member_count from filtered
    where sync_group_id is not null group by sync_group_id
  ), representatives as (
    select distinct on (sync_group_id) sync_group_id, id from filtered
    where sync_group_id is not null order by sync_group_id, sort_key, id
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows),'[]'::jsonb),
    (select pg_catalog.jsonb_build_object(
      'total',pg_catalog.count(*),
      'active',pg_catalog.count(*) filter(where status in ('수강','수업 진행 중')),
      'draft',pg_catalog.count(*) filter(where status in ('개강 예정','개강 준비 중'))
    ) from filtered),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'groupId', catalog.id, 'memberCount', counts.member_count, 'representativeClassId', representative.id
    ) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id)
      from catalog_groups catalog
      join group_counts counts on counts.sync_group_id = catalog.id
      join representatives representative on representative.sync_group_id = catalog.id),'[]'::jsonb)
  into v_rows, v_stats, v_group_counts;

  select pg_catalog.jsonb_build_object(
    'terms', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', term.id, 'label', term.name) order by term.academic_year desc, term.sort_order asc, term.id asc), '[]'::jsonb) from (select * from public.class_terms order by academic_year desc, sort_order asc, id asc limit 200) as term),
    'subjects', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.subject as value, class.subject collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.subject), '') is not null order by sort_value limit 200) as option),
    'grades', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.grade as value, class.grade collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.grade), '') is not null order by sort_value limit 200) as option),
    'teachers', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct pg_catalog.btrim(teacher_name.value) as value, pg_catalog.btrim(teacher_name.value) collate dashboard_private.ko_numeric as sort_value from public.classes as class cross join lateral pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value) where nullif(pg_catalog.btrim(teacher_name.value), '') is not null order by sort_value limit 200) as option),
    'syncGroups', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', sync_group.id, 'label', sync_group.name) order by sync_group.sort_order asc, sync_group.name collate dashboard_private.ko_numeric asc, sync_group.id asc), '[]'::jsonb) from (select * from public.class_schedule_sync_groups order by sort_order asc, name collate dashboard_private.ko_numeric asc, id asc limit 200) as sync_group)
  ) into v_options;

  return pg_catalog.jsonb_build_object(
    'rows',v_rows,'page',p_page,'pageSize',p_page_size,'totalCount',v_stats -> 'total',
    'stats',v_stats,'filterOptions',v_options,'syncGroupCounts',v_group_counts
  );
end
$function$;

alter function dashboard_private.get_operations_class_schedule_numbered_page_v1_common_impl_v1(jsonb,integer,integer) owner to postgres;
revoke all on function dashboard_private.get_operations_class_schedule_numbered_page_v1_common_impl_v1(jsonb,integer,integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.get_operations_class_lesson_design_detail_v1_common_impl_v1(p_class_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_build_object(
    'classItem', pg_catalog.jsonb_build_object(
      'id', class.id,
      'name', class.name,
      'className', class.name,
      'classType', class.class_type,
      'subject', class.subject,
      'grade', class.grade,
      'teacher', class.teacher,
      'schedule', class.schedule,
      'room', class.room,
      'status', class.status,
      'termId', class.term_id,
      'termName', term.name,
      'startDate', class.start_date,
      'endDate', class.end_date,
      'textbookIds', coalesce(class.textbook_ids, '[]'::jsonb),
      'schedulePlan', coalesce(class.schedule_plan, '{}'::jsonb),
      'scheduleStorageMode', class.schedule_storage_mode,
      'scheduleRevision', class.schedule_revision
    ),
    'textbooks','[]'::jsonb,
    'teacherCatalogs', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order
        from public.teacher_catalogs as teacher
        where teacher.is_visible and (teacher.subjects = '{}'::text[] or case
          when pg_catalog.btrim(class.subject) in ('영어', '영어팀') then teacher.subjects && array['영어', '영어팀']::text[]
          when pg_catalog.btrim(class.subject) in ('수학', '수학팀') then teacher.subjects && array['수학', '수학팀']::text[]
          when pg_catalog.btrim(class.subject) in ('과학', '과학팀') then teacher.subjects && array['과학', '과학팀']::text[]
          else pg_catalog.btrim(class.subject) = any(teacher.subjects)
        end)
        order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id
        limit 200
      ) as catalog
    ),
    'classroomCatalogs', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order
        from public.classroom_catalogs as classroom
        where classroom.is_visible and (classroom.subjects = '{}'::text[] or class.subject = any(classroom.subjects))
        order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id
        limit 200
      ) as catalog
    )
  )
  from public.classes as class
  left join public.class_terms as term on term.id = class.term_id
  where class.id = p_class_id
$function$;

alter function dashboard_private.get_operations_class_lesson_design_detail_v1_common_impl_v1(uuid) owner to postgres;
revoke all on function dashboard_private.get_operations_class_lesson_design_detail_v1_common_impl_v1(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dashboard_private.list_operations_catalogs_v1_common_impl_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_build_object(
    'academicSchools', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'category', catalog.category) order by catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select school.id, school.name, school.category from public.academic_schools as school where nullif(pg_catalog.btrim(school.name), '') is not null order by school.name collate dashboard_private.ko_numeric, school.id limit 200) as catalog),
    'teachers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order from public.teacher_catalogs as teacher where teacher.is_visible order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id limit 200) as catalog),
    'classrooms', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order from public.classroom_catalogs as classroom where classroom.is_visible order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id limit 200) as catalog),
    'subjects', (select coalesce(pg_catalog.jsonb_agg(subject_option.subject order by subject_option.sort_subject), '[]'::jsonb) from (select distinct class_row.subject, class_row.subject collate dashboard_private.ko_numeric as sort_subject from public.classes as class_row where nullif(pg_catalog.btrim(class_row.subject), '') is not null order by sort_subject limit 200) as subject_option)
  )
$function$;

alter function dashboard_private.list_operations_catalogs_v1_common_impl_v1() owner to postgres;
revoke all on function dashboard_private.list_operations_catalogs_v1_common_impl_v1() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_makeup_numbered_page_v1(p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor uuid:=auth.uid(); manager boolean; f jsonb:=p_filters; k text; date_value text; result jsonb; needs_keys boolean;
 columns text[]:=array['status','className','subject','teacher','requester','reason','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt','returnedReason','rejectedReason','finalNote','canceledNote'];
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('makeup_page',jsonb_build_object('p_filters',p_filters,'p_page',p_page,'p_page_size',p_page_size));end if;
 if actor is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not in(10,15,20) or jsonb_typeof(f) is distinct from 'object' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(f))<>10 or not f ?& array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search','sortColumn','sortDirection'] then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search'] loop if jsonb_typeof(f->k) is distinct from 'string' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; end loop;
 if f->>'view' not in('mine','approvalPending','makeupPending','refundPending','closed') or f->>'subject' not in('all','영어','수학','과학') or f->>'period' not in('all','today','week','month','custom')
  or not(f->>'filterColumn'=any(columns)) or not(f->>'teacher'='all' or f->>'teacher' ~ '^id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or f->>'teacher' ~ '^name:.+')
  or not coalesce((f->'sortColumn'='null'::jsonb and f->'sortDirection'='null'::jsonb) or (jsonb_typeof(f->'sortColumn')='string' and f->>'sortColumn'=any(columns) and f->>'sortDirection' in('asc','desc')),false) then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['dateFrom','dateTo'] loop
  date_value:=f->>k;
  if date_value<>'' then
   if date_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
   begin if to_char(date_value::date,'YYYY-MM-DD')<>date_value then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end;
  end if;
 end loop;
 if (f->>'period'='all' and (f->>'dateFrom'<>'' or f->>'dateTo'<>'')) or (f->>'period' in('today','week','month') and (f->>'dateFrom'='' or f->>'dateTo'='')) or (f->>'dateFrom'<>'' and f->>'dateTo'<>'' and f->>'dateFrom'>f->>'dateTo') then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 select coalesce(role in('admin','staff'),false) into manager from public.profiles where id=actor;
 -- Branch before EXISTS: a nullable sortColumn otherwise causes an unused
 -- legacy-compatibility scan even during default browsing.
 if (f->>'period'<>'all' or f->>'sortColumn' in('makeupAt','makeupRoom') or (public.makeup_numbered_trim_v1(f->>'search')<>'' and f->>'filterColumn' in('makeupAt','makeupRoom'))) then
  if exists (
  select 1 from public.makeup_requests r where
   case f->>'view'
    when 'mine' then r.status='revision_requested' and actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id)
    when 'approvalPending' then r.status='approval_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'makeupPending' then r.status='makeup_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'refundPending' then r.status='refund_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'closed' then r.status in('completed','rejected','canceled') else false end
   and (f->>'subject'='all' or public.makeup_numbered_trim_v1(r.subject)=f->>'subject')
   and (f->>'teacher'='all' or f->>'teacher'=case when r.teacher_catalog_id is not null then 'id:'||r.teacher_catalog_id else 'name:'||coalesce(public.makeup_numbered_profile_label_v1(r.teacher_profile_id),'선생님') end)
   and public.makeup_numbered_legacy_slots_v1(to_jsonb(r))
 ) then raise exception 'makeup_legacy_slot_format_unsupported' using errcode='22023'; end if;
 end if;
 -- Default browsing uses only membership/facets and created_at/id ordering.
 -- Derive display/search keys only when a filter or sort actually consumes them.
 needs_keys:=public.makeup_numbered_trim_v1(f->>'search')<>'' or f->>'period'<>'all' or f->>'sortColumn' is not null;
 with authorized as materialized (
  select r.id,r.status,r.subject,r.teacher_catalog_id,r.teacher_profile_id,r.requester_id,r.approver_profile_id,
   r.class_name,r.reason,r.cancel_date,r.makeup_start_at,r.makeup_end_at,r.makeup_classroom,r.makeup_slots,r.approver_teacher_catalog_id,r.returned_reason,r.rejected_reason,r.final_note,r.approved_at,r.canceled_at,r.created_at,
   (r.requester_id=actor or r.teacher_profile_id=actor or r.approver_profile_id=actor) is true involved
  from public.makeup_requests r
 ), membership as materialized (
  select a.*,array_remove(array[
   case when involved and status='revision_requested' then 'mine' end,
   case when (manager or involved) and status='approval_pending' then 'approvalPending' end,
   case when (manager or involved) and status='makeup_pending' then 'makeupPending' end,
   case when (manager or involved) and status='refund_pending' then 'refundPending' end,
   case when status in('completed','rejected','canceled') then 'closed' end],null) views
  from authorized a
 ), current_view as materialized (
  select a.*,coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.teacher_catalog_id),public.makeup_numbered_profile_label_v1(a.teacher_profile_id),'선생님') teacher_label
  from membership a where f->>'view'=any(a.views)
 ), keyed as materialized (
  select a.id,a.created_at,case when needs_keys then public.makeup_numbered_values_v1(to_jsonb(a),coalesce(e.latest,'{}'),jsonb_build_object('teacher',a.teacher_label,'requester',coalesce(public.makeup_numbered_profile_label_v1(a.requester_id),'신청자'),'approver',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.approver_teacher_catalog_id),public.makeup_numbered_profile_label_v1(a.approver_profile_id),'결재자'))) else '{}'::jsonb end keys
  from current_view a
  left join lateral (
   select jsonb_object_agg(kind,jsonb_build_object('createdAt',to_jsonb(created_at)#>>'{}','note',public.makeup_numbered_trim_v1(note))) latest from (
    select distinct on(kind) case when public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled') then 'canceled' when public.makeup_numbered_trim_v1(event_type) in('submitted','resubmitted') then 'submitted' else public.makeup_numbered_trim_v1(event_type) end kind,created_at,id,note
    from public.makeup_request_events where needs_keys and request_id=a.id and public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled','submitted','resubmitted','revision_requested','approved','rejected') order by kind,created_at desc,id desc
   ) latest_events
  ) e on true
  where (f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject') and (f->>'teacher'='all' or f->>'teacher'=case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end)
 ), filtered as materialized (
  select * from keyed where (public.makeup_numbered_trim_v1(f->>'search')='' or strpos(lower(keys->>(f->>'filterColumn')),lower(public.makeup_numbered_trim_v1(f->>'search')))>0)
   and (f->>'period'='all' or exists(select 1 from jsonb_array_elements_text(keys->'dates')d where (f->>'dateFrom'='' or d>=f->>'dateFrom') and (f->>'dateTo'='' or d<=f->>'dateTo')))
 ), selected as materialized (
  select id,row_number() over(order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc) position
  from filtered order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc limit p_page_size offset (p_page::bigint-1)*p_page_size
 ), teacher_sources as (
  select 'id:'||t.id value,public.makeup_numbered_trim_v1(t.name) label,0::bigint count,0 source,t.sort_order sort_order
  from public.teacher_catalogs t where t.is_visible is distinct from false and (f->>'subject'='all' or exists(select 1 from regexp_split_to_table(case when jsonb_typeof(to_jsonb(t.subjects))='array' then (select string_agg(x,',') from jsonb_array_elements_text(to_jsonb(t.subjects))x) else t.subjects::text end,'[,，/]+')s where regexp_replace(translate(s,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',''),'(과목|팀)$','')=f->>'subject'))
  union all
  select case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end,a.teacher_label,count(*),1,0 from current_view a where f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject' group by 1,2
 ), teacher_options as (
  select distinct on(value) * from teacher_sources where value<>'' and label<>'' order by value,source,sort_order,label collate public.makeup_ko_numeric
 )
 select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*) from filtered),
  'viewCounts',(select jsonb_object_agg(v,(select count(*) from membership where v=any(views))) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v),
  'subjectOptions',(select jsonb_agg(jsonb_build_object('value',s,'label',s,'count',(select count(*) from current_view where public.makeup_numbered_trim_v1(subject)=s)) order by ord) from unnest(array['영어','수학','과학'])with ordinality subjects(s,ord)),
  'teacherOptions',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',label,'count',count) order by source,sort_order,label collate public.makeup_ko_numeric) from teacher_options),'[]'),
  'rows',coalesce((select jsonb_agg(public.get_makeup_detail_v1(id) order by position) from selected),'[]')) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_makeup_detail_v1(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare r public.makeup_requests; result jsonb; k text; source_key text; events jsonb;
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('makeup_detail',jsonb_build_object('p_id',p_id));end if;
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_id is null then raise exception 'makeup_detail_request_invalid' using errcode='22023'; end if;
 select * into r from public.makeup_requests where id=p_id;
 if not found then return null; end if;
 result:=jsonb_build_object('id',r.id,'status',r.status,'approvalGroup',r.approval_group,'requestKind',r.request_kind,
  'requesterLabel',coalesce(public.makeup_numbered_profile_label_v1(r.requester_id),'신청자'),
  'teacherLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.teacher_catalog_id),public.makeup_numbered_profile_label_v1(r.teacher_profile_id),'선생님'),
  'approverLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.approver_teacher_catalog_id),public.makeup_numbered_profile_label_v1(r.approver_profile_id),'결재자'),
  'approvedByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.approved_by),''),'completedByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.completed_by),''),'canceledByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.canceled_by),''),
  'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(r)),
  'schedulePlanBefore',case when jsonb_typeof(r.schedule_plan_before)='object' then r.schedule_plan_before else '{}'::jsonb end,
  'schedulePlanAfter',case when jsonb_typeof(r.schedule_plan_after)='object' then r.schedule_plan_after else '{}'::jsonb end,
  'makeupAcademicEventIds',coalesce(r.makeup_academic_event_ids,'[]'));
 for k,source_key in select * from (values
  ('subject','subject'),('requesterId','requester_id'),('teacherCatalogId','teacher_catalog_id'),('teacherProfileId','teacher_profile_id'),('classId','class_id'),('className','class_name'),('reason','reason'),('cancelDate','cancel_date'),('makeupStartAt','makeup_start_at'),('makeupEndAt','makeup_end_at'),('makeupClassroom','makeup_classroom'),('approverTeacherCatalogId','approver_teacher_catalog_id'),('approverProfileId','approver_profile_id'),('returnedReason','returned_reason'),('rejectedReason','rejected_reason'),('finalNote','final_note'),('approvedBy','approved_by'),('approvedAt','approved_at'),('completedBy','completed_by'),('completedAt','completed_at'),('canceledBy','canceled_by'),('canceledAt','canceled_at'),('cancelAcademicEventId','cancel_academic_event_id'),('makeupAcademicEventId','makeup_academic_event_id'),('createdAt','created_at'),('updatedAt','updated_at'))m(k,s) loop
  result:=result||jsonb_build_object(k,public.makeup_numbered_trim_v1(to_jsonb(r)->>source_key));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'actorId',coalesce(e.actor_id::text,''),'actorLabel',coalesce(public.makeup_numbered_profile_label_v1(e.actor_id),'시스템'),
  'eventType',public.makeup_numbered_trim_v1(e.event_type),'fieldName',public.makeup_numbered_trim_v1(e.field_name),'beforeValue',public.makeup_numbered_trim_v1(e.before_value),'afterValue',public.makeup_numbered_trim_v1(e.after_value),'note',public.makeup_numbered_trim_v1(e.note),'createdAt',to_jsonb(e.created_at)#>>'{}') order by e.created_at desc,e.id desc),'[]') into events from public.makeup_request_events e where e.request_id=p_id;
 return result||jsonb_build_object('events',events)||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(r)) then jsonb_build_object('rawMakeupSlots',r.makeup_slots) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_summary_sources_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('dashboard',jsonb_build_object());end if;
 return (select pg_catalog.jsonb_build_object(
    'classes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          class.id,
          class.name,
          class.subject,
          class.grade,
          class.teacher,
          class.room,
          class.schedule,
          class.status,
          class.start_date,
          class.end_date,
          class.student_ids,
          class.waitlist_ids,
          class.schedule_storage_mode
        from public.classes class
      ) row_data
    ), '[]'::jsonb),
    'students', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          student.id,
          student.name,
          student.school,
          student.grade,
          student.status,
          student.class_ids,
          student.waitlist_class_ids
        from public.students student
      ) row_data
    ), '[]'::jsonb)
  ));
end
$function$;

CREATE OR REPLACE FUNCTION public.get_academic_curriculum_numbered_page_v2(p_filters jsonb, p_page integer, p_page_size integer, p_include_scope_metadata boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_filters jsonb;
  v_keys text[];
  v_result jsonb;
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('curriculum',jsonb_build_object('p_filters',p_filters,'p_page',p_page,'p_page_size',p_page_size,'p_include_scope_metadata',p_include_scope_metadata));end if;
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  -- Shape validation must precede jsonb expansion, and bigint math precedes OFFSET.
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['classroom','grade','periodId','search','status','subject','teacher','viewMode']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) or p_include_scope_metadata is null then
    raise exception 'academic_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case
    when key = 'search' then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    when key = 'viewMode' then pg_catalog.to_jsonb(coalesce(nullif(pg_catalog.btrim(value #>> '{}'),''),'all'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if v_filters ->> 'viewMode' not in ('all','unscheduled','unlinked','update','done')
    or ((v_filters ->> 'status') is not null and v_filters ->> 'status' not in ('수강','개강 준비','종강')) then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  if v_filters->>'viewMode'='unlinked' then v_filters:=jsonb_set(v_filters,'{viewMode}','"all"'); end if;
  with eligible_classes as materialized (
    select
      class.id, class.name, class.subject, class.subject_area_key, class.grade,
      class.teacher, class.room, class.schedule, class.status, class.start_date,
      class.end_date, class.term_id, class.period, class.schedule_storage_mode, class.schedule_plan,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), term.name, '') as term_name,
      0::integer as textbook_count,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), U&'\FFFF') collate dashboard_private.ko_numeric as sort_key
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(v_filters ->> 'periodId'), '') is null or exists (
        select 1
        from public.class_schedule_sync_group_members member
        join public.class_schedule_sync_groups group_row on group_row.id = member.group_id
        where member.class_id = class.id
          and (member.group_id::text = v_filters ->> 'periodId' or group_row.name = v_filters ->> 'periodId')
      ))
      and (nullif(pg_catalog.btrim(v_filters ->> 'status'), '') is null
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(v_filters ->> 'status'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'subject'), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(v_filters ->> 'subject'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'grade'), '') is null or pg_catalog.btrim(class.grade) = pg_catalog.btrim(v_filters ->> 'grade'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'teacher'), '') is null or coalesce(class.teacher, '') ilike '%' || pg_catalog.btrim(v_filters ->> 'teacher') || '%')
      and (
        nullif(pg_catalog.btrim(v_filters ->> 'classroom'), '') is null
        or exists (
          select 1
          from pg_catalog.regexp_split_to_table(coalesce(class.room, ''), '[,/&·]+') token
          where dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token))
            = dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(v_filters ->> 'classroom'))
        )
      )
      and (nullif(pg_catalog.btrim(v_filters ->> 'search'), '') is null or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, class.room, class.schedule) ilike '%' || pg_catalog.btrim(v_filters ->> 'search') || '%')
  ), session_classes as materialized (
    -- Only the all-view without scope metadata can page before session work.
    -- Other views need every class's counts to decide membership and totals.
    select * from eligible_classes order by sort_key,id
    offset case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then ((p_page::bigint-1)*p_page_size::bigint) else 0 end
    limit case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then p_page_size else null end
  ), saved_sessions (class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at) as materialized (
    select eligible.id, coalesce(nullif(item->>'id',''),nullif(item->>'sessionKey',''),eligible.id::text || ':' || ordinality),
      coalesce(nullif(item->>'sessionKey',''),nullif(item->>'id',''),eligible.id::text || ':' || ordinality),
      case when dashboard_private.is_canonical_class_date_v1(item->>'date') then nullif(item->>'date','')::date end, coalesce(item->>'startTime',''), coalesce(item->>'endTime',''),
      case when coalesce(item->>'scheduleState',item->>'state','active')='force_active' then 'active'
        else coalesce(item->>'scheduleState',item->>'state','active') end, ''
    from session_classes eligible
    cross join lateral jsonb_array_elements(case when jsonb_typeof(eligible.schedule_plan->'sessions')='array'
      then eligible.schedule_plan->'sessions' else '[]'::jsonb end) with ordinality entries(item,ordinality)
    where eligible.schedule_storage_mode <> 'normalized'
      and nullif(item->>'date','') is not null
      and coalesce(item->>'scheduleState',item->>'state','active') in ('active','force_active','exception','makeup','tbd')

  ), schedule_sessions as materialized (
    select session.class_id, session.id::text as id, session.session_key, session.session_date,
      session.start_time::text as start_time, session.end_time::text as end_time,
      session.schedule_state, session.updated_at::text as updated_at
    from public.class_lesson_sessions session
    join session_classes eligible on eligible.id=session.class_id
    where eligible.schedule_storage_mode='normalized' and session.schedule_state <> 'skipped'
    union all
    select class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at
    from saved_sessions where session_date is not null
  ), session_agg as materialized (
    select class_id, count(*)::integer as session_count,
      count(*) filter(where session_date < (current_timestamp at time zone 'Asia/Seoul')::date)::integer as planned_count,
      count(*) filter(where session_date >= (current_timestamp at time zone 'Asia/Seoul')::date)::integer as upcoming_count,
      max(updated_at) as last_updated_at
    from schedule_sessions group by class_id
  ), base as materialized (
    select
      eligible.id, eligible.name, eligible.subject, eligible.subject_area_key,
      eligible.grade, eligible.teacher, eligible.room, eligible.schedule,
      eligible.status, eligible.start_date, eligible.end_date, eligible.term_id,
      eligible.period, eligible.normalized_status,
      eligible.term_name, eligible.textbook_count, session_agg.last_updated_at,
      coalesce(session_agg.session_count, 0)::integer as session_count,
      coalesce(session_agg.planned_count, 0)::integer as planned_count,
      coalesce(session_agg.upcoming_count,0)::integer as upcoming_count,
      eligible.sort_key
    from eligible_classes eligible
    left join session_agg on session_agg.class_id = eligible.id
  ), classified as materialized (
    select
      base.id, base.name, base.subject, base.subject_area_key, base.grade,
      base.teacher, base.room, base.schedule, base.status, base.start_date,
      base.end_date, base.term_id, base.period,
      base.normalized_status, base.term_name, base.textbook_count, base.last_updated_at,
      base.session_count, base.planned_count, base.upcoming_count,
      base.sort_key,
      case
        when base.session_count = 0 then '회차 미생성'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then '일정 연장 필요'
        else '일정 편성'
      end as state_label,
      case
        when base.session_count = 0 then 'unscheduled'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then 'update'
        else 'done'
      end as view_mode
    from base
  ), filtered as materialized (
    select
      classified.id, classified.name, classified.subject, classified.subject_area_key,
      classified.grade, classified.teacher, classified.room, classified.schedule,
      classified.status, classified.start_date, classified.end_date, classified.term_id,
      classified.period, classified.normalized_status,
      classified.term_name, classified.textbook_count, classified.session_count, classified.last_updated_at,
      classified.planned_count,
      classified.sort_key, classified.state_label, classified.view_mode
    from classified
    where coalesce(nullif(pg_catalog.btrim(v_filters ->> 'viewMode'), ''), 'all') = 'all'
       or view_mode = pg_catalog.btrim(v_filters ->> 'viewMode')
  ), page_keys as materialized (
    select id, sort_key from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), next_unplanned as materialized (
    select distinct on (session.class_id) session.class_id,
      session.id as next_session_id,session.session_key as next_session_key,
      session.session_date as next_session_date,session.start_time as next_start_time,
      session.end_time as next_end_time,session.schedule_state as next_schedule_state
    from schedule_sessions session join page_keys selected on selected.id=session.class_id
    where session.session_date >= (current_timestamp at time zone 'Asia/Seoul')::date
    order by session.class_id,session.session_date,session.start_time nulls last,session.id
  ), page_candidates as materialized (
    select filtered.*, next_unplanned.next_session_id, next_unplanned.next_session_key,
      next_unplanned.next_session_date, next_unplanned.next_start_time,
      next_unplanned.next_end_time, next_unplanned.next_schedule_state
    from page_keys selected
    join filtered on filtered.id = selected.id
    left join next_unplanned on next_unplanned.class_id = selected.id
  ), page_rows as materialized (
    select
      id,
      sort_key::text as sort_key,
      pg_catalog.jsonb_build_object(
        'id', id,
        'title', pg_catalog.regexp_replace(coalesce(name, ''), '^\[[^]]+\]\s*', ''),
        'fullTitle', coalesce(name, ''),
        'subject', coalesce(subject, ''),
        'subjectAreaKey', coalesce(subject_area_key, ''),
        'grade', coalesce(grade, ''),
        'term', term_name,
        'teacherNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(teacher, ''), '\s*[,/&·]\s*')),
        'teacherSummary', coalesce(teacher, ''),
        'classroomNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(room, ''), '\s*[,/&·]\s*')),
        'classroomSummary', coalesce(room, ''),
        'schedule', coalesce(schedule, ''),
        'status', normalized_status,
        'statusFilter', normalized_status,
        'classGroupIds', coalesce((select pg_catalog.jsonb_agg(member.group_id::text order by member.sort_order, member.group_id) from public.class_schedule_sync_group_members member where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupNames', coalesce((select pg_catalog.jsonb_agg(group_row.name order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupLabel', coalesce((select pg_catalog.string_agg(group_row.name, ', ' order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '미분류'),
        'textbookCount', textbook_count,
        'textbookCatalog', '[]'::jsonb,
        'textbookTitles', '[]'::jsonb,
        'textbookSummary', '',
        'textbookOverflowCount', 0,
        'textbookScopeLabels', '[]'::jsonb,
        'totalSessions', session_count,
        'completedSessions', planned_count,
        'updatedSessions', planned_count,
        'delayedSessions', greatest(session_count - planned_count, 0),
        'plannedSessions', planned_count,
        'progressTargetSessions', case when textbook_count > 0 then session_count else 0 end,
        'delayedProgressSessions', case when textbook_count > 0 then greatest(session_count - planned_count, 0) else 0 end,
        'plannedProgressSessions', planned_count,
        'progressPercent', case when session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'progressTargetPercent', case when textbook_count > 0 and session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'lastUpdatedAt', coalesce(last_updated_at::text, ''),
        'stateLabel', state_label,
        'latestNoteSummary', '',
        'latestNoteSessionLabel', '',
        'pendingSessionLabels', '[]'::jsonb,
        'nextSession', case when next_session_id is null then null else pg_catalog.jsonb_build_object(
          'sessionId', next_session_id,
          'sessionKey', next_session_key,
          'sessionOrder', 0,
          'label', pg_catalog.to_char(next_session_date, 'YYYY-MM-DD'),
          'progressStatus', 'pending',
          'hasActualContent', false,
          'updatedAt', '',
          'noteSummary', '',
          'dateValue', next_session_date,
          'dateLabel', next_session_date,
          'periodLabel', pg_catalog.concat_ws('~', next_start_time::text, next_end_time::text),
          'scheduleState', next_schedule_state,
          'scheduleMemo', '',
          'makeupMemo', '',
          'makeupDate', '',
          'hasPlanContent', false,
          'planSummary', '',
          'textbookEntryCount', 0,
          'textbookEntries', '[]'::jsonb
        ) end,
        'sessionSummaries', '[]'::jsonb,
        'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', name, subject, grade, teacher, room, schedule, state_label))
      ) as row_data
    from page_candidates
  ), stats as materialized (
    select pg_catalog.jsonb_build_object(
      'total', pg_catalog.count(*)::integer,
      'managedClassCount', pg_catalog.count(*) filter (where session_count > 0)::integer,
      'totalSessions', coalesce(pg_catalog.sum(session_count),0)::integer,
      'completedSessions', coalesce(pg_catalog.sum(planned_count),0)::integer,
      'pendingSessions', coalesce(pg_catalog.sum(greatest(session_count-planned_count,0)),0)::integer,
      'linkedTextbooks', coalesce(pg_catalog.sum(textbook_count),0)::integer,
      'unlinkedClassCount', 0,
      'noScheduleClassCount', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
      'updateNeededClassCount', pg_catalog.count(*) filter (where state_label='일정 연장 필요')::integer,
      'completedClassCount', pg_catalog.count(*) filter (where state_label='일정 편성')::integer,
      'viewModeCounts', (
        select pg_catalog.jsonb_build_object(
          'all', pg_catalog.count(*)::integer,
          'unlinked', pg_catalog.count(*) filter (where view_mode='unlinked')::integer,
          'unscheduled', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
          'update', pg_catalog.count(*) filter (where view_mode='update')::integer,
          'done', pg_catalog.count(*) filter (where view_mode='done')::integer
        )
        from classified
      )
    ) as data from filtered
    where p_include_scope_metadata
  ), filter_options as materialized (
    select pg_catalog.jsonb_build_object(
      'periods', '[]'::jsonb,
      'statuses', pg_catalog.to_jsonb(array['수강','개강 준비','종강']),
      'subjects', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct subject as value from base where nullif(pg_catalog.btrim(subject),'') is not null order by subject limit 500) bounded), '[]'::jsonb),
      'grades', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct grade as value from base where nullif(pg_catalog.btrim(grade),'') is not null order by grade limit 500) bounded), '[]'::jsonb),
      'teachers', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct pg_catalog.btrim(token) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(teacher,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb),
      'classrooms', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token)) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(room,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb)
    ) as data
    where p_include_scope_metadata
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows), '[]'::jsonb),
    'page', p_page, 'pageSize', p_page_size,
    'totalCount', (select pg_catalog.count(*) from filtered),
    'stats', case when p_include_scope_metadata then (select data from stats) else null end,
    'filterOptions', case when p_include_scope_metadata then (select data from filter_options) else null end,
    'resolvedPeriodId', v_filters ->> 'periodId'
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_academic_timetable_range_v1(p_date_from date, p_date_to date, p_class_group_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_subject text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb := '[]'::jsonb;
  v_class_summaries jsonb := '[]'::jsonb;
  v_terms jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_teachers jsonb := '[]'::jsonb;
  v_classrooms jsonb := '[]'::jsonb;
  v_status_options jsonb := '[]'::jsonb;
  v_subject_options jsonb := '[]'::jsonb;
  v_collection text;
  v_class_group_id text;
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('timetable',jsonb_build_object('p_date_from',p_date_from,'p_date_to',p_date_to,'p_class_group_id',p_class_group_id,'p_status',p_status,'p_subject',p_subject));end if;
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from
     or (p_date_to - p_date_from) > 13 then
    raise exception 'academic_timetable_range_invalid' using errcode = '22023';
  end if;
  -- Weekly templates are selected by class status, never by a historical semester.
  -- Keep the retired argument and empty metadata keys for old client compatibility.
  v_class_group_id := null;

  with eligible as materialized (
    select
      class.id,
      class.name,
      class.subject,
      class.subject_area_key,
      class.grade,
      class.teacher,
      class.room,
      class.schedule,
      class.schedule_storage_mode,
      class.status,
      class.start_date,
      class.end_date,
      class.term_id,
      class.period,
      coalesce(term.academic_year, nullif(pg_catalog.substring(class.period, '([0-9]{4})'), '')::integer, pg_catalog.date_part('year', current_date)::integer) as academic_year,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), '')) as term_name,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(p_status), '') is null
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(p_status))
      and (nullif(pg_catalog.btrim(p_subject), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(p_subject))
  ), parsed as materialized (
    select
      class.*,
      '[]'::jsonb as group_ids,
      '[]'::jsonb as group_names,
      matched.parts,
      day_value.day,
      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.teacher_name, '') else case when (pg_catalog.length(coalesce(matched.parts[4], '')) - pg_catalog.length(pg_catalog.replace(coalesce(matched.parts[4], ''), ',', '')) = 1) then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 1)) else coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) end end as row_teacher,
      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.classroom_name, '') else case when (pg_catalog.length(coalesce(matched.parts[4], '')) - pg_catalog.length(pg_catalog.replace(coalesce(matched.parts[4], ''), ',', '')) = 1) then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 2)) else dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) end end as row_classroom

    from eligible class
    cross join lateral pg_catalog.regexp_matches(
      coalesce(class.schedule, ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?',
      'g'
    ) matched(parts)
    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    left join public.class_schedule_slots normalized_slot
      on class.schedule_storage_mode = 'normalized'
      and normalized_slot.class_id = class.id
      and normalized_slot.weekday = case day_value.day
        when '월' then 1 when '화' then 2 when '수' then 3 when '목' then 4
        when '금' then 5 when '토' then 6 else 0 end
      and normalized_slot.start_time = case
        when matched.parts[2] ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        then matched.parts[2]::time end
      and normalized_slot.end_time = case
        when matched.parts[3] ~ '^(([01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        then matched.parts[3]::time end
    where day_value.day in ('월','화','수','목','금','토','일')
  ), row_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', parsed.id::text || ':' || parsed.day || ':' || parsed.parts[2] || ':' || parsed.parts[3],
      'classId', parsed.id,
      'title', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''),
      'fullTitle', coalesce(parsed.name, ''),
      'academicYear', parsed.academic_year::text,
      'subject', coalesce(parsed.subject, ''),
      'subjectAreaKey', coalesce(parsed.subject_area_key, ''),
      'grade', coalesce(parsed.grade, ''),
      'teacher', parsed.row_teacher,
      'classroom', parsed.row_classroom,
      'term', coalesce(parsed.term_name, ''),
      'schedule', coalesce(parsed.schedule, ''),
      'status', parsed.normalized_status,
      'statusFilter', parsed.normalized_status,
      'classGroupIds', parsed.group_ids,
      'classGroupNames', parsed.group_names,
      'classGroupLabel', coalesce((select pg_catalog.string_agg(value, ', ') from pg_catalog.jsonb_array_elements_text(parsed.group_names) value), '미분류'),
      'day', parsed.day,
      'dayIndex', case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      'start', parsed.parts[2],
      'end', parsed.parts[3],
      'startMinutes', pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[2], ':', 2)::integer,
      'endMinutes', pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer,
      'durationMinutes', greatest(0,
        pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer
        - pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 - pg_catalog.split_part(parsed.parts[2], ':', 2)::integer),
      'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''), parsed.subject, parsed.grade, parsed.row_teacher, parsed.row_classroom, parsed.normalized_status, parsed.term_name, parsed.schedule))
    ) as row_data,
    parsed.day,
    parsed.parts[2] as start_time,
    parsed.id
    from parsed
    order by case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      parsed.parts[2], parsed.id
    limit 2001
  ), class_summary_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', class.id,
      'subject', class.subject,
      'grade', class.grade,
      'term_id', class.term_id,
      'period', class.period,
      'academic_year', class.academic_year
    ) as row_data
    from eligible class order by class.name collate dashboard_private.ko_numeric, class.id limit 501
  ), teacher_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.teacher_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.teacher, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  ), classroom_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.classroom_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.room, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by day, start_time, id) from row_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from class_summary_limited), '[]'::jsonb),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    coalesce((select pg_catalog.jsonb_agg(row_data) from teacher_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from classroom_limited), '[]'::jsonb),
    pg_catalog.jsonb_build_array('수강','개강 준비','종강'),
    coalesce((select pg_catalog.jsonb_agg(distinct subject order by subject) filter (where nullif(pg_catalog.btrim(subject), '') is not null) from eligible), '[]'::jsonb)
  into v_rows, v_class_summaries, v_terms, v_groups, v_members, v_teachers, v_classrooms, v_status_options, v_subject_options;

  if pg_catalog.jsonb_array_length(v_rows) > 2000 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'visible_range_too_dense',
      'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
      'rows', '[]'::jsonb, 'observedRowsAtLeast', 2001, 'suggestedDays', 7
    );
  end if;

  foreach v_collection in array array['class_summaries','class_terms','class_groups','class_group_members','teacher_catalogs','classroom_catalogs'] loop
    if pg_catalog.jsonb_array_length(case v_collection
      when 'class_summaries' then v_class_summaries when 'class_terms' then v_terms
      when 'class_groups' then v_groups when 'class_group_members' then v_members
      when 'teacher_catalogs' then v_teachers else v_classrooms end) > 500 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'timetable_collection_too_dense',
        'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
        'collection', v_collection, 'observedItemsAtLeast', 501,
        'action', 'narrow_filters', 'rows', '[]'::jsonb
      );
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
    'resolvedClassGroupId', v_class_group_id,
    'rows', v_rows,
    'classSummaries', v_class_summaries,
    'classTerms', v_terms,
    'classGroups', v_groups,
    'classGroupMembers', v_members,
    'teacherCatalogs', v_teachers,
    'classroomCatalogs', v_classrooms,
    'statusOptions', v_status_options,
    'subjectOptions', v_subject_options,
    'complete', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_operations_class_schedule_numbered_page_v1(p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_keys text[];
  v_filters jsonb;
  v_rows jsonb;
  v_stats jsonb;
  v_options jsonb;
  v_group_counts jsonb;
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('class_page',jsonb_build_object('p_filters',p_filters,'p_page',p_page,'p_page_size',p_page_size));end if;
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['grade','search','subject','syncGroupId','teacher','termId']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'operations_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case when key = 'search'
    then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if exists (select 1 from pg_catalog.jsonb_each_text(v_filters) field
    where key in ('termId','syncGroupId') and value is not null
      and value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;

  with filtered as materialized (
    select class.id, class.status,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), '') collate dashboard_private.ko_numeric as sort_key,
      (select member.group_id
        from public.class_schedule_sync_group_members member
        where member.class_id = class.id
        order by (member.group_id::text = v_filters ->> 'syncGroupId') desc, member.sort_order asc, member.group_id asc
        limit 1) as sync_group_id
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (v_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, term.name) ilike '%' || (v_filters ->> 'search') || '%')
      and ((v_filters ->> 'termId') is null or class.term_id::text = v_filters ->> 'termId')
      and ((v_filters ->> 'subject') is null or class.subject = v_filters ->> 'subject')
      and ((v_filters ->> 'grade') is null or class.grade = v_filters ->> 'grade')
      and ((v_filters ->> 'teacher') is null or exists (
        select 1
        from pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value)
        where pg_catalog.btrim(teacher_name.value) = v_filters ->> 'teacher'
      ))
      and ((v_filters ->> 'syncGroupId') is null or exists (
        select 1 from public.class_schedule_sync_group_members as member
        where member.class_id = class.id and member.group_id::text = v_filters ->> 'syncGroupId'
      ))
  ), page_keys as materialized (
    select id, sort_key, sync_group_id from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_rows as (
    select selected.id, selected.sort_key,
      pg_catalog.jsonb_build_object(
        'id', class.id, 'name', coalesce(class.name,''),
        'subject', coalesce(class.subject,''), 'grade', coalesce(class.grade,''),
        'schedule', coalesce(class.schedule,''), 'termId', class.term_id,
        'teacherName', nullif(pg_catalog.btrim(class.teacher),''),
        'termName', term.name, 'syncGroupId', selected.sync_group_id,
        'syncGroupName', group_row.name, 'status', coalesce(class.status,''),
        'updatedAt', class.created_at
      ) as row_data
    from page_keys selected
    join public.classes class on class.id = selected.id
    left join public.class_terms term on term.id = class.term_id
    left join public.class_schedule_sync_groups group_row on group_row.id = selected.sync_group_id
  ), catalog_groups as materialized (
    select id, sort_order, name from public.class_schedule_sync_groups
    order by sort_order, name collate dashboard_private.ko_numeric, id limit 200
  ), group_counts as (
    select sync_group_id, pg_catalog.count(*) as member_count from filtered
    where sync_group_id is not null group by sync_group_id
  ), representatives as (
    select distinct on (sync_group_id) sync_group_id, id from filtered
    where sync_group_id is not null order by sync_group_id, sort_key, id
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows),'[]'::jsonb),
    (select pg_catalog.jsonb_build_object(
      'total',pg_catalog.count(*),
      'active',pg_catalog.count(*) filter(where status in ('수강','수업 진행 중')),
      'draft',pg_catalog.count(*) filter(where status in ('개강 예정','개강 준비 중'))
    ) from filtered),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'groupId', catalog.id, 'memberCount', counts.member_count, 'representativeClassId', representative.id
    ) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id)
      from catalog_groups catalog
      join group_counts counts on counts.sync_group_id = catalog.id
      join representatives representative on representative.sync_group_id = catalog.id),'[]'::jsonb)
  into v_rows, v_stats, v_group_counts;

  select pg_catalog.jsonb_build_object(
    'terms', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', term.id, 'label', term.name) order by term.academic_year desc, term.sort_order asc, term.id asc), '[]'::jsonb) from (select * from public.class_terms order by academic_year desc, sort_order asc, id asc limit 200) as term),
    'subjects', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.subject as value, class.subject collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.subject), '') is not null order by sort_value limit 200) as option),
    'grades', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.grade as value, class.grade collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.grade), '') is not null order by sort_value limit 200) as option),
    'teachers', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct pg_catalog.btrim(teacher_name.value) as value, pg_catalog.btrim(teacher_name.value) collate dashboard_private.ko_numeric as sort_value from public.classes as class cross join lateral pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value) where nullif(pg_catalog.btrim(teacher_name.value), '') is not null order by sort_value limit 200) as option),
    'syncGroups', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', sync_group.id, 'label', sync_group.name) order by sync_group.sort_order asc, sync_group.name collate dashboard_private.ko_numeric asc, sync_group.id asc), '[]'::jsonb) from (select * from public.class_schedule_sync_groups order by sort_order asc, name collate dashboard_private.ko_numeric asc, id asc limit 200) as sync_group)
  ) into v_options;

  return pg_catalog.jsonb_build_object(
    'rows',v_rows,'page',p_page,'pageSize',p_page_size,'totalCount',v_stats -> 'total',
    'stats',v_stats,'filterOptions',v_options,'syncGroupCounts',v_group_counts
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.get_operations_class_lesson_design_detail_v1(p_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('class_detail',jsonb_build_object('p_class_id',p_class_id));end if;
 return (select pg_catalog.jsonb_build_object(
    'classItem', pg_catalog.jsonb_build_object(
      'id', class.id,
      'name', class.name,
      'className', class.name,
      'classType', class.class_type,
      'subject', class.subject,
      'grade', class.grade,
      'teacher', class.teacher,
      'schedule', class.schedule,
      'room', class.room,
      'status', class.status,
      'termId', class.term_id,
      'termName', term.name,
      'startDate', class.start_date,
      'endDate', class.end_date,
      'textbookIds', coalesce(class.textbook_ids, '[]'::jsonb),
      'schedulePlan', coalesce(class.schedule_plan, '{}'::jsonb),
      'scheduleStorageMode', class.schedule_storage_mode,
      'scheduleRevision', class.schedule_revision
    ),
    'textbooks','[]'::jsonb,
    'teacherCatalogs', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order
        from public.teacher_catalogs as teacher
        where teacher.is_visible and (teacher.subjects = '{}'::text[] or case
          when pg_catalog.btrim(class.subject) in ('영어', '영어팀') then teacher.subjects && array['영어', '영어팀']::text[]
          when pg_catalog.btrim(class.subject) in ('수학', '수학팀') then teacher.subjects && array['수학', '수학팀']::text[]
          when pg_catalog.btrim(class.subject) in ('과학', '과학팀') then teacher.subjects && array['과학', '과학팀']::text[]
          else pg_catalog.btrim(class.subject) = any(teacher.subjects)
        end)
        order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id
        limit 200
      ) as catalog
    ),
    'classroomCatalogs', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order
        from public.classroom_catalogs as classroom
        where classroom.is_visible and (classroom.subjects = '{}'::text[] or class.subject = any(classroom.subjects))
        order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id
        limit 200
      ) as catalog
    )
  )
  from public.classes as class
  left join public.class_terms as term on term.id = class.term_id
  where class.id = p_class_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.list_operations_catalogs_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if public.current_dashboard_role()='teacher' then return dashboard_private.teacher_operational_read_v1('catalogs',jsonb_build_object());end if;
 return (select pg_catalog.jsonb_build_object(
    'academicSchools', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'category', catalog.category) order by catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select school.id, school.name, school.category from public.academic_schools as school where nullif(pg_catalog.btrim(school.name), '') is not null order by school.name collate dashboard_private.ko_numeric, school.id limit 200) as catalog),
    'teachers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order from public.teacher_catalogs as teacher where teacher.is_visible order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id limit 200) as catalog),
    'classrooms', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order from public.classroom_catalogs as classroom where classroom.is_visible order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id limit 200) as catalog),
    'subjects', (select coalesce(pg_catalog.jsonb_agg(subject_option.subject order by subject_option.sort_subject), '[]'::jsonb) from (select distinct class_row.subject, class_row.subject collate dashboard_private.ko_numeric as sort_subject from public.classes as class_row where nullif(pg_catalog.btrim(class_row.subject), '') is not null order by sort_subject limit 200) as subject_option)
  ));
end
$function$;

revoke all on function dashboard_private.teacher_common_schedule_plan_v1(jsonb) from public,anon,authenticated,service_role;

revoke all on function dashboard_private.teacher_common_makeup_v1(jsonb) from public,anon,authenticated,service_role;

revoke all on function dashboard_private.teacher_common_profile_label_v1(uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_class_schedule_v1(p_class_id uuid, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_class public.classes%rowtype; v_plan jsonb;
begin
  if public.current_dashboard_role()='teacher' then
    if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='teacher' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise exception 'operational_common_read_forbidden' using errcode='42501';end if;
  else
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  select * into v_class from public.classes where id = p_class_id;
  if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 or v_class.schedule_storage_mode <> 'normalized' then
    return jsonb_build_object('authoritativeSource', 'legacy', 'runtimeVersion', public.continuous_class_schedule_runtime_version(), 'storageMode', v_class.schedule_storage_mode,
      'effectiveScheduleContext',case when v_class.schedule_storage_mode<>'normalized' then dashboard_private.legacy_effective_context_v1(v_class)-'weekly' end);
  end if;
  select schedule_plan into v_plan from public.classes where id = p_class_id;
  return jsonb_build_object(
    'authoritativeSource', 'normalized', 'runtimeVersion', 1, 'storageMode', v_class.schedule_storage_mode,
    'scheduleRevision', v_class.schedule_revision,
    'contentHash', dashboard_private.continuous_class_schedule_content_hash_v1(v_plan),
    'hasMoreBefore', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date < p_date_from),
    'hasMoreAfter', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date > p_date_to),
    'sessions', coalesce((select jsonb_agg(case when public.current_dashboard_role()='teacher' then (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(case when jsonb_typeof(to_jsonb(s))='object' then to_jsonb(s) else '{}'::jsonb end) where key=any(array['id','class_id','session_key','source_schedule_slot_id','session_date','schedule_state','start_time','end_time','teacher_catalog_id','teacher_name_snapshot','classroom_catalog_id','classroom_name_snapshot','origin','makeup_of_session_id','legacy_billing_id','legacy_billing_label','legacy_billing_color','revision','created_at','updated_at'])) else to_jsonb(s) end order by session_date, start_time nulls last, session_key)
      from public.class_lesson_sessions s where class_id = p_class_id and session_date between p_date_from and p_date_to), '[]'::jsonb)
  );
end;
$function$
;


-- Remaining operational processing and raw boundaries
-- Final ordered source: 20260716191000_notification_transfer_withdrawal_producers.sql
create or replace function dashboard_private.complete_ops_transfer_roster_transition_v2_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'ops_transfer_completion_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'complete_ops_transfer_roster_transition_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_legacy_response := dashboard_private.complete_ops_transfer_roster_transition_impl(
    p_task_id, p_request_id::text
  );
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id and task.type = 'transfer';
  if v_task.status <> 'done' then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '23514';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, p_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
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
    p_request_id, 'complete_ops_transfer_roster_transition_v2', v_fingerprint, v_response
  );
end;
$$;

-- Final ordered source: 20260716191000_notification_transfer_withdrawal_producers.sql
create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'ops_withdrawal_completion_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'complete_ops_withdrawal_roster_transition_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_legacy_response := dashboard_private.complete_ops_withdrawal_roster_transition_impl(
    p_task_id, p_request_id::text
  );
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id and task.type = 'withdrawal';
  if v_task.status <> 'done' then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, p_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
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
    p_request_id, 'complete_ops_withdrawal_roster_transition_v2', v_fingerprint, v_response
  );
end;
$$;

-- Final ordered source: 20260716191000_notification_transfer_withdrawal_producers.sql
create or replace function dashboard_private.complete_ops_transition_legacy_bridge_v1(
  p_task_id uuid,
  p_request_key text,
  p_task_type text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_request_id uuid;
  v_request_kind text;
  v_fingerprint text;
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if v_actor is null
    or p_task_id is null
    or v_request_key is null
    or p_task_type not in ('transfer', 'withdrawal')
  then
    raise exception 'ops_transition_completion_invalid' using errcode = '22023';
  end if;
  v_request_id := dashboard_private.notification_deterministic_uuid_v1(
    'ops-transition-legacy-request-v1',
    v_actor::text || ':' || p_task_type || ':' || v_request_key
  );
  v_request_kind := 'complete_ops_' || p_task_type || '_roster_transition_legacy_v1';
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'task_id', p_task_id,
    'task_type', p_task_type,
    'request_key', v_request_key
  )::text);
  perform dashboard_private.assert_ops_task_write_scope_v1(p_task_id);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    v_request_id, v_request_kind, v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', v_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  if p_task_type = 'transfer' then
    v_legacy_response := dashboard_private.complete_ops_transfer_roster_transition_impl(
      p_task_id, v_request_key
    );
  else
    v_legacy_response := dashboard_private.complete_ops_withdrawal_roster_transition_impl(
      p_task_id, v_request_key
    );
  end if;
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = p_task_type;
  if v_task.status <> 'done' then
    raise exception 'ops_transition_completion_state_conflict' using errcode = '23514';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, v_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'task', pg_catalog.to_jsonb(v_task),
      'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
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
    v_request_id, v_request_kind, v_fingerprint, v_response
  );
end;
$$;

-- Final ordered source: 20260901110300_registration_observation_status_independence.sql
create or replace function dashboard_private.enter_registration_observation_v1_impl(
  p_track_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor);
  if p_track_id is null
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_enter_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'enter',
        'trackId', p_track_id,
        'expectedWorkflowRevision', p_expected_workflow_revision
      )
    );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );

  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'enter'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'enter', p_request_key, v_track, null, null, false
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, 'enter', p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

-- Final ordered source: 20260901110300_registration_observation_status_independence.sql
create or replace function dashboard_private.save_registration_observation_booking_v1_impl(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_session_authority text,
  p_class_lesson_session_id uuid,
  p_legacy_session_key text,
  p_expected_workflow_revision integer,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_operation text;
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_resolved jsonb;
  v_response jsonb;
  v_changed boolean;
  v_attempt_count_before bigint;
  v_observation_revision_before bigint;
  v_notification_revision_before integer;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor);
  if p_track_id is null
    or p_class_id is null
    or nullif(pg_catalog.btrim(p_session_authority), '') is null
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_booking_invalid'
      using errcode = '22023';
  end if;

  if p_observation_id is null then
    if p_expected_appointment_notification_revision is not null
      or p_expected_observation_revision is not null
    then
      raise exception 'registration_observation_revision_combination_invalid'
        using errcode = '22023';
    end if;
    v_operation := 'book';
    v_fingerprint :=
      dashboard_private.registration_observation_request_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'operation', 'book',
          'trackId', p_track_id,
          'observationId', p_observation_id,
          'classId', p_class_id,
          'sessionAuthority', p_session_authority,
          'classLessonSessionId', p_class_lesson_session_id,
          'legacySessionKey', p_legacy_session_key,
          'expectedWorkflowRevision', p_expected_workflow_revision,
          'expectedAppointmentNotificationRevision',
            p_expected_appointment_notification_revision,
          'expectedObservationRevision', p_expected_observation_revision
        )
      );
  else
    if p_expected_workflow_revision is not null
      or p_expected_appointment_notification_revision is null
      or p_expected_appointment_notification_revision < 1
      or p_expected_observation_revision is null
      or p_expected_observation_revision < 1
    then
      raise exception 'registration_observation_revision_combination_invalid'
        using errcode = '22023';
    end if;
    v_operation := 'reschedule';
    v_fingerprint :=
      dashboard_private.registration_observation_request_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'operation', 'reschedule',
          'trackId', p_track_id,
          'observationId', p_observation_id,
          'classId', p_class_id,
          'sessionAuthority', p_session_authority,
          'classLessonSessionId', p_class_lesson_session_id,
          'legacySessionKey', p_legacy_session_key,
          'expectedWorkflowRevision', p_expected_workflow_revision,
          'expectedAppointmentNotificationRevision',
            p_expected_appointment_notification_revision,
          'expectedObservationRevision', p_expected_observation_revision
        )
      );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> v_operation
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  if v_operation = 'book' then
    if exists (
        select 1
        from public.ops_registration_observations observation
        where observation.track_id = v_track.id
          and observation.decision_kind is null
          and observation.status in (
            'scheduled', 'attended_feedback_pending', 'completed', 'no_show'
          )
      )
      or exists (
        select 1
        from public.ops_registration_observations observation
        join public.ops_registration_appointments appointment
          on appointment.id = observation.appointment_id
        where observation.track_id = v_track.id
          and observation.status = 'scheduled'
          and appointment.status = 'scheduled'
      )
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;

    v_resolved := dashboard_private.resolve_registration_observation_session_v1(
      v_track.id,
      p_class_id,
      p_session_authority,
      p_class_lesson_session_id,
      p_legacy_session_key
    );

    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status,
      notification_revision, created_by
    ) values (
      v_track.task_id,
      'observation_class',
      (v_resolved ->> 'startsAt')::timestamptz,
      v_resolved ->> 'campus',
      'scheduled',
      1,
      v_actor
    )
    returning * into v_appointment;

    insert into public.ops_registration_observations(
      task_id, track_id, appointment_id, class_id,
      session_authority, class_lesson_session_id, legacy_session_key,
      session_date, starts_at, ends_at, session_schedule_state,
      session_source_revision, legacy_session_source_hash, source_revision,
      booking_fact_hash, teacher_catalog_id, teacher_profile_id,
      classroom_catalog_id, subject, class_name_snapshot,
      teacher_name_snapshot, classroom_name_snapshot, campus,
      textbook_snapshot, progress_snapshot, status, feedback_revision,
      revision, created_by, updated_by
    ) values (
      v_track.task_id,
      v_track.id,
      v_appointment.id,
      (v_resolved ->> 'classId')::uuid,
      v_resolved ->> 'sessionAuthority',
      nullif(v_resolved ->> 'classLessonSessionId', '')::uuid,
      nullif(v_resolved ->> 'legacySessionKey', ''),
      (v_resolved ->> 'sessionDate')::date,
      (v_resolved ->> 'startsAt')::timestamptz,
      (v_resolved ->> 'endsAt')::timestamptz,
      v_resolved ->> 'scheduleState',
      nullif(v_resolved ->> 'sessionSourceRevision', '')::bigint,
      nullif(v_resolved ->> 'legacySessionSourceHash', ''),
      v_resolved -> 'sourceRevision',
      v_resolved ->> 'bookingFactHash',
      (v_resolved ->> 'teacherCatalogId')::uuid,
      (v_resolved ->> 'teacherProfileId')::uuid,
      (v_resolved ->> 'classroomCatalogId')::uuid,
      v_resolved ->> 'subject',
      v_resolved ->> 'className',
      v_resolved ->> 'teacherName',
      v_resolved ->> 'classroomName',
      v_resolved ->> 'campus',
      coalesce(v_resolved -> 'textbooks', '[]'::jsonb),
      coalesce(v_resolved ->> 'progress', ''),
      'scheduled',
      0,
      1,
      v_actor,
      v_actor
    )
    returning * into v_observation;

    v_attempt_count_before := v_track.observation_attempt_count;
    update public.ops_registration_subject_tracks track
    set observation_attempt_count = track.observation_attempt_count + 1,
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;

    insert into dashboard_private.registration_observation_domain_events(
      observation_id, appointment_id, notification_revision,
      event_kind, booking_fact_hash, source_revision
    ) values (
      v_observation.id,
      v_appointment.id,
      v_appointment.notification_revision,
      'observation_scheduled',
      v_observation.booking_fact_hash,
      v_observation.source_revision
    );

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_observation_scheduled',
      v_track.workflow_status,
      v_track.workflow_status,
      null,
      pg_catalog.jsonb_build_object(
        'trackId', v_track.id,
        'observationId', v_observation.id,
        'appointmentId', v_appointment.id,
        'observationRevisionBefore', null,
        'observationRevisionAfter', v_observation.revision,
        'appointmentNotificationRevisionBefore', null,
        'appointmentNotificationRevisionAfter',
          v_appointment.notification_revision,
        'observationAttemptCountBefore', v_attempt_count_before,
        'observationAttemptCountAfter', v_track.observation_attempt_count
      ),
      'user',
      null
    );
    v_changed := true;
  else
    select observation.*
    into v_observation
    from public.ops_registration_observations observation
    where observation.id = p_observation_id
      and observation.track_id = v_track.id
    for update;
    if not found then
      raise exception 'registration_observation_not_found'
        using errcode = 'P0002';
    end if;
    if v_observation.revision <> p_expected_observation_revision then
      raise exception 'registration_observation_stale_revision'
        using errcode = '23514';
    end if;
    if v_observation.status <> 'scheduled'
      or v_observation.decision_kind is not null
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;

    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = v_observation.appointment_id
      and appointment.task_id = v_track.task_id
    for update;
    if not found then
      raise exception 'registration_observation_not_found'
        using errcode = 'P0002';
    end if;
    if v_appointment.notification_revision
      <> p_expected_appointment_notification_revision
    then
      raise exception 'registration_observation_stale_revision'
        using errcode = '23514';
    end if;
    if v_appointment.kind <> 'observation_class'
      or v_appointment.status <> 'scheduled'
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;

    v_resolved := dashboard_private.resolve_registration_observation_session_v1(
      v_track.id,
      p_class_id,
      p_session_authority,
      p_class_lesson_session_id,
      p_legacy_session_key
    );
    v_changed := v_observation.booking_fact_hash
      <> (v_resolved ->> 'bookingFactHash');

    if v_changed then
      v_observation_revision_before := v_observation.revision;
      v_notification_revision_before := v_appointment.notification_revision;

      update public.ops_registration_appointments appointment
      set scheduled_at = (v_resolved ->> 'startsAt')::timestamptz,
          place = v_resolved ->> 'campus',
          notification_revision = appointment.notification_revision + 1,
          updated_at = pg_catalog.now()
      where appointment.id = v_appointment.id
      returning appointment.* into v_appointment;

      update public.ops_registration_observations observation
      set class_id = (v_resolved ->> 'classId')::uuid,
          session_authority = v_resolved ->> 'sessionAuthority',
          class_lesson_session_id =
            nullif(v_resolved ->> 'classLessonSessionId', '')::uuid,
          legacy_session_key = nullif(v_resolved ->> 'legacySessionKey', ''),
          session_date = (v_resolved ->> 'sessionDate')::date,
          starts_at = (v_resolved ->> 'startsAt')::timestamptz,
          ends_at = (v_resolved ->> 'endsAt')::timestamptz,
          session_schedule_state = v_resolved ->> 'scheduleState',
          session_source_revision =
            nullif(v_resolved ->> 'sessionSourceRevision', '')::bigint,
          legacy_session_source_hash =
            nullif(v_resolved ->> 'legacySessionSourceHash', ''),
          source_revision = v_resolved -> 'sourceRevision',
          booking_fact_hash = v_resolved ->> 'bookingFactHash',
          teacher_catalog_id = (v_resolved ->> 'teacherCatalogId')::uuid,
          teacher_profile_id = (v_resolved ->> 'teacherProfileId')::uuid,
          classroom_catalog_id = (v_resolved ->> 'classroomCatalogId')::uuid,
          subject = v_resolved ->> 'subject',
          class_name_snapshot = v_resolved ->> 'className',
          teacher_name_snapshot = v_resolved ->> 'teacherName',
          classroom_name_snapshot = v_resolved ->> 'classroomName',
          campus = v_resolved ->> 'campus',
          textbook_snapshot = coalesce(v_resolved -> 'textbooks', '[]'::jsonb),
          progress_snapshot = coalesce(v_resolved ->> 'progress', ''),
          revision = observation.revision + 1,
          updated_by = v_actor,
          updated_at = pg_catalog.now()
      where observation.id = v_observation.id
      returning observation.* into v_observation;

      insert into dashboard_private.registration_observation_domain_events(
        observation_id, appointment_id, notification_revision,
        event_kind, booking_fact_hash, source_revision
      ) values (
        v_observation.id,
        v_appointment.id,
        v_appointment.notification_revision,
        'observation_rescheduled',
        v_observation.booking_fact_hash,
        v_observation.source_revision
      );

      perform dashboard_private.write_registration_track_event_v2(
        v_track.task_id,
        v_track.id,
        'registration_observation_rescheduled',
        v_track.workflow_status,
        v_track.workflow_status,
        null,
        pg_catalog.jsonb_build_object(
          'trackId', v_track.id,
          'observationId', v_observation.id,
          'appointmentId', v_appointment.id,
          'observationRevisionBefore', v_observation_revision_before,
          'observationRevisionAfter', v_observation.revision,
          'appointmentNotificationRevisionBefore',
            v_notification_revision_before,
          'appointmentNotificationRevisionAfter',
            v_appointment.notification_revision
        ),
        'user',
        null
      );
    end if;
  end if;

  v_response := dashboard_private.registration_observation_response_v1(
    v_operation,
    p_request_key,
    v_track,
    v_observation,
    v_appointment,
    v_changed
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, v_operation, p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

-- Final ordered source: 20260901110300_registration_observation_status_independence.sql
create or replace function dashboard_private.cancel_registration_observation_v1_impl(
  p_observation_id uuid,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_observation_revision_before bigint;
  v_notification_revision_before integer;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor);
  if p_observation_id is null
    or p_expected_appointment_notification_revision is null
    or p_expected_appointment_notification_revision < 1
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_cancel_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'cancel',
        'observationId', p_observation_id,
        'expectedAppointmentNotificationRevision',
          p_expected_appointment_notification_revision,
        'expectedObservationRevision', p_expected_observation_revision
      )
    );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'cancel'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select observation.track_id
  into v_track_id
  from public.ops_registration_observations observation
  where observation.id = p_observation_id;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id
    and observation.track_id = v_track.id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  if v_observation.revision <> p_expected_observation_revision then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_track.task_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  if v_appointment.notification_revision
    <> p_expected_appointment_notification_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
  end if;
  if v_observation.status <> 'scheduled'
    or v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;

  v_observation_revision_before := v_observation.revision;
  v_notification_revision_before := v_appointment.notification_revision;
  update public.ops_registration_observations observation
  set status = 'canceled',
      revision = observation.revision + 1,
      updated_by = v_actor,
      updated_at = pg_catalog.now()
  where observation.id = v_observation.id
  returning observation.* into v_observation;
  update public.ops_registration_appointments appointment
  set status = 'canceled',
      notification_revision = appointment.notification_revision + 1,
      updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.* into v_appointment;

  insert into dashboard_private.registration_observation_domain_events(
    observation_id, appointment_id, notification_revision,
    event_kind, booking_fact_hash, source_revision
  ) values (
    v_observation.id,
    v_appointment.id,
    v_appointment.notification_revision,
    'observation_canceled',
    v_observation.booking_fact_hash,
    v_observation.source_revision
  );

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_canceled',
    v_track.workflow_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'appointmentId', v_appointment.id,
      'observationRevisionBefore', v_observation_revision_before,
      'observationRevisionAfter', v_observation.revision,
      'appointmentNotificationRevisionBefore',
        v_notification_revision_before,
      'appointmentNotificationRevisionAfter',
        v_appointment.notification_revision
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'cancel', p_request_key, v_track, v_observation, v_appointment, true
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, 'cancel', p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

create policy academic_curriculum_profiles_teacher_ro_insert_v1 on public.academic_curriculum_profiles as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_curriculum_profiles_teacher_ro_update_v1 on public.academic_curriculum_profiles as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_curriculum_profiles_teacher_ro_delete_v1 on public.academic_curriculum_profiles as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_event_exam_details_teacher_ro_insert_v1 on public.academic_event_exam_details as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_event_exam_details_teacher_ro_update_v1 on public.academic_event_exam_details as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_event_exam_details_teacher_ro_delete_v1 on public.academic_event_exam_details as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_days_teacher_ro_insert_v1 on public.academic_exam_days as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_days_teacher_ro_update_v1 on public.academic_exam_days as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_days_teacher_ro_delete_v1 on public.academic_exam_days as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_items_teacher_ro_insert_v1 on public.academic_exam_material_items as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_items_teacher_ro_update_v1 on public.academic_exam_material_items as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_items_teacher_ro_delete_v1 on public.academic_exam_material_items as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_plans_teacher_ro_insert_v1 on public.academic_exam_material_plans as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_plans_teacher_ro_update_v1 on public.academic_exam_material_plans as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_material_plans_teacher_ro_delete_v1 on public.academic_exam_material_plans as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_scopes_teacher_ro_insert_v1 on public.academic_exam_scopes as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_scopes_teacher_ro_update_v1 on public.academic_exam_scopes as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_exam_scopes_teacher_ro_delete_v1 on public.academic_exam_scopes as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_schools_teacher_ro_insert_v1 on public.academic_schools as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_schools_teacher_ro_update_v1 on public.academic_schools as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_schools_teacher_ro_delete_v1 on public.academic_schools as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_supplement_materials_teacher_ro_insert_v1 on public.academic_supplement_materials as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_supplement_materials_teacher_ro_update_v1 on public.academic_supplement_materials as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academic_supplement_materials_teacher_ro_delete_v1 on public.academic_supplement_materials as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_materials_teacher_ro_insert_v1 on public.academy_curriculum_materials as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_materials_teacher_ro_update_v1 on public.academy_curriculum_materials as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_materials_teacher_ro_delete_v1 on public.academy_curriculum_materials as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_catalogs_teacher_ro_insert_v1 on public.academy_curriculum_period_catalogs as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_catalogs_teacher_ro_update_v1 on public.academy_curriculum_period_catalogs as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_catalogs_teacher_ro_delete_v1 on public.academy_curriculum_period_catalogs as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_items_teacher_ro_insert_v1 on public.academy_curriculum_period_items as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_items_teacher_ro_update_v1 on public.academy_curriculum_period_items as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_items_teacher_ro_delete_v1 on public.academy_curriculum_period_items as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_plans_teacher_ro_insert_v1 on public.academy_curriculum_period_plans as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_plans_teacher_ro_update_v1 on public.academy_curriculum_period_plans as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_period_plans_teacher_ro_delete_v1 on public.academy_curriculum_period_plans as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_plans_teacher_ro_insert_v1 on public.academy_curriculum_plans as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_plans_teacher_ro_update_v1 on public.academy_curriculum_plans as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy academy_curriculum_plans_teacher_ro_delete_v1 on public.academy_curriculum_plans as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy ops_transfer_details_teacher_ro_insert_v1 on public.ops_transfer_details as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy ops_transfer_details_teacher_ro_update_v1 on public.ops_transfer_details as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy ops_withdrawal_details_teacher_ro_insert_v1 on public.ops_withdrawal_details as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy ops_withdrawal_details_teacher_ro_update_v1 on public.ops_withdrawal_details as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy ops_task_comments_teacher_ops_insert_deny_v1 on public.ops_task_comments as restrictive for insert to authenticated with check ((select public.current_dashboard_role()) is distinct from 'teacher' or exists(select 1 from public.ops_tasks parent where parent.id=ops_task_comments.task_id and parent.type in('general','word_retest')));

create policy ops_task_attachments_teacher_ops_insert_deny_v1 on public.ops_task_attachments as restrictive for insert to authenticated with check ((select public.current_dashboard_role()) is distinct from 'teacher' or exists(select 1 from public.ops_tasks parent where parent.id=ops_task_attachments.task_id and parent.type in('general','word_retest')));

create policy ops_task_events_teacher_ops_insert_deny_v1 on public.ops_task_events as restrictive for insert to authenticated with check ((select public.current_dashboard_role()) is distinct from 'teacher' or exists(select 1 from public.ops_tasks parent where parent.id=ops_task_events.task_id and parent.type in('general','word_retest')));

create policy textbooks_teacher_ro_insert_v1 on public.textbooks as restrictive for insert to authenticated  with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy textbooks_teacher_ro_update_v1 on public.textbooks as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy textbooks_teacher_ro_delete_v1 on public.textbooks as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy students_teacher_common_only_v1 on public.students as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy classes_teacher_common_only_v1 on public.classes as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy teacher_catalogs_teacher_common_only_v1 on public.teacher_catalogs as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy textbooks_teacher_common_only_v1 on public.textbooks as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy textbook_purchase_orders_teacher_common_only_v1 on public.textbook_purchase_orders as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');

create policy textbook_purchase_order_lines_teacher_common_only_v1 on public.textbook_purchase_order_lines as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');


create function public.read_operational_common_v1(p_operation text,p_args jsonb) returns jsonb language sql stable set search_path='' as $f$select dashboard_private.teacher_operational_read_v1(p_operation,p_args)$f$;
alter function public.read_operational_common_v1(text,jsonb) owner to postgres;
revoke all on function public.read_operational_common_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_operational_common_v1(text,jsonb) to authenticated;
create or replace function public.list_textbook_purchase_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
 if public.current_dashboard_role()='teacher' then raise exception 'operational_common_read_required' using errcode='42501';end if;
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'purchase'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'status-event');
  with keys as materialized(select * from dashboard_private.textbook_workflow_purchase_keys_v1(p_filters)),
  page as(select k.* from keys k order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],k.status),k.event_time desc nulls last,k.anchor offset (p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_purchase_project_v1(to_jsonb(p),p_filters->>'mode') order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],p.status),p.event_time desc nulls last,p.anchor)from page p),'[]'),'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from keys))into result; return result;
end $$;
create or replace function public.get_textbook_purchase_detail_v1(p_anchor_line_id uuid,p_mode text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
 if public.current_dashboard_role()='teacher' then raise exception 'operational_common_read_required' using errcode='42501';end if;
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  if p_anchor_line_id is null then raise exception 'textbook_id_invalid' using errcode='22023'; end if;
  select dashboard_private.textbook_workflow_purchase_project_v1(to_jsonb(k),p_mode) into result from dashboard_private.textbook_workflow_purchase_keys_v1(jsonb_build_object('mode',p_mode,'search','','boardScope','all','requestFilter','all','orderFilter','all'))k where p_anchor_line_id=any(k.member_ids);
  return jsonb_build_object('row',result);
end $$;
create or replace function public.get_textbook_purchase_summary_v1(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
 if public.current_dashboard_role()='teacher' then raise exception 'operational_common_read_required' using errcode='42501';end if;
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'purchase');
  with source as materialized(select to_jsonb(s) r from dashboard_private.textbook_workflow_purchase_source_v1(p_filters->>'mode')s),
  keys as materialized(select * from dashboard_private.textbook_workflow_purchase_keys_v1(p_filters)),
  groups as(select k.status,count(*) total_count,sum(cardinality(k.member_ids)) raw_count,
    dashboard_private.textbook_workflow_quantities_v1(coalesce(sum((k.quantities#>>'{student,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,received}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,received}')::bigint),0)::bigint) quantities from keys k group by k.status),
  totals as(select count(*)total_count,coalesce(sum(cardinality(k.member_ids)),0)raw_count,
    dashboard_private.textbook_workflow_quantities_v1(coalesce(sum((k.quantities#>>'{student,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,received}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,received}')::bigint),0)::bigint)quantities from keys k)
  select jsonb_build_object('mode',p_filters->>'mode','totalCount',t.total_count,'rawLineCount',t.raw_count,'quantities',t.quantities,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('status',g.status,'totalCount',g.total_count,'rawLineCount',g.raw_count,'quantities',g.quantities)order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],g.status))from groups g),'[]'),
    'requestCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('requestFilter',v),false)))from unnest(array['all','unregistered','orderable'])v),
    'orderCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('orderFilter',v),true)))from unnest(array['all','waiting','partial','returnable','returned'])v),
    'boardScopeCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('boardScope',v),false)))from unnest(array['active','recent','all'])v)) into result from totals t;
  return result;
end $$;


create policy makeup_requests_teacher_common_only_v1 on public.makeup_requests as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy makeup_request_events_teacher_common_only_v1 on public.makeup_request_events as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy makeup_notification_deliveries_teacher_common_only_v1 on public.makeup_notification_deliveries as restrictive for all to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');


-- Role restriction precedes stored deletion-response replay as well.
CREATE OR REPLACE FUNCTION public.delete_makeup_request_v2(p_makeup_request_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role()='teacher' then raise exception 'makeup_request_delete_forbidden' using errcode='42501';end if;
  perform dashboard_private.lock_timetable_operating_resources_v1();
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  declare timetable_result jsonb; begin timetable_result := dashboard_private.delete_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_request_id
  ); perform dashboard_private.assert_timetable_operational_conflicts_v1(); return timetable_result; end;
end;
$function$;


-- Management-only raw rows are not an alternate common-info endpoint.
create policy textbook_suppliers_teacher_private_read_v1 on public.textbook_suppliers as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_makeedu_payment_imports_teacher_private_read_v1 on public.textbook_makeedu_payment_imports as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_monthly_closings_teacher_private_read_v1 on public.textbook_monthly_closings as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_sales_teacher_private_read_v1 on public.textbook_sales as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_sale_lines_teacher_private_read_v1 on public.textbook_sale_lines as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_stock_moves_teacher_private_read_v1 on public.textbook_stock_moves as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_stock_counts_teacher_private_read_v1 on public.textbook_stock_counts as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_supplier_links_teacher_private_read_v1 on public.textbook_supplier_links as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy textbook_publisher_supplier_links_teacher_private_read_v1 on public.textbook_publisher_supplier_links as restrictive for select to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy classroom_catalogs_teacher_ro_insert_v1 on public.classroom_catalogs as restrictive for insert to authenticated with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy classroom_catalogs_teacher_ro_update_v1 on public.classroom_catalogs as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy classroom_catalogs_teacher_ro_delete_v1 on public.classroom_catalogs as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') ;
create policy class_terms_teacher_ro_insert_v1 on public.class_terms as restrictive for insert to authenticated with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy class_terms_teacher_ro_update_v1 on public.class_terms as restrictive for update to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') with check ((select public.current_dashboard_role()) is distinct from 'teacher');
create policy class_terms_teacher_ro_delete_v1 on public.class_terms as restrictive for delete to authenticated using ((select public.current_dashboard_role()) is distinct from 'teacher') ;
alter function dashboard_private.teacher_common_schedule_plan_v1(jsonb) owner to postgres;
revoke all on function dashboard_private.teacher_common_schedule_plan_v1(jsonb) from public,anon,authenticated,service_role;
alter function dashboard_private.teacher_common_profile_label_v1(uuid) owner to postgres;
revoke all on function dashboard_private.teacher_common_profile_label_v1(uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.teacher_common_makeup_v1(jsonb) owner to postgres;
revoke all on function dashboard_private.teacher_common_makeup_v1(jsonb) from public,anon,authenticated,service_role;
commit;
