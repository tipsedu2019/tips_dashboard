begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Safe activation metadata only. No provider URL or secret is stored here.
create function dashboard_private.ai_agent_chat_origin_valid_v1(origin text) returns boolean language sql immutable set search_path='' as $$
 select origin is null or (length(origin)<=250 and origin ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$' and origin !~ ':443$' and coalesce(substring(origin from ':([1-9][0-9]{0,4})$')::integer,443)<=65535)
$$;
create table dashboard_private.ai_agent_chat_support (
 singleton boolean primary key default true check(singleton),
 issuance_enabled boolean not null default false,
 revision bigint not null default 1 check(revision>0),
 public_origin text check(dashboard_private.ai_agent_chat_origin_valid_v1(public_origin)),
 updated_at timestamptz not null default clock_timestamp()
);
insert into dashboard_private.ai_agent_chat_support(singleton) values(true);
alter table dashboard_private.chat_space_configuration add column public_origin text check(dashboard_private.ai_agent_chat_origin_valid_v1(public_origin));
create table dashboard_private.ai_agent_chat_configuration_receipts (
 idempotency_key uuid primary key, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create trigger ai_agent_chat_configuration_receipts_immutable before update or delete on dashboard_private.ai_agent_chat_configuration_receipts for each row execute function dashboard_private.ai_agent_immutable_v1();
alter table dashboard_private.ai_agent_chat_support enable row level security;
alter table dashboard_private.ai_agent_chat_configuration_receipts enable row level security;
revoke all on dashboard_private.ai_agent_chat_support,dashboard_private.ai_agent_chat_configuration_receipts from public,anon,authenticated,service_role;

create function dashboard_private.ai_agent_chat_configuration_json_v1() returns jsonb language sql volatile set search_path='' as $$
 select jsonb_build_object('revision',s.revision::text,'issuanceEnabled',s.issuance_enabled,'publicOrigin',s.public_origin,
 'spaces',(select jsonb_agg(jsonb_build_object('spaceKey',c.space_key,'resourceName',c.resource_name,'revision',c.revision::text) order by c.space_key) from dashboard_private.chat_space_configuration c))
 from dashboard_private.ai_agent_chat_support s where singleton
$$;
create function public.ai_agent_chat_configuration_api_v1(p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare s dashboard_private.ai_agent_chat_support; rec dashboard_private.ai_agent_chat_configuration_receipts; k uuid; fingerprint text; origin text; resources jsonb; result jsonb;
begin
 if p_action='get' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array[]::text[]);
  -- Keep the two reads coherent with sync's singleton-first lock order.
  perform 1 from dashboard_private.ai_agent_chat_support where singleton for share;
  return dashboard_private.ai_agent_chat_configuration_json_v1();
 elsif p_action is distinct from 'sync' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 perform dashboard_private.ai_agent_assert_input_v1(p_input,array['idempotencyKey','revision','issuanceEnabled','publicOrigin','spaces']);
 k:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');
 if jsonb_typeof(p_input->'issuanceEnabled') is distinct from 'boolean' or not p_input ? 'publicOrigin' or jsonb_typeof(p_input->'publicOrigin') not in('string','null')
 or jsonb_typeof(p_input->'spaces') is distinct from 'array' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 origin:=p_input->>'publicOrigin';
 if not dashboard_private.ai_agent_chat_origin_valid_v1(origin) or jsonb_array_length(p_input->'spaces')<>7 then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'spaces') x where jsonb_typeof(x) is distinct from 'object' or x-array['spaceKey','resourceName']<>'{}'::jsonb
 or not x ?& array['spaceKey','resourceName'] or jsonb_typeof(x->'spaceKey') is distinct from 'string' or x->>'spaceKey' not in('space_1','space_2','space_3','space_4','space_5','space_6','space_7')
 or jsonb_typeof(x->'resourceName') not in('string','null') or (x->>'resourceName' is not null and (length(x->>'resourceName')>200 or x->>'resourceName' !~ '^spaces/[A-Za-z0-9_-]+$')))
 or (select count(distinct x->>'spaceKey') from jsonb_array_elements(p_input->'spaces') x)<>7
 or (origin is null and exists(select 1 from jsonb_array_elements(p_input->'spaces') x where x->>'resourceName' is not null)) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 select jsonb_agg(x order by x->>'spaceKey') into resources from jsonb_array_elements(p_input->'spaces') x;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('revision',p_input->'revision','issuanceEnabled',p_input->'issuanceEnabled','publicOrigin',origin,'spaces',resources)::text,'UTF8')),'hex');
 select * into s from dashboard_private.ai_agent_chat_support where singleton for update;
 select * into rec from dashboard_private.ai_agent_chat_configuration_receipts where idempotency_key=k;
 if found then
  if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
  return rec.result; -- Historical applied snapshot; caller must GET current state.
 end if;
 if s.revision<>dashboard_private.ai_agent_decimal_v1(p_input,'revision') then raise exception using errcode='55000',message='ai_agent_stale_version';end if;
 if s.revision=9223372036854775807 then raise exception using errcode='55000',message='ai_agent_conflict';end if;
 perform 1 from dashboard_private.chat_space_configuration order by space_key for update;
 update dashboard_private.chat_space_configuration c set configured=x.resource is not null,resource_name=x.resource,public_origin=origin,revision=c.revision+1
 from (select v->>'spaceKey' as key,v->>'resourceName' as resource from jsonb_array_elements(resources) v) x
 where c.space_key=x.key and (c.resource_name is distinct from x.resource or c.public_origin is distinct from origin or c.configured is distinct from (x.resource is not null));
 update dashboard_private.ai_agent_chat_support set issuance_enabled=(p_input->>'issuanceEnabled')::boolean,public_origin=origin,revision=revision+1,updated_at=clock_timestamp() where singleton;
 result:=dashboard_private.ai_agent_chat_configuration_json_v1();
 insert into dashboard_private.ai_agent_chat_configuration_receipts(idempotency_key,payload_hash,result) values(k,fingerprint,result);
 return result;
