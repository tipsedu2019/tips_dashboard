begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
  to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)') is not null,
  'public registration workflow status wrapper exists with its exact signature'
);

select ok(
  to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)') is not null,
  'private registration workflow status implementation exists with its exact signature'
);

select like(
  pg_get_functiondef(to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')),
  '%dashboard_private.set_registration_workflow_status_v1_impl%',
  'public wrapper delegates to the private implementation'
);

select is(
  (select not procedure.prosecdef from pg_proc procedure where procedure.oid = to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')),
  true,
  'public wrapper remains security invoker'
);

select is(
  (select procedure.prosecdef from pg_proc procedure where procedure.oid = to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  true,
  'private implementation remains security definer'
);

select is(
  (select pg_get_userbyid(procedure.proowner) from pg_proc procedure where procedure.oid = to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  'postgres',
  'private implementation remains owned by postgres'
);

select ok(
  has_function_privilege('authenticated', 'public.set_registration_workflow_status_v1(uuid,text,integer,text)', 'execute'),
  'authenticated retains execute on the public wrapper'
);

select ok(
  has_function_privilege('authenticated', 'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)', 'execute'),
  'authenticated retains execute on the private implementation'
);

select unlike(
  pg_get_functiondef(to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')),
  '40001',
  'public wrapper does not manually raise SQLSTATE 40001'
);

select unlike(
  pg_get_functiondef(to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  '40001',
  'private implementation does not manually raise SQLSTATE 40001'
);

select like(
  pg_get_functiondef(to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  '%registration_workflow_status_refresh_required%23514%',
  'private implementation maps stale revisions to registration_workflow_status_refresh_required with 23514'
);

select * from finish();
rollback;
