begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep validation in a later ledger unit than the NOT VALID additions.  A
-- timeout rolls this entire unit back, so the migration can be retried without
-- colliding with columns or constraints already committed by 110600.
alter table public.ops_registration_subject_tracks
  validate constraint ops_registration_subject_tracks_archived_by_fkey;

alter table public.ops_registration_subject_tracks
  validate constraint ops_registration_subject_tracks_archive_pair_check;

commit;
