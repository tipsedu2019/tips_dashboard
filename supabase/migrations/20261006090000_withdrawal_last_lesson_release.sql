begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Completion records an immutable end-of-day reservation. Current reciprocal
-- arrays and active claims remain live through the last lesson's KST date.
-- Unclaimed completed tasks may still be deleted: their reservation survives.
-- A claimed pending reservation temporarily protects its source task. Once
-- resolved, only the original claim's release-source FK may protect that task.
create table dashboard_private.withdrawal_roster_release_queue_v1 (
  task_id uuid primary key,
  claim_source_task_id uuid references public.ops_tasks(id) on delete restrict,
  student_id uuid not null,
  class_id uuid not null,
  expected_claim_id uuid,
  expected_history_count bigint not null check (expected_history_count >= 0),
  last_lesson_date date not null,
  actor_id uuid,
  status text not null default 'pending' check (status in ('pending','applied','superseded')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  last_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  applied_at timestamptz,
  resolved_at timestamptz,
  check ((status='pending' and expected_claim_id is not null
      and claim_source_task_id is not null and claim_source_task_id=task_id)
    or ((expected_claim_id is null or status<>'pending') and claim_source_task_id is null)),
  check ((status = 'pending' and resolved_at is null and applied_at is null)
    or (status = 'applied' and resolved_at is not null and applied_at is not null)
    or (status = 'superseded' and resolved_at is not null and applied_at is null))
);
alter table dashboard_private.withdrawal_roster_release_queue_v1 enable row level security;
revoke all on dashboard_private.withdrawal_roster_release_queue_v1 from public, anon, authenticated, service_role;
create unique index withdrawal_roster_release_pending_pair_v1
  on dashboard_private.withdrawal_roster_release_queue_v1(student_id,class_id) where status='pending';
create index withdrawal_roster_release_due_v1
  on dashboard_private.withdrawal_roster_release_queue_v1(last_lesson_date,next_attempt_at,task_id) where status='pending';
create index withdrawal_roster_release_history_pair_v1
  on public.student_class_enrollment_history(student_id,class_id);

create function dashboard_private.guard_withdrawal_roster_release_snapshot_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception 'withdrawal_release_snapshot_immutable' using errcode='23514';
  end if;
  if (new.task_id,new.student_id,new.class_id,new.expected_claim_id,
      new.expected_history_count,new.last_lesson_date,new.actor_id,new.created_at)
    is distinct from
     (old.task_id,old.student_id,old.class_id,old.expected_claim_id,
      old.expected_history_count,old.last_lesson_date,old.actor_id,old.created_at)
    or old.status<>'pending'
    or (new.claim_source_task_id is distinct from old.claim_source_task_id
      and not (old.status='pending' and new.status in('applied','superseded') and new.claim_source_task_id is null))
  then
    raise exception 'withdrawal_release_snapshot_immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function dashboard_private.guard_withdrawal_roster_release_snapshot_v1() from public,anon,authenticated,service_role;
create trigger guard_withdrawal_roster_release_snapshot_v1
before update or delete on dashboard_private.withdrawal_roster_release_queue_v1
for each row execute function dashboard_private.guard_withdrawal_roster_release_snapshot_v1();

create function dashboard_private.withdrawal_roster_release_scheduler_ready_v1()
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_ready boolean;
begin
  if pg_catalog.to_regclass('cron.job') is null then return false; end if;
  execute $query$select count(*)=1 and coalesce(bool_and(
    schedule='* * * * *'
    and command='set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();'
    and active and username='postgres' and database=pg_catalog.current_database()),false)
    from cron.job where jobname='tips-withdrawal-roster-release-v1'$query$ into v_ready;
  return v_ready;
end;
$$;
alter function dashboard_private.withdrawal_roster_release_scheduler_ready_v1() owner to postgres;
revoke all on function dashboard_private.withdrawal_roster_release_scheduler_ready_v1() from public,anon,authenticated,service_role;

-- Apply one due reservation without calling a completion/notification wrapper
-- and without setting any authenticated user's JWT or role claims.
create function dashboard_private.apply_scheduled_withdrawal_roster_release_v1(p_task_id uuid)
returns text language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  v_release dashboard_private.withdrawal_roster_release_queue_v1%rowtype;
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task public.ops_tasks%rowtype;
  v_pre_parent_ids uuid[];
  v_current_parent_ids uuid[];
  v_history_count bigint;
  v_claim_count integer;
  v_claim_id uuid;
  v_actor_id uuid;
  v_name_key text;
  v_parent_phone_key text;
  v_task_exists boolean;
  v_superseded boolean := false;
  v_next_status text;
begin
  select * into v_release from dashboard_private.withdrawal_roster_release_queue_v1 where task_id=p_task_id;
  if not found or v_release.status<>'pending' then return 'unchanged'; end if;
  if v_release.last_lesson_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    return 'not_due';
  end if;
  select coalesce(pg_catalog.array_agg(distinct track.task_id order by track.task_id),array[]::uuid[])
  into v_pre_parent_ids from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id=enrollment.track_id
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active;
  -- Preserve the completion gateway's parent -> track -> student -> batch ->
  -- claim -> class lock order; take the queue row only after these domain locks.
  perform 1 from public.ops_tasks task
  where task.id=p_task_id or task.id=any(v_pre_parent_ids) order by task.id for update;
  select * into v_task from public.ops_tasks where id=p_task_id;
  v_task_exists := found;
  if v_task_exists and (v_task.type<>'withdrawal' or v_task.status<>'done'
    or v_task.student_id is distinct from v_release.student_id
    or v_task.class_id is distinct from v_release.class_id) then v_superseded:=true; end if;
  if not v_task_exists and v_release.expected_claim_id is not null then v_superseded:=true; end if;
  perform 1 from public.ops_registration_subject_tracks track
  where track.task_id=any(v_pre_parent_ids) order by track.id for update;
  select * into v_student from public.students where id=v_release.student_id;
  if found then
    v_name_key:=pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name,''),'\s+','','g'));
    v_parent_phone_key:=pg_catalog.regexp_replace(coalesce(v_student.parent_contact,''),'\D+','','g');
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,0));
  end if;
  select * into v_student from public.students where id=v_release.student_id for update;
  if not found then
    v_superseded:=true;
  elsif pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name,''),'\s+','','g')) is distinct from v_name_key
    or pg_catalog.regexp_replace(coalesce(v_student.parent_contact,''),'\D+','','g') is distinct from v_parent_phone_key then
    raise exception 'registration_workflow_retry_required' using errcode='40001';
  end if;
  select coalesce(pg_catalog.array_agg(distinct track.task_id order by track.task_id),array[]::uuid[])
  into v_current_parent_ids from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id=enrollment.track_id
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active;
  if v_current_parent_ids is distinct from v_pre_parent_ids then
    raise exception 'registration_workflow_retry_required' using errcode='40001';
  end if;
  perform 1 from public.ops_registration_admission_batches batch
  where batch.task_id=any(v_current_parent_ids) order by batch.id for update;
  perform 1 from public.ops_registration_enrollments enrollment
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active
  order by enrollment.id for update;
  select * into v_class from public.classes where id=v_release.class_id for update;
  if not found then v_superseded:=true; end if;
  select * into v_release from dashboard_private.withdrawal_roster_release_queue_v1 where task_id=p_task_id for update;
  if v_release.status<>'pending' then return 'unchanged'; end if;
  if v_release.last_lesson_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then return 'not_due'; end if;
  select count(*) into v_history_count from public.student_class_enrollment_history
  where student_id=v_release.student_id and class_id=v_release.class_id;
  select count(*),(pg_catalog.array_agg(id order by id))[1] into v_claim_count,v_claim_id
  from public.ops_registration_enrollments where student_id=v_release.student_id and class_id=v_release.class_id and roster_active;
  if v_history_count<>v_release.expected_history_count or v_claim_count>1
    or v_claim_id is distinct from v_release.expected_claim_id
    or not (coalesce(v_student.class_ids,'[]'::jsonb) ? v_release.class_id::text)
    or coalesce(v_student.waitlist_class_ids,'[]'::jsonb) ? v_release.class_id::text
    or not (coalesce(v_class.student_ids,'[]'::jsonb) ? v_release.student_id::text)
    or coalesce(v_class.waitlist_ids,'[]'::jsonb) ? v_release.student_id::text
  then v_superseded:=true; end if;
  if v_claim_id is not null then
    select * into v_claim from public.ops_registration_enrollments where id=v_claim_id;
    if v_claim.status<>'enrolled' then v_superseded:=true; end if;
    if exists(select 1 from public.ops_registration_admission_batches where id=v_claim.admission_batch_id and status not in('completed','canceled')) then
      v_superseded:=true;
    end if;
  end if;
  if v_superseded then
    update dashboard_private.withdrawal_roster_release_queue_v1
    set status='superseded',claim_source_task_id=null,resolved_at=pg_catalog.clock_timestamp(),last_error_code='withdrawal_release_generation_changed'
    where task_id=p_task_id;
    return 'superseded';
  end if;
  if v_student.status is distinct from '재원' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode='23514';
  end if;
  -- The original actor is attribution only, never a synthesized auth session.
  select id into v_actor_id from auth.users where id=v_release.actor_id;
  perform dashboard_private.apply_student_class_roster_mode(
    v_release.student_id,v_release.class_id,'removed','enrolled',v_claim_id,'withdrawal_scheduled_release',v_actor_id);
  if v_claim_id is not null then
    update public.ops_registration_enrollments
    set roster_active=false,roster_released_at=pg_catalog.clock_timestamp(),roster_release_reason='withdrawal_completed',
      roster_release_source_task_id=p_task_id,roster_release_kind='withdrawal',updated_at=pg_catalog.clock_timestamp()
    where id=v_claim_id and status='enrolled' and roster_active;
    if not found then raise exception 'withdrawal_release_claim_changed' using errcode='23514'; end if;
    select * into v_track from public.ops_registration_subject_tracks where id=v_claim.track_id;
    if not found then raise exception 'withdrawal_release_track_missing' using errcode='23514'; end if;
    -- Preserve the registration history schema without the user-only event
    -- writer, which could create a notification source or require a fake JWT.
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value)
    values(v_track.task_id,null,'registration_track_event','registration_track:' || v_track.id::text,null,
      pg_catalog.jsonb_build_object('version',2,'event_type','registration_enrollment_roster_released',
        'actor_profile_id',null,'actor_kind','system','system_source','withdrawal_scheduled_release',
        'track_id',v_track.id,'subject',v_track.subject,'source',v_track.pipeline_status,
        'destination',v_track.pipeline_status,'reason_code','withdrawal_completed',
        'metadata',pg_catalog.jsonb_build_object('enrollmentId',v_claim_id,'sourceTaskId',p_task_id,'releaseKind','withdrawal',
          'enrollmentSnapshot',pg_catalog.jsonb_build_object('id',v_claim.id,'classId',v_claim.class_id,
            'textbookId',v_claim.textbook_id,'admissionBatchId',v_claim.admission_batch_id,
            'classStartDate',v_claim.class_start_date,'classStartSessionKey',v_claim.class_start_session_key,
            'classStartSession',v_claim.class_start_session,'status',v_claim.status,'sortOrder',v_claim.sort_order)),
        'occurred_at',pg_catalog.clock_timestamp())::text);
    perform dashboard_private.recompute_registration_parent(v_track.task_id);
  end if;
  select * into v_student from public.students where id=v_release.student_id;
  v_next_status:=case when pg_catalog.jsonb_array_length(coalesce(v_student.class_ids,'[]'::jsonb))
    + pg_catalog.jsonb_array_length(coalesce(v_student.waitlist_class_ids,'[]'::jsonb))
    + (select count(*) from public.ops_registration_enrollments where student_id=v_release.student_id and roster_active)=0
    then '퇴원' else '재원' end;
  if v_next_status='퇴원' then
    update public.students set status='퇴원' where id=v_release.student_id and status='재원';
    if not found then raise exception 'withdrawal_release_student_status_conflict' using errcode='23514'; end if;
  end if;
  if v_task_exists then
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value)
    values(p_task_id,null,'auto_synced','수업명단','기준일까지 유지','제외 적용 · withdrawal_scheduled_release');
  end if;
  update dashboard_private.withdrawal_roster_release_queue_v1
  set status='applied',claim_source_task_id=null,applied_at=pg_catalog.clock_timestamp(),resolved_at=pg_catalog.clock_timestamp(),last_error_code=null
  where task_id=p_task_id;
  return 'applied';