end$$;

-- App callers cannot bypass support, UUID receipts, or first-return-only secrets.
revoke all on function public.create_ai_agent_credential_v1(text,text[],jsonb,timestamptz),public.list_ai_agent_credentials_v1(integer,integer),public.revoke_ai_agent_credential_v1(uuid) from public,anon,authenticated,service_role;
create function public.ai_agent_credential_api_v1(p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  if c.id is null or c.created_by<>actor then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
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

create function public.ai_agent_chat_bridge_grant_v1(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.chat_credential_space_grants;
begin
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,'chat:send',null,true);
 select * into g from dashboard_private.chat_credential_space_grants where credential_id=c.id;
 if not 'bridge_reply'=any(g.purposes) or g.bridge_source_id is null then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 return jsonb_build_object('bridgeSourceId',g.bridge_source_id,'spaceKeys',g.space_keys,'purposes',g.purposes);
end$$;

create function dashboard_private.ai_agent_chat_title_v1(title text) returns text language plpgsql immutable set search_path='' as $$
declare safe text;
begin
 safe:=regexp_replace(title,'[[:cntrl:]' || U&'\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2066\2067\2068\2069\FEFF' || ']',' ','g');
 safe:=regexp_replace(safe,'https?://[^[:space:]]+|www\.[^[:space:]]+','','gi');
 safe:=regexp_replace(safe,'[<>\[\]()*_~`@]',' ','g');
 safe:=btrim(regexp_replace(safe,'[[:space:]]+',' ','g'));
 return coalesce(nullif(left(safe,200),''),'요청');
end$$;
create or replace function dashboard_private.ai_agent_completion_outbox_v1(r dashboard_private.ai_agent_requests,event_id uuid) returns void language plpgsql set search_path='' as $$
declare cfg dashboard_private.chat_space_configuration; allowed boolean; payload jsonb; reason text;
begin
 if not r.notify_on_done then return;end if;
 -- done already owns the request lock. Never acquire cfg SHARE after it:
 -- prepare holds cfg SHARE before request; adding a lock here would invert order.
 select * into cfg from dashboard_private.chat_space_configuration where space_key=r.notification_space;
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=r.requester_id and p.role in('admin','staff','teacher','assistant') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and (p.role='admin' or exists(select 1 from dashboard_private.chat_user_space_permissions where user_id=r.requester_id and r.notification_space=any(space_keys)))) into allowed;
 reason:=case when not cfg.configured or cfg.public_origin is null then 'space_unconfigured' when not allowed then 'space_permission_revoked' end;
 payload:=jsonb_build_object('text',dashboard_private.ai_agent_chat_title_v1(r.title)||E' · 완료\n'||case when cfg.public_origin is not null then cfg.public_origin||'/admin/ai-agent/'||r.id::text else '알림 공간 미설정' end);
 insert into dashboard_private.chat_delivery_outbox(request_id,completion_event_id,purpose,space_key,expected_space,payload,payload_hash,state,reason)
 values(r.id,event_id,'ai_completion',r.notification_space,cfg.resource_name,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),case when reason is null then 'pending' else 'cancelled' end,reason);
end$$;
create function dashboard_private.ai_agent_chat_completion_guard_v1() returns trigger language plpgsql set search_path='' as $$
declare cfg dashboard_private.chat_space_configuration; suffix text; title text;
begin
 if new.state='sending' and old.state<>'sending' and new.purpose='ai_completion' then
  -- Final prepare already holds this row FOR SHARE until its durable commit.
  select * into cfg from dashboard_private.chat_space_configuration where space_key=new.space_key;
  suffix:=E' · 완료\n'||cfg.public_origin||'/admin/ai-agent/'||new.request_id::text;
  if not cfg.configured or cfg.public_origin is null or cfg.resource_name is distinct from new.expected_space or right(new.payload->>'text',length(suffix)) is distinct from suffix then raise exception using errcode='55000',message='ai_agent_configuration_changed';end if;
  title:=left(new.payload->>'text',length(new.payload->>'text')-length(suffix));
  if title is distinct from dashboard_private.ai_agent_chat_title_v1(title) then raise exception using errcode='22023',message='chat_payload_invalid';end if;
 end if;
 return new;
end$$;
create trigger ai_agent_chat_completion_guard before update on dashboard_private.chat_delivery_outbox for each row execute function dashboard_private.ai_agent_chat_completion_guard_v1();

revoke all on function dashboard_private.ai_agent_chat_origin_valid_v1(text),dashboard_private.ai_agent_chat_configuration_json_v1(),dashboard_private.ai_agent_chat_title_v1(text),dashboard_private.ai_agent_chat_completion_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.ai_agent_chat_configuration_api_v1(text,jsonb),public.ai_agent_chat_bridge_grant_v1(text),public.ai_agent_credential_api_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_credential_api_v1(text,jsonb) to authenticated;
grant execute on function public.ai_agent_chat_configuration_api_v1(text,jsonb),public.ai_agent_chat_bridge_grant_v1(text) to service_role;
commit;
