-- Canonical personal support; does not enable issuance, configure providers or issue keys.
-- Frozen source: 0243fac336f578f7a5a89924eaeadd810c84e19e; original seven AI migrations unchanged.
-- Personal credentials are admin issued, bound to one current teacher profile,
-- and limited to that teacher's own requests. Role promotion also fails closed.
-- Existing central keys retain their issuer/queue behavior. No JWT/GUC impersonation.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- This release installs AI support for the first time. Do not silently use this
-- atomic index rollout to upgrade a populated installation. Locks retain the
-- verified empty state; the five-second timeout aborts behind another writer.
do $ai_personal_first_install$
declare enabled boolean;
begin
 select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton for share;
 if enabled is distinct from false then
  raise exception using errcode='55000',message='ai_agent_personal_install_issuance_not_disabled';
 end if;
 lock table dashboard_private.ai_agent_credentials,dashboard_private.ai_agent_request_events,
  dashboard_private.ai_agent_action_events,dashboard_private.chat_delivery_attempts in access exclusive mode;
 if exists(select 1 from dashboard_private.ai_agent_credentials)
  or exists(select 1 from dashboard_private.ai_agent_request_events)
  or exists(select 1 from dashboard_private.ai_agent_action_events)
  or exists(select 1 from dashboard_private.chat_delivery_attempts) then
  raise exception using errcode='55000',message='ai_agent_personal_install_not_empty';
 end if;
end
$ai_personal_first_install$;

alter table dashboard_private.ai_agent_credentials
 add column credential_kind text not null default 'central',
 add column owner_profile_id uuid,
 add constraint ai_agent_credential_owner_fk foreign key(owner_profile_id) references public.profiles(id) not valid,
 add constraint ai_agent_credential_owner_kind_check check (
  (credential_kind='central' and owner_profile_id is null) or
  (credential_kind='personal' and owner_profile_id is not null)) not valid;
-- The guard above enforces an empty table and retains its lock through COMMIT.
-- squawk-ignore require-concurrent-index-creation
create index ai_agent_credentials_personal_owner_created
 on dashboard_private.ai_agent_credentials(owner_profile_id,created_at desc,id)
 where credential_kind='personal';
alter table dashboard_private.ai_agent_request_events add column owner_profile_id uuid,
 add constraint ai_agent_event_owner_fk foreign key(owner_profile_id) references public.profiles(id) not valid;
alter table dashboard_private.ai_agent_action_events add column owner_profile_id uuid,
 add constraint ai_agent_action_owner_fk foreign key(owner_profile_id) references public.profiles(id) not valid;
alter table dashboard_private.chat_delivery_attempts add column owner_profile_id uuid,
 add constraint chat_attempt_owner_fk foreign key(owner_profile_id) references public.profiles(id) not valid;

create function dashboard_private.ai_agent_personal_identity_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='ai_agent_credentials' then
  if new.owner_profile_id is distinct from old.owner_profile_id or new.credential_kind is distinct from old.credential_kind or new.created_by is distinct from old.created_by then
   raise exception using errcode='55000',message='ai_agent_immutable';
  end if;
 elsif new.requester_id is distinct from old.requester_id or new.queue_key is distinct from old.queue_key then
  raise exception using errcode='55000',message='ai_agent_immutable';
 end if;
 return new;
end$$;
create trigger ai_agent_credentials_personal_identity before update on dashboard_private.ai_agent_credentials for each row execute function dashboard_private.ai_agent_personal_identity_v1();
create trigger ai_agent_requests_owner_identity before update on dashboard_private.ai_agent_requests for each row execute function dashboard_private.ai_agent_personal_identity_v1();

create function dashboard_private.ai_agent_personal_row_allowed_v1(c dashboard_private.ai_agent_credentials,p_requester uuid) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(c.credential_kind='central' or (c.credential_kind='personal' and c.owner_profile_id=p_requester),false)
$$;

create function dashboard_private.ai_agent_personal_audit_owner_v1() returns trigger
language plpgsql set search_path='' as $$
declare cid uuid; c dashboard_private.ai_agent_credentials; requester uuid;
begin
 if tg_table_name='ai_agent_request_events' then
  cid:=new.credential_id;requester:=new.requester_id;
 elsif tg_table_name='ai_agent_action_events' then
  if new.actor_kind='bot' then cid:=new.actor_id;end if;
  select r.requester_id into requester from dashboard_private.ai_agent_request_actions a join dashboard_private.ai_agent_requests r on r.id=a.request_id where a.id=new.action_id;
 else
  cid:=new.credential_id;
  select r.requester_id into requester from dashboard_private.chat_delivery_outbox o join dashboard_private.ai_agent_requests r on r.id=o.request_id where o.id=new.outbox_id;
 end if;
 if cid is not null then select * into c from dashboard_private.ai_agent_credentials where id=cid;end if;
 if new.owner_profile_id is not null and new.owner_profile_id is distinct from c.owner_profile_id then raise exception using errcode='55000',message='ai_agent_immutable';end if;
 if c.credential_kind='personal' and not dashboard_private.ai_agent_personal_row_allowed_v1(c,requester) then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 new.owner_profile_id:=c.owner_profile_id;
 return new;
end$$;
create trigger ai_agent_request_events_personal_owner before insert on dashboard_private.ai_agent_request_events for each row execute function dashboard_private.ai_agent_personal_audit_owner_v1();
create trigger ai_agent_action_events_personal_owner before insert on dashboard_private.ai_agent_action_events for each row execute function dashboard_private.ai_agent_personal_audit_owner_v1();
create trigger chat_delivery_attempts_personal_owner before insert on dashboard_private.chat_delivery_attempts for each row execute function dashboard_private.ai_agent_personal_audit_owner_v1();


