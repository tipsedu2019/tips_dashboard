begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table dashboard_private.ai_agent_requests add column claim_generation bigint not null default 0 check(claim_generation>=0);
create table dashboard_private.ai_agent_action_registry (
 kind text primary key check(kind ~ '^[a-z][a-z0-9_]{0,79}$'),
 permission_function regprocedure not null,
 receipt_function regprocedure,
 enabled boolean not null default false
);
-- Empty by default: a lifecycle grant never authorizes a business mutation.
-- Only a reviewed domain adapter and an explicit kind/target/hash grant can do so.
create table dashboard_private.ai_agent_domain_action_grants (
 credential_id uuid not null references dashboard_private.ai_agent_credentials(id),
 kind text not null references dashboard_private.ai_agent_action_registry(kind),
 target text not null check(length(target) between 1 and 500),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, revoked_at timestamptz,
 primary key(credential_id,kind,target,payload_hash)
);
create table dashboard_private.ai_agent_request_actions (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references dashboard_private.ai_agent_requests(id),
 credential_id uuid not null references dashboard_private.ai_agent_credentials(id),
 action_key uuid not null, step_key text not null check(length(step_key) between 1 and 100),
 kind text not null references dashboard_private.ai_agent_action_registry(kind),
 target text not null check(length(target) between 1 and 500),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=131072),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 generation bigint not null check(generation>0), revision bigint not null default 1 check(revision>0),
 state text not null default 'prepared' check(state in('prepared','started','succeeded','failed','unknown','cancelled')),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(request_id,action_key), unique(request_id,kind,target,payload_hash)
);
create table dashboard_private.ai_agent_action_events (
 id uuid primary key default gen_random_uuid(), action_id uuid not null references dashboard_private.ai_agent_request_actions(id),
 seq bigint not null check(seq>0), kind text not null,
 actor_kind text not null check(actor_kind in('user','bot')), actor_id uuid not null,
 evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=131072),
 created_at timestamptz not null default clock_timestamp(), unique(action_id,seq)
);
create index ai_agent_actions_page on dashboard_private.ai_agent_request_actions(request_id,created_at,id);
create index ai_agent_actions_unresolved on dashboard_private.ai_agent_request_actions(request_id,state);
create index ai_agent_actions_credential on dashboard_private.ai_agent_request_actions(credential_id);
create trigger ai_agent_action_events_immutable before update or delete on dashboard_private.ai_agent_action_events for each row execute function dashboard_private.ai_agent_immutable_v1();
create function dashboard_private.ai_agent_action_identity_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['state','revision','updated_at']) is distinct from (to_jsonb(old)-array['state','revision','updated_at']) then raise exception using errcode='55000',message='ai_agent_immutable';end if;
 return new;
end$$;
create trigger ai_agent_actions_identity before update on dashboard_private.ai_agent_request_actions for each row execute function dashboard_private.ai_agent_action_identity_v1();
create trigger ai_agent_actions_no_delete before delete on dashboard_private.ai_agent_request_actions for each row execute function dashboard_private.ai_agent_immutable_v1();
alter table dashboard_private.ai_agent_action_registry enable row level security;
alter table dashboard_private.ai_agent_domain_action_grants enable row level security;
alter table dashboard_private.ai_agent_request_actions enable row level security;
alter table dashboard_private.ai_agent_action_events enable row level security;
revoke all on dashboard_private.ai_agent_action_registry,dashboard_private.ai_agent_domain_action_grants,dashboard_private.ai_agent_request_actions,dashboard_private.ai_agent_action_events from public,anon,authenticated,service_role;

create function dashboard_private.ai_agent_authenticate_v1(p_hash text,p_scope text,p_grant_action text default null,p_chat boolean default false) returns dashboard_private.ai_agent_credentials
language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; cg dashboard_private.chat_credential_space_grants; issuer_role text;
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
 if not p_scope=any(c.scopes) then raise exception using errcode='42501',message='ai_agent_scope_forbidden';end if;
 if p_chat then
  select * into cg from dashboard_private.chat_credential_space_grants where credential_id=c.id for update;
  if not found or cg.revoked_at is not null or cg.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 elsif p_grant_action is not null then
  select * into g from dashboard_private.ai_agent_credential_grants where credential_id=c.id for update;
  if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp() or not p_grant_action=any(g.actions) then raise exception using errcode='42501',message='ai_agent_grant_forbidden';end if;
 end if;
 return c;
