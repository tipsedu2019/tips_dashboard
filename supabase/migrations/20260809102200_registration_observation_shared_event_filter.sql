begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.registration_task_event_shared_visible(public.ops_task_events)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_version jsonb;
  v_payload_version integer;
  v_inner_event_type text;
begin
  if pg_catalog.starts_with(
    coalesce(($1).event_type, ''),
    'registration_observation_'
  ) then
    return false;
  end if;

  if ($1).event_type is distinct from 'registration_track_event'
    or ($1).after_value is null
  then
    return true;
  end if;

  begin
    v_payload := ($1).after_value::jsonb;
  exception
    when data_exception then
      return true;
  end;

  if pg_catalog.jsonb_typeof(v_payload) is distinct from 'object' then
    return true;
  end if;

  v_version := v_payload -> 'version';
  if pg_catalog.jsonb_typeof(v_version) = 'number' then
    if v_version = pg_catalog.to_jsonb(1) then
      v_payload_version := 1;
    elsif v_version = pg_catalog.to_jsonb(2) then
      v_payload_version := 2;
    else
      return true;
    end if;
  elsif pg_catalog.jsonb_typeof(v_version) = 'string' then
    if v_payload ->> 'version' = '1' then
      v_payload_version := 1;
    elsif v_payload ->> 'version' = '2' then
      v_payload_version := 2;
    else
      return true;
    end if;
  else
    return true;
  end if;

  if v_payload_version = 1 then
    if pg_catalog.jsonb_typeof(v_payload -> 'eventType') is distinct from 'string' then
      return true;
    end if;
    v_inner_event_type := v_payload ->> 'eventType';
  else
    if pg_catalog.jsonb_typeof(v_payload -> 'event_type') is distinct from 'string' then
      return true;
    end if;
    v_inner_event_type := v_payload ->> 'event_type';
  end if;

  return not pg_catalog.starts_with(
    v_inner_event_type,
    'registration_observation_'
  );
end;
$$;

alter function public.registration_task_event_shared_visible(public.ops_task_events)
owner to postgres;

revoke all on function public.registration_task_event_shared_visible(public.ops_task_events)
from public, anon, authenticated, service_role;

grant execute on function public.registration_task_event_shared_visible(public.ops_task_events)
to authenticated, service_role;

commit;
