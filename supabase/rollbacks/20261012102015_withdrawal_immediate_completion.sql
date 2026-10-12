-- Recovery proposal only: parent coordinates app maintenance and DB execution.
-- Restores code/cron, never restores removed students or rewrites queue history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tips-withdrawal-roster-release-worker-v1',0));
do $rollback_completion$
declare
  v_target regprocedure := 'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'::regprocedure;
  v_definition text;
  v_anchor text := $anchor$  -- Last-lesson-day completion follows the finished lesson. Reject future
  -- dates for both enrolled and already removed students without any mutation.
  if v_detail.withdrawal_date > (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception 'withdrawal_last_lesson_date_in_future' using errcode = '23514';
  end if;
$anchor$;
  v_previous text := $previous$  if v_roster_mode = 'enrolled'
    and v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    if v_student.status is distinct from '재원' then
      raise exception 'withdrawal_release_student_status_conflict' using errcode='23514';
    end if;
    -- Reuse the gateway's full reciprocal/claim validation as a no-op. Merely
    -- checking the student array would skip invariants of the old removal path.
    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id,v_source_class_id,'enrolled','enrolled',v_claim_id,'withdrawal_release_schedule_validation',v_actor_id);
    if not dashboard_private.withdrawal_roster_release_scheduler_ready_v1() then
      raise exception 'withdrawal_release_scheduler_not_ready' using errcode='55000';
    end if;
    insert into dashboard_private.withdrawal_roster_release_queue_v1(
      task_id,claim_source_task_id,student_id,class_id,expected_claim_id,expected_history_count,last_lesson_date,actor_id)
    select p_task_id,case when v_claim_id is not null then p_task_id end,v_student_id,v_source_class_id,v_claim_id,
      count(*),v_detail.withdrawal_date,v_actor_id from public.student_class_enrollment_history
    where student_id=v_student_id and class_id=v_source_class_id;
    update public.ops_withdrawal_details set timetable_roster_updated=true,updated_at=pg_catalog.now()
    where task_id=p_task_id;
    if not found then raise exception 'withdrawal_release_state_changed' using errcode='23514'; end if;
    update public.ops_tasks set status='done',completed_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=p_task_id and type='withdrawal' and status not in('done','canceled');
    if not found then raise exception 'withdrawal_release_state_changed' using errcode='23514'; end if;
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value) values
      (p_task_id,v_actor_id,'auto_checked','시간표 명단 변경','','제외 예약'),
      (p_task_id,v_actor_id,'auto_synced','수업명단','',coalesce(v_class.name,v_task.class_name,v_source_class_id::text)
        || ' 기준일까지 유지 · ' || v_detail.withdrawal_date::text || ' 이후 제외 예약');
    v_response:=pg_catalog.jsonb_build_object('taskId',p_task_id,'studentId',v_student_id,'sourceClassId',v_source_class_id,
      'affectedClassIds',pg_catalog.to_jsonb(v_affected_class_ids),'releasedEnrollmentIds','[]'::jsonb,
      'canceledWaitlistEnrollmentIds','[]'::jsonb,'studentStatus',v_student.status,'taskStatus','done',
      'timetableRosterUpdated',true,'rosterReleaseScheduled',true,'lastLessonDate',v_detail.withdrawal_date);
    insert into dashboard_private.ops_registration_mutations(actor_id,request_key,task_id,mutation_type,target_fingerprint,response_payload)
    values(v_actor_id,v_request_key,p_task_id,'complete_withdrawal_roster_transition',v_target_fingerprint,v_response);
    return v_response;
  end if;
$previous$;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor)
    or strpos(v_definition, 'withdrawal_release_scheduler_not_ready') > 0 then
    raise exception 'withdrawal_immediate_rollback_core_version_mismatch' using errcode = '55000';
  end if;
  execute replace(v_definition,v_anchor,v_previous);
end;
$rollback_completion$;
do $rollback_worker$
declare
  v_target regprocedure := 'dashboard_private.process_due_withdrawal_roster_releases_v1(integer)'::regprocedure;
  v_definition text;
  v_anchor text := '  perform dashboard_private.retire_withdrawal_roster_release_scheduler_v1();' || E'\n';
begin
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor) then
    raise exception 'withdrawal_immediate_rollback_worker_version_mismatch' using errcode = '55000';
  end if;
  execute replace(v_definition,v_anchor,'');
end;
$rollback_worker$;
drop function dashboard_private.retire_withdrawal_roster_release_scheduler_v1();
drop trigger reject_new_withdrawal_roster_release_v1 on dashboard_private.withdrawal_roster_release_queue_v1;
drop function dashboard_private.reject_new_withdrawal_roster_release_v1();
create or replace function public.withdrawal_last_lesson_release_runtime_version()
returns text language sql stable security invoker set search_path = '' as $$
  select 'withdrawal_completion_without_settlement_v2'::text;
$$;
-- Old completion requires the exact scheduler for same-day/future requests.
-- The manager fails closed on ownership/command drift. No worker runs here.
select public.manage_withdrawal_roster_release_scheduler_v1('install');
commit;
