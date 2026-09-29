begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Audit identities/snapshots must survive the existing class/account lifecycle,
-- without preventing a deletion or cascading away the execution receipt.
-- Issuers and target classes are validated by the gateway at execution time.
alter table dashboard_private.agent_credentials
  drop constraint agent_credentials_created_by_fkey;
alter table dashboard_private.agent_previews
  drop constraint agent_previews_class_id_fkey;
alter table dashboard_private.agent_operations
  drop constraint agent_operations_actor_profile_id_fkey;
commit;
