begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- User-confirmed subject-wide directors. UUIDs were matched once to exact
-- catalog/profile links; runtime authorization never compares a display name.
create table dashboard_private.makeup_subject_directors_v1 (
 subject text not null check(subject in('영어','수학','과학')),
 profile_id uuid not null,
 teacher_catalog_id uuid not null,
 primary key(subject,profile_id),
 unique(subject,teacher_catalog_id)
);
alter table dashboard_private.makeup_subject_directors_v1 enable row level security;
revoke all on dashboard_private.makeup_subject_directors_v1 from public,anon,authenticated,service_role;
-- All current application writes use validated SECURITY DEFINER RPCs. Direct
-- table writes must not fabricate decisions or decision events around them.
-- Keep reads/RLS and service-side dispatch/effect paths unchanged.
revoke insert,update,delete on public.makeup_requests,public.makeup_request_events from public,anon,authenticated;
insert into dashboard_private.makeup_subject_directors_v1(subject,profile_id,teacher_catalog_id) values
('과학','7e206f00-469a-4787-8971-275ea742b9c4','49588f2c-a473-45da-a27a-b847de390217'),
('수학','ab0ae990-69d9-4aaa-befd-47750c1dc32c','8f00aae6-fdd0-4d86-94a0-7af83d8f4366'),
('수학','c9a96afd-b1c1-41f7-8c93-605cef26bd17','a21537b7-43ca-4e90-89f4-c8a65db33094'),
('영어','4cb2ea83-6e57-49b9-a91c-91d1ccd10558','a3e38821-1ec4-4075-ac3f-5300bc0a9332'),
('영어','84916635-9ae1-4c64-9e9a-46fbeae945f6','f264845d-dfa9-4b49-a6f3-a8a58d99e1c8'),
('영어','30c58f4f-37be-414b-9b9f-2839e204d010','711f445e-a8c2-4b0b-b7a1-d5582967561c');

create function dashboard_private.makeup_subject_director_v1(p_actor uuid,p_subject text)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(
  select 1 from dashboard_private.makeup_subject_directors_v1 d
  join public.profiles p on p.id=d.profile_id and p.teacher_catalog_id=d.teacher_catalog_id
    and p.role in('admin','staff','teacher')
  join public.teacher_catalogs t on t.id=d.teacher_catalog_id and t.profile_id=p.id and t.is_visible
  join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  where d.profile_id=p_actor and d.subject=p_subject
 )
$f$;
create function dashboard_private.makeup_request_director_v1(p_actor uuid,p_request uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from public.makeup_requests r join public.classes c on c.id=r.class_id and c.subject=r.subject
  where r.id=p_request and dashboard_private.makeup_subject_director_v1(p_actor,r.subject))
