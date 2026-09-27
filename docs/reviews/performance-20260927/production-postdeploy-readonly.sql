begin transaction read only;
set local statement_timeout = '8s';
select
  (select count(*) from supabase_migrations.schema_migrations where version = '20260927103000') as migration_receipts,
  (select attgenerated from pg_attribute where attrelid = 'public.textbooks'::regclass and attname = 'read_taxonomy' and not attisdropped) as taxonomy_storage,
  (select count(*) from public.textbooks) as textbook_count,
  (select count(*) from public.textbooks t where t.read_taxonomy is distinct from dashboard_private.textbook_taxonomy_v1(to_jsonb(t) - 'read_taxonomy')) as taxonomy_mismatches,
  (select pg_get_indexdef(indexrelid) from pg_index where indexrelid = 'public.ops_task_events_status_entered_idx'::regclass) as status_index,
  (select indisvalid and indisready from pg_index where indexrelid = 'public.ops_task_events_status_entered_idx'::regclass) as status_index_ready,
  position('t.read_taxonomy' in pg_get_functiondef('dashboard_private.textbook_read_keys_v1(text)'::regprocedure)) > 0 as reads_stored_taxonomy,
  (select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where oid = 'dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text)'::regprocedure) as immutable_invoker_empty_search_path,
  has_function_privilege('authenticated', 'dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text)', 'execute') as authenticated_execute,
  has_function_privilege('service_role', 'dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text)', 'execute') as service_role_execute,
  has_function_privilege('anon', 'dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text)', 'execute') as anon_execute,
  (select bool_and(has_function_privilege('service_role', signature, 'execute')) from unnest(array[
    'dashboard_private.textbook_taxonomy_v1(jsonb)',
    'dashboard_private.textbook_trim_v1(text)',
    'dashboard_private.textbook_subject_v1(text)',
    'dashboard_private.textbook_school_v1(text)',
    'dashboard_private.textbook_grade_v1(text)',
    'dashboard_private.textbook_compact_v1(text)'
  ]) signature) as service_role_pure_helpers_execute;
rollback;
