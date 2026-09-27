begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

-- Preserve the JS marker/JSON parser: only the suffix after the first marker is
-- metadata. Malformed notes cannot produce a collision in the existing model.
create function dashboard_private.makeup_approval_event_meta_v1(note text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare pos integer := strpos(note, '[[TIPS_MAKEUP]]');
begin
 if pos is null or pos=0 then return null; end if;
 return public.makeup_numbered_trim_v1(substring(note from pos+length('[[TIPS_MAKEUP]]')))::jsonb;
exception when invalid_text_representation then return null;
end $$;
revoke all on function dashboard_private.makeup_approval_event_meta_v1(text) from public,anon,authenticated;
grant execute on function dashboard_private.makeup_approval_event_meta_v1(text) to service_role;

-- Server-only, read-only preflight. The existing locked transition remains the
-- authority for concurrent writes. Ambiguous legacy dates are retained for JS
-- parsing, never silently excluded. Rooms/aliases remain the model's decision.
create function public.get_makeup_approval_collision_context_v1(p_slots jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_slots) is distinct from 'array' then
   raise exception using errcode='22023',message='makeup_reservation_request_invalid';
 end if;
 if exists(select 1 from jsonb_array_elements(p_slots) s where jsonb_typeof(s) is distinct from 'object'
   or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string') then
   raise exception using errcode='22023',message='makeup_reservation_request_invalid';
 end if;
 with targets as materialized (
   select public.makeup_numbered_source_instant_v1(s->>'startAt') start_at,
          public.makeup_numbered_source_instant_v1(s->>'endAt') end_at
   from jsonb_array_elements(p_slots) s
 ), reservations as materialized (
   select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots
   from public.makeup_requests where status in('approval_pending','manager_pending','makeup_pending','completed')
 ), events as materialized (
   select id,title,note,dashboard_private.makeup_approval_event_meta_v1(note) meta
   from public.academic_events where strpos(note,'[[TIPS_MAKEUP]]')>0
 ) select jsonb_build_object(
   'classes',coalesce((select jsonb_agg(to_jsonb(c) order by id) from (
     select id,name,subject,grade,teacher,room,schedule from public.classes c
     -- Every regular collision requires a literal Korean weekday in schedule.
     -- Do not reinterpret legacy room overrides or impose newer validation.
     where exists(select 1 from targets t where t.start_at is null or t.end_at is null
       or strpos(c.schedule,substr('일월화수목금토',extract(dow from t.start_at at time zone 'Asia/Seoul')::integer+1,1))>0)
   ) c),'[]'::jsonb),
   'requests',coalesce((select jsonb_agg(to_jsonb(r) order by id) from reservations r
     where exists(select 1 from targets t where t.start_at is null or t.end_at is null
       or public.makeup_numbered_legacy_slots_v1(to_jsonb(r))
       or exists(select 1 from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(r))) s
         where public.makeup_numbered_source_instant_v1(s->>'startAt') is null
           or public.makeup_numbered_source_instant_v1(s->>'endAt') is null
           or (public.makeup_numbered_source_instant_v1(s->>'startAt')<t.end_at
             and t.start_at<public.makeup_numbered_source_instant_v1(s->>'endAt'))))),'[]'::jsonb),
   'academicEvents',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'note',e.note) order by e.id)
     from events e where e.meta->>'kind'='makeup' and exists(select 1 from targets t
       where t.start_at is null or t.end_at is null
         or public.makeup_numbered_source_instant_v1(e.meta->>'startAt') is null
         or public.makeup_numbered_source_instant_v1(e.meta->>'endAt') is null
         or (public.makeup_numbered_source_instant_v1(e.meta->>'startAt')<t.end_at
           and t.start_at<public.makeup_numbered_source_instant_v1(e.meta->>'endAt')))),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.get_makeup_approval_collision_context_v1(jsonb) from public,anon,authenticated;
grant execute on function public.get_makeup_approval_collision_context_v1(jsonb) to service_role;
-- Only argument-transforming invokers; no actor-scoped data RPC is granted.
grant execute on function public.makeup_numbered_source_instant_v1(text),
 public.makeup_numbered_instant_v1(text),public.makeup_numbered_trim_v1(text),
 public.makeup_numbered_slots_v1(jsonb),public.makeup_numbered_legacy_slots_v1(jsonb) to service_role;
commit;
