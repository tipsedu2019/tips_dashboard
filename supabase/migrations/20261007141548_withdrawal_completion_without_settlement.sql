begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Extend the final last-lesson core, retaining its locks, authorization,
-- notification wrapper and receipt replay. This migration never runs a task.
do $withdrawal_completion_without_settlement$
declare
  v_target regprocedure := 'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'::regprocedure;
  v_definition text; v_anchor text; v_patch text; v_message text;
  v_owner oid; v_acl aclitem[]; v_after_owner oid; v_after_acl aclitem[];
begin
  select proowner, proacl into v_owner, v_acl from pg_catalog.pg_proc where oid = v_target;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if strpos(v_definition, 'withdrawal_release_scheduler_not_ready') = 0
    or strpos(v_definition, 'withdrawal_completion_validation') > 0 then
    raise exception 'withdrawal_completion_core_version_mismatch' using errcode = '55000';
  end if;
  v_anchor := $anchor_1$  v_response jsonb;$anchor_1$;
  v_patch := $patch_1$  v_response jsonb;
  v_roster_mode text;
  v_previous_student_status text;$patch_1$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_1_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_2$  -- withdrawal_mutable_state_check
  if v_task.status in ('done', 'canceled')
    or v_detail.timetable_roster_updated
  then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '__legacy_sqlstate__';
  end if;
  if not v_detail.makeedu_withdrawal_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_withdrawal_checklist_incomplete' using errcode = '__legacy_sqlstate__';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '__legacy_sqlstate__';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_source_class_id::text)
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_source_class_id::text
  then
    raise exception 'ops_withdrawal_source_roster_required' using errcode = '__legacy_sqlstate__';
  end if;
$anchor_2$;
  -- Reconstruct the old anchor only; the replacement uses domain SQLSTATEs.
  v_anchor := replace(v_anchor, '__legacy_sqlstate__', '40' || '001');
  v_patch := $patch_2$  -- A withdrawal may be completed after an authorized earlier roster removal.
  -- Settlement checks remain independent records; completion never marks them paid.
  if v_task.status in ('done', 'canceled') then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
  end if;
  if not v_detail.makeedu_withdrawal_done then
    raise exception 'ops_withdrawal_checklist_incomplete' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_source_class_id::text then
    raise exception 'ops_withdrawal_waitlist_conflict' using errcode = '23514';
  end if;
  v_roster_mode := case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_source_class_id::text
    then 'enrolled' else 'removed' end;
  v_previous_student_status := v_student.status;
  if v_student.status = '퇴원' and v_roster_mode <> 'removed' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode = '23514';
  end if;
$patch_2$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_2_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_3$  if v_detail.withdrawal_date is null then$anchor_3$;
  v_patch := $patch_3$  if v_roster_mode = 'removed' and v_claim_id is not null then
    raise exception 'ops_withdrawal_claim_roster_conflict' using errcode = '23514';
  end if;
  -- Preserve the canonical four-array, symmetry and claim validation on both
  -- paths. A removed->removed validation is a no-op and creates no history.
  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id, v_source_class_id, v_roster_mode, v_roster_mode,
    v_claim_id, 'withdrawal_completion_validation', v_actor_id);

  -- An old withdrawal must not remove a later admission/restored relationship.
  -- Initial enrollment history alone does not prove a removal and re-enrollment.
  if v_roster_mode = 'enrolled' and (
    (v_claim_id is not null and v_claim.class_start_date > v_detail.withdrawal_date)
    or exists (
      select 1 from public.student_class_enrollment_history reenrolled
      where reenrolled.student_id = v_student_id and reenrolled.class_id = v_source_class_id
        and reenrolled.action = 'enrolled'
        and (reenrolled.changed_at > v_task.created_at
          or reenrolled.changed_at >= ((v_detail.withdrawal_date + 1)::timestamp at time zone 'Asia/Seoul'))
        and exists (
          select 1 from public.student_class_enrollment_history removed
          where removed.student_id = v_student_id and removed.class_id = v_source_class_id
            and removed.action = 'removed' and removed.changed_at <= reenrolled.changed_at
        )
    )
  ) then
    raise exception 'ops_withdrawal_registration_changed' using errcode = '23514';
  end if;

  if v_detail.withdrawal_date is null then$patch_3$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_3_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_4$  if v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then$anchor_4$;
  v_patch := $patch_4$  if v_roster_mode = 'enrolled'
    and v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then$patch_4$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_4_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_5$    'removed',
    'enrolled',
    v_claim_id,
    'withdrawal_completed',$anchor_5$;
  v_patch := $patch_5$    'removed',
    v_roster_mode,
    v_claim_id,
    'withdrawal_completed',$patch_5$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_5_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_6$  if v_next_student_status = '퇴원' then
    update public.students
    set status = '퇴원'
    where id = v_student_id
      and status = '재원';
    if not found then
      raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '__legacy_sqlstate__';
    end if;
  elsif v_student.status <> '재원' then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '__legacy_sqlstate__';
  end if;

  update public.ops_withdrawal_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '__legacy_sqlstate__';
  end if;
