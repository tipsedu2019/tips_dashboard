begin;
set local lock_timeout='5s';
-- PostgreSQL rounds sub-microsecond precision; the browser model uses milliseconds.
-- Only demonstrably millisecond-equivalent source strings may prune candidates or
-- derive source date keys. Higher precision uses existing raw/JS fallback paths.
-- Target parsing/validation deliberately stays on makeup_numbered_instant_v1.
create function public.makeup_numbered_source_instant_v1(value text) returns timestamptz
language sql immutable security invoker set search_path='' as $$
 select case when value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then public.makeup_numbered_instant_v1(value) else null end
$$;
revoke all on function public.makeup_numbered_source_instant_v1(text) from public,anon;
grant execute on function public.makeup_numbered_source_instant_v1(text) to authenticated;

create or replace function public.makeup_numbered_slots_v1(r jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare raw jsonb:=r->'makeup_slots'; s jsonb; result jsonb:='[]'; i integer:=0; a text; b text; d text; t text; parsed_date timestamptz; room text:=public.makeup_numbered_trim_v1(r->>'makeup_classroom');
begin
 if jsonb_typeof(raw)='string' then begin raw:=(raw#>>'{}')::jsonb; exception when invalid_text_representation then raw:='[]'; end; end if;
 if jsonb_typeof(raw)='array' then
  for s in select value from jsonb_array_elements(raw) loop
   i:=i+1;
   a:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'startAt'),''),nullif(public.makeup_numbered_trim_v1(s->>'start_at'),''),'');
   b:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'endAt'),''),nullif(public.makeup_numbered_trim_v1(s->>'end_at'),''),'');
   d:=public.makeup_numbered_trim_v1(s->>'date');
   if d !~ '^\d{4}-\d{2}-\d{2}$' then
    -- The model's date+time fallback is Seoul-aware, unlike table date extraction.
    if d ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$' then d:=replace(d,' ','T')||'+09:00'; end if;
    parsed_date:=public.makeup_numbered_source_instant_v1(d);
    d:=case when parsed_date is not null then to_char(parsed_date at time zone 'Asia/Seoul','YYYY-MM-DD') end;
   end if;
   if a='' then t:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'startTime',''),s->>'start_time')); if d is not null and t ~ '^\d{1,2}:\d{2}$' then a:=d||'T'||lpad(t,5,'0')||':00+09:00'; end if; end if;
   if b='' then t:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'endTime',''),s->>'end_time')); if d is not null and t ~ '^\d{1,2}:\d{2}$' then b:=d||'T'||lpad(t,5,'0')||':00+09:00'; end if; end if;
   if a<>'' and b<>'' then result:=result||jsonb_build_array(jsonb_build_object('id',coalesce(nullif(public.makeup_numbered_trim_v1(s->>'id'),''),'slot-'||i),'startAt',a,'endAt',b,'classroom',coalesce(nullif(public.makeup_numbered_trim_v1(s->>'classroom'),''),room))); end if;
  end loop;
 end if;
 if jsonb_array_length(result)=0 and public.makeup_numbered_trim_v1(r->>'makeup_start_at')<>'' and public.makeup_numbered_trim_v1(r->>'makeup_end_at')<>'' then
  result:=jsonb_build_array(jsonb_build_object('id','slot-1','startAt',public.makeup_numbered_trim_v1(r->>'makeup_start_at'),'endAt',public.makeup_numbered_trim_v1(r->>'makeup_end_at'),'classroom',room));
 end if;
 return result;
end $$;

create or replace function public.makeup_numbered_legacy_slots_v1(r jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare raw jsonb:=r->'makeup_slots'; s jsonb; a text; b text; d text; start_time text; end_time text;
begin
 if jsonb_typeof(raw)='string' then begin raw:=(raw#>>'{}')::jsonb; exception when invalid_text_representation then return false; end; end if;
 if jsonb_typeof(raw) is distinct from 'array' then return false; end if;
 for s in select value from jsonb_array_elements(raw) loop
  a:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'startAt'),''),public.makeup_numbered_trim_v1(s->>'start_at'));
  b:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'endAt'),''),public.makeup_numbered_trim_v1(s->>'end_at'));
  d:=public.makeup_numbered_trim_v1(s->>'date');
  start_time:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'startTime',''),s->>'start_time'));
  end_time:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'endTime',''),s->>'end_time'));
  if d<>'' and ((a='' and start_time ~ '^\d{1,2}:\d{2}$') or (b='' and end_time ~ '^\d{1,2}:\d{2}$')) then
   if d ~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
   if d ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$' then d:=replace(d,' ','T')||'+09:00'; end if;
   if public.makeup_numbered_source_instant_v1(d) is null then return true; end if;
  end if;
 end loop;
 return false;
end $$;

create or replace function public.get_makeup_reservation_context_v1(p_slots jsonb,p_event_request_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare s jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or p_event_request_ids is null or array_position(p_event_request_ids,null) is not null then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string' or public.makeup_numbered_instant_v1(s->>'startAt') is null or public.makeup_numbered_instant_v1(s->>'endAt') is null or public.makeup_numbered_instant_v1(s->>'startAt')>=public.makeup_numbered_instant_v1(s->>'endAt') then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 end loop;
 with active as materialized (
  select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots from public.makeup_requests where status in('approval_pending','manager_pending','makeup_pending','completed')
 ), overlapping as (
  select a.* from active a where (jsonb_array_length(p_slots)>0 and public.makeup_numbered_legacy_slots_v1(to_jsonb(a))) or exists(select 1 from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(a)))r cross join jsonb_array_elements(p_slots)t
   where public.makeup_numbered_source_instant_v1(r->>'startAt') is null or public.makeup_numbered_source_instant_v1(r->>'endAt') is null
    or (public.makeup_numbered_source_instant_v1(r->>'startAt')<public.makeup_numbered_instant_v1(t->>'endAt') and public.makeup_numbered_instant_v1(t->>'startAt')<public.makeup_numbered_source_instant_v1(r->>'endAt')))
 ) select jsonb_build_object('reservations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'className',public.makeup_numbered_trim_v1(class_name),'makeupStartAt',coalesce(to_jsonb(makeup_start_at)#>>'{}',''),'makeupEndAt',coalesce(to_jsonb(makeup_end_at)#>>'{}',''),'makeupClassroom',public.makeup_numbered_trim_v1(makeup_classroom),'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(o)))||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(o)) then jsonb_build_object('rawMakeupSlots',makeup_slots) else '{}'::jsonb end order by id) from overlapping o),'[]'),
  'activeEventRequestIds',coalesce((select jsonb_agg(id order by id) from active where id=any(p_event_request_ids)),'[]')) into result;
 return result;
end $$;
commit;
