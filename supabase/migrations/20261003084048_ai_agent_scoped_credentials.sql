begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table dashboard_private.ai_agent_credentials (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references public.profiles(id),
 label text not null check(length(label) between 1 and 80 and btrim(label)<>''),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null check(cardinality(scopes)>0 and array_position(scopes,null) is null and scopes <@ array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update','chat:outbox:read','chat:send']::text[]),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 revoked_at timestamptz, last_used_at timestamptz, rate_window timestamptz,
 rate_count bigint not null default 0 check(rate_count between 0 and 60)
);
create table dashboard_private.ai_agent_credential_grants (
 credential_id uuid primary key references dashboard_private.ai_agent_credentials(id),
 queues text[] not null check(queues=array['employee_requests']::text[]),
 actions text[] not null check(cardinality(actions)>0 and array_position(actions,null) is null and actions <@ array['read','claim','renew','progress','question','done']::text[]),
 expires_at timestamptz not null, revoked_at timestamptz
);
create table dashboard_private.chat_credential_space_grants (
 credential_id uuid primary key references dashboard_private.ai_agent_credentials(id),
 space_keys text[] not null check(cardinality(space_keys)>0 and array_position(space_keys,null) is null and space_keys <@ array['space_1','space_2','space_3','space_4','space_5','space_6','space_7']::text[]),
 purposes text[] not null check(cardinality(purposes)>0 and array_position(purposes,null) is null and purposes <@ array['ai_completion','bridge_reply']::text[]),
 bridge_source_id uuid,
 expires_at timestamptz not null, revoked_at timestamptz,
 check(('bridge_reply'=any(purposes))=(bridge_source_id is not null))
);
create table dashboard_private.chat_user_space_permissions (
 user_id uuid primary key references public.profiles(id),
 space_keys text[] not null default '{}' check(array_position(space_keys,null) is null and space_keys <@ array['space_1','space_2','space_3','space_4','space_5','space_6','space_7']::text[]),
 revision bigint not null default 1 check(revision>0),
 configured_by uuid not null references public.profiles(id), updated_at timestamptz not null default clock_timestamp()
);
create index ai_agent_credentials_issuer_created on dashboard_private.ai_agent_credentials(created_by,created_at desc,id);
create index chat_user_space_permissions_configurer on dashboard_private.chat_user_space_permissions(configured_by);
alter table dashboard_private.ai_agent_credentials enable row level security;
alter table dashboard_private.ai_agent_credential_grants enable row level security;
alter table dashboard_private.chat_credential_space_grants enable row level security;
alter table dashboard_private.chat_user_space_permissions enable row level security;
revoke all on dashboard_private.ai_agent_credentials,dashboard_private.ai_agent_credential_grants,dashboard_private.chat_credential_space_grants,dashboard_private.chat_user_space_permissions from public,anon,authenticated,service_role;

create function public.create_ai_agent_credential_v1(p_label text,p_scopes text[],p_grant jsonb,p_expires_at timestamptz default null) returns jsonb
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
 if (select count(*) from dashboard_private.ai_agent_credentials where created_by=actor and revoked_at is null and expires_at>clock_timestamp())>=20 then raise exception using errcode='54000',message='ai_agent_credential_limit';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.ai_agent_credentials(created_by,label,token_hash,scopes,expires_at) values(actor,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,expires) returning * into cred;
 if has_ai then insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(cred.id,queues,actions,expires);end if;
 if has_chat then insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,bridge_source_id,expires_at) values(cred.id,spaces,purposes,bridge,expires);end if;
 return jsonb_build_object('id',cred.id,'label',cred.label,'token',raw,'scopes',cred.scopes,'grant',p_grant,'expiresAt',cred.expires_at);
exception when invalid_text_representation then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;
create function public.list_ai_agent_credentials_v1(p_page integer default 1,p_page_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_require_admin_v1();
begin
 if p_page is null or p_page<1 or p_page>10000 or p_page_size is null or p_page_size not in(10,15,20) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 return jsonb_build_object('total',(select count(*) from dashboard_private.ai_agent_credentials where created_by=actor),'items',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'scopes',c.scopes,'createdAt',c.created_at,'expiresAt',c.expires_at,'revokedAt',c.revoked_at,'lastUsedAt',c.last_used_at,'grant',jsonb_strip_nulls(jsonb_build_object('queues',a.queues,'actions',a.actions,'spaceKeys',g.space_keys,'purposes',g.purposes,'bridgeSourceId',g.bridge_source_id))) order by c.created_at desc,c.id),'[]') from (select * from dashboard_private.ai_agent_credentials where created_by=actor order by created_at desc,id limit p_page_size offset(p_page-1)*p_page_size) c left join dashboard_private.ai_agent_credential_grants a on a.credential_id=c.id left join dashboard_private.chat_credential_space_grants g on g.credential_id=c.id));
