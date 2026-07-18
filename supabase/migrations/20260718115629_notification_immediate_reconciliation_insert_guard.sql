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

  if new.status = 'pending'
    and new.attempt_count = 0
    and new.claimed_by is null
    and new.claim_token is null
    and new.lease_expires_at is null
    and new.completed_at is null
    and v_immediate_only
  then
    new.status := 'succeeded';
    new.next_attempt_at := null;
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

commit;