end$$;
create function dashboard_private.ai_agent_consume_rate_v1(p_id uuid) returns void language plpgsql set search_path='' as $$
declare minute timestamptz:=date_trunc('minute',clock_timestamp()); c dashboard_private.ai_agent_credentials;
begin
 select * into c from dashboard_private.ai_agent_credentials where id=p_id;
 if c.rate_window is distinct from minute then c.rate_count:=0;end if;
 if c.rate_count>=60 then raise exception using errcode='54000',message='ai_agent_rate_limited';end if;
 update dashboard_private.ai_agent_credentials set rate_count=c.rate_count+1,rate_window=minute,last_used_at=clock_timestamp() where id=p_id;
end$$;
create or replace function dashboard_private.ai_agent_require_bot_v1(p_token_hash text,p_action text) returns dashboard_private.ai_agent_credentials
language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials;
begin
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action in('get','list') then 'ai-agent:requests:read' when p_action='claim' then 'ai-agent:requests:claim' else 'ai-agent:requests:update' end,case when p_action in('get','list') then 'read' else p_action end);
 perform dashboard_private.ai_agent_consume_rate_v1(c.id);return c;
end$$;
create or replace function public.revoke_ai_agent_credential_v1(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c dashboard_private.ai_agent_credentials; ai_actor_role text;
begin
 select * into c from dashboard_private.ai_agent_credentials where id=p_id for update;
 select role into ai_actor_role from public.profiles where id=actor for share;
 if actor is null or ai_actor_role is distinct from 'admin' then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 perform 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 if c.id is null or c.created_by<>actor then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 update dashboard_private.ai_agent_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
 update dashboard_private.ai_agent_credential_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
 update dashboard_private.chat_credential_space_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
 update dashboard_private.ai_agent_domain_action_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where credential_id=p_id;
end$$;

create function dashboard_private.ai_agent_required_uuid_v1(i jsonb,k text) returns uuid language plpgsql immutable set search_path='' as $$
declare v uuid;
begin
 if jsonb_typeof(i->k) is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 v:=(i->>k)::uuid;return v;
exception when invalid_text_representation then raise exception using errcode='22023',message='ai_agent_invalid';end$$;
create function dashboard_private.ai_agent_decimal_v1(i jsonb,k text) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if not i ? k then raise exception using errcode='22023',message='ai_agent_precondition_required';end if;
 if jsonb_typeof(i->k) is distinct from 'string' or i->>k !~ '^[1-9][0-9]{0,18}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 return (i->>k)::bigint;
exception when numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';end$$;
create function dashboard_private.ai_agent_text_v1(i jsonb,k text,max_length integer) returns text language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(i->k) is distinct from 'string' or length(i->>k) not between 1 and max_length or not (i->>k) ~ '[^[:space:]]' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 return i->>k;
end$$;
create function dashboard_private.ai_agent_live_claim_v1(r dashboard_private.ai_agent_requests,c uuid,i jsonb) returns dashboard_private.ai_agent_request_claims
language plpgsql set search_path='' as $$
declare cl dashboard_private.ai_agent_request_claims; generation bigint:=dashboard_private.ai_agent_decimal_v1(i,'claimGeneration');
begin
 select * into cl from dashboard_private.ai_agent_request_claims where request_id=r.id for update;
 if jsonb_typeof(i->'claimTokenHash') is distinct from 'string' or i->>'claimTokenHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if r.status in('done','cancelled') then raise exception using errcode='55000',message='ai_agent_terminal';end if;
 if r.status<>'processing' or cl.request_id is null or cl.credential_id<>c or cl.token_hash<>i->>'claimTokenHash' or cl.generation<>generation or r.claim_generation<>generation or cl.lease_expires_at<=clock_timestamp() then raise exception using errcode='55000',message='ai_agent_claim_lost';end if;
 return cl;
end$$;
create function dashboard_private.ai_agent_event_v1(r dashboard_private.ai_agent_requests,k text,actor_kind text,actor uuid,issuer uuid default null,previous text default null,metadata jsonb default '{}') returns uuid
language plpgsql set search_path='' as $$
declare event_id uuid;
begin
 insert into dashboard_private.ai_agent_request_events(request_id,event_seq,kind,actor_kind,actor_id,requester_id,credential_id,issuer_id,previous_status,next_status,version,metadata)
 values(r.id,coalesce((select max(event_seq) from dashboard_private.ai_agent_request_events where request_id=r.id),0)+1,k,actor_kind,actor,r.requester_id,case when actor_kind='bot' then actor end,issuer,previous,r.status,r.version,metadata) returning id into event_id;
 return event_id;
end$$;
create function dashboard_private.ai_agent_message_json_v1(m dashboard_private.ai_agent_request_messages) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('id',m.id,'requestId',m.request_id,'seq',m.message_seq::text,'kind',m.kind,'text',m.text,'authorKind',m.author_kind,'authorId',m.author_id,'questionId',m.question_id,'createdAt',m.created_at)
$$;
create function dashboard_private.ai_agent_project_mutation_v1(ai_result jsonb,c dashboard_private.ai_agent_credentials) returns jsonb language sql volatile set search_path='' as $$
select case when not ai_result ? 'request' or ('ai-agent:requests:read'=any(c.scopes) and exists(select 1 from dashboard_private.ai_agent_credential_grants g join dashboard_private.ai_agent_requests r on r.id=(ai_result->'request'->>'id')::uuid where g.credential_id=c.id and 'read'=any(g.actions) and r.queue_key=any(g.queues) and g.revoked_at is null and g.expires_at>clock_timestamp())) then ai_result else jsonb_set(ai_result,'{request}',jsonb_build_object('id',ai_result->'request'->'id','status',ai_result->'request'->'status','version',ai_result->'request'->'version')) end
$$;
create function dashboard_private.ai_agent_action_json_v1(a dashboard_private.ai_agent_request_actions) returns jsonb language sql volatile set search_path='' as $$
select jsonb_build_object('id',a.id,'requestId',a.request_id,'credentialId',a.credential_id,'actionKey',a.action_key,'stepKey',a.step_key,'kind',a.kind,'target',a.target,'payload',a.payload,'payloadHash',a.payload_hash,'generation',a.generation::text,'revision',a.revision::text,'state',case when a.state='started' and not exists(select 1 from dashboard_private.ai_agent_request_claims c where c.request_id=a.request_id and c.generation=a.generation and c.lease_expires_at>clock_timestamp()) then 'unknown' else a.state end,'createdAt',a.created_at,'updatedAt',a.updated_at)
$$;
create function dashboard_private.ai_agent_action_event_v1(a dashboard_private.ai_agent_request_actions,k text,actor_kind text,actor uuid,e jsonb default '{}') returns void language plpgsql set search_path='' as $$
begin
 insert into dashboard_private.ai_agent_action_events(action_id,seq,kind,actor_kind,actor_id,evidence) values(a.id,coalesce((select max(seq) from dashboard_private.ai_agent_action_events where action_id=a.id),0)+1,k,actor_kind,actor,e);
end$$;
create function dashboard_private.ai_agent_authorize_action_v1(c uuid,r dashboard_private.ai_agent_requests,a dashboard_private.ai_agent_request_actions) returns void language plpgsql set search_path='' as $$
declare registry dashboard_private.ai_agent_action_registry; ok boolean; fn text;
begin
 select * into registry from dashboard_private.ai_agent_action_registry where kind=a.kind and enabled for share;
 if not found then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 perform 1 from dashboard_private.ai_agent_domain_action_grants where credential_id=c and kind=a.kind and target=a.target and payload_hash=a.payload_hash and revoked_at is null and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 if a.payload_hash<>encode(sha256(convert_to(a.payload::text,'UTF8')),'hex') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 select format('%I.%I',n.nspname,p.proname) into fn from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.oid=registry.permission_function and p.prorettype='boolean'::regtype and p.proargtypes='2950 25 25'::oidvector;
 if fn is null then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
 execute 'select '||fn||'($1,$2,$3)' into ok using r.requester_id,a.target,a.payload_hash;
 if ok is distinct from true then raise exception using errcode='42501',message='ai_agent_action_forbidden';end if;
end$$;

-- Preserve the accepted Task 1 read/create producers behind private adapters.
alter function public.ai_agent_user_api_v1(text,jsonb) set schema dashboard_private;
alter function dashboard_private.ai_agent_user_api_v1(text,jsonb) rename to ai_agent_user_read_create_v1;
revoke all on function dashboard_private.ai_agent_user_read_create_v1(text,jsonb) from public,anon,authenticated,service_role;
alter function public.ai_agent_bot_api_v1(text,text,jsonb) set schema dashboard_private;
alter function dashboard_private.ai_agent_bot_api_v1(text,text,jsonb) rename to ai_agent_bot_read_v1;
revoke all on function dashboard_private.ai_agent_bot_read_v1(text,text,jsonb) from public,anon,authenticated,service_role;


create function dashboard_private.ai_agent_cursor_encode_v1(binding text,p_position jsonb) returns text language sql stable set search_path='' as $$
select replace(encode(convert_to(jsonb_build_object('binding',binding,'position',p_position)::text,'UTF8'),'base64'),E'\n','')
$$;
create function dashboard_private.ai_agent_cursor_decode_v1(i jsonb,binding text) returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb; raw text;
begin
 if not i ? 'cursor' then return null;end if;
 raw:=i->>'cursor';
 if jsonb_typeof(i->'cursor') is distinct from 'string' or length(raw) not between 1 and 2048 or raw !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
 c:=convert_from(decode(raw,'base64'),'UTF8')::jsonb;
 if jsonb_typeof(c) is distinct from 'object' or c-'binding'-'position'<>'{}'::jsonb or c->>'binding' is distinct from binding or jsonb_typeof(c->'position') is distinct from 'object' or dashboard_private.ai_agent_cursor_encode_v1(binding,c->'position')<>raw then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
 return c->'position';
exception when others then raise exception using errcode='22023',message='ai_agent_cursor_invalid';
end$$;
create function dashboard_private.ai_agent_actions_read_v1(r dashboard_private.ai_agent_requests,i jsonb,principal text,operation text) returns jsonb language plpgsql volatile set search_path='' as $$
declare size integer:=coalesce((i->>'limit')::integer,50); binding text; pos jsonb; rows jsonb; next_cursor text; stamp timestamptz; last_id uuid; last_seq bigint:=0; a dashboard_private.ai_agent_request_actions;
begin
 if size not between 1 and 50 or (i ? 'limit' and jsonb_typeof(i->'limit') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 binding:=encode(sha256(convert_to(jsonb_build_object('operation',operation,'principal',principal,'requestId',r.id,'actionId',i->>'actionId','limit',size)::text,'UTF8')),'hex');
 pos:=dashboard_private.ai_agent_cursor_decode_v1(i,binding);
 if operation='actions' then
  if pos is not null then
   if pos-'createdAt'-'id'<>'{}'::jsonb or (jsonb_typeof(pos->'createdAt') is distinct from 'string' or pos->>'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?[+-][0-9]{2}:[0-9]{2}$') or jsonb_typeof(pos->'id') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
   stamp:=(pos->>'createdAt')::timestamptz;last_id:=dashboard_private.ai_agent_required_uuid_v1(pos,'id');
   if stamp is null or not isfinite(stamp) or not exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and id=last_id and created_at=stamp) then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
  end if;
  select coalesce(jsonb_agg(dashboard_private.ai_agent_action_json_v1(x) order by x.created_at,x.id),'[]') into rows from(select * from dashboard_private.ai_agent_request_actions where request_id=r.id and (pos is null or (created_at,id)>(stamp,last_id)) order by created_at,id limit size+1)x;
  if jsonb_array_length(rows)>size then
   rows:=rows- size;
   next_cursor:=dashboard_private.ai_agent_cursor_encode_v1(binding,jsonb_build_object('createdAt',rows->-1->>'createdAt','id',rows->-1->>'id'));
  end if;
  return jsonb_build_object('items',rows,'nextCursor',next_cursor);
 end if;
 select * into a from dashboard_private.ai_agent_request_actions where request_id=r.id and id=dashboard_private.ai_agent_required_uuid_v1(i,'actionId');
 if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 if pos is not null then
  if pos-'seq'<>'{}'::jsonb then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
  last_seq:=dashboard_private.ai_agent_decimal_v1(pos,'seq');
  if not exists(select 1 from dashboard_private.ai_agent_action_events where action_id=a.id and seq=last_seq) then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'actionId',x.action_id,'seq',x.seq::text,'kind',x.kind,'actorKind',x.actor_kind,'actorId',x.actor_id,'evidence',x.evidence,'createdAt',x.created_at) order by x.seq),'[]') into rows from(select * from dashboard_private.ai_agent_action_events where action_id=a.id and seq>last_seq order by seq limit size+1)x;
 if jsonb_array_length(rows)>size then
  rows:=rows-size;
  next_cursor:=dashboard_private.ai_agent_cursor_encode_v1(binding,jsonb_build_object('seq',rows->-1->>'seq'));
 end if;
 return jsonb_build_object('action',dashboard_private.ai_agent_action_json_v1(a),'events',rows,'nextCursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 if i ? 'cursor' then raise exception using errcode='22023',message='ai_agent_cursor_invalid';end if;
 raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create function public.ai_agent_user_api_v1(p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; admin boolean; r dashboard_private.ai_agent_requests; old_status text; rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; expected bigint; m dashboard_private.ai_agent_request_messages; a dashboard_private.ai_agent_request_actions; result jsonb; e jsonb; evidence_type text; registry dashboard_private.ai_agent_action_registry; fn text; receipt_ok boolean;
begin
 if p_action in('create','get','list') then return dashboard_private.ai_agent_user_read_create_v1(p_action,p_input);end if;
 if p_action not in('append_message','cancel','resume','reconcile_action','activity','actions','action_events') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if p_action in('activity','actions','action_events') then
  actor:=dashboard_private.ai_agent_require_user_v1();
  perform dashboard_private.ai_agent_assert_input_v1(p_input,case p_action when 'activity' then array['id','afterMessageSeq','afterEventSeq','limit'] when 'actions' then array['id','limit','cursor'] else array['id','actionId','limit','cursor'] end);
 else
  actor:=dashboard_private.ai_agent_lock_user_v1(p_action in('resume','reconcile_action'));
  perform dashboard_private.ai_agent_assert_input_v1(p_input,case p_action when 'append_message' then array['id','version','idempotencyKey','kind','text','questionId'] when 'reconcile_action' then array['id','revision','idempotencyKey','actionId','state','evidence','reason','confirmed'] when 'resume' then array['id','version','idempotencyKey','reason','confirmed'] else array['id','version','idempotencyKey'] end);
 end if;
 select role='admin' into admin from public.profiles where id=actor;
 if p_action in('activity','actions','action_events') then select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and (requester_id=actor or admin);
 else select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and (requester_id=actor or admin) for update;end if;
 if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 if p_action='activity' then return dashboard_private.ai_agent_activity_v1(r,p_input);end if;
 if p_action in('actions','action_events') then return dashboard_private.ai_agent_actions_read_v1(r,p_input,'user:'||actor::text,p_action);end if;
 if p_action in('resume','reconcile_action') and (p_input->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(p_input->'reason') is distinct from 'string' or p_input->>'reason' !~ '[^[:space:]]' or length(p_input->>'reason')>2000) then raise exception using errcode='22023',message='ai_agent_review_required';end if;
 key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
 select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation=p_action and resource_id=r.id and idempotency_key=key;
 if found then
  if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
  return rec.result;
 end if;
 old_status:=r.status;
 if p_action='reconcile_action' then
  select * into a from dashboard_private.ai_agent_request_actions where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'actionId') and request_id=r.id for update;
  if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
  if jsonb_typeof(p_input->'state') is distinct from 'string' or p_input->>'state' not in('succeeded','failed') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if a.revision<>dashboard_private.ai_agent_decimal_v1(p_input,'revision') or a.state not in('started','unknown') or p_input->>'state' not in('succeeded','failed') then raise exception using errcode='55000',message='ai_agent_conflict';end if;
  e:=p_input->'evidence';perform dashboard_private.ai_agent_assert_input_v1(e,array['type','target','payloadHash','resourceName','observedAt','observation','receiptId']);
  if e->>'target' is distinct from a.target or e->>'payloadHash' is distinct from a.payload_hash then raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
  evidence_type:=e->>'type';
  if evidence_type='manual_observation' then
   perform dashboard_private.ai_agent_text_v1(e,'resourceName',500);perform dashboard_private.ai_agent_text_v1(e,'observation',5000);
   if e->>'resourceName' !~ '^[A-Za-z][A-Za-z0-9_-]*(/[A-Za-z0-9_.:-]+)+$' then raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
   if jsonb_typeof(e->'observedAt') is distinct from 'string' or (e->>'observedAt')::timestamptz>clock_timestamp() or (e->>'observedAt')::timestamptz<a.created_at then raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
  elsif evidence_type='domain_receipt' then
   select * into registry from dashboard_private.ai_agent_action_registry where kind=a.kind for share;
   select format('%I.%I',n.nspname,p.proname) into fn from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.oid=registry.receipt_function and p.prorettype='boolean'::regtype and p.proargtypes='25 25 25 25'::oidvector;
   if fn is null then raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
   perform dashboard_private.ai_agent_text_v1(e,'receiptId',500);
   execute 'select '||fn||'($1,$2,$3,$4)' into receipt_ok using e->>'receiptId',a.target,a.payload_hash,p_input->>'state';
   if receipt_ok is distinct from true then raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
  else raise exception using errcode='22023',message='ai_agent_evidence_required';end if;
  update dashboard_private.ai_agent_request_actions set state=p_input->>'state',revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
  perform dashboard_private.ai_agent_action_event_v1(a,'reconciled_'||evidence_type,'user',actor,e||jsonb_build_object('outcome',a.state,'reviewReason',p_input->>'reason','confirmed',true));
  result:=dashboard_private.ai_agent_action_json_v1(a);
 else
  expected:=dashboard_private.ai_agent_decimal_v1(p_input,'version');
  if r.status in('done','cancelled') then raise exception using errcode='55000',message='ai_agent_terminal';end if;
  if r.version<>expected then raise exception using errcode='55000',message='ai_agent_stale_version';end if;
  if p_action='append_message' then
   if p_input->>'kind' not in('comment','answer') or jsonb_typeof(p_input->'kind') is distinct from 'string' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   if p_input->>'kind'='answer' then
    if r.status<>'question' or r.open_question_id is distinct from dashboard_private.ai_agent_required_uuid_v1(p_input,'questionId') then raise exception using errcode='55000',message='ai_agent_question_conflict';end if;
   elsif p_input ? 'questionId' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
   perform dashboard_private.ai_agent_text_v1(p_input,'text',5000);
   if (select count(*) from dashboard_private.ai_agent_request_messages where author_kind='user' and author_id=actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception using errcode='54000',message='ai_agent_rate_limited';end if;
   insert into dashboard_private.ai_agent_request_messages(request_id,message_seq,kind,text,author_kind,author_id,question_id) values(r.id,coalesce((select max(message_seq) from dashboard_private.ai_agent_request_messages where request_id=r.id),0)+1,p_input->>'kind',p_input->>'text','user',actor,case when p_input->>'kind'='answer' then r.open_question_id end) returning * into m;
   update dashboard_private.ai_agent_requests set version=version+1,updated_at=clock_timestamp(),status=case when m.kind='answer' then 'pending' else status end,open_question_id=case when m.kind='answer' then null else open_question_id end,ready_at=case when m.kind='answer' then clock_timestamp() else ready_at end where id=r.id returning * into r;
   perform dashboard_private.ai_agent_event_v1(r,m.kind,'user',actor,null,old_status,jsonb_build_object('messageId',m.id));
   result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r),'message',dashboard_private.ai_agent_message_json_v1(m));
  elsif p_action='cancel' then
   update dashboard_private.ai_agent_requests set status='cancelled',version=version+1,claim_generation=claim_generation+1,open_question_id=null,updated_at=clock_timestamp() where id=r.id returning * into r;
   delete from dashboard_private.ai_agent_request_claims where request_id=r.id;
   for a in update dashboard_private.ai_agent_request_actions set state='cancelled',revision=revision+1,updated_at=clock_timestamp() where request_id=r.id and state='prepared' returning * loop perform dashboard_private.ai_agent_action_event_v1(a,'cancelled','user',actor,jsonb_build_object('reason','request_cancelled'));end loop;
   perform dashboard_private.ai_agent_cancel_outbox_v1(r.id);
   perform dashboard_private.ai_agent_event_v1(r,'cancelled','user',actor,null,old_status);
   result:=dashboard_private.ai_agent_request_json_v1(r);
  else
   if r.status<>'processing' or exists(select 1 from dashboard_private.ai_agent_request_claims where request_id=r.id and lease_expires_at>clock_timestamp()) then raise exception using errcode='55000',message='ai_agent_conflict';end if;
   if exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and state in('prepared','started','unknown')) then raise exception using errcode='55000',message='ai_agent_effect_unresolved';end if;
   update dashboard_private.ai_agent_requests set status='pending',version=version+1,claim_generation=claim_generation+1,ready_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
   delete from dashboard_private.ai_agent_request_claims where request_id=r.id;
   perform dashboard_private.ai_agent_event_v1(r,'resumed','user',actor,null,old_status,jsonb_build_object('reviewReason',p_input->>'reason','confirmed',true));
   result:=dashboard_private.ai_agent_request_json_v1(r);
  end if;
 end if;
 insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,p_action,r.id,key,fingerprint,result);
 return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create function public.ai_agent_bot_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c dashboard_private.ai_agent_credentials; g dashboard_private.ai_agent_credential_grants; r dashboard_private.ai_agent_requests; cl dashboard_private.ai_agent_request_claims; rec dashboard_private.ai_agent_request_receipts; a dashboard_private.ai_agent_request_actions; m dashboard_private.ai_agent_request_messages; key uuid; fingerprint text; result jsonb; event_id uuid; old_status text; requester uuid; requester_role text; e jsonb;