-- The caller already holds credential/identity/applicable grant locks. This
-- final guard takes no new row locks. A deadline reached during any later wait
-- aborts the whole RPC, including SQL mutations made before an implicit FK wait.
-- Central late-result recording deliberately has no queue/Chat/domain grant.
create function dashboard_private.ai_agent_deadline_result_v1(
 p_result jsonb,p_credential uuid,p_grant_family text default null,
 p_domain_kind text default null,p_domain_target text default null,p_domain_hash text default null
) returns jsonb language plpgsql volatile set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; cg dashboard_private.chat_credential_space_grants; dg dashboard_private.ai_agent_domain_action_grants; checked_at timestamptz;
begin
 if (p_grant_family is not null and p_grant_family not in('ai','chat')) or num_nonnulls(p_domain_kind,p_domain_target,p_domain_hash) not in(0,3) or (p_domain_kind is not null and p_grant_family is distinct from 'ai') then
  raise exception using errcode='22023',message='ai_agent_invalid';
 end if;
 select * into c from dashboard_private.ai_agent_credentials where id=p_credential;
 if p_grant_family='ai' then select * into g from dashboard_private.ai_agent_credential_grants where credential_id=p_credential;
 elsif p_grant_family='chat' then select * into cg from dashboard_private.chat_credential_space_grants where credential_id=p_credential;end if;
 if p_domain_kind is not null then select * into dg from dashboard_private.ai_agent_domain_action_grants where credential_id=p_credential and kind=p_domain_kind and target=p_domain_target and payload_hash=p_domain_hash;end if;
 -- Sample once after every lookup, including any relation-lock wait.
 checked_at:=clock_timestamp();
 if c.id is null or c.revoked_at is not null or c.expires_at<=checked_at then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 if (p_grant_family='ai' and (g.credential_id is null or g.revoked_at is not null or g.expires_at<=checked_at)) or (p_grant_family='chat' and (cg.credential_id is null or cg.revoked_at is not null or cg.expires_at<=checked_at)) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 if p_domain_kind is not null and (dg.credential_id is null or dg.revoked_at is not null or dg.expires_at<=checked_at) then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 return p_result;
end$$;
revoke all on function dashboard_private.ai_agent_deadline_result_v1(jsonb,uuid,text,text,text,text) from public,anon,authenticated,service_role;

create or replace function dashboard_private.ai_agent_authenticate_v1(p_hash text,p_scope text,p_grant_action text default null,p_chat boolean default false) returns dashboard_private.ai_agent_credentials
language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; cg dashboard_private.chat_credential_space_grants; issuer_role text; owner_role text;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 select * into c from dashboard_private.ai_agent_credentials where token_hash=p_hash for update;
 if not found or c.revoked_at is not null or c.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 -- Existing-key writers use credential -> profile/auth -> grant -> request.
 -- Issuance locks the profile then INSERTS a new key; it never locks an existing key.
 select role into issuer_role from public.profiles where id=c.created_by for share;
 if issuer_role is distinct from 'admin' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform 1 from auth.users where id=c.created_by and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 -- Credential -> current issuer profile/auth -> current owner profile/auth -> grants.
 -- Validate issuer immediately: a personal owner's current role is teacher, not admin.
 -- User cancellation/policy changes lock owner profile before request/outbox and never credential.
 if c.credential_kind='personal' then
  select role into owner_role from public.profiles where id=c.owner_profile_id for share;
  if owner_role is distinct from 'teacher' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=c.owner_profile_id and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 end if;
 if not p_scope=any(c.scopes) then raise exception using errcode='42501',message='ai_agent_scope_forbidden';end if;
 if p_chat or (c.credential_kind='personal' and p_scope in('chat:outbox:read','chat:send')) then
  select * into cg from dashboard_private.chat_credential_space_grants where credential_id=c.id for update;
  if not found or cg.revoked_at is not null or cg.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
  if c.credential_kind='personal' and (cg.purposes is distinct from array['ai_completion']::text[] or cg.bridge_source_id is not null) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 elsif p_grant_action is not null then
  select * into g from dashboard_private.ai_agent_credential_grants where credential_id=c.id for update;
  if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp() or not p_grant_action=any(g.actions) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 end if;
 perform dashboard_private.ai_agent_deadline_result_v1(null,c.id,case when p_chat or (c.credential_kind='personal' and p_scope in('chat:outbox:read','chat:send')) then 'chat' when p_grant_action is not null then 'ai' else null end);
 return c;
end$$;

create or replace function dashboard_private.ai_agent_bot_read_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.ai_agent_credentials:=dashboard_private.ai_agent_require_bot_v1(p_token_hash,p_action); r dashboard_private.ai_agent_requests; grant_row dashboard_private.ai_agent_credential_grants; size integer; cursor_time timestamptz; cursor_id uuid; cursor_json jsonb; items jsonb; next_cursor text;
begin
 select * into grant_row from dashboard_private.ai_agent_credential_grants where credential_id=cred.id;
 if p_action='get' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['id']);
  if jsonb_typeof(p_input->'id') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select * into r from dashboard_private.ai_agent_requests where id=(p_input->>'id')::uuid and queue_key=any(grant_row.queues) and dashboard_private.ai_agent_personal_row_allowed_v1(cred,requester_id);
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_request_json_v1(r),cred.id,'ai');
 elsif p_action='list' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['limit','status','cursor']);
  if (p_input ? 'limit' and jsonb_typeof(p_input->'limit') is distinct from 'number') or (p_input ? 'status' and p_input->>'status' is distinct from 'pending') or (p_input ? 'cursor' and jsonb_typeof(p_input->'cursor') is distinct from 'string') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  size:=coalesce((p_input->>'limit')::integer,50);
  if size<1 or size>50 then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if p_input ? 'cursor' then
   if length(p_input->>'cursor')>512 then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   cursor_json:=convert_from(decode(p_input->>'cursor','base64'),'UTF8')::jsonb;
   perform dashboard_private.ai_agent_assert_input_v1(cursor_json,array['readyAt','id']);
   cursor_time:=(cursor_json->>'readyAt')::timestamptz;cursor_id:=(cursor_json->>'id')::uuid;
   if cursor_time is null or cursor_id is null then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  end if;
  select coalesce(jsonb_agg(dashboard_private.ai_agent_request_json_v1(x) order by x.ready_at,x.id),'[]') into items from (select * from dashboard_private.ai_agent_requests x where x.queue_key=any(grant_row.queues) and dashboard_private.ai_agent_personal_row_allowed_v1(cred,x.requester_id) and x.status='pending' and (cursor_id is null or (x.ready_at,x.id)>(cursor_time,cursor_id)) order by x.ready_at,x.id limit size) x;
  if jsonb_array_length(items)=size then next_cursor:=replace(encode(convert_to(jsonb_build_object('readyAt',items->-1->>'readyAt','id',items->-1->>'id')::text,'UTF8'),'base64'),E'\n','');end if;
  return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('items',items,'nextCursor',next_cursor),cred.id,'ai');
 else raise exception using errcode='22023',message='ai_agent_invalid';end if;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create or replace function dashboard_private.ai_agent_project_mutation_v1(ai_result jsonb,c dashboard_private.ai_agent_credentials) returns jsonb language sql volatile set search_path='' as $$
