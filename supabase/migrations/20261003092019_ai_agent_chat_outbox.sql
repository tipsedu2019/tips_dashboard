begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Runtime configuration is server-owned; these seven slots start unconfigured.
-- No RPC in this migration activates a slot or writes a provider URL/secret.
create table dashboard_private.chat_space_configuration (
 space_key text primary key check(space_key in('space_1','space_2','space_3','space_4','space_5','space_6','space_7')),
 configured boolean not null default false,
 resource_name text check(resource_name ~ '^spaces/[A-Za-z0-9_-]+$'),
 revision bigint not null default 1 check(revision>0),
 check(configured=(resource_name is not null))
);
insert into dashboard_private.chat_space_configuration(space_key) select 'space_'||n from generate_series(1,7)n;
create table dashboard_private.chat_delivery_outbox (
 id uuid primary key default gen_random_uuid(),
 request_id uuid references dashboard_private.ai_agent_requests(id),
 completion_event_id uuid references dashboard_private.ai_agent_request_events(id),
 bridge_source_id uuid, source_event_id text check(length(source_event_id) between 1 and 200),
 purpose text not null check(purpose in('ai_completion','bridge_reply')),
 space_key text not null references dashboard_private.chat_space_configuration(space_key),
 expected_space text check(expected_space ~ '^spaces/[A-Za-z0-9_-]+$'),
 thread_name text,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=32000),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 upstream_request_id uuid not null default gen_random_uuid() unique,
 state text not null default 'pending' check(state in('pending','sending','sent','retry_wait','failed','delivery_unknown','cancelled','incident')),
 revision bigint not null default 1 check(revision>0),
 reason text, attempt_count integer not null default 0 check(attempt_count between 0 and 5),
 active_attempt_id uuid, lease_expires_at timestamptz,
 ready_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(completion_event_id,space_key), unique(bridge_source_id,source_event_id),
 check((purpose='ai_completion' and completion_event_id is not null and request_id is not null and bridge_source_id is null and source_event_id is null and thread_name is null) or (purpose='bridge_reply' and completion_event_id is null and request_id is null and bridge_source_id is not null and source_event_id is not null and thread_name is not null)),
 check(thread_name is null or thread_name ~ '^spaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_-]+$')
);
create table dashboard_private.chat_delivery_attempts (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null,
 outbox_id uuid not null references dashboard_private.chat_delivery_outbox(id),
 credential_id uuid not null references dashboard_private.ai_agent_credentials(id),
 seq bigint not null check(seq>0), kind text not null check(kind in('started','result','lease_expired','incident')),
 outcome text, code text check(length(code)<=100), message_name text, thread_name text,
 created_at timestamptz not null default clock_timestamp(), unique(attempt_id,seq)
);
create table dashboard_private.chat_send_global_budget (
 singleton boolean primary key default true check(singleton), minute timestamptz, count integer not null default 0 check(count between 0 and 60)
);
insert into dashboard_private.chat_send_global_budget(singleton) values(true);
create table dashboard_private.chat_space_send_budgets (
 space_key text primary key references dashboard_private.chat_space_configuration(space_key), last_dispatch_at timestamptz
);
insert into dashboard_private.chat_space_send_budgets(space_key) select space_key from dashboard_private.chat_space_configuration;
create index chat_outbox_ready on dashboard_private.chat_delivery_outbox(state,ready_at,id);
create index chat_outbox_request on dashboard_private.chat_delivery_outbox(request_id);
create index chat_attempts_outbox on dashboard_private.chat_delivery_attempts(outbox_id,created_at,id);
create index chat_attempts_credential on dashboard_private.chat_delivery_attempts(credential_id);
create trigger chat_attempts_immutable before update or delete on dashboard_private.chat_delivery_attempts for each row execute function dashboard_private.ai_agent_immutable_v1();
create function dashboard_private.chat_outbox_identity_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['state','revision','reason','attempt_count','active_attempt_id','lease_expires_at','ready_at','updated_at']) is distinct from (to_jsonb(old)-array['state','revision','reason','attempt_count','active_attempt_id','lease_expires_at','ready_at','updated_at']) then raise exception using errcode='55000',message='ai_agent_immutable';end if;
 return new;