begin
 if p_action in('get','list') then return dashboard_private.ai_agent_bot_read_v1(p_token_hash,p_action,p_input);end if;
 if p_action not in('claim','renew','progress','question','done','register_action','start_action','record_action','activity','actions','action_events') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 c:=dashboard_private.ai_agent_authenticate_v1(p_token_hash,case when p_action='claim' then 'ai-agent:requests:claim' when p_action in('activity','actions','action_events') then 'ai-agent:requests:read' else 'ai-agent:requests:update' end,case when p_action in('register_action','start_action') then 'done' when p_action='record_action' then null when p_action in('activity','actions','action_events') then 'read' else p_action end);
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
 if p_action in('activity','actions','action_events') then select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and queue_key=any(g.queues);
 else select * into r from dashboard_private.ai_agent_requests where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'id') and (p_action='record_action' or queue_key=any(g.queues)) for update;end if;
 if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 if p_action in('activity','actions','action_events') then
  perform dashboard_private.ai_agent_consume_rate_v1(c.id);
  if p_action='activity' then return dashboard_private.ai_agent_activity_v1(r,p_input);end if;
  return dashboard_private.ai_agent_actions_read_v1(r,p_input,'bot:'||c.id::text,p_action);
 end if;
 key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
 select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='bot' and principal_id=c.id and operation=p_action and resource_id=r.id and idempotency_key=key;
 if rec.principal_id is not null and rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
 if p_action='claim' then
  if jsonb_typeof(p_input->'claimTokenHash') is distinct from 'string' or p_input->>'claimTokenHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if rec.principal_id is not null then
   cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input||jsonb_build_object('claimGeneration',rec.result->'claim'->>'generation'));
   return dashboard_private.ai_agent_project_mutation_v1(rec.result,c);
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
   if rec.principal_id is not null then return dashboard_private.ai_agent_project_mutation_v1(rec.result,c);end if;
   if exists(select 1 from dashboard_private.ai_agent_request_actions where request_id=r.id and (action_key=a.action_key or (kind=a.kind and target=a.target and payload_hash=a.payload_hash))) then raise exception using errcode='55000',message='ai_agent_conflict';end if;
   perform dashboard_private.ai_agent_consume_rate_v1(c.id);
   insert into dashboard_private.ai_agent_request_actions(request_id,credential_id,action_key,step_key,kind,target,payload,payload_hash,generation) values(r.id,c.id,a.action_key,a.step_key,a.kind,a.target,a.payload,a.payload_hash,cl.generation) returning * into a;
   perform dashboard_private.ai_agent_action_event_v1(a,'prepared','bot',c.id);
  else
   select * into a from dashboard_private.ai_agent_request_actions where id=dashboard_private.ai_agent_required_uuid_v1(p_input,'actionId') and request_id=r.id and credential_id=c.id for update;
   if not found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
   if p_action='start_action' then perform dashboard_private.ai_agent_authorize_action_v1(c.id,r,a);end if;
   if rec.principal_id is not null then return dashboard_private.ai_agent_project_mutation_v1(rec.result,c);end if;
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
  if rec.principal_id is not null and p_action in('done','question') and r.status=p_action and r.version::text=rec.result->'request'->>'version' and r.open_question_id::text is not distinct from rec.result->'request'->>'openQuestionId' and r.claim_generation=dashboard_private.ai_agent_decimal_v1(p_input,'claimGeneration')+1 then return dashboard_private.ai_agent_project_mutation_v1(rec.result,c);end if;
  cl:=dashboard_private.ai_agent_live_claim_v1(r,c.id,p_input);
  if rec.principal_id is not null then return dashboard_private.ai_agent_project_mutation_v1(rec.result,c);end if;
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
 return dashboard_private.ai_agent_project_mutation_v1(result,c);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';