select case when not ai_result ? 'request' or ('ai-agent:requests:read'=any(c.scopes) and exists(select 1 from dashboard_private.ai_agent_credential_grants g join dashboard_private.ai_agent_requests r on r.id=(ai_result->'request'->>'id')::uuid where g.credential_id=c.id and 'read'=any(g.actions) and r.queue_key=any(g.queues) and dashboard_private.ai_agent_personal_row_allowed_v1(c,r.requester_id) and g.revoked_at is null and g.expires_at>clock_timestamp())) then ai_result else jsonb_set(ai_result,'{request}',jsonb_build_object('id',ai_result->'request'->'id','status',ai_result->'request'->'status','version',ai_result->'request'->'version')) end
$$;

create or replace function dashboard_private.ai_agent_live_claim_v1(r dashboard_private.ai_agent_requests,c uuid,i jsonb) returns dashboard_private.ai_agent_request_claims
language plpgsql set search_path='' as $$
declare cl dashboard_private.ai_agent_request_claims; generation bigint:=dashboard_private.ai_agent_decimal_v1(i,'claimGeneration');
begin
 if not exists(select 1 from dashboard_private.ai_agent_credentials cred where cred.id=c and dashboard_private.ai_agent_personal_row_allowed_v1(cred,r.requester_id)) then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 select * into cl from dashboard_private.ai_agent_request_claims where request_id=r.id for update;
 if jsonb_typeof(i->'claimTokenHash') is distinct from 'string' or i->>'claimTokenHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if r.status in('done','cancelled') then raise exception using errcode='55000',message='ai_agent_terminal';end if;
 if r.status<>'processing' or cl.request_id is null or cl.credential_id<>c or cl.token_hash<>i->>'claimTokenHash' or cl.generation<>generation or r.claim_generation<>generation or cl.lease_expires_at<=clock_timestamp() then raise exception using errcode='55000',message='ai_agent_claim_lost';end if;
 return cl;
end$$;

