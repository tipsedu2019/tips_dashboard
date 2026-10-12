begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Patch only the final completion core. Submission stays independent of done;
-- a future last lesson cannot complete or remove a roster. No queue is drained
-- by this installer, and no existing snapshot or student is deleted.
do $withdrawal_immediate_completion$
declare
  v_target regprocedure := 'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'::regprocedure;
  v_definition text; v_start integer; v_finish integer;
  v_owner oid; v_acl aclitem[]; v_after_owner oid; v_after_acl aclitem[];
  v_anchor text := $anchor$  if v_roster_mode = 'enrolled'
    and v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then$anchor$;
  v_end text := '  -- verification_checkpoint_withdrawal_before_status_flip';
begin
  select proowner, proacl into v_owner, v_acl from pg_catalog.pg_proc where oid = v_target;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  v_start := strpos(v_definition, v_anchor);
  v_finish := strpos(v_definition, v_end);
  if v_start = 0 or v_finish <= v_start
    or (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor)
    or (length(v_definition)-length(replace(v_definition,v_end,''))) <> length(v_end)
    or strpos(v_definition, 'withdrawal_completion_validation') = 0
    or strpos(v_definition, 'withdrawal_release_scheduler_not_ready') = 0
    or strpos(v_definition, '-- withdrawal_receipt_lookup') = 0
    or strpos(v_definition, '-- withdrawal_claim_locks') = 0 then
    raise exception 'withdrawal_immediate_completion_core_version_mismatch' using errcode = '55000';
  end if;
  v_definition := substring(v_definition from 1 for v_start - 1)
    || $replacement$  -- Last-lesson-day completion follows the finished lesson. Reject future
  -- dates for both enrolled and already removed students without any mutation.
  if v_detail.withdrawal_date > (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception 'withdrawal_last_lesson_date_in_future' using errcode = '23514';
  end if;
$replacement$
    || substring(v_definition from v_finish);
  if strpos(v_definition, 'withdrawal_release_scheduler_not_ready') > 0
    or strpos(v_definition, 'insert into dashboard_private.withdrawal_roster_release_queue_v1') > 0
    or strpos(v_definition, 'withdrawal_release_schedule_validation') > 0 then
    raise exception 'withdrawal_immediate_completion_schedule_remaining' using errcode = '55000';
  end if;
  execute v_definition;
  select proowner, proacl into v_after_owner, v_after_acl from pg_catalog.pg_proc where oid = v_target;
  if v_owner is distinct from v_after_owner or v_acl is distinct from v_after_acl then
    raise exception 'withdrawal_immediate_completion_acl_changed' using errcode = '55000';
  end if;
end;
$withdrawal_immediate_completion$;

-- CREATE TRIGGER takes the queue relation lock: an already uncommitted old
-- INSERT finishes before installation can retire an empty queue. An old cached
-- completion that inserts after installation is refused and fully rolls back.
-- This closes the transition race without deleting or rewriting legacy rows.
create function dashboard_private.reject_new_withdrawal_roster_release_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'withdrawal_release_new_reservation_retired' using errcode = '23514';
end;
$$;
revoke all on function dashboard_private.reject_new_withdrawal_roster_release_v1() from public, anon, authenticated, service_role;
create trigger reject_new_withdrawal_roster_release_v1
before insert on dashboard_private.withdrawal_roster_release_queue_v1
for each row execute function dashboard_private.reject_new_withdrawal_roster_release_v1();

-- Internal only. A legacy pending row (including future/backoff/failure) keeps
-- the original scheduler until its existing D+1 worker safely resolves it.
-- Never remove an ambiguous/drifted job or interfere with an in-flight batch.
create function dashboard_private.retire_withdrawal_roster_release_scheduler_v1()
returns text language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_count integer; v_matches boolean; v_removed boolean;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('tips-withdrawal-roster-release-worker-v1',0)) then
    return 'busy';
  end if;
  if exists (select 1 from dashboard_private.withdrawal_roster_release_queue_v1 where status='pending') then
    return 'pending';
  end if;
  if pg_catalog.to_regclass('cron.job') is null
    or pg_catalog.to_regprocedure('cron.unschedule(text)') is null then
    return 'unavailable';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('tips-withdrawal-roster-release-v1',0)) then
    return 'busy';
  end if;
  execute $query$select count(*), bool_and(
      schedule='* * * * *' and username='postgres' and database=pg_catalog.current_database()
      and command='set transaction_timeout = ''0''; set transaction_timeout = ''30s''; set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();')
    from cron.job where jobname='tips-withdrawal-roster-release-v1'$query$ into v_count, v_matches;
  if v_count=0 then return 'absent'; end if;
  if v_count<>1 or v_matches is distinct from true then return 'drifted'; end if;
  execute $stop$select cron.unschedule('tips-withdrawal-roster-release-v1')$stop$ into v_removed;
  if v_removed is distinct from true then
    raise exception 'withdrawal_release_scheduler_retirement_failed' using errcode = '55000';
  end if;
  return 'removed';
end;
$$;
alter function dashboard_private.retire_withdrawal_roster_release_scheduler_v1() owner to postgres;
revoke all on function dashboard_private.retire_withdrawal_roster_release_scheduler_v1() from public, anon, authenticated, service_role;

-- Keep the original batch, cutoff, locks, generation checks, no-send behavior,
-- and response contract. Retirement is attempted after the last legacy row.
do $withdrawal_worker_retirement$
declare
  v_target regprocedure := 'dashboard_private.process_due_withdrawal_roster_releases_v1(integer)'::regprocedure;
  v_definition text; v_owner oid; v_acl aclitem[]; v_after_owner oid; v_after_acl aclitem[];
  v_anchor text := $anchor$  return pg_catalog.jsonb_build_object('applied',v_applied,'superseded',v_superseded,'failed',v_failed);$anchor$;
begin
  select proowner, proacl into v_owner, v_acl from pg_catalog.pg_proc where oid = v_target;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if (length(v_definition)-length(replace(v_definition,v_anchor,''))) <> length(v_anchor)
    or strpos(v_definition, 'retire_withdrawal_roster_release_scheduler_v1') > 0 then
    raise exception 'withdrawal_worker_retirement_version_mismatch' using errcode = '55000';
  end if;
  execute replace(v_definition, v_anchor,
    '  perform dashboard_private.retire_withdrawal_roster_release_scheduler_v1();' || E'\n' || v_anchor);
  select proowner, proacl into v_after_owner, v_after_acl from pg_catalog.pg_proc where oid = v_target;
  if v_owner is distinct from v_after_owner or v_acl is distinct from v_after_acl then
    raise exception 'withdrawal_worker_retirement_acl_changed' using errcode = '55000';
  end if;
end;
$withdrawal_worker_retirement$;

-- Preserve the existing capability RPC's owner and ACL, but make the new app
-- fail closed against a runtime with the earlier scheduling contract.
create or replace function public.withdrawal_last_lesson_release_runtime_version()
returns text language sql stable security invoker set search_path = '' as $$
  select 'withdrawal_immediate_completion_v3'::text;
$$;

-- Empty queues permit removal now. Pending queues are left byte-for-byte
-- intact; the existing worker will retire only after the queue becomes empty.
select dashboard_private.retire_withdrawal_roster_release_scheduler_v1();
commit;
