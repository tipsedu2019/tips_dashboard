begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Forward-only change to the final installed transfer implementation. No data
-- backfill, settings, ACL, scheduler or provider mutation is performed here.
do $transfer_completion$
declare
  target regprocedure := 'dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)'::regprocedure;
  definition text;
  original_owner oid;
  original_acl aclitem[];
  anchor text;
  replacement text;
  business_message text;
begin
  select proowner, proacl into original_owner, original_acl from pg_catalog.pg_proc where oid=target;
  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.md5(definition) <> 'f5ae6b686d5ab30065b2409096bd0c30' then
    raise exception 'transfer_completion_definition_drift' using errcode='55000';
  end if;
  foreach business_message in array array['ops_transfer_completion_state_conflict', 'ops_transfer_checklist_incomplete', 'registration_student_reactivation_required', 'registration_roster_mode_conflict', 'registration_student_class_already_active', 'registration_open_admission_batch'] loop
    definition := replace(definition,
      'raise exception ' || quote_literal(business_message) || ' using errcode = ' || quote_literal('40001'),
      'raise exception ' || quote_literal(business_message) || ' using errcode = ' || quote_literal('23514'));
  end loop;

  anchor := $anchor$  v_response jsonb;$anchor$;
  replacement := $replacement$  v_response jsonb;
  v_to_claim_id uuid;
  v_to_claim_count integer;$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;$anchor$;
  replacement := $replacement$  -- A saved transfer may outlive removal from the last source roster.$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$  if v_from_class.id is null or v_to_class.id is null then$anchor$;
  replacement := $replacement$  if v_detail.from_class_end_date is null or v_detail.to_class_start_date is null then
    raise exception 'ops_transfer_schedule_required' using errcode = '23514';
  end if;
  if v_from_class.id is null or v_to_class.id is null then$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$  update public.ops_transfer_details$anchor$;
  replacement := $replacement$  -- An already enrolled destination can be a roster no-op, but the saved
  -- student's status must still reflect the successfully reconciled transfer.
  update public.students set status = '재원'
  where id = v_student_id and status is distinct from '재원';

  update public.ops_transfer_details$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$  if not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_from_class_id::text)
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_from_class_id::text
    or not (coalesce(pg_catalog.to_jsonb(v_from_class.student_ids), '[]'::jsonb) ? v_student_id::text)
    or coalesce(pg_catalog.to_jsonb(v_from_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '23514';
  end if;
  if coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.student_ids), '[]'::jsonb) ? v_student_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = v_to_class_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_already_active' using errcode = '23514';
  end if;
$anchor$;
  replacement := $replacement$  -- Removed source / enrolled destination are valid completion inputs.
  -- Waiting is a different workflow. Reciprocal arrays and element shape are
  -- still validated by apply_student_class_roster_mode under the same locks.
  if coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_from_class_id::text
    or coalesce(v_from_class.waitlist_ids, '[]'::jsonb) ? v_student_id::text
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(v_to_class.waitlist_ids, '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '23514';
  end if;
  select pg_catalog.count(*), (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_to_claim_count, v_to_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_to_class_id and enrollment.roster_active;
  if v_to_claim_count > 1 or exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.id = v_to_claim_id
      and (enrollment.status <> 'enrolled'
        or not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text)
        or not (coalesce(v_to_class.student_ids, '[]'::jsonb) ? v_student_id::text))
  ) then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    v_from_class_id,
    'removed',
    'enrolled',$anchor$;
  replacement := $replacement$    v_from_class_id,
    'removed',
    case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_from_class_id::text then 'enrolled' else 'removed' end,$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    v_to_class_id,
    'enrolled',
    'removed',
    null,$anchor$;
  replacement := $replacement$    v_to_class_id,
    'enrolled',
    case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text then 'enrolled' else 'removed' end,
    v_to_claim_id,$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    class_name = v_to_class.name,
    subject = v_to_class.subject,$anchor$;
  replacement := $replacement$    class_name = v_detail.to_class_name,
    subject = v_task.subject,$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$      coalesce(v_from_class.name, ''),
      coalesce(v_to_class.name, '') || ' 등록 · transfer_to_class'$anchor$;
  replacement := $replacement$      coalesce(v_detail.from_class_name, ''),
      coalesce(v_detail.to_class_name, '') || ' 등록 · transfer_to_class'$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원', '재원');$anchor$;
  replacement := $replacement$    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', v_student.status, '재원');$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_completion_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
  if exists(select 1 from pg_catalog.pg_proc where oid=target
    and (proowner is distinct from original_owner or proacl is distinct from original_acl)) then
    raise exception 'transfer_completion_acl_drift' using errcode='55000';
  end if;
