begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Install only while the approved Chat path is still empty/inactive. Hold the
-- same exclusive lock needed by ADD COLUMN before checking, so a concurrent
-- insert cannot cross this boundary. Never rewrite populated delivery history.
lock table dashboard_private.chat_delivery_outbox in access exclusive mode;
do $$begin
 if exists(select 1 from dashboard_private.chat_delivery_outbox limit 1) then
  raise exception using errcode='55000',message='chat_thread_reply_install_requires_empty_outbox';
 end if;
end$$;

-- Existing-thread replies only. No new purpose, role grant, key, space or switch.
alter table dashboard_private.chat_delivery_outbox add column client_message_id uuid;
-- The exclusive empty-table check above makes validation constant-time.
-- squawk-ignore constraint-missing-not-valid
alter table dashboard_private.chat_delivery_outbox add constraint chat_client_message_reply_only check(client_message_id is null or purpose='bridge_reply');
alter table dashboard_private.chat_delivery_outbox drop constraint chat_delivery_outbox_bridge_source_id_source_event_id_key;
-- Empty table is locked above; replace uniqueness atomically in this transaction.
-- squawk-ignore require-concurrent-index-creation
create unique index chat_outbox_legacy_source_event on dashboard_private.chat_delivery_outbox(bridge_source_id,source_event_id) where client_message_id is null;
-- Empty table is locked above; replace uniqueness atomically in this transaction.
-- squawk-ignore require-concurrent-index-creation
create unique index chat_outbox_client_message on dashboard_private.chat_delivery_outbox(bridge_source_id,client_message_id) where client_message_id is not null;
-- Empty table is locked above; replace uniqueness atomically in this transaction.
-- squawk-ignore require-concurrent-index-creation
create index chat_outbox_unresolved_event on dashboard_private.chat_delivery_outbox(bridge_source_id,source_event_id) where state in('pending','retry_wait','sending','delivery_unknown','incident');

-- Keep legacy JSON and receipt fingerprints unchanged. Client IDs are additive
-- only for new messages; rollout must deploy the parser before issuing keys.
create or replace function dashboard_private.chat_outbox_json_v1(o dashboard_private.chat_delivery_outbox) returns jsonb language sql volatile set search_path='' as $$
select jsonb_build_object('id',o.id,'requestId',o.request_id,'completionEventId',o.completion_event_id,'bridgeSourceId',o.bridge_source_id,'sourceEventId',o.source_event_id,'purpose',o.purpose,'spaceKey',o.space_key,'expectedSpace',o.expected_space,'threadName',o.thread_name,'payload',o.payload,'payloadHash',o.payload_hash,'upstreamRequestId',o.upstream_request_id,'state',case when o.state='sending' and o.lease_expires_at<=clock_timestamp() then 'delivery_unknown' else o.state end,'revision',o.revision::text,'reason',case when o.state='sending' and o.lease_expires_at<=clock_timestamp() then 'dispatch_lease_expired' else o.reason end,'attemptCount',o.attempt_count,'activeAttemptId',o.active_attempt_id,'leaseExpiresAt',o.lease_expires_at,'readyAt',o.ready_at,'createdAt',o.created_at,'updatedAt',o.updated_at)
 || case when o.client_message_id is null then '{}'::jsonb else jsonb_build_object('clientMessageId',o.client_message_id) end
$$;

create or replace function public.ai_agent_chat_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare client_message uuid; event_source uuid; event_id text; c dashboard_private.ai_agent_credentials; g dashboard_private.chat_credential_space_grants; o dashboard_private.chat_delivery_outbox; a dashboard_private.chat_delivery_attempts; cfg dashboard_private.chat_space_configuration; r dashboard_private.ai_agent_requests; requester_role text; requester uuid; perm dashboard_private.chat_user_space_permissions;
 rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; resource uuid; result jsonb; payload jsonb; attempt uuid; size integer; ai_reason text; global_budget dashboard_private.chat_send_global_budget; space_budget dashboard_private.chat_space_send_budgets; ai_minute timestamptz:=date_trunc('minute',clock_timestamp()); binding text; pos jsonb; stamp timestamptz; last_id uuid; rows jsonb; next_cursor text; outcome text; provider_code text; message_name text; thread_name text;
