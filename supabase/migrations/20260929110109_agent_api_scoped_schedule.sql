begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Opaque, revocable capabilities. No integration can access these tables through
-- the Data API. Issuer authority is checked again on every invocation.
create table dashboard_private.agent_credentials (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references public.profiles(id),
 label text not null check(length(label) between 1 and 80),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null,
 class_ids uuid[] not null default '{}',
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_used_at timestamptz,
 rate_window timestamptz,
 rate_count integer not null default 0
);
create table dashboard_private.agent_previews (
 id uuid primary key default gen_random_uuid(),
 credential_id uuid not null references dashboard_private.agent_credentials(id),
 class_id uuid not null references public.classes(id),
 base_version text not null,
 command jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 reason text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table dashboard_private.agent_operations (
 credential_id uuid not null references dashboard_private.agent_credentials(id),
 request_key uuid not null,
 preview_id uuid not null references dashboard_private.agent_previews(id),
 actor_profile_id uuid not null references public.profiles(id),
 executor text not null,
 source_reference text,
 state text not null check(state in('applied','failed')),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(credential_id,request_key),
 unique(preview_id)
);
create index agent_previews_credential_created on dashboard_private.agent_previews(credential_id,created_at desc);
create index agent_operations_credential_created on dashboard_private.agent_operations(credential_id,created_at desc);
alter table dashboard_private.agent_credentials enable row level security;
alter table dashboard_private.agent_previews enable row level security;
alter table dashboard_private.agent_operations enable row level security;
revoke all on dashboard_private.agent_credentials,dashboard_private.agent_previews,dashboard_private.agent_operations from public,anon,authenticated,service_role;

create function dashboard_private.agent_require_admin_v1() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=actor and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())) then
 raise exception using errcode='42501',message='agent_forbidden'; end if;
 return actor;
end$$;

create function public.create_agent_credential_v1(p_label text,p_scopes text[],p_class_ids uuid[],p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1(); raw text; row dashboard_private.agent_credentials;
begin
 if nullif(btrim(p_label),'') is null or length(p_label)>80 or p_scopes is null or cardinality(p_scopes)=0 or array_position(p_scopes,null) is not null
 or not p_scopes <@ array['classes:read','calendar:read','schedule:preview','schedule:write']::text[]
 or p_class_ids is null or cardinality(p_class_ids)>50 or array_position(p_class_ids,null) is not null
 or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '30 days'
 or (p_scopes && array['schedule:preview','schedule:write']::text[] and (cardinality(p_class_ids)=0 or not 'classes:read'=any(p_scopes)))
 or ('schedule:write'=any(p_scopes) and not 'schedule:preview'=any(p_scopes))
 or exists(select 1 from unnest(p_class_ids) id where not exists(select 1 from public.classes c where c.id=id)) then
 raise exception using errcode='22023',message='agent_invalid'; end if;
 if (select count(*) from dashboard_private.agent_credentials where created_by=actor and revoked_at is null and expires_at>now())>=20 then raise exception using errcode='54000',message='agent_credential_limit';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.agent_credentials(created_by,label,token_hash,scopes,class_ids,expires_at)
 values(actor,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,p_class_ids,p_expires_at) returning * into row;
 return jsonb_build_object('id',row.id,'label',row.label,'token',raw,'scopes',row.scopes,'classIds',row.class_ids,'expiresAt',row.expires_at);
end$$;
create function public.list_agent_credentials_v1(p_page integer default 1,p_page_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1();begin
 if p_page is null or p_page<1 or p_page>10000 or p_page_size is null or p_page_size not in(10,15,20) then raise exception using errcode='22023',message='agent_invalid';end if;
 return jsonb_build_object('total',(select count(*) from dashboard_private.agent_credentials where created_by=actor),'items',
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'scopes',scopes,'classIds',class_ids,'createdAt',created_at,'expiresAt',expires_at,'revokedAt',revoked_at,'lastUsedAt',last_used_at) order by created_at desc,id),'[]')
 from (select * from dashboard_private.agent_credentials where created_by=actor order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size) x));