end$$;
create trigger chat_outbox_identity before update on dashboard_private.chat_delivery_outbox for each row execute function dashboard_private.chat_outbox_identity_v1();
create trigger chat_outbox_no_delete before delete on dashboard_private.chat_delivery_outbox for each row execute function dashboard_private.ai_agent_immutable_v1();
alter table dashboard_private.chat_space_configuration enable row level security;
alter table dashboard_private.chat_delivery_outbox enable row level security;
alter table dashboard_private.chat_delivery_attempts enable row level security;
alter table dashboard_private.chat_send_global_budget enable row level security;
alter table dashboard_private.chat_space_send_budgets enable row level security;
revoke all on dashboard_private.chat_space_configuration,dashboard_private.chat_delivery_outbox,dashboard_private.chat_delivery_attempts,dashboard_private.chat_send_global_budget,dashboard_private.chat_space_send_budgets from public,anon,authenticated,service_role;

create function dashboard_private.ai_agent_completion_outbox_v1(r dashboard_private.ai_agent_requests,event_id uuid) returns void language plpgsql set search_path='' as $$
declare cfg dashboard_private.chat_space_configuration; allowed boolean; payload jsonb; reason text;
begin
 if not r.notify_on_done then return;end if;
 select * into cfg from dashboard_private.chat_space_configuration where space_key=r.notification_space;
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=r.requester_id and p.role in('admin','staff','teacher','assistant') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and (p.role='admin' or exists(select 1 from dashboard_private.chat_user_space_permissions where user_id=r.requester_id and r.notification_space=any(space_keys)))) into allowed;
 reason:=case when not cfg.configured then 'space_unconfigured' when not allowed then 'space_permission_revoked' end;
 payload:=jsonb_build_object('text',r.title||E' · 완료\n/admin/ai-agent/'||r.id::text);
 insert into dashboard_private.chat_delivery_outbox(request_id,completion_event_id,purpose,space_key,expected_space,payload,payload_hash,state,reason)
 values(r.id,event_id,'ai_completion',r.notification_space,cfg.resource_name,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),case when reason is null then 'pending' else 'cancelled' end,reason);
end$$;
create function dashboard_private.ai_agent_cancel_outbox_v1(p_id uuid) returns void language plpgsql set search_path='' as $$
begin
 update dashboard_private.chat_delivery_outbox set state='cancelled',reason='request_cancelled',revision=revision+1,updated_at=clock_timestamp() where request_id=p_id and state in('pending','retry_wait');
end$$;
create function dashboard_private.chat_outbox_json_v1(o dashboard_private.chat_delivery_outbox) returns jsonb language sql volatile set search_path='' as $$
select jsonb_build_object('id',o.id,'requestId',o.request_id,'completionEventId',o.completion_event_id,'bridgeSourceId',o.bridge_source_id,'sourceEventId',o.source_event_id,'purpose',o.purpose,'spaceKey',o.space_key,'expectedSpace',o.expected_space,'threadName',o.thread_name,'payload',o.payload,'payloadHash',o.payload_hash,'upstreamRequestId',o.upstream_request_id,'state',case when o.state='sending' and o.lease_expires_at<=clock_timestamp() then 'delivery_unknown' else o.state end,'revision',o.revision::text,'reason',case when o.state='sending' and o.lease_expires_at<=clock_timestamp() then 'dispatch_lease_expired' else o.reason end,'attemptCount',o.attempt_count,'activeAttemptId',o.active_attempt_id,'leaseExpiresAt',o.lease_expires_at,'readyAt',o.ready_at,'createdAt',o.created_at,'updatedAt',o.updated_at)
$$;
create function dashboard_private.chat_attempt_json_v1(a dashboard_private.chat_delivery_attempts) returns jsonb language sql volatile set search_path='' as $$
select jsonb_build_object('id',a.id,'attemptId',a.attempt_id,'outboxId',a.outbox_id,'credentialId',a.credential_id,'seq',a.seq::text,'kind',a.kind,'outcome',a.outcome,'code',a.code,'messageName',a.message_name,'threadName',a.thread_name,'createdAt',a.created_at)
$$;
create function dashboard_private.chat_authorize_intent_v1(c uuid,o dashboard_private.chat_delivery_outbox) returns void language plpgsql set search_path='' as $$
declare g dashboard_private.chat_credential_space_grants;
begin
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c;
 if not o.space_key=any(g.space_keys) or not o.purpose=any(g.purposes) or (o.purpose='bridge_reply' and g.bridge_source_id is distinct from o.bridge_source_id) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
end$$;

create function public.ai_agent_chat_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.chat_credential_space_grants; o dashboard_private.chat_delivery_outbox; a dashboard_private.chat_delivery_attempts; cfg dashboard_private.chat_space_configuration; r dashboard_private.ai_agent_requests; requester_role text; requester uuid; perm dashboard_private.chat_user_space_permissions;
 rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; resource uuid; result jsonb; payload jsonb; attempt uuid; size integer; ai_reason text; global_budget dashboard_private.chat_send_global_budget; space_budget dashboard_private.chat_space_send_budgets; ai_minute timestamptz:=date_trunc('minute',clock_timestamp()); outcome text; provider_code text; message_name text; thread_name text;
