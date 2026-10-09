-- Candidate only: no production application is authorized.
-- Existing administrator-issued keys retain their issuer checks and grants.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table dashboard_private.agent_personal_dashboard_credentials
 add column issuer_kind text not null default 'administrator'
 check(issuer_kind in ('administrator','self_teacher')),
 add constraint agent_personal_self_identity check(issuer_kind<>'self_teacher' or created_by=owner_profile_id);

create or replace function dashboard_private.agent_personal_dashboard_identity_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.owner_profile_id is distinct from old.owner_profile_id or new.credential_kind is distinct from old.credential_kind or new.audience is distinct from old.audience or new.token_hash is distinct from old.token_hash or new.scopes is distinct from old.scopes or new.class_ids is distinct from old.class_ids or new.school_ids is distinct from old.school_ids or new.expires_at is distinct from old.expires_at or new.issuer_kind is distinct from old.issuer_kind then
  raise exception using errcode='55000',message='agent_personal_identity_immutable';
 end if;
 return new;
end$$;
revoke all on function dashboard_private.agent_personal_dashboard_identity_v1() from public,anon,authenticated,service_role;

create table dashboard_private.agent_personal_connection_operations (
 owner_id uuid not null references public.profiles(id), request_id uuid not null,
 kind text not null check(kind in('issue','revoke')),
 input_hash text check(input_hash ~ '^[a-f0-9]{64}$'),
 state text not null check(state in('applied','failed')),
 credential_id uuid references dashboard_private.agent_personal_dashboard_credentials(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,request_id),
 check((state='applied' and input_hash is not null and credential_id is not null) or (state='failed' and credential_id is null))
);
create index agent_personal_connection_operation_owner_time on dashboard_private.agent_personal_connection_operations(owner_id,created_at);
alter table dashboard_private.agent_personal_connection_operations enable row level security;
revoke all on dashboard_private.agent_personal_connection_operations from public,anon,authenticated,service_role;

create function dashboard_private.agent_personal_connection_class_allowed_v1(p_owner uuid,p_class uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles p join public.teacher_catalogs t on t.id=p.teacher_catalog_id and t.profile_id=p.id
 join public.class_schedule_slots s on s.teacher_catalog_id=t.id join public.classes c on c.id=s.class_id
 where p.id=p_owner and p.role='teacher' and c.id=p_class and c.status='수강' and c.closed_at is null and c.schedule_storage_mode='normalized'
 and dashboard_private.timetable_teacher_eligible_v1(p_owner))