$f$;
create function dashboard_private.get_makeup_director_capability_v1_impl(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select auth.uid() is not null and dashboard_private.makeup_request_director_v1(auth.uid(),p_request)
$f$;
create function public.get_makeup_director_capability_v1(p_request uuid)
returns boolean language sql stable security invoker set search_path='' as $f$
 select dashboard_private.get_makeup_director_capability_v1_impl(p_request)
$f$;
create function dashboard_private.get_my_makeup_director_subjects_v1_impl()
returns jsonb language sql stable security definer set search_path='' as $f$
 select coalesce(jsonb_agg(subject order by subject),'[]'::jsonb)
 from (select distinct subject from dashboard_private.makeup_subject_directors_v1
  where profile_id=auth.uid() and dashboard_private.makeup_subject_director_v1(auth.uid(),subject)) d
$f$;
create function public.get_my_makeup_director_subjects_v1()
returns jsonb language sql stable security invoker set search_path='' as $f$
 select dashboard_private.get_my_makeup_director_subjects_v1_impl()
$f$;


CREATE OR REPLACE FUNCTION public.transition_makeup_request_v2(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_dashboard_role()='teacher' and p_command not in('approve','revision_requested','reject','approval_canceled') then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
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
  if actor_role='assistant' or (actor_role='teacher' and p_command not in('approve','revision_requested','reject','approval_canceled')) then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
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
  select request.* into before_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  -- Recheck current subject authority before returning even a prior receipt.
  -- All decision paths keep the existing timetable -> request-key -> row order.
  if p_command in('approve','revision_requested','reject','approval_canceled') then
    perform 1 from dashboard_private.makeup_subject_directors_v1 d
    join public.profiles p on p.id=d.profile_id and p.teacher_catalog_id=d.teacher_catalog_id and p.role in('admin','staff','teacher')
    join public.teacher_catalogs t on t.id=d.teacher_catalog_id and t.profile_id=p.id and t.is_visible
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where d.profile_id=actor_id and d.subject=before_row.subject
    for share of d,p,t,u;
    if not found then raise exception 'makeup_request_transition_forbidden' using errcode='42501';end if;
    -- Only a current subject director may distinguish an invalid source.
    -- Recheck and lock it before receipt replay as well as new decisions.
    perform 1 from public.classes c
    where c.id=before_row.class_id and c.subject=before_row.subject
    for share of c;
    if not found then raise exception 'makeup_request_source_changed' using errcode='P0001';end if;
  end if;
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

  if before_row.status <> p_expected_status then
    raise exception 'makeup_request_stale_status' using errcode = 'P0001';
  end if;

  if p_command = 'approve' then
    if before_row.status <> 'approval_pending'
      or not dashboard_private.makeup_request_director_v1(actor_id,before_row.id)
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
      or not dashboard_private.makeup_request_director_v1(actor_id,before_row.id)
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
      or not dashboard_private.makeup_request_director_v1(actor_id,before_row.id)
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
    if before_row.status not in('completed','makeup_pending')
      or not dashboard_private.makeup_request_director_v1(actor_id,before_row.id) then
      raise exception 'makeup_request_transition_forbidden' using errcode='42501';
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

alter function dashboard_private.teacher_common_makeup_v1(jsonb) rename to teacher_common_makeup_redacted_v1;
create function dashboard_private.teacher_common_makeup_v1(p jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; permitted boolean;
begin
 if p is null then return null;end if;
 result:=dashboard_private.teacher_common_makeup_redacted_v1(p);
 permitted:=dashboard_private.makeup_request_director_v1(auth.uid(),nullif(p->>'id','')::uuid);
 if permitted then
  result:=result||jsonb_build_object('reason',coalesce(p->>'reason',''),'returnedReason',coalesce(p->>'returnedReason',''),
   'rejectedReason',coalesce(p->>'rejectedReason',''),'finalNote',coalesce(p->>'finalNote',''),'events',coalesce(p->'events','[]'::jsonb));
 end if;
 return result||jsonb_build_object('canDecideSubject',permitted);
end $f$;

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
 return result||jsonb_build_object('canDecideSubject',public.get_makeup_director_capability_v1(p_id),'events',events)||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(r)) then jsonb_build_object('rawMakeupSlots',r.makeup_slots) else '{}'::jsonb end;
end $function$;

create or replace function dashboard_private.teacher_request_actor_v1(p_teacher_only boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); r text;
begin
  select role into r from public.profiles where id=a for share;
  if a is null or r is null or (p_teacher_only and r<>'teacher')
    or (not p_teacher_only and r not in('admin','staff','viewer') and not(r='teacher' and exists(select 1 from dashboard_private.makeup_subject_directors_v1 d where d.profile_id=a and dashboard_private.makeup_subject_director_v1(a,d.subject)))) then
    raise exception 'teacher_request_forbidden' using errcode='42501';
  end if;
  perform 1 from auth.users where id=a and deleted_at is null
    and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  return a;
end $$;

create or replace function dashboard_private.teacher_request_manager_can_access_v1(d text,i uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.deleted_at is null
 and(u.banned_until is null or u.banned_until<=now()) where p.id=auth.uid() and
 (p.role in('admin','staff') or(d='makeup' and dashboard_private.makeup_request_director_v1(p.id,i))))
$f$;
create function dashboard_private.teacher_request_change_can_resolve_v1(d text,i uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select case when d='makeup' then dashboard_private.makeup_request_director_v1(auth.uid(),i)
 else dashboard_private.teacher_request_manager_can_access_v1(d,i) end
$f$;
create function dashboard_private.teacher_request_change_can_note_v1(d text,i uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select d='makeup' and dashboard_private.teacher_request_manager_can_access_v1(d,i)
 and public.current_dashboard_role() in('admin','staff')
$f$;
-- A decision cannot race a revocation of its subject membership, identity link,
-- active account, or class subject. Caller holds timetable/request locks first.
create function dashboard_private.lock_makeup_subject_director_v1(p_actor uuid,p_request uuid)
returns void language plpgsql security definer set search_path='' as $f$
begin
 perform 1 from public.makeup_requests r
 join public.classes c on c.id=r.class_id and c.subject=r.subject
 join dashboard_private.makeup_subject_directors_v1 d on d.subject=r.subject and d.profile_id=p_actor
 join public.profiles p on p.id=d.profile_id and p.teacher_catalog_id=d.teacher_catalog_id and p.role in('admin','staff','teacher')
 join public.teacher_catalogs t on t.id=d.teacher_catalog_id and t.profile_id=p.id and t.is_visible
 join auth.users u on u.id=p.id and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 where r.id=p_request for share of d,p,t,u,c;
 if not found then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
end $f$;
-- The companion unpublished migration creates the complete history CHECK.
-- These migrations are reviewed/applied together; no later table scan is needed.


create or replace function dashboard_private.get_teacher_request_changes_v1_impl(p_domain text,p_page integer default 1,p_page_size integer default 10)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid:=dashboard_private.teacher_request_actor_v1(false);rows jsonb;total bigint;
begin
 if p_domain is null or p_domain not in('transfer','withdrawal','makeup','textbook') or p_page is null or p_page<1 or p_page>100000
  or p_page_size is null or p_page_size not in(10,15,20) then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 with source as materialized(select c.* from dashboard_private.teacher_request_changes_v1 c
  where domain=p_domain and dashboard_private.teacher_request_manager_can_access_v1(domain,request_id)),
 page as(select * from source order by(status='pending') desc,created_at desc,id desc limit p_page_size offset((p_page-1)*p_page_size))
 select(select count(*) from source),(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'domain',c.domain,'requestId',c.request_id,'requesterId',c.requester_id,
  'kind',c.kind,'note',c.note,'status',c.status,'createdAt',c.created_at,'resolvedAt',c.resolved_at,'resolutionNote',c.resolution_note,
  'revision',md5(to_jsonb(c)::text),
  'canResolve',dashboard_private.teacher_request_change_can_resolve_v1(c.domain,c.request_id),
  'canRecordProgress',dashboard_private.teacher_request_change_can_note_v1(c.domain,c.request_id),
  'progressNotes',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'note',h.note,'createdAt',h.created_at) order by h.created_at,h.id)
    from dashboard_private.teacher_request_history_v1 h where h.domain=c.domain and h.request_id=c.request_id
    and h.action='noted' and h.input_snapshot->>'changeId'=c.id::text),'[]'::jsonb),
  'title',coalesce(case when c.domain in('transfer','withdrawal') then(select title from public.ops_tasks where id=c.request_id and type=c.domain)
   when c.domain='makeup' then(select class_name from public.makeup_requests where id=c.request_id)
   else(select requested_textbook_title from public.textbook_purchase_order_lines where purchase_order_id=c.request_id order by id limit 1) end,'원본 없음'),
  'requestStatus',case when c.domain in('transfer','withdrawal') then(select status from public.ops_tasks where id=c.request_id and type=c.domain)
   when c.domain='makeup' then(select status from public.makeup_requests where id=c.request_id)
   else(select status from public.textbook_purchase_orders where id=c.request_id) end,
  'anchorId',case when c.domain='textbook' then(select id from public.textbook_purchase_order_lines where purchase_order_id=c.request_id order by id limit 1) else c.request_id end)
  order by(c.status='pending') desc,c.created_at desc,c.id desc),'[]') from page c) into total,rows;
 return jsonb_build_object('rows',rows,'totalCount',total,'page',p_page,'pageSize',p_page_size);