end$$;
create function public.revoke_agent_credential_v1(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1();begin
 update dashboard_private.agent_credentials set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id and created_by=actor;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
end$$;

-- Only schedule/operating state contributes to this opaque optimistic version.
create function dashboard_private.agent_class_version_v1(c public.classes) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('schedule',c.schedule,'plan',c.schedule_plan,'teacher',c.teacher,'room',c.room,'subject',c.subject,'status',c.status,'closedAt',c.closed_at,'mode',c.schedule_storage_mode,'revision',c.schedule_revision,'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.class_schedule_slots s where s.class_id=c.id))::text,'UTF8')),'hex')
$$;
create function dashboard_private.agent_class_json_v1(c public.classes,r jsonb) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'teacher',c.teacher,'room',c.room,'status',c.status,'schedule',c.schedule,'version',dashboard_private.agent_class_version_v1(c),'weeklySlots',(select coalesce(jsonb_agg(s order by s->>'id'),'[]') from jsonb_array_elements(r->'shadowSlots') s where s->>'classId'=c.id::text),'weeklyScheduleComplete',not exists(select 1 from jsonb_array_elements(r->'unresolvedOccupancies') b where b->>'classId'=c.id::text))
$$;

-- One supported mutation: change the times of ONE existing weekly slot. Every
-- other slot, all materialized lessons, learning content and student history stay
-- in the existing domain writers. No generic table/column writes are exposed.
create function dashboard_private.agent_apply_weekly_time_v1(p_class_id uuid,p_command jsonb,p_key uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.classes; r jsonb; slot jsonb; row jsonb; slots jsonb:='[]'; schedule text:=''; teacher text; room text; a int; b int; sorder int;
begin
 perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into c from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if c.closed_at is not null or c.status<>'수강' then raise exception using errcode='42501',message='agent_class_not_active';end if;
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 if exists(select 1 from jsonb_array_elements(r->'unresolvedOccupancies') x where x->>'classId'=c.id::text) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 select s into slot from jsonb_array_elements(r->'shadowSlots') s where s->>'classId'=c.id::text and s->>'id'=p_command->>'slotId';
 if slot is null then raise exception using errcode='P0001',message='agent_stale';end if;
 a:=(p_command->>'startMinute')::int;b:=(p_command->>'endMinute')::int;
 if a is null or b is null or a<0 or a>=b or b>1440 then raise exception using errcode='22023',message='agent_invalid';end if;
 if a=(slot->>'startMinute')::int and b=(slot->>'endMinute')::int then raise exception using errcode='22023',message='agent_no_change';end if;
 for row in select s from jsonb_array_elements(r->'shadowSlots') s where s->>'classId'=c.id::text order by s->>'id' loop
 if row->>'id'=slot->>'id' then row:=row||jsonb_build_object('startMinute',a,'endMinute',b);end if;
 if c.schedule_storage_mode='normalized' then
 select sort_order into sorder from public.class_schedule_slots where id=(row->>'sourceSlotId')::uuid;
 slots:=slots||jsonb_build_array(jsonb_build_object('id',row->>'sourceSlotId','weekday',(row->>'weekday')::int,'startTime',lpad(((row->>'startMinute')::int/60)::text,2,'0')||':'||lpad(((row->>'startMinute')::int%60)::text,2,'0'),'endTime',lpad(((row->>'endMinute')::int/60)::text,2,'0')||':'||lpad(((row->>'endMinute')::int%60)::text,2,'0'),'teacherCatalogId',row->>'teacherId','classroomCatalogId',row->>'classroomId','sortOrder',sorder));
 else
 select name into teacher from public.teacher_catalogs where id=(row->>'teacherId')::uuid;
 select name into room from public.classroom_catalogs where id=(row->>'classroomId')::uuid;
 if teacher ~ '[,();\n]' or room ~ '[,();\n]' then raise exception using errcode='22023',message='agent_unsupported_catalog_label';end if;
 schedule:=schedule||case when schedule='' then '' else '; ' end||substr('일월화수목금토',(row->>'weekday')::int+1,1)||' '||lpad(((row->>'startMinute')::int/60)::text,2,'0')||':'||lpad(((row->>'startMinute')::int%60)::text,2,'0')||'-'||lpad(((row->>'endMinute')::int/60)::text,2,'0')||':'||lpad(((row->>'endMinute')::int%60)::text,2,'0')||' ('||teacher||', '||room||')';
 end if;
 end loop;
 if c.schedule_storage_mode='normalized' then
 perform public.save_class_schedule_defaults_v1(c.id,c.schedule_revision,slots,p_key,p_command->>'reason');
 else
 perform public.update_class_operational_v1(c.id,jsonb_build_object('schedule',schedule),p_key,null);
 end if;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
end$$;

-- Sole service-only entry point. It verifies a hashed integration capability,
-- derives the actor from the stored grant (never from input), narrows actions,
-- and restores transaction-local claims after using the existing domain RPCs.
create function public.agent_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.agent_credentials; preview dashboard_private.agent_previews; op dashboard_private.agent_operations;
 c public.classes; r jsonb; result jsonb; before_state jsonb; after_state jsonb; command jsonb; scope text;
 cid uuid; key uuid; preview_id uuid; page int; total int; date_from date; date_to date;
 claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); jwtrole text:=current_setting('request.jwt.claim.role',true);
 err text; errcode text;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='28000',message='agent_unauthorized';end if;
 select * into cred from dashboard_private.agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='agent_forbidden';end if;
 if cred.rate_window is null or cred.rate_window<date_trunc('minute',clock_timestamp()) then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then return jsonb_build_object('error',jsonb_build_object('code','agent_rate_limited'));end if;
 update dashboard_private.agent_credentials set last_used_at=clock_timestamp(),rate_window=date_trunc('minute',clock_timestamp()),rate_count=cred.rate_count+1 where id=cred.id;
 scope:=case p_action when 'classes' then 'classes:read' when 'class' then 'classes:read' when 'calendar' then 'calendar:read' when 'preview' then 'schedule:preview' when 'commit' then 'schedule:write' when 'operation' then 'schedule:write' when 'health' then null else 'invalid' end;
 if scope='invalid' or (scope is not null and not scope=any(cred.scopes)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='agent_invalid';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cred.created_by,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cred.created_by::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 if p_action='health' then
 result:=jsonb_build_object('apiVersion','1','credentialId',cred.id,'executor',cred.label,'scopes',cred.scopes,'classIds',cred.class_ids,'expiresAt',cred.expires_at,'timezone','Asia/Seoul');
 elsif p_action in('classes','class') then
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 if p_action='class' then
 cid:=(p_input->>'classId')::uuid;
 select * into c from public.classes where id=cid and (cardinality(cred.class_ids)=0 or id=any(cred.class_ids));
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 result:=dashboard_private.agent_class_json_v1(c,r);
 else
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 or length(coalesce(p_input->>'search',''))>100 then raise exception using errcode='22023',message='agent_invalid';end if;
 select count(*) into total from public.classes where (cardinality(cred.class_ids)=0 or id=any(cred.class_ids)) and (nullif(p_input->>'status','') is null or status=p_input->>'status') and (nullif(p_input->>'search','') is null or strpos(lower(name),lower(p_input->>'search'))>0);
 select jsonb_build_object('items',coalesce(jsonb_agg(dashboard_private.agent_class_json_v1(x,r) order by x.name,x.id),'[]'),'page',page,'pageSize',20,'total',total) into result from (select * from public.classes where (cardinality(cred.class_ids)=0 or id=any(cred.class_ids)) and (nullif(p_input->>'status','') is null or status=p_input->>'status') and (nullif(p_input->>'search','') is null or strpos(lower(name),lower(p_input->>'search'))>0) order by name,id limit 20 offset (page-1)*20) x;
 end if;
 elsif p_action='calendar' then
 date_from:=(p_input->>'from')::date;date_to:=(p_input->>'to')::date;
 if date_from is null or date_to is null or date_to<date_from or date_to-date_from>31 then raise exception using errcode='22023',message='agent_invalid_range';end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'date',date,'type',type,'schoolId',school_id,'grade',grade) order by date,id),'[]'),'from',date_from,'to',date_to) into result from public.academic_events where date between date_from and date_to;
 elsif p_action='operation' then
 key:=(p_input->>'requestKey')::uuid;
 select * into op from dashboard_private.agent_operations where credential_id=cred.id and request_key=key;
 result:=case when found then op.result else jsonb_build_object('operationId',key,'state','unknown','retryWithNewKey',false) end;
 elsif p_action='preview' then
 cid:=(p_input->>'classId')::uuid;
 if not cid=any(cred.class_ids) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if nullif(btrim(p_input->>'reason'),'') is null or length(p_input->>'reason')>300 then raise exception using errcode='22023',message='agent_invalid';end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into c from public.classes where id=cid for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if p_input->>'expectedVersion' is distinct from dashboard_private.agent_class_version_v1(c) then raise exception using errcode='P0001',message='agent_stale';end if;
 command:=jsonb_build_object('slotId',p_input->>'slotId','startMinute',p_input->'startMinute','endMinute',p_input->'endMinute','reason',p_input->>'reason');
 before_state:=dashboard_private.agent_class_json_v1(c,dashboard_private.read_timetable_weekly_reference_v1());
 -- A subtransaction exercises the FINAL domain writer and immediate conflict
 -- checks, then rolls back ALL its state/receipts/signals. Only preview is saved.
 begin
 perform dashboard_private.agent_apply_weekly_time_v1(cid,command,gen_random_uuid());
 select dashboard_private.agent_class_json_v1(x,dashboard_private.read_timetable_weekly_reference_v1()) into after_state from public.classes x where id=cid;
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_previews(credential_id,class_id,base_version,command,before_state,after_state,reason) values(cred.id,cid,p_input->>'expectedVersion',command,before_state,after_state,p_input->>'reason') returning * into preview;
 result:=jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'before',before_state,'after',after_state,'effect','weekly_template_only','materializedLessonsChanged',false,'notifications',jsonb_build_object('state','not_requested'));
 elsif p_action='commit' then
 key:=(p_input->>'requestKey')::uuid;preview_id:=(p_input->>'previewToken')::uuid;
 if key is null or preview_id is null or length(coalesce(p_input->>'sourceReference',''))>500 then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into op from dashboard_private.agent_operations where credential_id=cred.id and request_key=key;
 if found then
 if op.preview_id<>preview_id or op.source_reference is distinct from nullif(p_input->>'sourceReference','') then raise exception using errcode='22023',message='agent_idempotency_key_reused';end if;
 result:=op.result||jsonb_build_object('replayed',true);
 else
 select * into preview from dashboard_private.agent_previews where id=preview_id and credential_id=cred.id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if not preview.class_id=any(cred.class_ids) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if exists(select 1 from dashboard_private.agent_operations o where o.preview_id=preview.id) then raise exception using errcode='22023',message='agent_preview_consumed';end if;
 begin
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='agent_preview_expired';end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into c from public.classes where id=preview.class_id for update;
 if dashboard_private.agent_class_version_v1(c) is distinct from preview.base_version then raise exception using errcode='P0001',message='agent_stale';end if;
 perform dashboard_private.agent_apply_weekly_time_v1(preview.class_id,preview.command,gen_random_uuid());
 select dashboard_private.agent_class_json_v1(x,dashboard_private.read_timetable_weekly_reference_v1()) into after_state from public.classes x where id=preview.class_id;
 result:=jsonb_build_object('operationId',key,'state','applied','class',after_state,'appliedAt',clock_timestamp(),'executor',cred.label,'actorProfileId',cred.created_by,'sourceReference',nullif(p_input->>'sourceReference',''),'requesterVerified',false,'effect','weekly_template_only','materializedLessonsChanged',false,'notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 exception when others then
 get stacked diagnostics err=message_text,errcode=returned_sqlstate;
 result:=jsonb_build_object('operationId',key,'state','failed','error',jsonb_build_object('code',case when errcode='23P01' then 'timetable_resource_conflict' when err in('agent_stale','agent_preview_expired','class_schedule_stale','class_schedule_closed','class_schedule_forbidden','continuous_class_schedule_runtime_not_ready') then err else 'agent_write_failed' end,'sqlstate',errcode),'notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 end;
 insert into dashboard_private.agent_operations(credential_id,request_key,preview_id,actor_profile_id,executor,source_reference,state,result) values(cred.id,key,preview.id,cred.created_by,cred.label,nullif(p_input->>'sourceReference',''),result->>'state',result);
 end if;
 end if;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 perform set_config('request.jwt.claim.role',coalesce(jwtrole,''),true);
 return jsonb_build_object('data',result);
end$$;

revoke all on function public.agent_api_v1(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_api_v1(text,text,jsonb) to service_role;
revoke all on function public.create_agent_credential_v1(text,text[],uuid[],timestamptz),public.list_agent_credentials_v1(integer,integer),public.revoke_agent_credential_v1(uuid) from public,anon,service_role;
grant execute on function public.create_agent_credential_v1(text,text[],uuid[],timestamptz),public.list_agent_credentials_v1(integer,integer),public.revoke_agent_credential_v1(uuid) to authenticated;
revoke all on function dashboard_private.agent_require_admin_v1(),dashboard_private.agent_class_version_v1(public.classes),dashboard_private.agent_class_json_v1(public.classes,jsonb),dashboard_private.agent_apply_weekly_time_v1(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