create or replace function public.ai_agent_bot_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; r dashboard_private.ai_agent_requests; cl dashboard_private.ai_agent_request_claims; rec dashboard_private.ai_agent_request_receipts; a dashboard_private.ai_agent_request_actions; m dashboard_private.ai_agent_request_messages; key uuid; fingerprint text; result jsonb; event_id uuid; old_status text; requester uuid; requester_role text; e jsonb;
begin
 if p_action in('get','list') then return dashboard_private.ai_agent_bot_read_v1(p_token_hash,p_action,p_input);end if;
 if p_action not in('claim','renew','progress','question','done','register_action','start_action','record_action','activity','actions','action_events') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action='claim' then 'ai-agent:requests:claim' when p_action in('activity','actions','action_events') then 'ai-agent:requests:read' else 'ai-agent:requests:update' end,case when p_action in('register_action','start_action') then 'done' when p_action='record_action' then null when p_action in('activity','actions','action_events') then 'read' else p_action end);
 if c.credential_kind='personal' and p_action in('register_action','start_action','record_action') then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 select * into g from dashboard_private.ai_agent_credential_grants where credential_id=c.id;
 perform dashboard_private.ai_agent_assert_input_v1(p_input,case p_action
 when 'claim' then array['id','version','idempotencyKey','claimTokenHash']
 when 'activity' then array['id','afterMessageSeq','afterEventSeq','limit']
 when 'actions' then array['id','limit','cursor'] when 'action_events' then array['id','actionId','limit','cursor']
 when 'register_action' then array['id','claimTokenHash','claimGeneration','idempotencyKey','actionKey','stepKey','kind','target','payload','payloadHash']
 when 'start_action' then array['id','claimTokenHash','claimGeneration','idempotencyKey','actionId','revision','target','payloadHash']
 when 'record_action' then array['id','idempotencyKey','actionId','revision','state','target','payloadHash','evidence','claimTokenHash','claimGeneration']
 when 'done' then array['id','version','idempotencyKey','claimTokenHash','claimGeneration','result']
 when 'progress' then array['id','version','idempotencyKey','claimTokenHash','claimGeneration','text']
 when 'question' then array['id','version','idempotencyKey','claimTokenHash','claimGeneration','text']
 else array['id','version','idempotencyKey','claimTokenHash','claimGeneration'] end);
 -- All domain grant/registry locks precede request, then the definitive
 -- permission callback runs after request/claim/action validation under them.
 if p_action in('register_action','start_action') then
  if p_action='register_action' then
   a.kind:=p_input->>'kind';a.target:=p_input->>'target';a.payload_hash:=p_input->>'payloadHash';
  else
   select * into a from dashboard_private.ai_agent_request_actions where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'actionId') and request_id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and credential_id=c.id;
   if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  end if;
  perform 1 from dashboard_private.ai_agent_action_registry where kind=a.kind and enabled for share;
  if not found then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
  perform 1 from dashboard_private.ai_agent_domain_action_grants where credential_id=c.id and kind=a.kind and target=a.target and payload_hash=a.payload_hash and revoked_at is null and expires_at>clock_timestamp() for share;
  if not found then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
  select requester_id into requester from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id');
  select role into requester_role from public.profiles where id=requester for share;
  if requester_role is null or requester_role not in('admin','staff','teacher','assistant') then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
  perform 1 from auth.users where id=requester and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 end if;
 if p_action in('activity','actions','action_events') then select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and queue_key=any(g.queues) and dashboard_private.ai_agent_personal_row_allowed_v1(c,requester_id);
 else select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and (p_action='record_action' or queue_key=any(g.queues)) and dashboard_private.ai_agent_personal_row_allowed_v1(c,requester_id) for update;end if;
 if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 if p_action in('activity','actions','action_events') then
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  if p_action='activity' then return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_activity_v1(r,p_input),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);end if;
  return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_actions_read_v1(r,p_input,'bot:'||c.id::text,p_action),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);
 end if;
 key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
 select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='bot' and principal_id=c.id and operation=p_action and resource_id=r.id and idempotency_key=key;
 if rec.principal_id is not null and rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
 if p_action='claim' then
  if jsonb_typeof(p_input->'claimTokenHash') is distinct from 'string' or p_input->>'claimTokenHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if rec.principal_id is not null then
   cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input||jsonb_build_object('claimGeneration',rec.result->'claim'->>'generation'));
   return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(rec.result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);
  end if;
  if r.status in('done','cancelled') then raise exception using errcode='55000',message='ai_agent_terminal';end if;
  if r.status<>'pending' then raise exception using errcode='55000',message='ai_agent_conflict';end if;
  if r.version<>dashboard_private.ai_agent_decimal_v1(p_input,'version') then raise exception using errcode='55000',message='ai_agent_stale_version';end if;
  if exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and state in('prepared','started','unknown')) then raise exception using errcode='55000',message='ai_agent_effect_unresolved';end if;
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  update dashboard_private.ai_agent_requests set status='processing',version=version+1,claim_generation=claim_generation+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into dashboard_private.ai_agent_request_claims(request_id,credential_id,token_hash,generation,lease_expires_at) values(r.id,c.id,p_input->>'claimTokenHash',r.claim_generation,clock_timestamp()+interval '15 minutes') returning * into cl;
  perform dashboard_private.ai_agent_event_v1(r,'claimed','bot',c.id,c.created_by,'pending',jsonb_build_object('generation',cl.generation::text));
  result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r),'claim',jsonb_build_object('generation',cl.generation::text,'leaseExpiresAt',cl.lease_expires_at));
 elsif p_action in('register_action','start_action','record_action') then
  if p_action<>'record_action' then cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input);end if;
  if p_action='register_action' then
   a.request_id:=r.id;a.credential_id:=c.id;a.action_key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'actionKey');a.step_key:=dashboard_private.ai_agent_text_v1(p_input,'stepKey',100);a.kind:=dashboard_private.ai_agent_text_v1(p_input,'kind',80);a.target:=dashboard_private.ai_agent_text_v1(p_input,'target',500);a.payload:=p_input->'payload';a.payload_hash:=p_input->>'payloadHash';
   if jsonb_typeof(a.payload) is distinct from 'object' or a.payload_hash is null or a.payload_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   perform dashboard_private.ai_agent_authorize_action_v1(c.id,r,a);
   if rec.principal_id is not null then return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(rec.result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);end if;
   if exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and (action_key=a.action_key or (kind=a.kind and target=a.target and payload_hash=a.payload_hash))) then raise exception using errcode='55000',message='ai_agent_conflict';end if;
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   insert into dashboard_private.ai_agent_request_actions(request_id,credential_id,action_key,step_key,kind,target,payload,payload_hash,generation) values(r.id,c.id,a.action_key,a.step_key,a.kind,a.target,a.payload,a.payload_hash,cl.generation) returning * into a;
   perform dashboard_private.ai_agent_action_event_v1(a,'prepared','bot',c.id);
  else
   select * into a from dashboard_private.ai_agent_request_actions where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'actionId') and request_id=r.id and credential_id=c.id for update;
   if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
   if p_action='start_action' then perform dashboard_private.ai_agent_authorize_action_v1(c.id,r,a);end if;
   if rec.principal_id is not null then return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(rec.result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);end if;
   if a.revision<>dashboard_private.ai_agent_decimal_v1(p_input,'revision') then raise exception using errcode='55000',message='ai_agent_conflict';end if;
   perform dashboard_private.ai_agent_text_v1(p_input,'target',500);
   if jsonb_typeof(p_input->'payloadHash') is distinct from 'string' or p_input->>'payloadHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   if p_action='record_action' and a.state='prepared' and p_input->>'state'='cancelled' then
    cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input);
    if a.generation<>cl.generation or a.target is distinct from p_input->>'target' or a.payload_hash is distinct from p_input->>'payloadHash' then raise exception using errcode='55000',message='ai_agent_conflict';end if;
    e:=p_input->'evidence';perform dashboard_private.ai_agent_assert_input_v1(e,array['code']);perform dashboard_private.ai_agent_text_v1(e,'code',100);
    perform dashboard_private.ai_agent_consume_rate_v1(c.id);
    update dashboard_private.ai_agent_request_actions set state='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
    perform dashboard_private.ai_agent_action_event_v1(a,'cancelled','bot',c.id,e);
   elsif a.target is distinct from p_input->>'target' or a.payload_hash is distinct from p_input->>'payloadHash' then
    if p_action='start_action' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
    if a.state not in('started','unknown','succeeded','failed') then raise exception using errcode='55000',message='ai_agent_conflict';end if;
    perform dashboard_private.ai_agent_consume_rate_v1(c.id);
    update dashboard_private.ai_agent_request_actions set state='unknown',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
    perform dashboard_private.ai_agent_action_event_v1(a,'incident','bot',c.id,jsonb_build_object('reason','target_or_payload_mismatch','reportedTarget',p_input->>'target','reportedPayloadHash',p_input->>'payloadHash'));
   elsif p_action='start_action' then
    if a.state<>'prepared' or a.generation<>cl.generation then raise exception using errcode='55000',message='ai_agent_conflict';end if;
    perform dashboard_private.ai_agent_consume_rate_v1(c.id);
    update dashboard_private.ai_agent_request_actions set state='started',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
    perform dashboard_private.ai_agent_action_event_v1(a,'started','bot',c.id);
   else
    if a.state not in('started','unknown','succeeded','failed') or jsonb_typeof(p_input->'state') is distinct from 'string' or p_input->>'state' not in('succeeded','failed','unknown') then raise exception using errcode='55000',message='ai_agent_conflict';end if;
    e:=p_input->'evidence';perform dashboard_private.ai_agent_assert_input_v1(e,array['resourceName','code','observation']);
    if p_input->>'state'='succeeded' then perform dashboard_private.ai_agent_text_v1(e,'resourceName',500);end if;
    if p_input->>'state'='failed' then perform dashboard_private.ai_agent_text_v1(e,'code',100);end if;
    if e ? 'observation' then perform dashboard_private.ai_agent_text_v1(e,'observation',5000);end if;
    perform dashboard_private.ai_agent_consume_rate_v1(c.id);
    if a.state in('succeeded','failed') then
     update dashboard_private.ai_agent_request_actions set state='unknown',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
     perform dashboard_private.ai_agent_action_event_v1(a,'incident','bot',c.id,e||jsonb_build_object('reason','contradictory_result','reportedOutcome',p_input->>'state'));
    else
     update dashboard_private.ai_agent_request_actions set state=p_input->>'state',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
     perform dashboard_private.ai_agent_action_event_v1(a,'result','bot',c.id,e||jsonb_build_object('outcome',a.state));
    end if;
   end if;
  end if;
  result:=dashboard_private.ai_agent_action_json_v1(a);
 else
  -- A narrowly proved readback of the operation which ended this generation
  -- does not restore its claim. Any answer/cancel/later version ends readback.
  if rec.principal_id is not null and p_action in('done','question') and r.status=p_action and r.version::text=rec.result->'request'->>'version' and r.open_question_id::text is not distinct from rec.result->'request'->>'openQuestionId' and r.claim_generation=dashboard_private.ai_agent_decimal_v1(p_input,'claimGeneration')+1 then return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(rec.result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);end if;
  cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input);
  if rec.principal_id is not null then return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(rec.result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);end if;
  if r.version<>dashboard_private.ai_agent_decimal_v1(p_input,'version') then raise exception using errcode='55000',message='ai_agent_stale_version';end if;
  old_status:=r.status;
  if p_action in('done','question') and exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and state in('prepared','started','unknown')) then raise exception using errcode='55000',message='ai_agent_effect_unresolved';end if;
  if p_action in('question','progress') then perform dashboard_private.ai_agent_text_v1(p_input,'text',5000);end if;
  if p_action='done' then perform dashboard_private.ai_agent_text_v1(p_input,'result',20000);end if;
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  if p_action='renew' then
   update dashboard_private.ai_agent_request_claims set lease_expires_at=clock_timestamp()+interval '15 minutes',renewed_at=clock_timestamp() where request_id=r.id returning * into cl;
   perform dashboard_private.ai_agent_event_v1(r,'renewed','bot',c.id,c.created_by,old_status,jsonb_build_object('generation',cl.generation::text));
   result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r),'claim',jsonb_build_object('generation',cl.generation::text,'leaseExpiresAt',cl.lease_expires_at));
  elsif p_action in('question','progress') then
   insert into dashboard_private.ai_agent_request_messages(request_id,message_seq,kind,text,author_kind,author_id) values(r.id,coalesce((select max(message_seq) from dashboard_private.ai_agent_request_messages where request_id=r.id),0)+1,p_action,p_input->>'text','bot',c.id) returning * into m;
   update dashboard_private.ai_agent_requests set version=version+1,updated_at=clock_timestamp(),status=case when p_action='question' then 'question' else status end,open_question_id=case when p_action='question' then m.id else open_question_id end,claim_generation=claim_generation+case when p_action='question' then 1 else 0 end where id=r.id returning * into r;
   if p_action='question' then delete from dashboard_private.ai_agent_request_claims where request_id=r.id;end if;
   perform dashboard_private.ai_agent_event_v1(r,p_action,'bot',c.id,c.created_by,old_status,jsonb_build_object('messageId',m.id));
   result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r),'message',dashboard_private.ai_agent_message_json_v1(m));
  else
   update dashboard_private.ai_agent_requests set status='done',result=p_input->>'result',version=version+1,updated_at=clock_timestamp(),claim_generation=claim_generation+1 where id=r.id returning * into r;
   delete from dashboard_private.ai_agent_request_claims where request_id=r.id;
   event_id:=dashboard_private.ai_agent_event_v1(r,'done','bot',c.id,c.created_by,old_status);
   perform dashboard_private.ai_agent_completion_outbox_v1(r,event_id);
   result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r));
  end if;
 end if;
 insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('bot',c.id,p_action,r.id,key,fingerprint,result);
 return dashboard_private.ai_agent_deadline_result_v1(dashboard_private.ai_agent_project_mutation_v1(result,c),c.id,case when p_action='record_action' then null else 'ai' end,case when p_action in('register_action','start_action') then a.kind end,case when p_action in('register_action','start_action') then a.target end,case when p_action in('register_action','start_action') then a.payload_hash end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create or replace function dashboard_private.chat_authorize_intent_v1(c uuid,o dashboard_private.chat_delivery_outbox) returns void language plpgsql set search_path='' as $$
declare g dashboard_private.chat_credential_space_grants;
begin
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c;
 if exists(select 1 from dashboard_private.ai_agent_credentials cred where cred.id=c and cred.credential_kind='personal') then
  if o.purpose<>'ai_completion' or o.request_id is null or not exists(select 1 from dashboard_private.ai_agent_credentials cred join dashboard_private.ai_agent_requests r on r.id=o.request_id join dashboard_private.chat_user_space_permissions p on p.user_id=cred.owner_profile_id join dashboard_private.chat_space_configuration cfg on cfg.space_key=o.space_key where cred.id=c and r.requester_id=cred.owner_profile_id and o.space_key=any(p.space_keys) and cfg.configured) then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
 end if;
 if not o.space_key=any(g.space_keys) or not o.purpose=any(g.purposes) or (o.purpose='bridge_reply' and g.bridge_source_id is distinct from o.bridge_source_id) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
end$$;

create or replace function public.ai_agent_chat_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.chat_credential_space_grants; o dashboard_private.chat_delivery_outbox; a dashboard_private.chat_delivery_attempts; cfg dashboard_private.chat_space_configuration; r dashboard_private.ai_agent_requests; requester_role text; requester uuid; perm dashboard_private.chat_user_space_permissions;
 rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; resource uuid; result jsonb; payload jsonb; attempt uuid; size integer; ai_reason text; global_budget dashboard_private.chat_send_global_budget; space_budget dashboard_private.chat_space_send_budgets; ai_minute timestamptz:=date_trunc('minute',clock_timestamp()); binding text; pos jsonb; stamp timestamptz; last_id uuid; rows jsonb; next_cursor text; outcome text; provider_code text; message_name text; thread_name text;
begin
 if p_action not in('list','get','chat_outbox','prepare_attempt','record_attempt') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action in('get','list') then 'chat:outbox:read' else 'chat:send' end,null,p_action<>'record_attempt');
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c.id;
 if c.credential_kind='personal' then
  if p_action='chat_outbox' then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
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
 when 'list' then array['limit','state','cursor'] when 'get' then array['id']
 when 'chat_outbox' then array['idempotencyKey','bridgeSourceId','sourceEventId','spaceKey','threadName','text']
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

