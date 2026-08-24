begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ops_registration_enrollments
  validate constraint ops_registration_enrollments_roster_release_kind_check;
alter table public.ops_registration_enrollments
  validate constraint ops_registration_enrollments_roster_state_check_v2;

commit;
