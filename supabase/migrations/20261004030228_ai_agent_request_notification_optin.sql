begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function dashboard_private.ai_agent_user_read_create_v1(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare ai_notify_on_done boolean; ai_notification_space text; cfg dashboard_private.chat_space_configuration; perm dashboard_private.chat_user_space_permissions; actor uuid:=case when p_action='create' then dashboard_private.ai_agent_lock_user_v1(false) else dashboard_private.ai_agent_require_user_v1() end; is_admin boolean; r dashboard_private.ai_agent_requests; rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; resource uuid:='00000000-0000-0000-0000-000000000000'::uuid; page integer; size integer; scope text; status_filter text; search_filter text; result jsonb;
begin
 select role='admin' into is_admin from public.profiles where id=actor;
 if p_action='create' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['title','body','notifyOnDone','notificationSpace','idempotencyKey']);
  if jsonb_typeof(p_input->'title') is distinct from 'string' or jsonb_typeof(p_input->'body') is distinct from 'string' or length(p_input->>'title') not between 1 and 200 or length(p_input->>'body') not between 1 and 20000 or not (p_input->>'title') ~ '[^[:space:]]' or not (p_input->>'body') ~ '[^[:space:]]' or (p_input ? 'notifyOnDone' and jsonb_typeof(p_input->'notifyOnDone') is distinct from 'boolean') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  ai_notify_on_done:=coalesce((p_input->>'notifyOnDone')::boolean,false);
  ai_notification_space:=null;
  if ai_notify_on_done then
   if jsonb_typeof(p_input->'notificationSpace') is distinct from 'string' or p_input->>'notificationSpace' not in('space_1','space_2','space_3','space_4','space_5','space_6','space_7') then
    raise exception using errcode='22023',message='ai_agent_invalid';
   end if;
   ai_notification_space:=p_input->>'notificationSpace';
   -- Actor profile UPDATE + auth SHARE are already held. This matches the
   -- existing profile -> auth -> own permission -> configuration lock order.
   -- A policy writer takes the target profile SHARE even for an absent row;
   -- therefore an insert/revoke cannot race the decisive create authorization.
   select * into perm from dashboard_private.chat_user_space_permissions where user_id=actor for share;
   if not is_admin and (perm.user_id is null or not ai_notification_space=any(perm.space_keys)) then
    raise exception using errcode='42501',message='ai_agent_space_forbidden';
   end if;
   select * into cfg from dashboard_private.chat_space_configuration where space_key=ai_notification_space for share;
   if not found or not cfg.configured then
    raise exception using errcode='42501',message='ai_agent_space_forbidden';
   end if;
  elsif p_input ? 'notificationSpace' then
   -- Preserve the prior OFF input contract; normal OFF requests omit this key.
   raise exception using errcode='42501',message='ai_agent_space_forbidden';
  end if;
  if not p_input ? 'idempotencyKey' then raise exception using errcode='22023',message='ai_agent_idempotency_required';end if;
  key:=(p_input->>'idempotencyKey')::uuid;
  if key is null then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  -- ai_agent_lock_user_v1 already holds the actor lock, serializing current
  -- authority, receipt replay and the rolling create budget in this transaction.
  -- Preserve the exact old OFF hash shape, including omitted space, so already
  -- stored OFF receipts remain replayable. ON hashes bind both consent and slot.
  fingerprint:=encode(sha256(convert_to((jsonb_build_object('title',p_input->>'title','body',p_input->>'body','notifyOnDone',ai_notify_on_done)||case when ai_notify_on_done then jsonb_build_object('notificationSpace',ai_notification_space) else '{}'::jsonb end)::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='create' and resource_id=resource and idempotency_key=key;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return rec.result;
  end if;
  if (select count(*) from dashboard_private.ai_agent_requests where requester_id=actor and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception using errcode='54000',message='ai_agent_rate_limited';end if;
  insert into dashboard_private.ai_agent_requests(requester_id,title,body,notify_on_done,notification_space) values(actor,p_input->>'title',p_input->>'body',ai_notify_on_done,ai_notification_space) returning * into r;
  insert into dashboard_private.ai_agent_request_events(request_id,event_seq,kind,actor_kind,actor_id,requester_id,next_status,version) values(r.id,1,'created','user',actor,actor,'pending',1);
  result:=dashboard_private.ai_agent_request_json_v1(r);
  insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'create',resource,key,fingerprint,result);
  return result;
 elsif p_action='get' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['id']);
  if jsonb_typeof(p_input->'id') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select * into r from dashboard_private.ai_agent_requests where id=(p_input->>'id')::uuid and (requester_id=actor or is_admin);
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  return dashboard_private.ai_agent_request_json_v1(r);
 elsif p_action='list' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['page','pageSize','scope','status','search']);
  if (p_input ? 'page' and jsonb_typeof(p_input->'page')<>'number') or (p_input ? 'pageSize' and jsonb_typeof(p_input->'pageSize')<>'number') or exists(select 1 from unnest(array['scope','status','search']) k where p_input ? k and jsonb_typeof(p_input->k) is distinct from 'string') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  page:=coalesce((p_input->>'page')::integer,1);size:=coalesce((p_input->>'pageSize')::integer,10);scope:=coalesce(p_input->>'scope','own');status_filter:=p_input->>'status';search_filter:=p_input->>'search';
  if page<1 or page>10000 or size not in(10,15,20) or scope not in('own','all') or (status_filter is not null and status_filter not in('pending','processing','question','done','cancelled')) or length(search_filter)>200 then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if scope='all' and not is_admin then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  return jsonb_build_object('page',page,'pageSize',size,'total',(select count(*) from dashboard_private.ai_agent_requests x where (x.requester_id=actor or scope='all') and (status_filter is null or x.status=status_filter) and (search_filter is null or x.title ilike '%'||search_filter||'%')),'items',(select coalesce(jsonb_agg(dashboard_private.ai_agent_request_json_v1(x) order by x.created_at desc,x.id),'[]') from (select * from dashboard_private.ai_agent_requests x where (x.requester_id=actor or scope='all') and (status_filter is null or x.status=status_filter) and (search_filter is null or x.title ilike '%'||search_filter||'%') order by x.created_at desc,x.id limit size offset (page-1)*size) x));
 else raise exception using errcode='22023',message='ai_agent_invalid';end if;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;
revoke all on function dashboard_private.ai_agent_user_read_create_v1(text,jsonb) from public,anon,authenticated,service_role;
commit;
