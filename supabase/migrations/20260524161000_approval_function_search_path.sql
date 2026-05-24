create or replace function public.set_approval_requests_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.write_approval_status_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.approval_events(approval_id, actor_id, event_type, field_name, after_value)
    values (new.id, auth.uid(), 'created', 'status', new.status);
  elsif old.status is distinct from new.status then
    insert into public.approval_events(approval_id, actor_id, event_type, field_name, before_value, after_value)
    values (new.id, auth.uid(), 'status_changed', 'status', old.status, new.status);
  end if;
  return new;
end;
$$;