end;
$$;
alter function dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid) owner to postgres;
revoke all on function dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid) from public,anon,authenticated,service_role;

create function dashboard_private.process_due_withdrawal_roster_releases_v1(p_batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_task_id uuid; v_outcome text; v_error_code text; v_applied integer:=0; v_superseded integer:=0; v_failed integer:=0;
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception 'withdrawal_release_batch_invalid' using errcode='22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('tips-withdrawal-roster-release-worker-v1',0)) then
    return pg_catalog.jsonb_build_object('applied',0,'superseded',0,'failed',0,'busy',true);
  end if;
  for v_task_id in select task_id from dashboard_private.withdrawal_roster_release_queue_v1
    where status='pending' and last_lesson_date<(pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date
      and next_attempt_at<=pg_catalog.clock_timestamp() order by last_lesson_date,task_id limit p_batch_size
  loop
    begin
      v_outcome:=dashboard_private.apply_scheduled_withdrawal_roster_release_v1(v_task_id);
      if v_outcome='applied' then v_applied:=v_applied+1; end if;
      if v_outcome='superseded' then v_superseded:=v_superseded+1; end if;
    exception when others then
      get stacked diagnostics v_error_code=returned_sqlstate;
      update dashboard_private.withdrawal_roster_release_queue_v1 set attempt_count=attempt_count+1,
        last_error_code=v_error_code,next_attempt_at=pg_catalog.clock_timestamp()+interval '1 minute'
      where task_id=v_task_id and status='pending';
      v_failed:=v_failed+1;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('applied',v_applied,'superseded',v_superseded,'failed',v_failed);
end;
$$;
alter function dashboard_private.process_due_withdrawal_roster_releases_v1(integer) owner to postgres;
revoke all on function dashboard_private.process_due_withdrawal_roster_releases_v1(integer) from public,anon,authenticated,service_role;

-- Installing this migration does not activate the scheduler. An explicit release
-- operation may install/disable/remove this database-only cron after verification.
-- The cron session bounds the whole SELECT to 30s; a function-local setting
-- would not reliably restart the calling statement's timeout timer.
create function public.manage_withdrawal_roster_release_scheduler_v1(p_action text default 'inspect')
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_job_id bigint; v_jobs jsonb; v_count integer; v_matches boolean; v_active boolean;
begin
  if p_action is null or p_action not in('inspect','install','disable','remove') then
    raise exception 'withdrawal_release_scheduler_action_invalid' using errcode='22023';
  end if;
  if pg_catalog.to_regclass('cron.job') is null
    or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
    or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    if p_action='inspect' then return pg_catalog.jsonb_build_object('available',false,'ready',false); end if;
    raise exception 'withdrawal_release_scheduler_unavailable' using errcode='55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tips-withdrawal-roster-release-v1',0));
  execute 'select count(*) from cron.job where jobname=$1' into v_count using 'tips-withdrawal-roster-release-v1';
  if p_action='install' then
    if v_count>1 then raise exception 'withdrawal_release_scheduler_ambiguous' using errcode='55000'; end if;
    if v_count=1 then
      execute $query$select bool_and(schedule='* * * * *'
        and command='set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();'
        and username='postgres' and database=pg_catalog.current_database()), bool_and(active), min(jobid)
        from cron.job where jobname='tips-withdrawal-roster-release-v1'$query$ into v_matches, v_active, v_job_id;
      if v_matches is distinct from true then
        raise exception 'withdrawal_release_scheduler_drift' using errcode='55000';
      end if;
      -- Named schedule preserves an existing job's active flag. Recreate an
      -- inactive exact job so activation needs no additional extension grants.
      if v_active is distinct from true then
        execute 'select cron.unschedule($1)' using v_job_id;
      end if;
    end if;
    -- Named schedule creates or refreshes only this owner's exact job. Managed
    -- Supabase may deny postgres direct cron.job UPDATE and cron.alter_job.
    execute 'select cron.schedule($1,$2,$3)' into v_job_id using 'tips-withdrawal-roster-release-v1','* * * * *',
      'set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();';
  elsif p_action in('disable','remove') then
    -- Stopping unschedules the job; it preserves pending reservations and does
    -- not cancel an in-flight worker. A later install may return a new job ID.
    for v_job_id in execute 'select jobid from cron.job where jobname=$1' using 'tips-withdrawal-roster-release-v1'
    loop execute 'select cron.unschedule($1)' using v_job_id; end loop;
  end if;
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''jobId'',jobid,''schedule'',schedule,''active'',active) order by jobid),''[]''::jsonb)
    from cron.job where jobname=$1' into v_jobs using 'tips-withdrawal-roster-release-v1';
  return pg_catalog.jsonb_build_object('available',true,'ready',dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'jobs',v_jobs);