end$$;

create function dashboard_private.ai_agent_activity_v1(r dashboard_private.ai_agent_requests,i jsonb) returns jsonb language plpgsql volatile set search_path='' as $$
declare size integer:=coalesce((i->>'limit')::integer,50); ms bigint:=0; es bigint:=0; cl dashboard_private.ai_agent_request_claims; result jsonb;
begin
 if size not between 1 and 50 or (i ? 'limit' and jsonb_typeof(i->'limit') is distinct from 'number') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if i ? 'afterMessageSeq' then ms:=dashboard_private.ai_agent_decimal_v1(i,'afterMessageSeq');end if;
 if i ? 'afterEventSeq' then es:=dashboard_private.ai_agent_decimal_v1(i,'afterEventSeq');end if;
 select * into cl from dashboard_private.ai_agent_request_claims where request_id=r.id;
 result:=jsonb_build_object('request',dashboard_private.ai_agent_request_json_v1(r),'claim',case when cl.request_id is not null then jsonb_build_object('generation',cl.generation::text,'leaseExpiresAt',cl.lease_expires_at,'leaseState',case when cl.lease_expires_at<=clock_timestamp() then 'expired' else 'live' end) end,
 'messages',(select coalesce(jsonb_agg(dashboard_private.ai_agent_message_json_v1(m) order by m.message_seq),'[]') from(select * from dashboard_private.ai_agent_request_messages where request_id=r.id and message_seq>ms order by message_seq limit size)m),
 'events',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'requestId',v.request_id,'seq',v.event_seq::text,'kind',v.kind,'actorKind',v.actor_kind,'actorId',v.actor_id,'requesterId',v.requester_id,'credentialId',v.credential_id,'issuerId',v.issuer_id,'previousStatus',v.previous_status,'nextStatus',v.next_status,'version',v.version::text,'metadata',v.metadata,'createdAt',v.created_at) order by v.event_seq),'[]') from(select * from dashboard_private.ai_agent_request_events where request_id=r.id and event_seq>es order by event_seq limit size)v),
 'actions',(select coalesce(jsonb_agg(dashboard_private.ai_agent_action_json_v1(a) order by a.created_at,a.id),'[]') from(select * from dashboard_private.ai_agent_request_actions where request_id=r.id order by created_at,id limit 50)a));
 return result||jsonb_build_object('notification',dashboard_private.ai_agent_notification_v1(r.id),'nextMessageSeq',case when jsonb_array_length(result->'messages')=size then result->'messages'->-1->>'seq' end,'nextEventSeq',case when jsonb_array_length(result->'events')=size then result->'events'->-1->>'seq' end);
