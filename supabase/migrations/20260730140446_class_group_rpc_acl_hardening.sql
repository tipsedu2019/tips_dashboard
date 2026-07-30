begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

revoke all on function public.create_class_with_group_memberships_v1(jsonb, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.replace_class_group_memberships_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;

grant execute on function public.create_class_with_group_memberships_v1(jsonb, uuid[])
  to authenticated;
grant execute on function public.replace_class_group_memberships_v1(uuid, uuid[])
  to authenticated;

commit;
