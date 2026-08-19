begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The first class-period migration created the membership tables after these
-- legacy active classes already existed. Normalize the historical active
-- status aliases and attach any active class without a period to the same
-- default period used by the management list.
do $migration$
declare
  v_default_group_id uuid;
begin
  select group_row.id
  into v_default_group_id
  from public.class_schedule_sync_groups as group_row
  order by
    group_row.is_default desc,
    group_row.sort_order asc,
    group_row.name collate dashboard_private.ko_numeric asc,
    group_row.id asc
  limit 1;

  if v_default_group_id is null then
    raise exception 'class_period_backfill_default_group_missing' using errcode = '55000';
  end if;

  update public.classes as class_row
  set status = '수강'
  where class_row.status in ('개강', '수업 진행 중');

  insert into public.class_schedule_sync_group_members (
    group_id,
    class_id,
    sort_order
  )
  select
    v_default_group_id,
    class_row.id,
    0
  from public.classes as class_row
  where class_row.status = '수강'
    and not exists (
      select 1
      from public.class_schedule_sync_group_members as member
      where member.class_id = class_row.id
    )
  on conflict (group_id, class_id) do nothing;

  if exists (
    select 1
    from public.classes as class_row
    where class_row.status in ('수강', '개강', '수업 진행 중')
      and not exists (
        select 1
        from public.class_schedule_sync_group_members as member
        where member.class_id = class_row.id
      )
  ) then
    raise exception 'class_period_backfill_incomplete' using errcode = '55000';
  end if;
end
$migration$;

set constraints class_active_group_membership_required_on_classes immediate;
set constraints class_active_group_membership_required_on_members immediate;

commit;
