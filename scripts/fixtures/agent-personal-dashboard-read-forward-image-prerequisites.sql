-- Fresh owned synthetic DB only. The unchanged signup-confirmation migration
-- references this managed Auth field. The prior offline replay supplies the
-- same nullable timestamptz. No confirmation, identity or authority is forged.
-- Applied after the untouched baseline comparison; its Auth mismatch remains
-- recorded against the initial cached-image shape.
alter table auth.users add column if not exists email_confirmed_at timestamptz;