end;
$$;
alter function public.manage_withdrawal_roster_release_scheduler_v1(text) owner to postgres;
revoke all on function public.manage_withdrawal_roster_release_scheduler_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.manage_withdrawal_roster_release_scheduler_v1(text) to service_role;

-- Patch the final ordered core, preserving its existing permission checks, locks,
-- claim/checklist validation, receipt replay and the late immediate-release path.
do $withdrawal_release_core_patch$
declare
  v_target regprocedure:='dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'::regprocedure;
  v_definition text; v_owner oid; v_acl aclitem[]; v_after_owner oid; v_after_acl aclitem[];
  v_anchor text:=$anchor$  -- verification_checkpoint_withdrawal_before_status_flip$anchor$;
  v_patch text:=$patch$
  if v_detail.withdrawal_date is null then
    raise exception 'withdrawal_last_lesson_date_required' using errcode='23514';
  end if;
  -- Protect a current reservation from every second completion, including a
  -- task with a past date that would otherwise take the immediate-release path.
  -- A manual removal/restoration or a new enrollment owns a new generation.
  update dashboard_private.withdrawal_roster_release_queue_v1 previous
  set status='superseded',claim_source_task_id=null,resolved_at=pg_catalog.clock_timestamp(),last_error_code='withdrawal_release_generation_changed'
  where previous.student_id=v_student_id and previous.class_id=v_source_class_id and previous.status='pending'
    and (previous.expected_claim_id is distinct from v_claim_id or previous.expected_history_count<>
      (select count(*) from public.student_class_enrollment_history
       where student_id=v_student_id and class_id=v_source_class_id));
  if exists(select 1 from dashboard_private.withdrawal_roster_release_queue_v1
    where student_id=v_student_id and class_id=v_source_class_id and status='pending') then
    raise exception 'withdrawal_release_already_scheduled' using errcode='23514';
  end if;
  if v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
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
    where task_id=p_task_id and not timetable_roster_updated;
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
  -- verification_checkpoint_withdrawal_before_status_flip$patch$;