create or replace function dashboard_private.create_ai_agent_personal_credential_v1(p_owner_profile_id uuid,p_label text,p_scopes text[],p_grant jsonb,p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_lock_user_v1(true); expires timestamptz:=coalesce(p_expires_at,clock_timestamp()+interval '1 day'); raw text; cred dashboard_private.ai_agent_credentials; queues text[]; actions text[]; spaces text[]; purposes text[]; bridge uuid; has_ai boolean; has_chat boolean;
begin
 perform 1 from public.profiles where id=p_owner_profile_id and role='teacher' for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform 1 from auth.users where id=p_owner_profile_id and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform dashboard_private.ai_agent_assert_input_v1(p_grant,array['queues','actions','spaceKeys','purposes','bridgeSourceId']);
 has_ai:=p_scopes && array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update']::text[];
 has_chat:=p_scopes && array['chat:outbox:read','chat:send']::text[];
 if p_label is null or btrim(p_label)='' or length(p_label)>80 or p_scopes is null or cardinality(p_scopes)=0 or array_position(p_scopes,null) is not null or cardinality(p_scopes)<>(select count(distinct s) from unnest(p_scopes) s) or not p_scopes <@ array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update','chat:outbox:read','chat:send']::text[] or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if has_ai then
  if jsonb_typeof(p_grant->'queues') is distinct from 'array' or jsonb_typeof(p_grant->'actions') is distinct from 'array' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select array_agg(v) into queues from jsonb_array_elements_text(p_grant->'queues') v;
  select array_agg(v) into actions from jsonb_array_elements_text(p_grant->'actions') v;
  if queues is distinct from array['employee_requests']::text[] or actions is null or array_position(actions,null) is not null or not actions <@ array['read','claim','renew','progress','question','done']::text[] or cardinality(actions)<>(select count(distinct a) from unnest(actions) a)
   or ('ai-agent:requests:read'=any(p_scopes)) is distinct from ('read'=any(actions)) or ('ai-agent:requests:claim'=any(p_scopes)) is distinct from ('claim'=any(actions)) or ('ai-agent:requests:update'=any(p_scopes)) is distinct from (actions && array['renew','progress','question','done']::text[]) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 elsif p_grant ?| array['queues','actions'] then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if has_chat then
  if jsonb_typeof(p_grant->'spaceKeys') is distinct from 'array' or jsonb_typeof(p_grant->'purposes') is distinct from 'array' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select array_agg(v) into spaces from jsonb_array_elements_text(p_grant->'spaceKeys') v;
  select array_agg(v) into purposes from jsonb_array_elements_text(p_grant->'purposes') v;
  bridge:=(p_grant->>'bridgeSourceId')::uuid;
  if spaces is null or purposes is null or array_position(spaces,null) is not null or array_position(purposes,null) is not null or not spaces <@ array['space_1','space_2','space_3','space_4','space_5','space_6','space_7']::text[] or not purposes <@ array['ai_completion','bridge_reply']::text[] or cardinality(spaces)<>(select count(distinct s) from unnest(spaces) s) or cardinality(purposes)<>(select count(distinct p) from unnest(purposes) p) or ('bridge_reply'=any(purposes)) is distinct from (bridge is not null) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 elsif p_grant ?| array['spaceKeys','purposes','bridgeSourceId'] then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 -- The decisive admin check and issuer lock precede all issuance validation;
 -- that same held lock makes the twenty-active-key limit atomic.
 if (select count(*) from dashboard_private.ai_agent_credentials where created_by=actor and revoked_at is null and expires_at>clock_timestamp())>=20 then raise exception using errcode='54000',message='ai_agent_credential_limit';end if;
 if has_chat and (purposes is distinct from array['ai_completion']::text[] or bridge is not null) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.ai_agent_credentials(created_by,credential_kind,owner_profile_id,label,token_hash,scopes,expires_at) values(actor,'personal',p_owner_profile_id,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,expires) returning * into cred;
 if has_ai then insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(cred.id,queues,actions,expires);end if;
 if has_chat then insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,bridge_source_id,expires_at) values(cred.id,spaces,purposes,bridge,expires);end if;
 return jsonb_build_object('id',cred.id,'label',cred.label,'token',raw,'scopes',cred.scopes,'grant',p_grant,'expiresAt',cred.expires_at,'credentialKind',cred.credential_kind,'ownerProfileId',cred.owner_profile_id,'issuerProfileId',cred.created_by,'ownerName',(select p.name from public.profiles p where p.id=cred.owner_profile_id),'issuerName',(select p.name from public.profiles p where p.id=cred.created_by));