end;
$transfer_completion$;

-- Keep original requested facts separate from the saved detail actually applied.
-- This changes source payload creation only; no delivery, routes, keys or settings.
do $transfer_request_snapshot$
declare
  target regprocedure := 'dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'::regprocedure;
  definition text;
  original_owner oid;
  original_acl aclitem[];
  anchor text;
  replacement text;
begin
  select proowner,proacl into original_owner,original_acl from pg_catalog.pg_proc where oid=target;
  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.md5(definition) <> '3ddb371070b506f34711f5c52538910e' then
    raise exception 'transfer_request_snapshot_definition_drift' using errcode='55000';
  end if;
  anchor := $anchor$  v_transfer public.ops_transfer_details%rowtype;$anchor$;
  replacement := $replacement$  v_transfer public.ops_transfer_details%rowtype;
  v_requested_transfer_snapshot jsonb;
  v_requested_transfer_snapshot_status text;
  v_applied_transfer_snapshot jsonb;$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_request_snapshot_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := $anchor$    v_teacher_name := coalesce(nullif(v_transfer.from_teacher_name, ''), nullif(v_transfer.to_teacher_name, ''));$anchor$;
  replacement := $replacement$    v_teacher_name := coalesce(nullif(v_transfer.from_teacher_name, ''), nullif(v_transfer.to_teacher_name, ''));
    if p_event_key = 'transfer.completed' then
      -- Historical request facts are copied only from the first recorded request.
      -- Missing legacy fields stay missing; current detail is a separate applied fact.
      select coalesce((select pg_catalog.jsonb_object_agg(fact.key, fact.value)
        from pg_catalog.jsonb_each(source.payload) fact
        where fact.key = any(array['before_class', 'after_class', 'teacher_name',
          'before_class_end_date', 'after_class_start_date',
          'before_class_end_session', 'after_class_start_session'])), '{}'::jsonb)
        || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'before_class_end_date', coalesce(nullif(source.payload -> 'before_class_end_date', 'null'::jsonb), source.payload -> 'before_end_date'),
          'after_class_start_date', coalesce(nullif(source.payload -> 'after_class_start_date', 'null'::jsonb), source.payload -> 'after_start_date')
        ))
      into v_requested_transfer_snapshot
      from public.ops_task_events source
      where source.task_id = p_task.id and source.event_type = 'transfer.submitted'
      order by source.created_at, source.id
      limit 1;
      v_requested_transfer_snapshot_status := case
        when not found then 'missing'
        when v_requested_transfer_snapshot ->> 'before_class_end_date' is null
          or v_requested_transfer_snapshot ->> 'after_class_start_date' is null
          or v_requested_transfer_snapshot ->> 'before_class_end_session' is null
          or v_requested_transfer_snapshot ->> 'after_class_start_session' is null
          or v_requested_transfer_snapshot ->> 'before_class' is null
          or v_requested_transfer_snapshot ->> 'after_class' is null then 'incomplete'
        else 'complete'
      end;
      v_applied_transfer_snapshot := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'before_class', v_transfer.from_class_name,
        'after_class', v_transfer.to_class_name,
        'teacher_name', v_teacher_name,
        'before_class_end_date', v_transfer.from_class_end_date,
        'after_class_start_date', v_transfer.to_class_start_date,
        'before_class_end_session', v_transfer.from_class_end_session,
        'after_class_start_session', v_transfer.to_class_start_session
      ));
    end if;$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_request_snapshot_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := $anchor$    'requested_effective_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,$anchor$;
  replacement := $replacement$    'requested_transfer_snapshot_status', v_requested_transfer_snapshot_status,
    'requested_transfer_snapshot', v_requested_transfer_snapshot,
    'applied_transfer_snapshot', v_applied_transfer_snapshot,
    'requested_effective_date', case
      when p_event_key = 'transfer.completed' then v_requested_transfer_snapshot ->> 'after_class_start_date'
      when p_task.type = 'transfer' then v_transfer.to_class_start_date::text
    end,
    'before_class_end_session', case when p_task.type = 'transfer' then v_transfer.from_class_end_session end,
    'after_class_start_session', case when p_task.type = 'transfer' then v_transfer.to_class_start_session end,$replacement$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'transfer_request_snapshot_anchor_drift' using errcode='55000';
  end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
  if exists(select 1 from pg_catalog.pg_proc where oid=target
    and (proowner is distinct from original_owner or proacl is distinct from original_acl)) then
    raise exception 'transfer_request_snapshot_acl_drift' using errcode='55000';
  end if;
end;
$transfer_request_snapshot$;
commit;