$$;
revoke all on function dashboard_private.agent_personal_connection_class_allowed_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function dashboard_private.agent_personal_connection_metadata_v1(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'ownerId',c.owner_profile_id,'label',c.label,
 'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',coalesce(t.name,'접근할 수 없는 수업')) order by v.ord),'[]') from unnest(c.class_ids) with ordinality v(id,ord)
 left join public.classes t on t.id=v.id and dashboard_private.agent_personal_connection_class_allowed_v1(c.owner_profile_id,v.id)),
 'schools',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',coalesce(s.name,'삭제된 학교')) order by v.ord),'[]') from unnest(c.school_ids) with ordinality v(id,ord) left join public.academic_schools s on s.id=v.id),
 'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'revokedAt',case when c.revoked_at is null then null else to_char(c.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
 'lastUsedAt',case when c.last_used_at is null then null else to_char(c.last_used_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
 from dashboard_private.agent_personal_dashboard_credentials c where c.id=p_id
$$;
revoke all on function dashboard_private.agent_personal_connection_metadata_v1(uuid) from public,anon,authenticated,service_role;

-- Patch only the issuer branch. Every existing owner, grant, assignment, expiry,
-- row lock, DTO, rate limit and callback privilege remains byte-for-byte intact.
do $issuer$
declare body text; anchor text; replacement text;
begin
 body:=pg_get_functiondef('public.agent_personal_dashboard_read_v1(text,text,jsonb)'::regprocedure);
 anchor:=$old$ perform 1 from public.profiles where id=cred.created_by and role='admin' for share;
 if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
 perform 1 from auth.users where id=cred.created_by and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='agent_forbidden';end if;$old$;
 replacement:=$new$ if cred.issuer_kind='administrator' then
  perform 1 from public.profiles where id=cred.created_by and role='admin' for share;
  if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
  perform 1 from auth.users where id=cred.created_by and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
 elsif cred.issuer_kind<>'self_teacher' or cred.created_by<>cred.owner_profile_id then
  raise exception using errcode='42501',message='agent_forbidden';
 end if;$new$;
 if length(body)-length(replace(body,anchor,''))<>length(anchor) then raise exception using errcode='55000',message='personal_issuer_source_drift';end if;
 execute replace(body,anchor,replacement);
end $issuer$;

create function public.agent_personal_connection_v1(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare actor public.profiles; cred dashboard_private.agent_personal_dashboard_credentials;
 op dashboard_private.agent_personal_connection_operations;
 actor_id uuid:=auth.uid(); rid uuid; cid uuid; sid uuid; kind text; fingerprint text;
 class_ids uuid[]; school_ids uuid[]; scopes text[]; expiry timestamptz; label text; token text;
 page integer; size integer; total bigint; items jsonb; operation jsonb:='null'; search text; target_kind text;
 catalog_id uuid; row_count integer;
begin
 if actor_id is null then raise exception using errcode='42501',message='personal_connection_forbidden';end if;
 -- Serializes issue quotas, idempotency and recovery tombstones per actual actor.
 perform pg_advisory_xact_lock(hashtextextended('personal_connection:'||actor_id::text,0));
 select * into actor from public.profiles where id=actor_id and role='teacher' for share;
 if not found then raise exception using errcode='42501',message='personal_connection_forbidden';end if;
 perform 1 from auth.users where id=actor_id and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='personal_connection_forbidden';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>20000 or p_action is null or p_action not in('snapshot','targets','issue','revoke') then raise exception using errcode='22023',message='personal_connection_invalid';end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where not k=any(case p_action when 'snapshot' then array['page','pageSize','pending'] when 'targets' then array['kind','search','page','pageSize'] when 'issue' then array['requestId','label','expiresAt','classIds','schoolIds'] else array['requestId','credentialId'] end)) then raise exception using errcode='22023',message='personal_connection_invalid';end if;

 if p_action in ('snapshot','targets') then
  if jsonb_typeof(p_input->'page') is distinct from 'number' or jsonb_typeof(p_input->'pageSize') is distinct from 'number' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  if coalesce(p_input->>'page','')!~'^[0-9]+$' or coalesce(p_input->>'pageSize','')!~'^[0-9]+$' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  page:=(p_input->>'page')::integer;size:=(p_input->>'pageSize')::integer;
  if page not between 1 and 10000 or size not in(10,15,20) then raise exception using errcode='22023',message='personal_connection_invalid';end if;
 end if;

 if p_action='targets' then
  if jsonb_typeof(p_input->'kind') is distinct from 'string' or p_input->>'kind' not in('classes','schools') or jsonb_typeof(p_input->'search') is distinct from 'string' or length(p_input->>'search')>100 then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  search:=btrim(p_input->>'search');target_kind:=p_input->>'kind';
  with eligible as materialized (
   select c.id,c.name from public.classes c where target_kind='classes' and strpos(lower(c.name),lower(search))>0 and dashboard_private.agent_personal_connection_class_allowed_v1(actor_id,c.id)
   union all
   select s.id,s.name from public.academic_schools s where target_kind='schools' and strpos(lower(s.name),lower(search))>0
  ) select (select count(*) from eligible),(select coalesce(jsonb_agg(to_jsonb(q) order by q.name,q.id),'[]') from(select id,name from eligible order by name,id limit size offset(page-1)*size)q) into total,items;
  return jsonb_build_object('ownerId',actor_id,'kind',target_kind,'search',search,'items',items,'total',total,'page',page,'pageSize',size);
 end if;

 if p_action='snapshot' then
  if p_input->'pending' is not null and p_input->'pending'<>'null'::jsonb then
   if jsonb_typeof(p_input->'pending') is distinct from 'object' or (p_input->'pending')-array['requestId','kind']<>'{}'::jsonb
    or jsonb_typeof(p_input#>'{pending,requestId}') is distinct from 'string' or coalesce(p_input#>>'{pending,kind}','') not in('issue','revoke') then raise exception using errcode='22023',message='personal_connection_invalid';end if;
   rid:=(p_input#>>'{pending,requestId}')::uuid;kind:=p_input#>>'{pending,kind}';
   select * into op from dashboard_private.agent_personal_connection_operations where owner_id=actor_id and request_id=rid;
   if not found then
    -- An absent operation is not declared failed until its original ID is
    -- durably closed. A delayed original request can no longer mint a key.
    if (select count(*) from dashboard_private.agent_personal_connection_operations where owner_id=actor_id and created_at>=clock_timestamp()-interval '1 day')>=100 then raise exception using errcode='54000',message='personal_connection_recovery_limit';end if;
    insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,state) values(actor_id,rid,kind,'failed') returning * into op;
   end if;
   if op.kind<>kind then raise exception using errcode='22023',message='personal_connection_request_conflict';end if;
   operation:=jsonb_build_object('requestId',rid,'kind',kind,'state',op.state,'credential',case when op.credential_id is null then null else dashboard_private.agent_personal_connection_metadata_v1(op.credential_id) end);
  end if;
  with owned as materialized (select id,created_at from dashboard_private.agent_personal_dashboard_credentials where owner_profile_id=actor_id)
  select (select count(*) from owned),(select coalesce(jsonb_agg(dashboard_private.agent_personal_connection_metadata_v1(q.id) order by q.created_at desc,q.id),'[]') from
   (select id,created_at from owned order by created_at desc,id limit size offset(page-1)*size) q) into total,items;
  return jsonb_build_object('status','ready','ownerId',actor_id,'items',items,'total',total,'page',page,'pageSize',size,'operation',operation);
 end if;

 if jsonb_typeof(p_input->'requestId') is distinct from 'string' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
 rid:=(p_input->>'requestId')::uuid;kind:=p_action;
 fingerprint:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into op from dashboard_private.agent_personal_connection_operations where owner_id=actor_id and request_id=rid;
 if found then
  if op.kind<>kind or op.input_hash is not null and op.input_hash<>fingerprint then raise exception using errcode='22023',message='personal_connection_request_conflict';end if;
  if op.state='failed' then raise exception using errcode='55000',message='personal_connection_request_closed';end if;
  -- No stored plaintext: replay returns metadata only, never a second secret.
  return jsonb_build_object('requestId',rid,'credential',dashboard_private.agent_personal_connection_metadata_v1(op.credential_id))||case when kind='issue' then jsonb_build_object('secret',null) else '{}'::jsonb end;
 end if;

 if p_action='issue' then
  if jsonb_typeof(p_input->'label') is distinct from 'string' or jsonb_typeof(p_input->'expiresAt') is distinct from 'string'
   or jsonb_typeof(p_input->'classIds') is distinct from 'array' or jsonb_typeof(p_input->'schoolIds') is distinct from 'array' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  label:=btrim(p_input->>'label');expiry:=(p_input->>'expiresAt')::timestamptz;
  if length(label) not between 1 and 80 or not isfinite(expiry) or expiry<=clock_timestamp()+interval '5 minutes' or expiry>clock_timestamp()+interval '30 days'
   or jsonb_array_length(p_input->'classIds')>50 or jsonb_array_length(p_input->'schoolIds')>50 then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  if exists(select 1 from jsonb_array_elements((p_input->'classIds')||(p_input->'schoolIds')) v where jsonb_typeof(v)<>'string') then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  select coalesce(array_agg(v::uuid order by v::uuid),'{}') into class_ids from jsonb_array_elements_text(p_input->'classIds') v;
  select coalesce(array_agg(v::uuid order by v::uuid),'{}') into school_ids from jsonb_array_elements_text(p_input->'schoolIds') v;
  if not dashboard_private.agent_personal_dashboard_uuid_grant_v1(class_ids) or not dashboard_private.agent_personal_dashboard_uuid_grant_v1(school_ids) or cardinality(class_ids)+cardinality(school_ids)=0 then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  if cardinality(class_ids)>0 then
   select id into catalog_id from public.teacher_catalogs where id=actor.teacher_catalog_id and profile_id=actor_id for share;
   if not found or not dashboard_private.timetable_teacher_eligible_v1(actor_id) then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
   foreach cid in array class_ids loop
    perform 1 from public.classes where id=cid and status='수강' and closed_at is null and schedule_storage_mode='normalized' for share;
    if not found then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
    perform 1 from public.class_schedule_slots where class_id=cid and teacher_catalog_id=catalog_id order by id for share;
    if not found then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
   end loop;
  end if;
  foreach sid in array school_ids loop
   perform 1 from public.academic_schools where id=sid for share;
   if not found then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
  end loop;
  select count(*) into row_count from dashboard_private.agent_personal_dashboard_credentials where owner_profile_id=actor_id and revoked_at is null and expires_at>clock_timestamp();
  if row_count>=5 then raise exception using errcode='54000',message='personal_connection_active_limit';end if;
  if (select count(*) from dashboard_private.agent_personal_connection_operations o where o.owner_id=actor_id and o.kind='issue' and o.state='applied' and o.created_at>=clock_timestamp()-interval '1 day')>=10 then raise exception using errcode='54000',message='personal_connection_issue_limit';end if;
  -- Expiry may have elapsed while waiting for current grant rows.
  if expiry<=clock_timestamp() then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  scopes:=(case when cardinality(class_ids)>0 then array['class-details:read'] else '{}'::text[] end)||(case when cardinality(school_ids)>0 then array['calendar:read'] else '{}'::text[] end);
  token:='tips_dashboard_personal_'||encode(extensions.gen_random_bytes(32),'hex');
  insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,school_ids,expires_at,issuer_kind)
   values(actor_id,actor_id,label,encode(sha256(convert_to(token,'UTF8')),'hex'),scopes,class_ids,school_ids,expiry,'self_teacher') returning * into cred;
 else
  if jsonb_typeof(p_input->'credentialId') is distinct from 'string' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  cid:=(p_input->>'credentialId')::uuid;
  select * into cred from dashboard_private.agent_personal_dashboard_credentials where id=cid and owner_profile_id=actor_id for update;
  if not found then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
  update dashboard_private.agent_personal_dashboard_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=cid returning * into cred;
 end if;
 insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,input_hash,state,credential_id) values(actor_id,rid,kind,fingerprint,'applied',cred.id);
 return jsonb_build_object('requestId',rid,'credential',dashboard_private.agent_personal_connection_metadata_v1(cred.id))||case when p_action='issue' then jsonb_build_object('secret',token) else '{}'::jsonb end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='22023',message='personal_connection_invalid';
end$$;
alter function public.agent_personal_connection_v1(text,jsonb) owner to postgres;
revoke all on function public.agent_personal_connection_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.agent_personal_connection_v1(text,jsonb) to authenticated;
commit;