exception when invalid_text_representation then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create function dashboard_private.ai_agent_personal_credential_json_v1(c dashboard_private.ai_agent_credentials) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'label',c.label,'scopes',c.scopes,'expiresAt',c.expires_at,'credentialKind',c.credential_kind,'ownerProfileId',c.owner_profile_id,'issuerProfileId',c.created_by,'ownerName',(select p.name from public.profiles p where p.id=c.owner_profile_id),'issuerName',(select p.name from public.profiles p where p.id=c.created_by),'createdAt',c.created_at,'revokedAt',c.revoked_at,'lastUsedAt',c.last_used_at,'grant',jsonb_strip_nulls(jsonb_build_object('queues',a.queues,'actions',a.actions,'spaceKeys',g.space_keys,'purposes',g.purposes,'bridgeSourceId',g.bridge_source_id)))
 from dashboard_private.ai_agent_credential_grants a full join dashboard_private.chat_credential_space_grants g on g.credential_id=a.credential_id
 where coalesce(a.credential_id,g.credential_id)=c.id
$$;

create function public.ai_agent_personal_credential_api_v1(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; owner_id uuid; enabled boolean; k uuid; resource uuid:='00000000-0000-0000-0000-000000000000'; fingerprint text; rec dashboard_private.ai_agent_request_receipts; c dashboard_private.ai_agent_credentials; result jsonb; scopes text[]; expires timestamptz; page integer; size integer;
begin
 if p_action='owners' then
  -- Display-only candidates never grant authority. Creation independently locks
  -- and rechecks the selected owner's current role/auth before issuance.
  select role into actor_role from public.profiles where id=actor for share;
  if actor is null or actor_role is distinct from 'admin' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['page','pageSize']);
  if (p_input ? 'page' and jsonb_typeof(p_input->'page') is distinct from 'number') or (p_input ? 'pageSize' and jsonb_typeof(p_input->'pageSize') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  page:=coalesce((p_input->>'page')::integer,1);size:=coalesce((p_input->>'pageSize')::integer,10);
  if page<1 or page>10000 or size not in(10,15,20) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  with eligible as materialized (
   select p.id,p.name from public.profiles p join auth.users u on u.id=p.id
   where p.role='teacher' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  ) select jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name nulls last,x.id),'[]') from(select * from eligible order by name nulls last,id limit size offset(page-1)*size)x),'total',(select count(*) from eligible),'page',page,'pageSize',size) into result;
  return result;
 elsif p_action='create' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['ownerProfileId','label','scopes','grant','expiresAt','idempotencyKey']);
  k:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');owner_id:=dashboard_private.ai_agent_required_uuid_v1(p_input,'ownerProfileId');
  select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton for share;
  actor:=dashboard_private.ai_agent_lock_user_v1(true);
  perform 1 from public.profiles where id=owner_id and role='teacher' for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=owner_id and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='personal_credential_create' and resource_id=resource and idempotency_key=k;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return rec.result||jsonb_build_object('token',null);
  end if;
  if not enabled then raise exception using errcode='42501',message='ai_agent_support_disabled';end if;
  if jsonb_typeof(p_input->'label') is distinct from 'string' or jsonb_typeof(p_input->'scopes') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_input->'scopes')v where jsonb_typeof(v) is distinct from 'string') or jsonb_typeof(p_input->'grant') is distinct from 'object' or (p_input ? 'expiresAt' and jsonb_typeof(p_input->'expiresAt') not in('string','null')) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select array_agg(v) into scopes from jsonb_array_elements_text(p_input->'scopes')v;expires:=(p_input->>'expiresAt')::timestamptz;
  result:=dashboard_private.create_ai_agent_personal_credential_v1(owner_id,p_input->>'label',scopes,p_input->'grant',expires);
  insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'personal_credential_create',resource,k,fingerprint,result-'token');
  return result;
 elsif p_action='list' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['page','pageSize']);
  select role into actor_role from public.profiles where id=actor for share;
  if actor is null or actor_role is null or actor_role not in('admin','teacher') then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  if (p_input ? 'page' and jsonb_typeof(p_input->'page') is distinct from 'number') or (p_input ? 'pageSize' and jsonb_typeof(p_input->'pageSize') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  page:=coalesce((p_input->>'page')::integer,1);size:=coalesce((p_input->>'pageSize')::integer,10);
  if page<1 or page>10000 or size not in(10,15,20) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton;
  return jsonb_build_object('supportEnabled',enabled,'total',(select count(*) from dashboard_private.ai_agent_credentials x where x.credential_kind='personal' and ((actor_role='admin' and x.created_by=actor) or (actor_role='teacher' and x.owner_profile_id=actor))),'items',(select coalesce(jsonb_agg(dashboard_private.ai_agent_personal_credential_json_v1(x) order by x.created_at desc,x.id),'[]') from(select * from dashboard_private.ai_agent_credentials x where x.credential_kind='personal' and ((actor_role='admin' and x.created_by=actor) or (actor_role='teacher' and x.owner_profile_id=actor)) order by x.created_at desc,x.id limit size offset (page-1)*size)x));
 elsif p_action='revoke' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['id','idempotencyKey']);
  resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'id');k:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');
  select * into c from dashboard_private.ai_agent_credentials where id=resource for update;
  select role into actor_role from public.profiles where id=actor for share;
  if actor is null or actor_role is null or actor_role not in('admin','teacher') then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  if c.id is null or c.credential_kind<>'personal' or not ((actor_role='admin' and c.created_by=actor) or (actor_role='teacher' and c.owner_profile_id=actor)) then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='personal_credential_revoke' and resource_id=resource and idempotency_key=k;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;return rec.result;
  end if;
  update dashboard_private.ai_agent_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=resource;
  update dashboard_private.ai_agent_credential_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=resource;
  update dashboard_private.chat_credential_space_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=resource;
  update dashboard_private.ai_agent_domain_action_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=resource;
  select * into c from dashboard_private.ai_agent_credentials where id=resource;result:=jsonb_build_object('id',c.id,'revokedAt',c.revoked_at);
  insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'personal_credential_revoke',resource,k,fingerprint,result);return result;
 else raise exception using errcode='22023',message='ai_agent_invalid';end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;


