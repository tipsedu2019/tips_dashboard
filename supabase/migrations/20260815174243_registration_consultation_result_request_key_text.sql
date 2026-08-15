begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $migration$
declare
  v_function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid)'::pg_catalog.regprocedure
  )
  into strict v_function_definition;

  execute 'drop function public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid)';

  v_function_definition := pg_catalog.replace(
    v_function_definition,
    'p_request_key uuid',
    'p_request_key text'
  );

  if v_function_definition not like '%p_request_key text%' then
    raise exception 'registration_consultation_result_request_key_rewrite_failed';
  end if;

  execute v_function_definition;
end;
$migration$;

alter function public.save_registration_consultation_result_v2(uuid, text, text, text, uuid, integer, text)
  owner to postgres;

revoke all on function public.save_registration_consultation_result_v2(uuid, text, text, text, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_registration_consultation_result_v2(uuid, text, text, text, uuid, integer, text)
  to authenticated;

commit;