begin
 if p_action not in('list','get','chat_outbox','prepare_attempt','record_attempt') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action in('get','list') then 'chat:outbox:read' else 'chat:send' end,null,p_action<>'record_attempt');
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c.id;
 if c.credential_kind='personal' then
  if p_action='chat_outbox' or (p_action='get' and p_input ? 'clientMessageId') then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
  -- Current owner policy/configuration locks precede all request/outbox locks,
  -- including get, late result append and receipt replay. No personal bridge path.
  select * into perm from dashboard_private.chat_user_space_permissions where user_id=c.owner_profile_id for share;
  if p_action='list' then
   perform 1 from dashboard_private.chat_space_configuration where space_key=any(g.space_keys) order by space_key for share;
  else
   select x.request_id,x.space_key into o.request_id,o.space_key from dashboard_private.chat_delivery_outbox x join dashboard_private.ai_agent_requests own_request on own_request.id=x.request_id where x.id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and x.purpose='ai_completion' and own_request.requester_id=c.owner_profile_id;
   if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
   if perm.user_id is null or not o.space_key=any(perm.space_keys) then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
   select * into cfg from dashboard_private.chat_space_configuration where space_key=o.space_key for share;
   if not found or not cfg.configured then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
  end if;
 end if;
 perform dashboard_private.ai_agent_assert_input_v1(p_input,case p_action
 when 'list' then array['limit','state','cursor'] when 'get' then array['id','clientMessageId']
 when 'chat_outbox' then array['idempotencyKey','bridgeSourceId','sourceEventId','spaceKey','threadName','text','clientMessageId']
 when 'prepare_attempt' then array['id','revision','idempotencyKey']
 else array['id','attemptId','idempotencyKey','outcome','code','messageName','threadName'] end);
 if p_action='list' then
  size:=coalesce((p_input->>'limit')::integer,50);
  if size not between 1 and 50 or (p_input ? 'limit' and jsonb_typeof(p_input->'limit') is distinct from 'number') or (p_input ? 'state' and (jsonb_typeof(p_input->'state') is distinct from 'string' or p_input->>'state' not in('pending','sending','sent','retry_wait','failed','delivery_unknown','cancelled','incident'))) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  -- Keep the legacy central cursor binding byte-compatible.
  if c.credential_kind='central' then
   binding:=encode(sha256(convert_to(jsonb_build_object('operation','chat_list','credentialId',c.id,'spaceKeys',g.space_keys,'purposes',g.purposes,'sourceId',g.bridge_source_id,'state',p_input->>'state','limit',size)::text,'UTF8')),'hex');
  else
   binding:=encode(sha256(convert_to(jsonb_build_object('operation','chat_list','credentialId',c.id,'credentialKind',c.credential_kind,'ownerProfileId',c.owner_profile_id,'spaceKeys',g.space_keys,'purposes',g.purposes,'sourceId',g.bridge_source_id,'state',p_input->>'state','limit',size)::text,'UTF8')),'hex');
  end if;
  pos:=dashboard_private.ai_agent_cursor_decode_v1(p_input,binding);
  if pos is not null then
   begin
    if pos-'readyAt'-'id'<>'{}'::jsonb or (jsonb_typeof(pos->'readyAt') is distinct from 'string' or pos->>'readyAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?[+-][0-9]{2}:[0-9]{2}$') or jsonb_typeof(pos->'id') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
    stamp:=(pos->>'readyAt')::timestamptz;last_id:=dashboard_private.ai_agent_required_uuid_v1(pos,'id');
    if stamp is null or not isfinite(stamp) then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
   exception when others then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end;
  end if;
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  select coalesce(jsonb_agg(dashboard_private.chat_outbox_json_v1(x) order by x.ready_at,x.id),'[]') into rows from(select * from dashboard_private.chat_delivery_outbox x where x.space_key=any(g.space_keys) and x.purpose=any(g.purposes) and (c.credential_kind='central' or (x.purpose='ai_completion' and exists(select 1 from dashboard_private.ai_agent_requests own_request where own_request.id=x.request_id and own_request.requester_id=c.owner_profile_id) and x.space_key=any(perm.space_keys) and exists(select 1 from dashboard_private.chat_space_configuration own_cfg where own_cfg.space_key=x.space_key and own_cfg.configured))) and (x.purpose<>'bridge_reply' or x.bridge_source_id=g.bridge_source_id) and (pos is null or (x.ready_at,x.id)>(stamp,last_id)) and (case when p_input ? 'state' then (case when x.state='sending' and x.lease_expires_at<=clock_timestamp() then 'delivery_unknown' else x.state end)=p_input->>'state' else x.state in('pending','retry_wait') and x.ready_at<=clock_timestamp() end) order by x.ready_at,x.id limit size+1)x;
  if jsonb_array_length(rows)>size then
   rows:=rows-size;
   next_cursor:=dashboard_private.ai_agent_cursor_encode_v1(binding,jsonb_build_object('readyAt',rows->-1->>'readyAt','id',rows->-1->>'id'));
  end if;
  return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('items',rows,'nextCursor',next_cursor),c.id,case when p_action='record_attempt' and c.credential_kind='central' then null else 'chat' end);
 end if;
 if p_action='chat_outbox' then
  resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'bridgeSourceId');
  -- Omission is the legacy contract; explicit null is invalid, never a new identity.
  if p_input ? 'clientMessageId' then client_message:=dashboard_private.ai_agent_required_uuid_v1(p_input,'clientMessageId');end if;
  o.purpose:='bridge_reply';o.bridge_source_id:=resource;o.space_key:=dashboard_private.ai_agent_text_v1(p_input,'spaceKey',20);
  perform dashboard_private.chat_authorize_intent_v1(c.id,o);
  select * into cfg from dashboard_private.chat_space_configuration where space_key=o.space_key for share;
  if not found or not cfg.configured then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
  o.thread_name:=dashboard_private.ai_agent_text_v1(p_input,'threadName',500);o.source_event_id:=dashboard_private.ai_agent_text_v1(p_input,'sourceEventId',200);
  if o.source_event_id !~ '^spaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+$' or split_part(o.source_event_id,'/messages/',1)<>cfg.resource_name then raise exception using errcode='22023',message='chat_source_event_invalid';end if;
  if o.thread_name !~ '^spaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_-]+$' or split_part(o.thread_name,'/threads/',1)<>cfg.resource_name then raise exception using errcode='22023',message='chat_thread_invalid';end if;
  payload:=jsonb_build_object('text',dashboard_private.ai_agent_text_v1(p_input,'text',20000),'thread',jsonb_build_object('name',o.thread_name));
  if octet_length(payload::text)>32000 then raise exception using errcode='22023',message='chat_payload_too_large';end if;
  key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='bot' and principal_id=c.id and operation='chat_outbox' and resource_id=resource and idempotency_key=key;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   select * into o from dashboard_private.chat_delivery_outbox where id=(rec.result->'outbox'->>'id')::uuid;
   return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',false),c.id,case when p_action='record_attempt' and c.credential_kind='central' then null else 'chat' end);
  end if;
  -- Lock client identity before the existing event identity, across key rotation.
  -- Different events cannot race one client ID into inconsistent receipts.
  if client_message is not null then
   perform pg_advisory_xact_lock(hashtextextended('chat-client:'||resource::text||':'||client_message::text,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(resource::text||':'||o.source_event_id,0));
  select * into o from dashboard_private.chat_delivery_outbox where bridge_source_id=resource
   and (case when client_message is null then source_event_id=p_input->>'sourceEventId' and client_message_id is null else client_message_id=client_message end);
  if found then
   if o.source_event_id is distinct from p_input->>'sourceEventId' or o.payload is distinct from payload or o.space_key is distinct from p_input->>'spaceKey' or o.thread_name is distinct from p_input->>'threadName' then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',false);
  else
   -- One observed source event stays in one exact space/thread across replies.
   if exists(select 1 from dashboard_private.chat_delivery_outbox prior where prior.bridge_source_id=resource and prior.source_event_id=p_input->>'sourceEventId' and (prior.space_key is distinct from p_input->>'spaceKey' or prior.expected_space is distinct from cfg.resource_name or prior.thread_name is distinct from p_input->>'threadName')) then
    raise exception using errcode='23514',message='ai_agent_idempotency_conflict';
   end if;
   -- A fresh message ID is not a recovery mechanism for an unresolved send.
   if exists(select 1 from dashboard_private.chat_delivery_outbox prior where prior.bridge_source_id=resource and prior.source_event_id=p_input->>'sourceEventId' and prior.state in('pending','retry_wait','sending','delivery_unknown','incident')) then
    raise exception using errcode='55000',message='ai_agent_effect_unresolved';
   end if;
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   insert into dashboard_private.chat_delivery_outbox(bridge_source_id,source_event_id,client_message_id,purpose,space_key,expected_space,thread_name,payload,payload_hash) values(resource,p_input->>'sourceEventId',client_message,'bridge_reply',p_input->>'spaceKey',cfg.resource_name,p_input->>'threadName',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) returning * into o;
   result:=jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'created',true);
  end if;
 else
  if p_action='get' and p_input ? 'clientMessageId' then
   if p_input ? 'id' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   client_message:=dashboard_private.ai_agent_required_uuid_v1(p_input,'clientMessageId');
   select id into resource from dashboard_private.chat_delivery_outbox where bridge_source_id=g.bridge_source_id and client_message_id=client_message;
   if resource is null then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  else resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'id');end if;
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
   -- Same lock order as creation: current credential/config, event, then outbox.
   select bridge_source_id,source_event_id into event_source,event_id from dashboard_private.chat_delivery_outbox where id=resource and purpose='bridge_reply';
   if event_source is not null then perform pg_advisory_xact_lock(hashtextextended(event_source::text||':'||event_id,0));end if;
   if o.request_id is not null then select * into r from dashboard_private.ai_agent_requests where id=o.request_id for update;end if;
  end if;
  if p_action='record_attempt' then
   -- Late contradictory results can change a terminal row to incident. Serialize
   -- that decision with new replies and dispatch permits before locking outbox.
   select bridge_source_id,source_event_id into event_source,event_id from dashboard_private.chat_delivery_outbox where id=resource and purpose='bridge_reply';
   if event_source is not null then perform pg_advisory_xact_lock(hashtextextended(event_source::text||':'||event_id,0));end if;
  end if;
  if p_action='get' then select * into o from dashboard_private.chat_delivery_outbox where id=resource;
  else select * into o from dashboard_private.chat_delivery_outbox where id=resource for update;end if;
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  if p_action<>'record_attempt' or c.credential_kind='personal' then perform dashboard_private.chat_authorize_intent_v1(c.id,o);end if;
  if p_action='get' then
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempts',case when c.credential_kind='personal' then '[]'::jsonb else (select coalesce(jsonb_agg(dashboard_private.chat_attempt_json_v1(t) order by t.created_at,t.id),'[]') from(select * from dashboard_private.chat_delivery_attempts where outbox_id=o.id order by created_at desc,id desc limit 50)t) end),c.id,case when p_action='record_attempt' and c.credential_kind='central' then null else 'chat' end);
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
   return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('outbox',dashboard_private.chat_outbox_json_v1(o),'attempt',case when p_action='record_attempt' then rec.result->'attempt' else null end),c.id,case when p_action='record_attempt' and c.credential_kind='central' then null else 'chat' end);
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
    if o.purpose='bridge_reply' and exists(select 1 from dashboard_private.chat_delivery_outbox prior where prior.bridge_source_id=o.bridge_source_id and prior.source_event_id=o.source_event_id and prior.id<>o.id and prior.state in('pending','retry_wait','sending','delivery_unknown','incident')) then
     raise exception using errcode='55000',message='ai_agent_effect_unresolved';
    end if;
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
 return dashboard_private.ai_agent_deadline_result_v1(result,c.id,case when p_action='record_attempt' and c.credential_kind='central' then null else 'chat' end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

commit;
