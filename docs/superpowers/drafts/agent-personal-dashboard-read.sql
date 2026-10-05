-- DRAFT ONLY. No active migration registration, operational application or issuance.
-- Base: 52b0e2e23d8e7cda54b786c261aceac93910e476. Central/AI inbox credentials remain unchanged.
-- A new audience has explicit read-only grants; neither JWT/GUC substitution nor
-- an admin issuer's authority supplies the owner's class/calendar authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function dashboard_private.agent_personal_dashboard_uuid_grant_v1(p_ids uuid[]) returns boolean
language sql immutable set search_path='' as $$
 select p_ids is not null and coalesce(array_ndims(p_ids),1)=1 and cardinality(p_ids)<=50 and array_position(p_ids,null) is null and cardinality(p_ids)=(select count(distinct id) from unnest(p_ids) id)
$$;
revoke all on function dashboard_private.agent_personal_dashboard_uuid_grant_v1(uuid[]) from public,anon,authenticated,service_role;

create table dashboard_private.agent_personal_dashboard_credentials (
 id uuid primary key default gen_random_uuid(),
 credential_kind text not null default 'personal_dashboard_read' check(credential_kind='personal_dashboard_read'),
 audience text not null default 'tips_dashboard_personal' check(audience='tips_dashboard_personal'),
 created_by uuid not null references public.profiles(id),
 owner_profile_id uuid not null references public.profiles(id),
 label text not null check(length(label) between 1 and 80 and btrim(label)<>''),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null check(coalesce(array_ndims(scopes),1)=1 and array_position(scopes,null) is null and scopes <@ array['class-details:read','calendar:read']::text[] and cardinality(scopes) between 1 and 2 and cardinality(scopes)=('class-details:read'=any(scopes))::integer+('calendar:read'=any(scopes))::integer),
 class_ids uuid[] not null default '{}' check(dashboard_private.agent_personal_dashboard_uuid_grant_v1(class_ids)),
 school_ids uuid[] not null default '{}' check(dashboard_private.agent_personal_dashboard_uuid_grant_v1(school_ids)),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_used_at timestamptz,
 rate_window timestamptz,
 rate_count bigint not null default 0 check(rate_count between 0 and 60),
 check(('class-details:read'=any(scopes))=(cardinality(class_ids)>0)),
 check(('calendar:read'=any(scopes))=(cardinality(school_ids)>0))
);
create index agent_personal_dashboard_owner_created on dashboard_private.agent_personal_dashboard_credentials(owner_profile_id,created_at desc,id);
alter table dashboard_private.agent_personal_dashboard_credentials enable row level security;
revoke all on dashboard_private.agent_personal_dashboard_credentials from public,anon,authenticated,service_role;

create function dashboard_private.agent_personal_dashboard_identity_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.owner_profile_id is distinct from old.owner_profile_id or new.credential_kind is distinct from old.credential_kind or new.audience is distinct from old.audience or new.token_hash is distinct from old.token_hash or new.scopes is distinct from old.scopes or new.class_ids is distinct from old.class_ids or new.school_ids is distinct from old.school_ids or new.expires_at is distinct from old.expires_at then
  raise exception using errcode='55000',message='agent_personal_identity_immutable';
 end if;
 return new;
end$$;
create trigger agent_personal_dashboard_identity_immutable before update on dashboard_private.agent_personal_dashboard_credentials for each row execute function dashboard_private.agent_personal_dashboard_identity_v1();
revoke all on function dashboard_private.agent_personal_dashboard_identity_v1() from public,anon,authenticated,service_role;

