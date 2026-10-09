-- Explicit non-expiring central Chat replies only. No keys/config/provider actions.
-- Legacy missing/NULL expiry still defaults to one day; finite TTL remains <=30 days.
-- Existing function signatures and EXECUTE ACLs are preserved by CREATE OR REPLACE.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table dashboard_private.ai_agent_credentials
 add constraint ai_agent_nonexpiring_chat_only check (
  expires_at is not null or (credential_kind='central' and cardinality(scopes)=2
   and scopes @> array['chat:outbox:read','chat:send']::text[])) not valid;
alter table dashboard_private.ai_agent_credentials validate constraint ai_agent_nonexpiring_chat_only;
alter table dashboard_private.chat_credential_space_grants
 add constraint chat_nonexpiring_reply_only check (
  expires_at is not null or (purposes=array['bridge_reply']::text[] and bridge_source_id is not null)) not valid;
alter table dashboard_private.chat_credential_space_grants validate constraint chat_nonexpiring_reply_only;
alter table dashboard_private.ai_agent_credentials alter column expires_at drop not null;
alter table dashboard_private.chat_credential_space_grants alter column expires_at drop not null;

create or replace function public.create_ai_agent_credential_v1(p_label text,p_scopes text[],p_grant jsonb,p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_lock_user_v1(true); expires timestamptz:=coalesce(p_expires_at,clock_timestamp()+interval '1 day'); raw text; cred dashboard_private.ai_agent_credentials; queues text[]; actions text[]; spaces text[]; purposes text[]; bridge uuid; has_ai boolean; has_chat boolean;
begin
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
 if (select count(*) from dashboard_private.ai_agent_credentials where created_by=actor and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()))>=20 then raise exception using errcode='54000',message='ai_agent_credential_limit';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.ai_agent_credentials(created_by,label,token_hash,scopes,expires_at) values(actor,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,expires) returning * into cred;
 if has_ai then insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(cred.id,queues,actions,expires);end if;
 if has_chat then insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,bridge_source_id,expires_at) values(cred.id,spaces,purposes,bridge,expires);end if;
 return jsonb_build_object('id',cred.id,'label',cred.label,'token',raw,'scopes',cred.scopes,'grant',p_grant,'expiresAt',cred.expires_at);
exception when invalid_text_representation then raise exception using errcode='22023',message='ai_agent_invalid';
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
 if (select count(*) from dashboard_private.ai_agent_credentials where created_by=actor and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()))>=20 then raise exception using errcode='54000',message='ai_agent_credential_limit';end if;
 if has_chat and (purposes is distinct from array['ai_completion']::text[] or bridge is not null) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.ai_agent_credentials(created_by,credential_kind,owner_profile_id,label,token_hash,scopes,expires_at) values(actor,'personal',p_owner_profile_id,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,expires) returning * into cred;
 if has_ai then insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(cred.id,queues,actions,expires);end if;
 if has_chat then insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,bridge_source_id,expires_at) values(cred.id,spaces,purposes,bridge,expires);end if;
 return jsonb_build_object('id',cred.id,'label',cred.label,'token',raw,'scopes',cred.scopes,'grant',p_grant,'expiresAt',cred.expires_at,'credentialKind',cred.credential_kind,'ownerProfileId',cred.owner_profile_id,'issuerProfileId',cred.created_by,'ownerName',(select p.name from public.profiles p where p.id=cred.owner_profile_id),'issuerName',(select p.name from public.profiles p where p.id=cred.created_by));