end$$;
create function public.revoke_ai_agent_credential_v1(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_require_admin_v1();
begin
 update dashboard_private.ai_agent_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id and created_by=actor;
 if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 update dashboard_private.ai_agent_credential_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
 update dashboard_private.chat_credential_space_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
end$$;

-- A private verifier for this store only. No existing class credential/verifier
-- is widened and the bot never adopts the issuer as an authenticated user actor.
create function dashboard_private.ai_agent_require_bot_v1(p_token_hash text,p_action text) returns dashboard_private.ai_agent_credentials
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.ai_agent_credentials; grant_row dashboard_private.ai_agent_credential_grants; scope text; action text; minute timestamptz:=date_trunc('minute',clock_timestamp());
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 select * into cred from dashboard_private.ai_agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='ai_agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 scope:=case when p_action in('list','get') then 'ai-agent:requests:read' when p_action='claim' then 'ai-agent:requests:claim' when p_action in('renew','progress','question','done') then 'ai-agent:requests:update' else null end;
 action:=case when p_action in('list','get') then 'read' else p_action end;
 if scope is null or not scope=any(cred.scopes) then raise exception using errcode='42501',message='ai_agent_scope_forbidden';end if;
 select * into grant_row from dashboard_private.ai_agent_credential_grants where credential_id=cred.id;
 if not found or grant_row.revoked_at is not null or grant_row.expires_at<=clock_timestamp() or not action=any(grant_row.actions) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 if cred.rate_window is distinct from minute then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then raise exception using errcode='54000',message='ai_agent_rate_limited';end if;
 update dashboard_private.ai_agent_credentials set rate_count=cred.rate_count+1,rate_window=minute,last_used_at=clock_timestamp() where id=cred.id;
 return cred;
end$$;
revoke all on function dashboard_private.ai_agent_require_bot_v1(text,text) from public,anon,authenticated,service_role;
create function public.ai_agent_bot_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.ai_agent_credentials:=dashboard_private.ai_agent_require_bot_v1(p_token_hash,p_action); r dashboard_private.ai_agent_requests; grant_row dashboard_private.ai_agent_credential_grants; size integer; cursor_time timestamptz; cursor_id uuid; cursor_json jsonb; items jsonb; next_cursor text;
begin
 select * into grant_row from dashboard_private.ai_agent_credential_grants where credential_id=cred.id;
 if p_action='get' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['id']);
  if jsonb_typeof(p_input->'id') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  select * into r from dashboard_private.ai_agent_requests where id=(p_input->>'id')::uuid and queue_key=any(grant_row.queues);
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  return dashboard_private.ai_agent_request_json_v1(r);
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
  select coalesce(jsonb_agg(dashboard_private.ai_agent_request_json_v1(x) order by x.ready_at,x.id),'[]') into items from (select * from dashboard_private.ai_agent_requests x where x.queue_key=any(grant_row.queues) and x.status='pending' and (cursor_id is null or (x.ready_at,x.id)>(cursor_time,cursor_id)) order by x.ready_at,x.id limit size) x;
  if jsonb_array_length(items)=size then next_cursor:=replace(encode(convert_to(jsonb_build_object('readyAt',items->-1->>'readyAt','id',items->-1->>'id')::text,'UTF8'),'base64'),E'\n','');end if;
  return jsonb_build_object('items',items,'nextCursor',next_cursor);
 else raise exception using errcode='22023',message='ai_agent_invalid';end if;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;
revoke all on function public.create_ai_agent_credential_v1(text,text[],jsonb,timestamptz),public.list_ai_agent_credentials_v1(integer,integer),public.revoke_ai_agent_credential_v1(uuid),public.ai_agent_bot_api_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_bot_api_v1(text,text,jsonb) to service_role;
-- Enforce new writes now without scanning existing rows under the stronger
-- ADD FOREIGN KEY locks. Validate after this commit in the outbox migration.
alter table dashboard_private.ai_agent_request_claims add constraint ai_agent_claim_credential_fk foreign key(credential_id) references dashboard_private.ai_agent_credentials(id) not valid;
alter table dashboard_private.ai_agent_request_events add constraint ai_agent_event_credential_fk foreign key(credential_id) references dashboard_private.ai_agent_credentials(id) not valid;
alter table dashboard_private.ai_agent_request_events add constraint ai_agent_event_issuer_fk foreign key(issuer_id) references public.profiles(id) not valid;
commit;
