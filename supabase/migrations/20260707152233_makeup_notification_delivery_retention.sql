create index if not exists makeup_notification_deliveries_created_at_idx
  on public.makeup_notification_deliveries(created_at desc, id desc);

create or replace function public.prune_makeup_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.makeup_notification_deliveries
  where id in (
    select id
    from (
      select
        id,
        row_number() over (order by created_at desc, id desc) as row_number
      from public.makeup_notification_deliveries
    ) ranked
    where row_number > 500
  );

  return null;
end;
$$;

drop trigger if exists prune_makeup_notification_deliveries_after_insert
  on public.makeup_notification_deliveries;

create trigger prune_makeup_notification_deliveries_after_insert
after insert on public.makeup_notification_deliveries
for each statement
execute function public.prune_makeup_notification_deliveries();

delete from public.makeup_notification_deliveries
where id in (
  select id
  from (
    select
      id,
      row_number() over (order by created_at desc, id desc) as row_number
    from public.makeup_notification_deliveries
  ) ranked
  where row_number > 500
);