end $$;

create or replace function dashboard_private.resolve_teacher_request_change_v1_impl(p_change_id uuid,p_resolution text,p_note text,p_expected_revision text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1(false);c dashboard_private.teacher_request_changes_v1%rowtype;
 receipt dashboard_private.teacher_request_receipts_v1%rowtype;f text;result jsonb;original jsonb;
begin
 if p_change_id is null or p_request_id is null or p_resolution is null or p_resolution not in('confirmed','rejected','noted')
  or p_note is null or length(btrim(p_note)) not between 1 and 4000 or p_expected_revision is null then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from dashboard_private.teacher_request_changes_v1 where id=p_change_id;
 if not found or not (case when p_resolution='noted' then dashboard_private.teacher_request_change_can_note_v1(c.domain,c.request_id) else dashboard_private.teacher_request_change_can_resolve_v1(c.domain,c.request_id) end) then
  raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 if c.domain='makeup' then perform dashboard_private.lock_timetable_operating_resources_v1();end if;
 perform pg_advisory_xact_lock(hashtextextended('teacher-own-request:'||p_request_id::text,0));
 perform dashboard_private.teacher_request_lock_v1(c.domain,c.request_id);
 select * into c from dashboard_private.teacher_request_changes_v1 where id=p_change_id for update;
 if c.domain='makeup' and p_resolution<>'noted' then
  perform dashboard_private.lock_makeup_subject_director_v1(a,c.request_id);
 end if;
 original:=dashboard_private.teacher_request_state_v1(c.domain,c.request_id);
 if not (case when p_resolution='noted' then dashboard_private.teacher_request_change_can_note_v1(c.domain,c.request_id) else dashboard_private.teacher_request_change_can_resolve_v1(c.domain,c.request_id) end)
   or (original->>'requesterId')::uuid is distinct from c.requester_id then
  raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 f:=md5(jsonb_build_object('actor',a,'change',p_change_id,'resolution',p_resolution,'note',p_note,'expected',p_expected_revision)::text);
 select * into receipt from dashboard_private.teacher_request_receipts_v1 where request_key=p_request_id;
 if found then
  if receipt.actor_id is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  if receipt.fingerprint<>f or receipt.action<>'resolve' then raise exception 'idempotency_key_reused' using errcode='22023';end if;
  return receipt.response;
 end if;
 if md5(to_jsonb(c)::text) is distinct from p_expected_revision then raise exception 'teacher_request_stale' using errcode='23514';end if;
 if c.status<>'pending' then raise exception 'teacher_request_state_conflict' using errcode='23514';end if;
 -- Recording a manager's result never performs, approves, or reverses the
 -- underlying enrollment, stock, refund, or lesson-schedule operation.
 if p_resolution<>'noted' then
 update dashboard_private.teacher_request_changes_v1 set status=p_resolution,resolution_note=btrim(p_note),resolved_by=a,resolved_at=clock_timestamp() where id=p_change_id returning * into c;
 end if;
 insert into dashboard_private.teacher_request_history_v1(domain,request_id,actor_id,action,note,input_snapshot)
 values(c.domain,c.request_id,a,p_resolution,btrim(p_note),jsonb_build_object('changeId',c.id));
 result:=jsonb_build_object('id',c.id,'domain',c.domain,'requestId',c.request_id,'kind',c.kind,'note',c.note,'status',c.status,
  'createdAt',c.created_at,'resolvedAt',c.resolved_at,'resolutionNote',c.resolution_note,'revision',md5(to_jsonb(c)::text));
 insert into dashboard_private.teacher_request_receipts_v1(request_key,actor_id,domain,request_id,action,fingerprint,response)
 values(p_request_id,a,c.domain,c.request_id,'resolve',f,result);
 return result;
end $$;

alter function dashboard_private.makeup_subject_director_v1(uuid,text) owner to postgres;
alter function dashboard_private.makeup_request_director_v1(uuid,uuid) owner to postgres;
alter function dashboard_private.get_makeup_director_capability_v1_impl(uuid) owner to postgres;
alter function dashboard_private.get_my_makeup_director_subjects_v1_impl() owner to postgres;
alter function dashboard_private.teacher_common_makeup_v1(jsonb) owner to postgres;
alter function dashboard_private.teacher_request_change_can_resolve_v1(text,uuid) owner to postgres;
alter function dashboard_private.teacher_request_change_can_note_v1(text,uuid) owner to postgres;
alter function dashboard_private.lock_makeup_subject_director_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.makeup_subject_director_v1(uuid,text),
 dashboard_private.makeup_request_director_v1(uuid,uuid),
 dashboard_private.teacher_common_makeup_v1(jsonb),
 dashboard_private.teacher_common_makeup_redacted_v1(jsonb),
 dashboard_private.teacher_request_change_can_resolve_v1(text,uuid),
 dashboard_private.teacher_request_change_can_note_v1(text,uuid) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.lock_makeup_subject_director_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_makeup_director_capability_v1(uuid),dashboard_private.get_makeup_director_capability_v1_impl(uuid),
 public.get_my_makeup_director_subjects_v1(),dashboard_private.get_my_makeup_director_subjects_v1_impl() from public,anon,authenticated,service_role;
grant execute on function public.get_makeup_director_capability_v1(uuid),dashboard_private.get_makeup_director_capability_v1_impl(uuid),
 public.get_my_makeup_director_subjects_v1(),dashboard_private.get_my_makeup_director_subjects_v1_impl() to authenticated;
-- Used only by the authenticated HTTP endpoint's service client. This is not
-- an end-user send API and does not alter recipients, plans or deduplication.
create function dashboard_private.get_makeup_director_dispatch_authorization_v1_impl(p_actor uuid,p_source_event uuid)
returns boolean language plpgsql stable security definer set search_path='' as $f$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'makeup_dispatch_forbidden' using errcode='42501';end if;
 return exists(select 1 from public.makeup_request_events e
  where e.id=p_source_event and e.actor_id=p_actor
  and e.event_type in('approved','revision_requested','rejected','approval_canceled')
  and dashboard_private.makeup_request_director_v1(p_actor,e.request_id));
end $f$;
create function public.get_makeup_director_dispatch_authorization_v1(p_actor uuid,p_source_event uuid)
returns boolean language sql stable security invoker set search_path='' as $f$
 select dashboard_private.get_makeup_director_dispatch_authorization_v1_impl(p_actor,p_source_event)
$f$;
alter function dashboard_private.get_makeup_director_dispatch_authorization_v1_impl(uuid,uuid) owner to postgres;
revoke all on function public.get_makeup_director_dispatch_authorization_v1(uuid,uuid),
 dashboard_private.get_makeup_director_dispatch_authorization_v1_impl(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_makeup_director_dispatch_authorization_v1(uuid,uuid),
 dashboard_private.get_makeup_director_dispatch_authorization_v1_impl(uuid,uuid) to service_role;

-- Preserve historical routing metadata during an owner edit. This exception
-- requires the unforgeable, exact transaction/request/update context created by
-- the owner RPC; it cannot authorize creation, resubmission or any decision.
create function dashboard_private.teacher_request_preserved_makeup_approver_v1(p_input jsonb)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from dashboard_private.teacher_request_context_v1 c
 join public.makeup_requests r on r.id=c.request_id and r.requester_id=auth.uid()
 where c.transaction_id=txid_current() and c.backend_pid=pg_backend_pid() and c.actor_id=auth.uid()
 and c.domain='makeup' and c.action='update'
 and dashboard_private.teacher_request_context_matches_v1('makeup',r.id)
 and p_input->>'requester_id'=r.requester_id::text and p_input->>'class_id'=r.class_id::text
 and p_input->>'approver_profile_id'=r.approver_profile_id::text
 and p_input->>'approver_teacher_catalog_id'=r.approver_teacher_catalog_id::text)
$f$;
alter function dashboard_private.teacher_request_preserved_makeup_approver_v1(jsonb) owner to postgres;
revoke all on function dashboard_private.teacher_request_preserved_makeup_approver_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function dashboard_private.notification_makeup_input_valid_v1(
  p_input jsonb,
  p_effective_at timestamptz default pg_catalog.now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_input is not null
    and pg_catalog.jsonb_typeof(p_input) = 'object'
    and p_input ->> 'request_kind' in ('cancel_makeup', 'cancel_only', 'makeup_only')
    and p_input ->> 'approval_group' in ('math_middle', 'math_high', 'english', 'unknown')
    and nullif(pg_catalog.btrim(p_input ->> 'subject'), '') is not null
    and nullif(pg_catalog.btrim(p_input ->> 'class_name'), '') is not null
    and nullif(pg_catalog.btrim(p_input ->> 'reason'), '') is not null
    and nullif(p_input ->> 'requester_id', '') is not null
    and nullif(p_input ->> 'teacher_catalog_id', '') is not null
    and nullif(p_input ->> 'teacher_profile_id', '') is not null
    and nullif(p_input ->> 'class_id', '') is not null
    and nullif(p_input ->> 'approver_teacher_catalog_id', '') is not null
    and nullif(p_input ->> 'approver_profile_id', '') is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id::text = pg_catalog.lower(
        pg_catalog.btrim(p_input ->> 'requester_id')
      )
    )
    and exists (
      select 1
      from public.classes class_row
      join public.teacher_catalogs teacher
        on teacher.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'teacher_catalog_id')
        )
      join public.teacher_catalogs approver
        on approver.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'approver_teacher_catalog_id')
        )
      cross join lateral (
        select dashboard_private.resolve_registration_default_director(
          class_row.subject,
          class_row.grade,
          p_effective_at
        ) as resolution
      ) director
      where class_row.id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'class_id')
        )
        and pg_catalog.btrim(class_row.name) = pg_catalog.btrim(
          p_input ->> 'class_name'
        )
        and pg_catalog.btrim(class_row.subject) = pg_catalog.btrim(
          p_input ->> 'subject'
        )
        and teacher.profile_id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'teacher_profile_id')
        )
        and pg_catalog.btrim(teacher.name) = pg_catalog.btrim(class_row.teacher)
        and approver.profile_id::text = pg_catalog.lower(
          pg_catalog.btrim(p_input ->> 'approver_profile_id')
        )
        and approver.is_visible
        and p_input ->> 'approval_group' = case
          when pg_catalog.btrim(class_row.subject) = '영어' then 'english'
          when pg_catalog.btrim(class_row.subject) = '수학'
            and coalesce(
              nullif(pg_catalog.btrim(class_row.grade), ''),
              nullif(pg_catalog.btrim(class_row.name), ''),
              ''
            ) ~* '(고|high)'
          then 'math_high'
          when pg_catalog.btrim(class_row.subject) = '수학'
            and coalesce(
              nullif(pg_catalog.btrim(class_row.grade), ''),
              nullif(pg_catalog.btrim(class_row.name), ''),
              ''
            ) ~* '(초|elementary|중|middle)'
          then 'math_middle'
          else 'unknown'
        end
        and (
          public.current_dashboard_role() in ('admin', 'staff')
          or dashboard_private.teacher_request_preserved_makeup_approver_v1(p_input)
          or (
            director.resolution ->> 'status' = 'resolved'
            and director.resolution ->> 'profileId' = approver.profile_id::text
          )
        )
    )
    and pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
    and case p_input ->> 'request_kind'
      when 'cancel_only' then
        nullif(p_input ->> 'cancel_date', '') is not null
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end = 0
        and nullif(p_input ->> 'makeup_start_at', '') is null
        and nullif(p_input ->> 'makeup_end_at', '') is null
        and nullif(p_input ->> 'makeup_classroom', '') is null
      when 'makeup_only' then
        nullif(p_input ->> 'cancel_date', '') is null
        and nullif(p_input ->> 'makeup_start_at', '') is not null
        and nullif(p_input ->> 'makeup_end_at', '') is not null
        and nullif(pg_catalog.btrim(p_input ->> 'makeup_classroom'), '') is not null
        and (p_input ->> 'makeup_end_at')::timestamptz
          > (p_input ->> 'makeup_start_at')::timestamptz
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end > 0
      else
        nullif(p_input ->> 'cancel_date', '') is not null
        and nullif(p_input ->> 'makeup_start_at', '') is not null
        and nullif(p_input ->> 'makeup_end_at', '') is not null
        and nullif(pg_catalog.btrim(p_input ->> 'makeup_classroom'), '') is not null
        and (p_input ->> 'makeup_end_at')::timestamptz
          > (p_input ->> 'makeup_start_at')::timestamptz
        and case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then pg_catalog.jsonb_array_length(coalesce(p_input -> 'makeup_slots', '[]'::jsonb))
          else -1
        end > 0
    end
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(coalesce(p_input -> 'makeup_slots', '[]'::jsonb)) = 'array'
            then coalesce(p_input -> 'makeup_slots', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) slot(value)
      where pg_catalog.jsonb_typeof(slot.value) <> 'object'
        or nullif(slot.value ->> 'startAt', '') is null
        or nullif(slot.value ->> 'endAt', '') is null
        or nullif(pg_catalog.btrim(slot.value ->> 'classroom'), '') is null
        or (slot.value ->> 'endAt')::timestamptz
          <= (slot.value ->> 'startAt')::timestamptz
    );