$anchor_6$;
  -- Reconstruct the old anchor only; the replacement uses domain SQLSTATEs.
  v_anchor := replace(v_anchor, '__legacy_sqlstate__', '40' || '001');
  v_patch := $patch_6$  if v_next_student_status = '퇴원' then
    if v_student.status = '재원' then
      update public.students set status = '퇴원' where id = v_student_id and status = '재원';
      if not found then
        raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
      end if;
    elsif v_student.status <> '퇴원' then
      raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
    end if;
  elsif v_student.status <> '재원' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode = '23514';
  end if;

  update public.ops_withdrawal_details
  set timetable_roster_updated = true, updated_at = pg_catalog.now()
  where task_id = p_task_id;
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
  end if;
$patch_6$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_6_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_7$        || ' 제거 · withdrawal_completed'$anchor_7$;
  v_patch := $patch_7$        || case when v_roster_mode = 'removed' then ' 이미 제외됨 · withdrawal_completed'
          else ' 제거 · withdrawal_completed' end$patch_7$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_7_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_8$p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원',$anchor_8$;
  v_patch := $patch_8$p_task_id, v_actor_id, 'auto_synced', '학생 상태', v_previous_student_status,$patch_8$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_8_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_9$    'taskStatus', 'done',$anchor_9$;
  v_patch := $patch_9$    'taskStatus', 'done',
    'rosterAlreadyRemoved', v_roster_mode = 'removed',$patch_9$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_9_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  v_anchor := $anchor_10$    where task_id=p_task_id and not timetable_roster_updated;$anchor_10$;
  v_patch := $patch_10$    where task_id=p_task_id;$patch_10$;
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_completion_patch_10_mismatch' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);
  -- Existing business conflicts are not serialization failures. Only the
  -- two actual identity/parent rescan collision guards retain 40001.
  foreach v_message in array array['ops_withdrawal_completion_state_conflict', 'registration_open_admission_batch'] loop
    v_definition := replace(v_definition,
      format('raise exception %L using errcode = %L;', v_message, '40001'),
      format('raise exception %L using errcode = %L;', v_message, '23514'));
  end loop;
  if (length(v_definition)-length(replace(v_definition,'''40001''',''))) / length('''40001''') <> 2 then
    raise exception 'withdrawal_completion_concurrency_contract_mismatch' using errcode = '55000';
  end if;
  execute v_definition;
  select proowner, proacl into v_after_owner, v_after_acl from pg_catalog.pg_proc where oid = v_target;
  if v_owner is distinct from v_after_owner or v_acl is distinct from v_after_acl then
    raise exception 'withdrawal_completion_acl_changed' using errcode = '55000';
  end if;
end;
$withdrawal_completion_without_settlement$;

-- The app fails closed against the earlier runtime that still requires fees
-- and an existing roster. The callable role and runtime's ownership are retained.
create or replace function public.withdrawal_last_lesson_release_runtime_version()
returns text language sql stable security invoker set search_path = '' as $$
  select 'withdrawal_completion_without_settlement_v2'::text;