begin
 if p_action not in('list','get','chat_outbox','prepare_attempt','record_attempt') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action in('get','list') then 'chat:outbox:read' else 'chat:send' end,null,p_action<>'record_attempt');
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c.id;
 perform dashboard_private.ai_agent_assert_input_v1(p_input,case p_action
 when 'list' then array['limit','state'] when 'get' then array['id']
 when 'chat_outbox' then array['idempotencyKey','bridgeSourceId','sourceEventId','spaceKey','threadName','text']
 when 'prepare_attempt' then array['id','revision','idempotencyKey']
 else array['id','attemptId','idempotencyKey','outcome','code','messageName','threadName'] end);
 if p_action='list' then
  size:=coalesce((p_input->>'limit')::integer,50);
  if size not between 1 and 50 or (p_input ? 'limit' and jsonb_typeof(p_input->'limit') is distinct from 'number') or (p_input ? 'state' and (jsonb_typeof(p_input->'state') is distinct from 'string' or p_input->>'state' not in('pending','sending','sent','retry_wait','failed','delivery_unknown','cancelled','incident'))) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  return jsonb_build_object('items',(select coalesce(jsonb_agg(dashboard_private.chat_outbox_json_v1(x) order by x.ready_at,x.id),'[]') from(select * from dashboard_private.chat_delivery_outbox x where x.space_key=any(g.space_keys) and x.purpose=any(g.purposes) and (x.purpose<>'bridge_reply' or x.bridge_source_id=g.bridge_source_id) and (case when p_input ? 'state' then (case when x.state='sending' and x.lease_expires_at<=clock_timestamp() then 'delivery_unknown' else x.state end)=p_input->>'state' else x.state in('pending','retry_wait') and x.ready_at<=clock_timestamp() end) order by x.ready_at,x.id limit size)x));
 end if;
 if p_action='chat_outbox' then
  resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'bridgeSourceId');
  o.purpose:='bridge_reply';o.bridge_source_id:=resource;o.space_key:=dashboard_private.ai_agent_text_v1(p_input,'spaceKey',20);
  perform dashboard_private.chat_authorize_intent_v1(c.id,o);
  select * into cfg from dashboard_private.chat_space_configuration where space_key=o.space_key for share;
  if not found or not cfg.configured then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
  o.thread_name:=dashboard_private.ai_agent_text_v1(p_input,'threadName',500);o.source_event_id:=dashboard_private.ai_agent_text_v1(p_input,'sourceEventId',200);
  if o.thread_name !~ '^spaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_-]+$' or split_part(o.thread_name,'/threads/',1)<>cfg.resource_name then raise exception using errcode='22023',message='chat_thread_invalid';end if;
  payload:=jsonb_build_object('text',dashboard_private.ai_agent_text_v1(p_input,'text',20000),'thread',jsonb_build_object('name',o.thread_name));
  if octet_length(payload::text)>32000 then raise exception using errcode='22023',message='chat_payload_too_large';end if;
  key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='bot' and principal_id=c.id and operation='chat_outbox' and resource_id=resource and idempotency_key=key;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   select * into o from dashboard_private.chat_delivery_outbox where id=(rec.result->'outbox'->>'id')::uuid;
   return jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',false);
  end if;
  -- Stable source/event dedupe survives credential rotation. A transaction-level
  -- advisory lock serializes only this already-authorized source/event pair.
  perform pg_advisory_xact_lock(hashtextextended(resource::text||':'||o.source_event_id,0));
  select * into o from dashboard_private.chat_delivery_outbox where bridge_source_id=resource and source_event_id=p_input->>'sourceEventId';
  if found then
   if o.payload is distinct from payload or o.space_key is distinct from p_input->>'spaceKey' or o.thread_name is distinct from p_input->>'threadName' then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',false);
  else
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   insert into dashboard_private.chat_delivery_outbox(bridge_source_id,source_event_id,purpose,space_key,expected_space,thread_name,payload,payload_hash) values(resource,p_input->>'sourceEventId','bridge_reply',p_input->>'spaceKey',cfg.resource_name,p_input->>'threadName',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) returning * into o;
   result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',true);
  end if;
 else
  resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'id');
  if p_action='prepare_attempt' then
   -- Policy/profile/configuration locks precede request/outbox. Cancellation
   -- uses profile -> request -> outbox; neither user path locks a credential.
   select request_id,space_key into o.request_id,o.space_key from dashboard_private.chat_delivery_outbox where id=resource;
   if o.request_id is not null then
    select requester_id into requester from dashboard_private.ai_agent_requests where id=o.request_id;
    select role into requester_role from public.profiles where id=requester for share;
    perform 1 from auth.users where id=requester and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
    if not found or requester_role is null or requester_role not in('admin','staff','teacher','assistant') then ai_reason:='requester_inactive';end if;
    select * into perm from dashboard_private.chat_user_space_permissions where user_id=requester for share;
    if requester_role<>'admin' and (perm.user_id is null or not o.space_key=any(perm.space_keys)) then ai_reason:='space_permission_revoked';end if;
   end if;
   select * into cfg from dashboard_private.chat_space_configuration where space_key=o.space_key for share;
   if not cfg.configured then ai_reason:='space_unconfigured';end if;
   if o.request_id is not null then select * into r from dashboard_private.ai_agent_requests where id=o.request_id for update;end if;
  end if;
  if p_action='get' then select * into o from dashboard_private.chat_delivery_outbox where id=resource;
  else select * into o from dashboard_private.chat_delivery_outbox where id=resource for update;end if;
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  if p_action<>'record_attempt' then perform dashboard_private.chat_authorize_intent_v1(c.id,o);end if;
  if p_action='get' then
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   return jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempts',(select coalesce(jsonb_agg(dashboard_private.chat_attempt_json_v1(t) order by t.created_at,t.id),'[]') from(select * from dashboard_private.chat_delivery_attempts where outbox_id=o.id order by created_at desc,id desc limit 50)t));
  end if;
  key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  if p_action='record_attempt' then
   attempt:=dashboard_private.ai_agent_required_uuid_v1(p_input,'attemptId');
   select * into a from dashboard_private.chat_delivery_attempts where attempt_id=attempt and outbox_id=o.id and credential_id=c.id and kind='started';
   if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  end if;
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='bot' and principal_id=c.id and operation=p_action and resource_id=resource and idempotency_key=key;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',case when p_action='record_attempt' then rec.result->'attempt' else null end);
  end if;
  if p_action='prepare_attempt' then
   if o.revision<>dashboard_private.ai_agent_decimal_v1(p_input,'revision') then raise exception using errcode='55000',message='ai_agent_conflict';end if;
   if o.state='sent' then result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',null);
   elsif o.state='sending' and o.lease_expires_at<=clock_timestamp() then
    select * into a from dashboard_private.chat_delivery_attempts where attempt_id=o.active_attempt_id and kind='started';
    insert into dashboard_private.chat_delivery_attempts(attempt_id,outbox_id,credential_id,seq,kind,outcome,code) values(a.attempt_id,o.id,a.credential_id,coalesce((select max(seq) from dashboard_private.chat_delivery_attempts where attempt_id=a.attempt_id),0)+1,'lease_expired','delivery_unknown','dispatch_lease_expired');
    update dashboard_private.chat_delivery_outbox set state='delivery_unknown',reason='dispatch_lease_expired',revision=revision+1,updated_at=clock_timestamp() where id=o.id returning * into o;
    result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',null);
   elsif o.state not in('pending','retry_wait') or o.ready_at>clock_timestamp() then raise exception using errcode='55000',message='ai_agent_conflict';
   elsif ai_reason is not null or (r.id is not null and r.status<>'done') or cfg.resource_name is distinct from o.expected_space then
    update dashboard_private.chat_delivery_outbox set state='cancelled',reason=coalesce(ai_reason,case when cfg.resource_name is distinct from o.expected_space then 'space_configuration_changed' else 'request_cancelled' end),revision=revision+1,updated_at=clock_timestamp() where id=o.id returning * into o;
    result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',null);
   else
    if o.payload_hash<>encode(sha256(convert_to(o.payload::text,'UTF8')),'hex') or octet_length(o.payload::text)>32000 or (o.purpose='bridge_reply' and (o.thread_name is null or split_part(o.thread_name,'/threads/',1)<>o.expected_space or o.payload->'thread'->>'name' is distinct from o.thread_name)) then raise exception using errcode='22023',message='chat_payload_invalid';end if;
    select * into global_budget from dashboard_private.chat_send_global_budget where singleton for update;
    select * into space_budget from dashboard_private.chat_space_send_budgets where space_key=o.space_key for update;
    if global_budget.minute is distinct from ai_minute then global_budget.count:=0;end if;
    if global_budget.count>=60 or space_budget.last_dispatch_at>clock_timestamp()-interval '1 second' then raise exception using errcode='54000',message='chat_rate_limited';end if;
    perform dashboard_private.ai_agent_consume_rate_v1(c.id);
    update dashboard_private.chat_send_global_budget set minute=ai_minute,count=global_budget.count+1 where singleton;
    update dashboard_private.chat_space_send_budgets set last_dispatch_at=clock_timestamp() where space_key=o.space_key;
    attempt:=gen_random_uuid();
    insert into dashboard_private.chat_delivery_attempts(attempt_id,outbox_id,credential_id,seq,kind) values(attempt,o.id,c.id,1,'started') returning * into a;
    update dashboard_private.chat_delivery_outbox set state='sending',revision=revision+1,attempt_count=attempt_count+1,active_attempt_id=attempt,lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp(),reason=null where id=o.id returning * into o;
    result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',dashboard_private.chat_attempt_json_v1(a));
   end if;
  else
   outcome:=dashboard_private.ai_agent_text_v1(p_input,'outcome',50);provider_code:=dashboard_private.ai_agent_text_v1(p_input,'code',100);
   if outcome not in('sent','rejected_retryable','rejected_permanent','unknown') or provider_code !~ '^[A-Za-z0-9_.-]+$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   message_name:=p_input->>'messageName';thread_name:=p_input->>'threadName';
   if (p_input ? 'messageName' and (jsonb_typeof(p_input->'messageName') is distinct from 'string' or length(message_name)>500)) or (p_input ? 'threadName' and (jsonb_typeof(p_input->'threadName') is distinct from 'string' or length(thread_name)>500)) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   if outcome='rejected_retryable' and provider_code<>'429' then outcome:='unknown';end if;
   if outcome='sent' then
    if message_name is null or thread_name is null then outcome:='delivery_unknown';ai_reason:='success_evidence_missing';
    elsif message_name !~ '^spaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+$' or thread_name !~ '^spaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_-]+$' or split_part(message_name,'/messages/',1)<>o.expected_space or split_part(thread_name,'/threads/',1)<>o.expected_space or (o.thread_name is not null and thread_name<>o.thread_name) then outcome:='incident';ai_reason:='provider_resource_mismatch';end if;
   end if;
   if o.active_attempt_id is distinct from attempt or exists(select 1 from dashboard_private.chat_delivery_attempts where attempt_id=attempt and kind in('result','incident')) then outcome:='incident';ai_reason:='contradictory_or_old_result';end if;
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   insert into dashboard_private.chat_delivery_attempts(attempt_id,outbox_id,credential_id,seq,kind,outcome,code,message_name,thread_name) values(attempt,o.id,c.id,coalesce((select max(seq) from dashboard_private.chat_delivery_attempts where attempt_id=attempt),0)+1,case when outcome='incident' then 'incident' else 'result' end,outcome,provider_code,message_name,thread_name) returning * into a;
   update dashboard_private.chat_delivery_outbox set state=case outcome when 'sent' then 'sent' when 'rejected_retryable' then case when attempt_count>=5 then 'failed' else 'retry_wait' end when 'rejected_permanent' then 'failed' when 'incident' then 'incident' else 'delivery_unknown' end,reason=coalesce(ai_reason,case when outcome='sent' then null else provider_code end),ready_at=case when outcome='rejected_retryable' then clock_timestamp()+make_interval(secs=>power(2,attempt_count)::integer+(abs(hashtextextended(id::text,0)%1000)::double precision/1000)) else ready_at end,revision=revision+1,updated_at=clock_timestamp() where id=o.id returning * into o;
   result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',dashboard_private.chat_attempt_json_v1(a));
  end if;
 end if;
 insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('bot',c.id,p_action,resource,key,fingerprint,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;
revoke all on function dashboard_private.chat_outbox_identity_v1(),dashboard_private.ai_agent_completion_outbox_v1(dashboard_private.ai_agent_requests,uuid),dashboard_private.ai_agent_cancel_outbox_v1(uuid),dashboard_private.chat_outbox_json_v1(dashboard_private.chat_delivery_outbox),dashboard_private.chat_attempt_json_v1(dashboard_private.chat_delivery_attempts),dashboard_private.chat_authorize_intent_v1(uuid,dashboard_private.chat_delivery_outbox) from public,anon,authenticated,service_role;
revoke all on function public.ai_agent_chat_api_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_chat_api_v1(text,text,jsonb) to service_role;
commit;
