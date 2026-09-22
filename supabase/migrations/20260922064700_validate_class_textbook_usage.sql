begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Validate existing rows after releasing the schema migration's exclusive lock.
alter table public.classes validate constraint classes_textbook_usage_valid;

commit;
