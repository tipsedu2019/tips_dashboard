alter table public.ops_registration_details
  add column if not exists level_test_result text,
  add column if not exists principal_review_note text,
  add column if not exists principal_placement_checked boolean not null default false;
