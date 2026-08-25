begin;

select plan(22);

select has_function(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'final reminder claim exists'
);
select has_function(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'final reminder backlog check exists'
);
select function_privs_are(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'service_role', array['EXECUTE'], 'claim remains service-only'
);
select function_privs_are(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'authenticated', array[]::text[], 'browser roles cannot claim reminder work'
);
select function_privs_are(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'service_role', array['EXECUTE'], 'backlog check remains service-only'
);
select function_privs_are(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'authenticated', array[]::text[], 'browser roles cannot inspect reminder backlog'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    ) ~ 'verification_scope_changed'
      and pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      ) ~ 'pre_cutoff_backlog'
      and pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      ) ~ 'source_ineligible'
      and pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      ) ~ 'booking_fact_changed'
  ),
  'final claim terminalizes every observation policy drift before a marker'
);
select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    ) ~ 'join dashboard_private.registration_customer_solapi_activation activation'
      and pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      ) ~ 'join dashboard_private.registration_customer_solapi_template_receipts receipt'
      and pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      ) ~ 'provider_status = ''sendable'''
  ),
  'bounded candidate page excludes activation and receipt blockers before LIMIT'
);
select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    ) !~ 'message_kind = v_job.message_kind[^;]+for share'
  ),
  'claim does not invert the activation setter lock order'
);
select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    ) !~ 'registration_customer_reminder_worker_heartbeats'
  ),
  'final claim does not reintroduce the legacy heartbeat write'
);
select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
    ) ~ 'registration_customer_solapi_template_receipts'
      and pg_catalog.pg_get_functiondef(
        'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
      ) ~ 'registration_customer_solapi_live_evidence_valid_v1'
      and pg_catalog.pg_get_functiondef(
        'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
      ) ~ 'automatic_delivery_cutoff_at'
  ),
  'final backlog uses the same configuration and evidence gates'
);
select is(
  (
    select proc.proowner = 'postgres'::regrole
      and proc.prosecdef
      and proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.claim_registration_customer_reminder_job_v1()'::regprocedure
  ),
  true,
  'claim keeps postgres ownership, SECURITY DEFINER, and an empty search path'
);
select is(
  (
    select proc.proowner = 'postgres'::regrole
      and proc.prosecdef
      and proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
  ),
  true,
  'backlog keeps postgres ownership, SECURITY DEFINER, and an empty search path'
);

select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::regprocedure
    )) ~ 'registration_customer_reminder_booking_fact_changed''[[:space:]]+using errcode = ''p0001'''
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::regprocedure
      )) !~ 'registration_customer_reminder_booking_fact_changed''[[:space:]]+using errcode = ''40001'''
  ),
  'final resolver exposes booking-fact drift as exact non-retryable P0001'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.read_registration_customer_reminder_source_v1(uuid,uuid)'::regprocedure
    )) ~ 'registration_customer_reminder_booking_fact_changed'' using errcode = ''p0001'''
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.read_registration_customer_reminder_source_v1(uuid,uuid)'::regprocedure
      )) !~ 'registration_customer_reminder_booking_fact_changed'' using errcode = ''40001'''
  ),
  'final worker source read preserves the same exact P0001 drift contract'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::regprocedure
    )) ~ 'when sqlstate ''p0001'' then[[:space:]]+if sqlerrm <> ''registration_customer_reminder_booking_fact_changed'' then[[:space:]]+raise;[[:space:]]+end if;'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::regprocedure
      )) !~ 'when sqlstate ''40001'' then[[:space:]]+update dashboard_private.registration_customer_reminder_jobs'
  ),
  'final begin classifies only the exact P0001 booking-fact drift message'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    )) ~ 'when sqlstate ''p0001'' then[[:space:]]+if sqlerrm <> ''registration_customer_reminder_booking_fact_changed'' then[[:space:]]+raise;[[:space:]]+end if;'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      )) !~ 'when others then'
  ),
  'final claim does not swallow unrelated resolver failures'
);

grant execute on function public.claim_registration_customer_reminder_job_v1()
  to authenticated;
grant execute on function public.has_registration_customer_reminder_backlog_v1()
  to authenticated;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.claim_registration_customer_reminder_job_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'claim rejects browser roles before protected reads'
);
select throws_ok(
  $$select public.has_registration_customer_reminder_backlog_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'backlog rejects browser roles before protected reads'
);
reset role;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from authenticated;
revoke all on function public.has_registration_customer_reminder_backlog_v1()
  from authenticated;

create temporary table final_claim_marker_baseline as
select count(*) as marker_count
from public.ops_registration_customer_messages
where provider_attempt_count = 1;

alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
insert into dashboard_private.registration_customer_reminder_settings(
  singleton, enabled, lead_hours, revision
) values (true, false, 3, 1)
on conflict (singleton) do update
set enabled = false;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.claim_registration_customer_reminder_job_v1(),
  null::jsonb,
  'disabled reminder settings return no claim'
);
select is(
  public.has_registration_customer_reminder_backlog_v1(),
  false,
  'disabled reminder settings report no backlog'
);
reset role;
select is(
  (select count(*)
   from public.ops_registration_customer_messages message
   where message.provider_attempt_count = 1)
    - (select marker_count from final_claim_marker_baseline),
  0::bigint,
  'final gate checks add no provider marker while disabled'
);

select * from finish();
rollback;
