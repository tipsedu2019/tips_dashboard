begin;

create or replace function dashboard_private.complete_immediate_notification_rule_reconciliation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_immediate_only boolean := false;
begin
  select
    pg_catalog.count(*) = (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(new.rule_revision_map)
    )
    and pg_catalog.count(*) > 0
    and coalesce(
      pg_catalog.bool_and(rule_row.delivery_mode = 'immediate'),
      false
    )
  into v_immediate_only
  from pg_catalog.jsonb_object_keys(new.rule_revision_map) changed(rule_id)
  join dashboard_private.notification_rules rule_row
    on rule_row.id::text = changed.rule_id
   and rule_row.workflow_key = new.workflow_key;

  if v_immediate_only then
    new.status := 'succeeded';
    new.next_attempt_at := null;
    new.claimed_by := null;
    new.claim_token := null;
    new.lease_expires_at := null;
    new.last_error_code := null;
    new.completed_at := pg_catalog.clock_timestamp();
    new.updated_at := new.completed_at;
  end if;

  return new;
end;
$$;

alter function dashboard_private.complete_immediate_notification_rule_reconciliation_v1()
  owner to postgres;
revoke all on function dashboard_private.complete_immediate_notification_rule_reconciliation_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists notification_rule_reconciliation_complete_immediate_v1
  on dashboard_private.notification_rule_reconciliation_jobs;
create trigger notification_rule_reconciliation_complete_immediate_v1
before insert on dashboard_private.notification_rule_reconciliation_jobs
for each row
execute function dashboard_private.complete_immediate_notification_rule_reconciliation_v1();

with immediate_jobs as (
  select job.id
  from dashboard_private.notification_rule_reconciliation_jobs job
  where job.status = 'pending'
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(job.rule_revision_map)
    ) > 0
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(job.rule_revision_map) changed(rule_id)
      join dashboard_private.notification_rules rule_row
        on rule_row.id::text = changed.rule_id
       and rule_row.workflow_key = job.workflow_key
    ) = (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(job.rule_revision_map)
    )
    and (
      select coalesce(
        pg_catalog.bool_and(rule_row.delivery_mode = 'immediate'),
        false
      )
      from pg_catalog.jsonb_object_keys(job.rule_revision_map) changed(rule_id)
      join dashboard_private.notification_rules rule_row
        on rule_row.id::text = changed.rule_id
       and rule_row.workflow_key = job.workflow_key
    )
)
update dashboard_private.notification_rule_reconciliation_jobs job
set status = 'succeeded',
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    last_error_code = null,
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
from immediate_jobs
where job.id = immediate_jobs.id;

commit;