$$;
alter function public.withdrawal_last_lesson_release_runtime_version() owner to postgres;
revoke all on function public.withdrawal_last_lesson_release_runtime_version() from public, anon, authenticated, service_role;
grant execute on function public.withdrawal_last_lesson_release_runtime_version() to authenticated;

-- A completed withdrawal's two settlement CHECKS can be followed up separately.
-- This records an operator's confirmation; no amount, claim, invoice, payment,
-- queue, task status or completion timestamp is written by this endpoint.
create function public.update_ops_withdrawal_settlement_check_v1(
  p_task_id uuid, p_field text, p_checked boolean, p_expected_checked boolean, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := 'withdrawal-settlement:' || p_request_id::text;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_withdrawal_details%rowtype;
  v_target jsonb; v_response jsonb; v_receipt_matches boolean;
  v_current boolean; v_changed boolean; v_label text;
begin
  perform dashboard_private.assert_registration_mutation_access(p_task_id, null, 'complete_withdrawal_roster_transition');
  if p_task_id is null or p_request_id is null or p_field is null
    or p_field not in ('feeProcessed', 'textbookFeeProcessed')
    or p_checked is null or p_expected_checked is null then
    raise exception 'withdrawal_settlement_check_invalid' using errcode = '22023';
  end if;
  v_target := pg_catalog.jsonb_build_object('taskId', p_task_id, 'field', p_field,
    'checked', p_checked, 'expectedChecked', p_expected_checked);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0));
  select * into v_task from public.ops_tasks where id = p_task_id and type = 'withdrawal' for update;
  if not found then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  select * into v_detail from public.ops_withdrawal_details where task_id = p_task_id for update;
  if not found then raise exception 'ops_withdrawal_detail_required' using errcode = '23514'; end if;
  select mutation.response_payload,
    mutation.task_id = p_task_id and mutation.mutation_type = 'update_withdrawal_settlement_check'
      and mutation.target_fingerprint = v_target
  into v_response, v_receipt_matches from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if not v_receipt_matches then raise exception 'idempotency_key_reused' using errcode = '22023'; end if;
    return v_response;
  end if;
  if v_task.status <> 'done' then
    raise exception 'withdrawal_settlement_completed_task_required' using errcode = '23514';
  end if;
  v_current := case p_field when 'feeProcessed' then v_detail.fee_processed else v_detail.textbook_fee_processed end;
  v_changed := v_current is distinct from p_checked;
  if v_changed and v_current is distinct from p_expected_checked then
    raise exception 'withdrawal_settlement_check_conflict' using errcode = '23514';
  end if;
  if v_changed then
    update public.ops_withdrawal_details set
      fee_processed = case when p_field = 'feeProcessed' then p_checked else fee_processed end,
      textbook_fee_processed = case when p_field = 'textbookFeeProcessed' then p_checked else textbook_fee_processed end,
      updated_at = pg_catalog.now()
    where task_id = p_task_id;
    v_label := case p_field when 'feeProcessed' then '수업료 처리' else '교재비 처리' end;
    insert into public.ops_task_events(task_id, actor_id, event_type, field_name, before_value, after_value)
    values(p_task_id, v_actor_id, case when p_checked then 'manual_checked' else 'manual_unchecked' end,
      v_label, case when v_current then '완료' else '미완료' end, case when p_checked then '완료' else '미완료' end);
  end if;
  v_response := pg_catalog.jsonb_build_object('taskId', p_task_id, 'field', p_field, 'checked', p_checked, 'changed', v_changed);
  insert into dashboard_private.ops_registration_mutations(actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload)
  values(v_actor_id, v_request_key, p_task_id, 'update_withdrawal_settlement_check', v_target, v_response);
  return v_response;
end;
$$;
alter function public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid) owner to postgres;
revoke all on function public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid) from public, anon, authenticated, service_role;
grant execute on function public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid) to authenticated;

commit;