-- No issuing RPC/token generator exists in this draft. A future issuance path
-- needs separate authorization and must validate explicit grants before storing.
create function public.agent_personal_dashboard_read_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare cred dashboard_private.agent_personal_dashboard_credentials; owner public.profiles; c public.classes; sid uuid; cid uuid; catalog_id uuid; yr integer; page integer; scope text; context jsonb; slots jsonb; sessions jsonb; events jsonb; areas jsonb; schools jsonb; school jsonb; row_count bigint; authorization jsonb; resource jsonb; minute timestamptz; invalid_projection boolean;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='28000',message='agent_unauthorized';end if;
 select * into cred from dashboard_private.agent_personal_dashboard_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() or cred.credential_kind<>'personal_dashboard_read' or cred.audience<>'tips_dashboard_personal' then raise exception using errcode='28000',message='agent_unauthorized';end if;
 -- Issuer validity is a conservative additional boundary, never a read actor.
 perform 1 from public.profiles where id=cred.created_by and role='admin' for share;
 if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
 perform 1 from auth.users where id=cred.created_by and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
 select * into owner from public.profiles where id=cred.owner_profile_id and role='teacher' for share;
 if not found or cred.owner_profile_id is null then raise exception using errcode='42501',message='agent_forbidden';end if;
 perform 1 from auth.users where id=owner.id and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='agent_forbidden';end if;
 scope:=case p_action when 'class_context' then 'class-details:read' when 'calendar_context' then 'calendar:read' when 'schools' then 'calendar:read' else null end;
 if scope is null then raise exception using errcode='22023',message='agent_invalid';end if;
 if not scope=any(cred.scopes) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536 then raise exception using errcode='22023',message='agent_invalid';end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where not k=any(case p_action when 'class_context' then array['classId'] when 'calendar_context' then array['schoolId','schoolYear'] else array['page','search'] end)) then raise exception using errcode='22023',message='agent_invalid';end if;
 -- Budget check precedes any domain row read, locks or projection work.
 minute:=date_trunc('minute',clock_timestamp());
 if cred.rate_window is distinct from minute then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then raise exception using errcode='54000',message='agent_rate_limited';end if;
 authorization:=jsonb_build_object('credentialId',cred.id,'credentialKind',cred.credential_kind,'ownerProfileId',owner.id,'ownerRole',owner.role,'scope',scope);
 if p_action='class_context' then
  if jsonb_typeof(p_input->'classId') is distinct from 'string' then raise exception using errcode='22023',message='agent_invalid';end if;
  cid:=(p_input->>'classId')::uuid;
  if not cid=any(cred.class_ids) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  select * into c from public.classes where id=cid for share;
  if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
  if c.status is distinct from '수강' or c.closed_at is not null then raise exception using errcode='42501',message='agent_class_not_active';end if;
  if c.schedule_storage_mode is distinct from 'normalized' then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  select id into catalog_id from public.teacher_catalogs where id=owner.teacher_catalog_id and profile_id=owner.id for share;
  if not found or not dashboard_private.timetable_teacher_eligible_v1(owner.id) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  -- Lock the actual current UUID assignment before any context read. Historical
  -- dated sessions, catalog visibility and matching display names are not grants.
  perform 1 from public.class_schedule_slots where class_id=cid and teacher_catalog_id=catalog_id order by id for share;
  if not found then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  -- Materialize each bounded, locked source once; count, validation and output
  -- share the same rows. Inserts cannot manufacture a pre-limit grant.
  with eligible as materialized (
   select id,weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id,sort_order from public.class_schedule_slots where class_id=cid order by id limit 51 for share
  ) select count(*),coalesce(bool_or(teacher_catalog_id is null or extract(second from start_time)<>0 or extract(second from end_time)<>0),false),coalesce(jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startMinute',(extract(epoch from start_time)/60)::integer,'endMinute',(extract(epoch from end_time)/60)::integer,'teacherId',teacher_catalog_id,'classroomId',classroom_catalog_id,'sortOrder',sort_order) order by id),'[]') into row_count,invalid_projection,slots from eligible;
  if row_count>50 then raise exception using errcode='54000',message='agent_read_too_dense';end if;
  if invalid_projection then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  with eligible as materialized (
   select id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,source_schedule_slot_id,makeup_of_session_id from public.class_lesson_sessions where class_id=cid order by session_date,id limit 2501 for share
  ) select count(*),coalesce(bool_or((start_time is not null and extract(second from start_time)<>0) or (end_time is not null and extract(second from end_time)<>0)),false),coalesce(jsonb_agg(jsonb_build_object('id',id,'session_date',session_date,'schedule_state',schedule_state,'start_time',start_time,'end_time',end_time,'teacher_catalog_id',teacher_catalog_id,'classroom_catalog_id',classroom_catalog_id,'source_schedule_slot_id',source_schedule_slot_id,'makeup_of_session_id',makeup_of_session_id) order by session_date,id),'[]') into row_count,invalid_projection,sessions from eligible;
  if row_count>2500 then raise exception using errcode='54000',message='agent_read_too_dense';end if;
  if invalid_projection then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  context:=jsonb_build_object('id',c.id,'basic',jsonb_build_object('name',c.name,'classType',c.class_type,'subject',c.subject,'subjectAreaKey',c.subject_area_key,'grade',c.grade),'storageMode','normalized','schedule',coalesce(c.schedule,''),'weeklySlots',slots,'plan','{}'::jsonb,'sessions',sessions,'catalogs',jsonb_build_object('teachers','[]'::jsonb,'classrooms','[]'::jsonb),'weeklyScheduleComplete',true);
  -- Fingerprint only the safe visible scheduling projection: no fees, notes,
  -- students, raw plans, private snapshots or hashes derived from those fields.
  context:=context||jsonb_build_object('version',encode(sha256(convert_to(context::text,'UTF8')),'hex'));
  resource:=jsonb_build_object('kind','class','id',cid);
 elsif p_action='calendar_context' then
  if jsonb_typeof(p_input->'schoolId') is distinct from 'string' or jsonb_typeof(p_input->'schoolYear') is distinct from 'number' then raise exception using errcode='22023',message='agent_invalid';end if;
  sid:=(p_input->>'schoolId')::uuid;yr:=(p_input->>'schoolYear')::integer;
  if yr<2000 or yr>2200 then raise exception using errcode='22023',message='agent_invalid_range';end if;
  if not sid=any(cred.school_ids) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
  select jsonb_build_object('id',id,'name',name,'category',coalesce(category,'')) into school from public.academic_schools where id=sid for share;
  if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
  -- Shared teacher academic read is narrowed by an explicit school grant.
  -- No inferred owner-school/student relation, free description or note source.
  with eligible as materialized (
   select id,title,type,date,grade from public.academic_events where school_id=sid and date>=make_date(yr,3,1) and date<make_date(yr+1,3,1) and type in('시험기간','영어시험일','수학시험일','과학시험일','체험학습','방학·휴일·기타') and strpos(coalesce(note,''),'[[TIPS_MAKEUP]]')=0 order by date,id limit 2501 for share
  ) select count(*),coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'type',type,'date',date,'grade',grade) order by date,id),'[]') into row_count,events from eligible;
  if row_count>2500 then raise exception using errcode='54000',message='agent_read_too_dense';end if;
  select coalesce(jsonb_agg(area_key order by area_key),'[]') into areas from(select area_key from public.academic_subject_areas where subject='과학' and is_active and area_key is not null order by area_key limit 100)x;
  context:=jsonb_build_object('school',school,'schoolYear',yr,'events',events,'scienceAreas',areas);
  context:=context||jsonb_build_object('version',encode(sha256(convert_to(context::text,'UTF8')),'hex'));
  resource:=jsonb_build_object('kind','calendar','id',sid,'schoolYear',yr);
 else
  if (p_input ? 'page' and jsonb_typeof(p_input->'page') is distinct from 'number') or (p_input ? 'search' and jsonb_typeof(p_input->'search') is distinct from 'string') then raise exception using errcode='22023',message='agent_invalid';end if;
  page:=coalesce((p_input->>'page')::integer,1);
  if page<1 or page>10000 or length(coalesce(p_input->>'search',''))>100 then raise exception using errcode='22023',message='agent_invalid';end if;
  with eligible as materialized (
   select id,name,coalesce(category,'') category from public.academic_schools where id=any(cred.school_ids) and strpos(lower(name),lower(coalesce(p_input->>'search','')))>0 order by id for share
  ) select jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'category',x.category) order by x.name,x.id),'[]') from(select * from eligible order by name,id limit 20 offset(page-1)*20)x),'total',(select count(*) from eligible),'page',page,'pageSize',20) into context;
  resource:=jsonb_build_object('kind','schools');
 end if;
 -- A read may have waited on current authority/domain row locks. Never return
 -- a credential that expired during that wait/projection. Revocation and all
 -- immutable grant/identity fields are serialized by the credential lock.
 if cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 update dashboard_private.agent_personal_dashboard_credentials set last_used_at=clock_timestamp(),rate_window=minute,rate_count=cred.rate_count+1 where id=cred.id;
 return jsonb_build_object('data',jsonb_build_object('authorization',authorization,'resource',resource,'context',context));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using errcode='22023',message='agent_invalid';
end$$;
revoke all on function public.agent_personal_dashboard_read_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.agent_personal_dashboard_read_v1(text,text,jsonb) to service_role;
commit;