exception when invalid_text_representation then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create or replace function public.ai_agent_credential_api_v1(p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); enabled boolean; k uuid; resource uuid:='00000000-0000-0000-0000-000000000000'::uuid; fingerprint text; rec dashboard_private.ai_agent_request_receipts; c dashboard_private.ai_agent_credentials; result jsonb; scopes text[]; expires timestamptz; actor_role text; non_expiring boolean;
begin
 if p_action='list' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['page','pageSize']);
  actor:=dashboard_private.ai_agent_require_admin_v1();
  if (p_input ? 'page' and jsonb_typeof(p_input->'page') is distinct from 'number') or (p_input ? 'pageSize' and jsonb_typeof(p_input->'pageSize') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select issuance_enabled into enabled from dashboard_private.ai_agent_chat_support where singleton;
  return public.list_ai_agent_credentials_v1(coalesce((p_input->>'page')::integer,1),coalesce((p_input->>'pageSize')::integer,10))||jsonb_build_object('supportEnabled',enabled);
 elsif p_action='create' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['label','scopes','grant','expiresAt','idempotencyKey','nonExpiring']);
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
  if p_input ? 'nonExpiring' and jsonb_typeof(p_input->'nonExpiring') is distinct from 'boolean' then
   raise exception using errcode='22023',message='ai_agent_invalid';
  end if;
  non_expiring:=coalesce((p_input->>'nonExpiring')::boolean,false);
  if non_expiring and (jsonb_typeof(p_input->'expiresAt') is distinct from 'null'
   or cardinality(scopes)<>2 or not scopes @> array['chat:outbox:read','chat:send']::text[]
   or p_input->'grant'->'purposes' is distinct from '["bridge_reply"]'::jsonb) then
   raise exception using errcode='22023',message='ai_agent_invalid';
  end if;
  -- Reuse the existing admin lock, active-key limit and complete grant validation.
  -- This new credential is uncommitted; no caller can observe its temporary TTL.
  result:=public.create_ai_agent_credential_v1(p_input->>'label',scopes,p_input->'grant',expires);
  if non_expiring then
   update dashboard_private.ai_agent_credentials set expires_at=null where id=(result->>'id')::uuid;
   update dashboard_private.chat_credential_space_grants set expires_at=null where credential_id=(result->>'id')::uuid;
   result:=jsonb_set(result,'{expiresAt}','null'::jsonb);
  end if;
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

create or replace function dashboard_private.ai_agent_authenticate_v1(p_hash text,p_scope text,p_grant_action text default null,p_chat boolean default false) returns dashboard_private.ai_agent_credentials
language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; cg dashboard_private.chat_credential_space_grants; issuer_role text; owner_role text;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 select * into c from dashboard_private.ai_agent_credentials where token_hash=p_hash for update;
 if not found or c.revoked_at is not null or (c.expires_at is not null and c.expires_at<=clock_timestamp()) then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
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
  if not found or cg.revoked_at is not null or (cg.expires_at is not null and cg.expires_at<=clock_timestamp()) or (cg.expires_at is null and c.expires_at is not null) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
  if c.credential_kind='personal' and (cg.purposes is distinct from array['ai_completion']::text[] or cg.bridge_source_id is not null) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 elsif p_grant_action is not null then
  select * into g from dashboard_private.ai_agent_credential_grants where credential_id=c.id for update;
  if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp() or not p_grant_action=any(g.actions) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 end if;
 perform dashboard_private.ai_agent_deadline_result_v1(null,c.id,case when p_chat or (c.credential_kind='personal' and p_scope in('chat:outbox:read','chat:send')) then 'chat' when p_grant_action is not null then 'ai' else null end);
 return c;
end$$;

create or replace function dashboard_private.ai_agent_deadline_result_v1(
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
 if c.id is null or c.revoked_at is not null or (c.expires_at is not null and c.expires_at<=checked_at) then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 if (p_grant_family='ai' and (g.credential_id is null or g.revoked_at is not null or g.expires_at<=checked_at)) or (p_grant_family='chat' and (cg.credential_id is null or cg.revoked_at is not null or (cg.expires_at is not null and cg.expires_at<=checked_at) or (cg.expires_at is null and c.expires_at is not null))) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 if p_domain_kind is not null and (dg.credential_id is null or dg.revoked_at is not null or dg.expires_at<=checked_at) then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 return p_result;
end$$;

commit;
