begin;

select plan(18);

select has_column('public', 'dashboard_audit_logs', 'record_format');
select has_column('public', 'dashboard_audit_logs', 'change_patch');
select has_column('public', 'dashboard_audit_logs', 'before_hash');
select has_column('public', 'dashboard_audit_logs', 'after_hash');
select has_column('public', 'dashboard_audit_logs', 'event_sequence');
select has_column('public', 'dashboard_audit_logs', 'audit_chain_id');
select has_column('public', 'dashboard_audit_logs', 'chain_ordinal');
select has_column('public', 'dashboard_audit_logs', 'predecessor_event_id');

select has_function('dashboard_private', 'log_dashboard_audit_event_v2', array[]::text[]);
select has_function('dashboard_private', 'dashboard_audit_forward_patch_v2', array['jsonb', 'jsonb']);
select has_function('dashboard_private', 'dashboard_audit_reverse_patch_v2', array['jsonb', 'jsonb']);
select has_index('public', 'dashboard_audit_logs', 'dashboard_audit_logs_v2_entity_sequence_idx');
select ok(not has_function_privilege('authenticated', 'dashboard_private.log_dashboard_audit_event_v2()', 'EXECUTE'), 'authenticated cannot invoke audit trigger function');
select ok(not has_function_privilege('anon', 'dashboard_private.log_dashboard_audit_event_v2()', 'EXECUTE'), 'anon cannot invoke audit trigger function');
select ok(not has_sequence_privilege('authenticated', 'dashboard_private.dashboard_audit_event_sequence_v2', 'USAGE'), 'authenticated cannot advance audit event sequence');
select ok((select convalidated = false from pg_catalog.pg_constraint where conname = 'dashboard_audit_logs_v2_shape_check'), 'v2 shape check is not validated against historical rows');
select ok((select indexdef like '%WHERE (record_format = ANY (ARRAY[''full_v2''::text, ''diff_v2''::text]))%' from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'dashboard_audit_logs_v2_entity_sequence_idx'), 'predecessor index remains partial');
select ok((select tgfoid::regprocedure::text like 'dashboard_private.log_dashboard_audit_event_v2%' from pg_catalog.pg_trigger where tgname = 'dashboard_audit_classes'), 'classes audit trigger uses v2 function');

select * from finish();
rollback;
