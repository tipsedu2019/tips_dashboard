begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table dashboard_private.ai_agent_requests (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 200 and title ~ '[^[:space:]]'),
 body text not null check(length(body) between 1 and 20000 and body ~ '[^[:space:]]'),
 queue_key text not null default 'employee_requests' check(queue_key='employee_requests'),
 status text not null default 'pending' check(status in('pending','processing','question','done','cancelled')),
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 ready_at timestamptz not null default clock_timestamp(),
 open_question_id uuid,
 result text check(length(result) between 1 and 20000 and result ~ '[^[:space:]]'),
 notify_on_done boolean not null default false,
 notification_space text check(notification_space in('space_1','space_2','space_3','space_4','space_5','space_6','space_7')),
 check(notify_on_done=(notification_space is not null)),
 check(status<>'done' or result is not null)
);
create table dashboard_private.ai_agent_request_messages (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references dashboard_private.ai_agent_requests(id),
 message_seq bigint not null check(message_seq>0),
 kind text not null check(kind in('question','answer','comment','progress')),
 text text not null check(length(text) between 1 and 5000 and text ~ '[^[:space:]]'),
 author_kind text not null check(author_kind in('user','bot')),
 author_id uuid not null,
 question_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,message_seq), unique(request_id,id),
 foreign key(request_id,question_id) references dashboard_private.ai_agent_request_messages(request_id,id) deferrable initially deferred,
 check((kind='answer')=(question_id is not null))
);
alter table dashboard_private.ai_agent_requests add constraint ai_agent_open_question_fk foreign key(id,open_question_id) references dashboard_private.ai_agent_request_messages(request_id,id) deferrable initially deferred;
create table dashboard_private.ai_agent_request_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references dashboard_private.ai_agent_requests(id),
 event_seq bigint not null check(event_seq>0),
 kind text not null,
 actor_kind text not null check(actor_kind in('user','bot')),
 actor_id uuid not null,
 requester_id uuid not null references public.profiles(id),
 credential_id uuid, issuer_id uuid,
 previous_status text, next_status text,
 version bigint not null check(version>0),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,event_seq)
);
create table dashboard_private.ai_agent_request_claims (
 request_id uuid primary key references dashboard_private.ai_agent_requests(id),
 credential_id uuid not null,
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 generation bigint not null check(generation>0),
 lease_expires_at timestamptz not null,
 renewed_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp()
);
create table dashboard_private.ai_agent_request_receipts (
 principal_kind text not null check(principal_kind in('user','bot')),
 principal_id uuid not null,
 operation text not null,
 resource_id uuid not null,
 idempotency_key uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(principal_kind,principal_id,operation,resource_id,idempotency_key)
);
create index ai_agent_requests_owner_created on dashboard_private.ai_agent_requests(requester_id,created_at desc,id);
create index ai_agent_requests_pending on dashboard_private.ai_agent_requests(status,ready_at,id) where status='pending';
create index ai_agent_messages_question on dashboard_private.ai_agent_request_messages(question_id) where question_id is not null;
create index ai_agent_events_requester on dashboard_private.ai_agent_request_events(requester_id);
create index ai_agent_receipts_resource on dashboard_private.ai_agent_request_receipts(resource_id);
create index ai_agent_claims_credential on dashboard_private.ai_agent_request_claims(credential_id);

create function dashboard_private.ai_agent_require_user_v1() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=actor and p.role in('admin','staff','teacher','assistant') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
  raise exception using errcode='42501',message='ai_agent_forbidden';
 end if;
 return actor;
end$$;
create function dashboard_private.ai_agent_require_admin_v1() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_require_user_v1();
begin
 if not exists(select 1 from public.profiles where id=actor and role='admin') then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 return actor;
end$$;
create function dashboard_private.ai_agent_can_read_v1(p_requester uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role in('admin','staff','teacher','assistant') and (p.id=p_requester or p.role='admin') and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
$$;
create function dashboard_private.ai_agent_assert_input_v1(p_input jsonb,p_keys text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>131072 or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(p_keys)) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
end$$;
create function dashboard_private.ai_agent_request_json_v1(r dashboard_private.ai_agent_requests) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'requesterId',r.requester_id,'requesterName',(select p.name from public.profiles p where p.id=r.requester_id),'title',r.title,'body',r.body,'status',r.status,'version',r.version::text,'createdAt',r.created_at,'updatedAt',r.updated_at,'readyAt',r.ready_at,'openQuestionId',r.open_question_id,'result',r.result,'notifyOnDone',r.notify_on_done,'notificationSpace',r.notification_space)
$$;
create function dashboard_private.ai_agent_immutable_v1() returns trigger
language plpgsql set search_path='' as $$begin raise exception using errcode='55000',message='ai_agent_immutable';end$$;
create trigger ai_agent_messages_immutable before update or delete on dashboard_private.ai_agent_request_messages for each row execute function dashboard_private.ai_agent_immutable_v1();
create trigger ai_agent_events_immutable before update or delete on dashboard_private.ai_agent_request_events for each row execute function dashboard_private.ai_agent_immutable_v1();
create trigger ai_agent_receipts_immutable before update or delete on dashboard_private.ai_agent_request_receipts for each row execute function dashboard_private.ai_agent_immutable_v1();