$$;

create or replace function dashboard_private.teacher_request_makeup_input_v1(p_input jsonb,p_existing_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.classes%rowtype;t public.teacher_catalogs%rowtype;ap public.teacher_catalogs%rowtype;
 old_request public.makeup_requests%rowtype;director jsonb;v jsonb;slot jsonb;mode text;session_id uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input ?& dashboard_private.teacher_request_input_fields_v1('makeup'))
  or p_input-dashboard_private.teacher_request_input_fields_v1('makeup')<>'{}'
  or jsonb_typeof(p_input->'request_kind') is distinct from 'string'
  or jsonb_typeof(p_input->'class_id') is distinct from 'string'
  or jsonb_typeof(p_input->'reason') is distinct from 'string'
  or length(btrim(p_input->>'reason')) not between 1 and 4000
  or jsonb_typeof(p_input->'makeup_slots') is distinct from 'array'
  or jsonb_array_length(p_input->'makeup_slots')>30
  or jsonb_typeof(p_input->'cancel_date') not in('string','null')
  or jsonb_typeof(p_input->'original_lesson_session_id') not in('string','null') then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from public.classes where id=(p_input->>'class_id')::uuid for share;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if p_existing_id is not null then
  select * into old_request from public.makeup_requests where id=p_existing_id;
  if c.id is distinct from old_request.class_id then raise exception 'teacher_request_reference_change_forbidden' using errcode='22023';end if;
 end if;
 -- Resolve unique active catalog links, never a client-supplied profile/role.
 if (select count(*) from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher))<>1 then
  raise exception 'teacher_request_teacher_unavailable' using errcode='22023';end if;
 select tc.* into t from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher);
 if p_existing_id is null then
 director:=dashboard_private.resolve_registration_default_director(c.subject,c.grade,coalesce(old_request.created_at,now()));
 if director->>'status' is distinct from 'resolved' then raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 if (select count(*) from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId')<>1 then
  raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 select * into ap from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId';
 else
  select * into ap from public.teacher_catalogs where id=old_request.approver_teacher_catalog_id
   and profile_id=old_request.approver_profile_id and is_visible;
  if not found then raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 end if;
 for slot in select value from jsonb_array_elements(p_input->'makeup_slots') loop
  if jsonb_typeof(slot) is distinct from 'object' or not(slot ?& array['startAt','endAt','classroom'])
    or slot-array['startAt','endAt','classroom']<>'{}' or exists(select 1 from jsonb_each(slot) where jsonb_typeof(value)<>'string')
    or not exists(select 1 from public.classroom_catalogs where is_visible and name=slot->>'classroom')
    or (slot->>'endAt')::timestamptz<=(slot->>'startAt')::timestamptz then
    raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 end loop;
 session_id:=nullif(p_input->>'original_lesson_session_id','')::uuid;
 if c.schedule_storage_mode='normalized' and p_input->>'request_kind'<>'makeup_only' then
  if session_id is null or not exists(select 1 from public.class_lesson_sessions where id=session_id and class_id=c.id
    and session_date=(p_input->>'cancel_date')::date and schedule_state in('active','makeup')) then
   raise exception 'makeup_lesson_session_invalid' using errcode='22023';end if;
 elsif session_id is not null then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 v:=jsonb_build_object('request_kind',p_input->'request_kind','class_id',c.id,'class_name',c.name,'subject',c.subject,
  'approval_group',case when btrim(c.subject)='영어' then 'english' when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(고|high)' then 'math_high'
   when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(초|elementary|중|middle)' then 'math_middle' else 'unknown' end,
  'requester_id',auth.uid(),'teacher_catalog_id',t.id,'teacher_profile_id',t.profile_id,'approver_teacher_catalog_id',ap.id,'approver_profile_id',ap.profile_id,
  'reason',btrim(p_input->>'reason'),'cancel_date',p_input->'cancel_date','original_lesson_session_id',session_id,
  'makeup_slots',p_input->'makeup_slots','makeup_start_at',p_input#>'{makeup_slots,0,startAt}',
  'makeup_end_at',p_input#>'{makeup_slots,0,endAt}','makeup_classroom',p_input#>'{makeup_slots,0,classroom}');
 if not coalesce(dashboard_private.notification_makeup_input_valid_v1(v,coalesce(old_request.created_at,now())),false) then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'teacher_request_input_invalid' using errcode='22023';
end $$;

notify pgrst,'reload schema';
commit;