create or replace function public.list_ai_agent_credentials_v1(p_page integer default 1,p_page_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_require_admin_v1();
begin
 if p_page is null or p_page<1 or p_page>10000 or p_page_size is null or p_page_size not in(10,15,20) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 return jsonb_build_object('total',(select count(*) from dashboard_private.ai_agent_credentials where created_by=actor and credential_kind='central'),'items',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'scopes',c.scopes,'createdAt',c.created_at,'expiresAt',c.expires_at,'revokedAt',c.revoked_at,'lastUsedAt',c.last_used_at,'grant',jsonb_strip_nulls(jsonb_build_object('queues',a.queues,'actions',a.actions,'spaceKeys',g.space_keys,'purposes',g.purposes,'bridgeSourceId',g.bridge_source_id))) order by c.created_at desc,c.id),'[]') from (select * from dashboard_private.ai_agent_credentials where created_by=actor and credential_kind='central' order by created_at desc,id limit p_page_size offset(p_page-1)*p_page_size) c left join dashboard_private.ai_agent_credential_grants a on a.credential_id=c.id left join dashboard_private.chat_credential_space_grants g on g.credential_id=c.id));
end$$;

create or replace function public.revoke_ai_agent_credential_v1(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c dashboard_private.ai_agent_credentials; ai_actor_role text;
begin
 select * into c from dashboard_private.ai_agent_credentials where id=p_id for update;
 select role into ai_actor_role from public.profiles where id=actor for share;
 if actor is null or ai_actor_role is distinct from 'admin' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 if c.id is null or c.credential_kind<>'central' or c.created_by<>actor then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 update dashboard_private.ai_agent_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
 update dashboard_private.ai_agent_credential_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
 update dashboard_private.chat_credential_space_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
 update dashboard_private.ai_agent_domain_action_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
end$$;

create or replace function public.ai_agent_credential_api_v1(p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); enabled boolean; k uuid; resource uuid:='00000000-0000-0000-0000-000000000000'::uuid; fingerprint text; rec dashboard_private.ai_agent_request_receipts; c dashboard_private.ai_agent_credentials; result jsonb; scopes text[]; expires timestamptz; actor_role text;
begin
 if p_action='list' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['page','pageSize']);
  actor:=dashboard_private.ai_agent_require_admin_v1();
  if (p_input ? 'page' and jsonb_typeof(p_input->'page') is distinct from 'number') or (p_input ? 'pageSize' and jsonb_typeof(p_input->'pageSize') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton;
  return public.list_ai_agent_credentials_v1(coalesce((p_input->>'page')::integer,1),coalesce((p_input->>'pageSize')::integer,10))||jsonb_build_object('supportEnabled',enabled);
 elsif p_action='create' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['label','scopes','grant','expiresAt','idempotencyKey']);
  k:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');
  -- Support first; this current tuple is decisive after any concurrent sync wait.
  select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton for share;
  actor:=dashboard_private.ai_agent_lock_user_v1(true);
  fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='credential_create' and resource_id=resource and idempotency_key=k;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return rec.result||jsonb_build_object('token',null);
  end if;
  if not enabled then raise exception using errcode='42501',message='ai_agent_support_disabled';end if;
  if jsonb_typeof(p_input->'label') is distinct from 'string' or jsonb_typeof(p_input->'scopes') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_input->'scopes')v where jsonb_typeof(v) is distinct from 'string')
  or jsonb_typeof(p_input->'grant') is distinct from 'object' or (p_input ? 'expiresAt' and jsonb_typeof(p_input->'expiresAt') not in('string','null')) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select array_agg(v) into scopes from jsonb_array_elements_text(p_input->'scopes')v;
  expires:=(p_input->>'expiresAt')::timestamptz;
  result:=public.create_ai_agent_credential_v1(p_input->>'label',scopes,p_input->'grant',expires);
  insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'credential_create',resource,k,fingerprint,result-'token');
  return result;
 elsif p_action='revoke' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['id','idempotencyKey']);
  resource:=dashboard_private.ai_agent_required_uuid_v1(p_input,'id');k:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');
  -- Existing credential first, then current actor/auth, then grants. No issuer UPDATE prologue.
  select * into c from dashboard_private.ai_agent_credentials where id=resource for update;
  select role into actor_role from public.profiles where id=actor for share;
  if actor is null or actor_role is distinct from 'admin' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
  if c.id is null or c.credential_kind<>'central' or c.created_by<>actor then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='credential_revoke' and resource_id=resource and idempotency_key=k;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return rec.result;
  end if;
  perform public.revoke_ai_agent_credential_v1(resource);
  select * into c from dashboard_private.ai_agent_credentials where id=resource;
  result:=jsonb_build_object('id',c.id,'revokedAt',c.revoked_at);
  insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'credential_revoke',resource,k,fingerprint,result);
  return result;
 end if;
 raise exception using errcode='22023',message='ai_agent_invalid';
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create or replace function public.ai_agent_chat_bridge_grant_v1(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.chat_credential_space_grants;
begin
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,'chat:send',null,true);
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c.id;
 if not 'bridge_reply'=any(g.purposes) or g.bridge_source_id is null then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 return dashboard_private.ai_agent_deadline_result_v1(jsonb_build_object('bridgeSourceId',g.bridge_source_id,'spaceKeys',g.space_keys,'purposes',g.purposes),c.id,'chat');
end$$;


-- Replace preserves existing ACLs; each new private helper remains uncallable by clients.
revoke all on function dashboard_private.ai_agent_personal_identity_v1(),dashboard_private.ai_agent_personal_row_allowed_v1(dashboard_private.ai_agent_credentials,uuid),dashboard_private.ai_agent_personal_audit_owner_v1(),dashboard_private.create_ai_agent_personal_credential_v1(uuid,text,text[],jsonb,timestamptz),dashboard_private.ai_agent_personal_credential_json_v1(dashboard_private.ai_agent_credentials) from public,anon,authenticated,service_role;
revoke all on function public.ai_agent_personal_credential_api_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_personal_credential_api_v1(text,jsonb) to authenticated;
commit;