alter table dashboard_private.ai_agent_requests enable row level security;
alter table dashboard_private.ai_agent_request_messages enable row level security;
alter table dashboard_private.ai_agent_request_events enable row level security;
alter table dashboard_private.ai_agent_request_claims enable row level security;
alter table dashboard_private.ai_agent_request_receipts enable row level security;
create policy ai_agent_requests_owner on dashboard_private.ai_agent_requests for select to authenticated using(dashboard_private.ai_agent_can_read_v1(requester_id));
create policy ai_agent_messages_owner on dashboard_private.ai_agent_request_messages for select to authenticated using(exists(select 1 from dashboard_private.ai_agent_requests r where r.id=request_id and dashboard_private.ai_agent_can_read_v1(r.requester_id)));
create policy ai_agent_events_owner on dashboard_private.ai_agent_request_events for select to authenticated using(dashboard_private.ai_agent_can_read_v1(requester_id));
revoke all on dashboard_private.ai_agent_requests,dashboard_private.ai_agent_request_messages,dashboard_private.ai_agent_request_events,dashboard_private.ai_agent_request_claims,dashboard_private.ai_agent_request_receipts from public,anon,authenticated,service_role;
revoke all on function dashboard_private.ai_agent_require_user_v1(),dashboard_private.ai_agent_require_admin_v1(),dashboard_private.ai_agent_can_read_v1(uuid),dashboard_private.ai_agent_assert_input_v1(jsonb,text[]),dashboard_private.ai_agent_request_json_v1(dashboard_private.ai_agent_requests),dashboard_private.ai_agent_immutable_v1() from public,anon,authenticated,service_role;

create function public.ai_agent_user_api_v1(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.ai_agent_require_user_v1(); is_admin boolean; r dashboard_private.ai_agent_requests; rec dashboard_private.ai_agent_request_receipts; key uuid; fingerprint text; resource uuid:='00000000-0000-0000-0000-000000000000'::uuid; page integer; size integer; scope text; status_filter text; search_filter text; result jsonb;
begin
 select role='admin' into is_admin from public.profiles where id=actor;
 if p_action='create' then
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['title','body','notifyOnDone','notificationSpace','idempotencyKey']);
  if jsonb_typeof(p_input->'title') is distinct from 'string' or jsonb_typeof(p_input->'body') is distinct from 'string' or length(p_input->>'title') not between 1 and 200 or length(p_input->>'body') not between 1 and 20000 or not (p_input->>'title') ~ '[^[:space:]]' or not (p_input->>'body') ~ '[^[:space:]]' or (p_input ? 'notifyOnDone' and jsonb_typeof(p_input->'notifyOnDone') is distinct from 'boolean') then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  if coalesce((p_input->>'notifyOnDone')::boolean,false) or p_input ? 'notificationSpace' then
   -- All provider slots are unconfigured until the separately approved activation.
   raise exception using errcode='42501',message='ai_agent_space_forbidden';
  end if;
  if not p_input ? 'idempotencyKey' then raise exception using errcode='22023',message='ai_agent_idempotency_required';end if;
  key:=(p_input->>'idempotencyKey')::uuid;
  if key is null then raise exception using errcode='22023',message='ai_agent_invalid';end if;
  -- This actor lock serializes receipt replay and the rolling create budget.
  perform 1 from public.profiles where id=actor for update;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('title',p_input->>'title','body',p_input->>'body','notifyOnDone',false)::text,'UTF8')),'hex');
  select * into rec from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='create' and resource_id=resource and idempotency_key=key;
  if found then
   if rec.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
   return rec.result;
  end if;
  if (select count(*) from dashboard_private.ai_agent_requests where requester_id=actor and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception using errcode='54000',message='ai_agent_rate_limited';end if;
  insert into dashboard_private.ai_agent_requests(requester_id,title,body) values(actor,p_input->>'title',p_input->>'body') returning * into r;
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
revoke all on function public.ai_agent_user_api_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_user_api_v1(text,jsonb) to authenticated;
commit;
