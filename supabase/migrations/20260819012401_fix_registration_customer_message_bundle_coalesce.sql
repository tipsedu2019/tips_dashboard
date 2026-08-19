begin;

-- Correct functions installed before the baseline migration used COALESCE as a
-- schema-qualified function. COALESCE is SQL syntax, not a pg_catalog function.
do $$
declare
  v_definition text;
begin
  for v_definition in
    select pg_get_functiondef(proc.oid)
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where (namespace.nspname, proc.proname) in (
      ('dashboard_private', 'bump_registration_customer_message_recipient_revision_v1'),
      ('dashboard_private', 'collect_registration_customer_message_bundle_items_v1'),
      ('dashboard_private', 'materialize_registration_customer_message_bundle_v1'),
      ('public', 'resolve_registration_customer_message_bundle_source_v1'),
      ('public', 'get_registration_customer_message_bundle_runtime_v1')
    )
      and proc.prosrc like '%pg_catalog.coalesce%'
  loop
    execute replace(v_definition, 'pg_catalog.coalesce', 'coalesce');
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