begin
  select proowner,proacl into v_owner,v_acl from pg_catalog.pg_proc where oid=v_target;
  v_definition:=pg_catalog.pg_get_functiondef(v_target);
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))<>length(v_anchor)
    or strpos(v_definition,'withdrawal_release_scheduler_not_ready')>0
    or strpos(v_definition,'-- withdrawal_receipt_lookup')=0
    or strpos(v_definition,'-- withdrawal_claim_locks')=0 then
    raise exception 'withdrawal_release_core_patch_target_missing' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,v_patch);
  select proowner,proacl into v_after_owner,v_after_acl from pg_catalog.pg_proc where oid=v_target;
  if v_after_owner is distinct from v_owner or v_after_acl is distinct from v_acl then
    raise exception 'withdrawal_release_core_patch_metadata_changed' using errcode='55000';
  end if;
end;
$withdrawal_release_core_patch$;

create function public.withdrawal_last_lesson_release_runtime_version()
returns text language sql stable security invoker set search_path='' as $$
  select 'withdrawal_last_lesson_release_v1'::text;
$$;
alter function public.withdrawal_last_lesson_release_runtime_version() owner to postgres;
revoke all on function public.withdrawal_last_lesson_release_runtime_version() from public,anon,authenticated,service_role;
grant execute on function public.withdrawal_last_lesson_release_runtime_version() to authenticated;

create function public.complete_ops_withdrawal_roster_transition_v3(p_task_id uuid,p_request_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(p_task_id,p_request_id);
$$;
alter function public.complete_ops_withdrawal_roster_transition_v3(uuid,uuid) owner to postgres;
revoke all on function public.complete_ops_withdrawal_roster_transition_v3(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_ops_withdrawal_roster_transition_v3(uuid,uuid) to authenticated;

commit;
