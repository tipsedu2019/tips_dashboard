begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.assert_active_class_group_membership_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_status text;
begin
  if tg_table_name = 'classes' then
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return null;
    end if;
    v_class_id := new.id;
  elsif tg_op = 'DELETE' then
    v_class_id := old.class_id;
  else
    v_class_id := new.class_id;
  end if;

  if v_class_id is null then
    return null;
  end if;

  select class_row.status
  into v_status
  from public.classes as class_row
  where class_row.id = v_class_id;

  if v_status = '수강'
    and not exists (
      select 1
      from public.class_schedule_sync_group_members as member
      where member.class_id = v_class_id
    ) then
    raise exception '수강 수업에는 기간을 하나 이상 연결해야 합니다.'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

alter function dashboard_private.assert_active_class_group_membership_v1()
  owner to postgres;

revoke all on function dashboard_private.assert_active_class_group_membership_v1()
  from public, anon, authenticated, service_role;

commit;