end$$;
revoke all on function dashboard_private.ai_agent_cursor_encode_v1(text,jsonb),dashboard_private.ai_agent_cursor_decode_v1(jsonb,text),dashboard_private.ai_agent_actions_read_v1(dashboard_private.ai_agent_requests,jsonb,text,text) from public,anon,authenticated,service_role;
-- No private helper or adapter is directly callable by an API role.
revoke all on function dashboard_private.ai_agent_action_identity_v1(),dashboard_private.ai_agent_authenticate_v1(text,text,text,boolean),dashboard_private.ai_agent_consume_rate_v1(uuid),dashboard_private.ai_agent_required_uuid_v1(jsonb,text),dashboard_private.ai_agent_decimal_v1(jsonb,text),dashboard_private.ai_agent_text_v1(jsonb,text,integer),dashboard_private.ai_agent_live_claim_v1(dashboard_private.ai_agent_requests,uuid,jsonb),dashboard_private.ai_agent_event_v1(dashboard_private.ai_agent_requests,text,text,uuid,uuid,text,jsonb),dashboard_private.ai_agent_message_json_v1(dashboard_private.ai_agent_request_messages),dashboard_private.ai_agent_project_mutation_v1(jsonb,dashboard_private.ai_agent_credentials),dashboard_private.ai_agent_action_json_v1(dashboard_private.ai_agent_request_actions),dashboard_private.ai_agent_action_event_v1(dashboard_private.ai_agent_request_actions,text,text,uuid,jsonb),dashboard_private.ai_agent_authorize_action_v1(uuid,dashboard_private.ai_agent_requests,dashboard_private.ai_agent_request_actions),dashboard_private.ai_agent_activity_v1(dashboard_private.ai_agent_requests,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ai_agent_user_api_v1(text,jsonb),public.ai_agent_bot_api_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_user_api_v1(text,jsonb) to authenticated;
grant execute on function public.ai_agent_bot_api_v1(text,text,jsonb) to service_role;
commit;
