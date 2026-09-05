-- SQL-language functions with SET clauses cannot be inlined. Their generic
-- plans retain every task domain even when p_type selects just one. Plan these
-- two parameter-sensitive reads inside PL/pgSQL with their actual parameters.
-- Keep the final ordered definition (including subject soft-archive rules)
-- verbatim: no copied historical SELECT, filter change, ACL or RLS change.
do $migration$
declare
  target regprocedure;
  function_row record;
  body text;
begin
  foreach target in array array[
    'dashboard_private.ops_task_page_source_v1(text,jsonb)'::regprocedure,
    'dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::regprocedure
  ] loop
    select p.*, l.lanname into strict function_row
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = target;

    if function_row.lanname <> 'sql'
      or function_row.prosecdef
      or function_row.provolatile <> 's'
      or function_row.proargnames[1:2] <> array['p_type','p_filters']
      or not coalesce(
        'search_path=' = any(function_row.proconfig)
        or 'search_path=""' = any(function_row.proconfig), false)
      or not coalesce('TimeZone=Asia/Seoul' = any(function_row.proconfig), false)
      or not pg_catalog.has_function_privilege('authenticated', target, 'execute')
      or pg_catalog.has_function_privilege('anon', target, 'execute')
      or pg_catalog.has_function_privilege('public', target, 'execute') then
      raise exception using errcode = '55000',
        message = 'ops_task_source_plan_definition_drift', detail = target::text;
    end if;

    body := pg_catalog.rtrim(function_row.prosrc, E' \t\n\r;');
    if body !~* '^\s*with base as\s*\('
      or body !~* 'select \* from shaped\s*$' then
      raise exception using errcode = '55000',
        message = 'ops_task_source_plan_body_drift', detail = target::text;
    end if;

    -- SQL table output names are columns. Preserve that binding when wrapping
    -- the unchanged query in a PL/pgSQL table-returning function.
    execute pg_catalog.format(
      'create or replace function dashboard_private.%I(p_type text, p_filters jsonb)
       returns %s language plpgsql stable security invoker
       set search_path = '''' set timezone = ''Asia/Seoul''
       set plan_cache_mode = ''force_custom_plan'' as %L',
      function_row.proname,
      pg_catalog.pg_get_function_result(target),
      E'#variable_conflict use_column\nbegin\n  return query\n' || body || E';\nend;\n'
    );
  end loop;
end
$migration$;
