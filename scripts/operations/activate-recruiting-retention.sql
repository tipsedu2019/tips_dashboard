-- Explicit operational activation, outside the automatic migration chain.
-- Run as the approved privileged database operator only after the recruiting
-- migration succeeds, while RECRUITING_APPLICATIONS_ENABLED remains false.
-- This schedules recurring deletion and immediately purges expired records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$ begin
  if to_regclass('cron.job') is null then
    raise exception 'recruiting_requires_pg_cron' using errcode = '55000';
  end if;
  if to_regprocedure('public.purge_expired_recruiting_applications_v1()') is null then
    raise exception 'recruiting_migration_required' using errcode = '55000';
  end if;
end $$;

-- pg_cron reuses the named job for the same operator, so retries do not add jobs.
select cron.schedule('recruiting-retention-cleanup', '13 * * * *', 'select public.purge_expired_recruiting_applications_v1();');
select public.purge_expired_recruiting_applications_v1();
commit;
