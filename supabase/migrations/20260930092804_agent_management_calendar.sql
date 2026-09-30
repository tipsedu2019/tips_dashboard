begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Existing grants retain their exact target set. Only the new explicit issuing
-- API may authorize current and future classes.
alter table dashboard_private.agent_credentials add column all_classes boolean not null default false;

-- School years are bounded calendar labels (2000–2200), not growing counters.
create table dashboard_private.agent_calendar_sources (
 event_id uuid primary key,
 school_id uuid not null,
 -- squawk-ignore prefer-bigint-over-int
 school_year integer not null,
 source jsonb not null,
 event_version text not null,
 updated_at timestamptz not null default clock_timestamp()
);
create table dashboard_private.agent_calendar_previews (
 id uuid primary key default gen_random_uuid(),
 credential_id uuid not null references dashboard_private.agent_credentials(id),
 school_id uuid not null,
 -- squawk-ignore prefer-bigint-over-int
 school_year integer not null,
 base_version text not null,
 command jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table dashboard_private.agent_calendar_operations (
 credential_id uuid not null references dashboard_private.agent_credentials(id),
 request_key uuid not null,
 preview_id uuid not null unique references dashboard_private.agent_calendar_previews(id),
 source_reference text,
 state text not null check(state in('applied','failed')),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(credential_id,request_key)
);
create index agent_calendar_previews_credential_created on dashboard_private.agent_calendar_previews(credential_id,created_at desc);
create index agent_calendar_operations_credential_created on dashboard_private.agent_calendar_operations(credential_id,created_at desc);
alter table dashboard_private.agent_calendar_sources enable row level security;
alter table dashboard_private.agent_calendar_previews enable row level security;
alter table dashboard_private.agent_calendar_operations enable row level security;
revoke all on dashboard_private.agent_calendar_sources,dashboard_private.agent_calendar_previews,dashboard_private.agent_calendar_operations from public,anon,authenticated,service_role;

-- Retain the legacy issuance contract, correcting its correlated ID check.
create or replace function public.create_agent_credential_v1(p_label text,p_scopes text[],p_class_ids uuid[],p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1(); raw text; row dashboard_private.agent_credentials;
begin
 if nullif(btrim(p_label),'') is null or length(p_label)>80 or p_scopes is null or cardinality(p_scopes)=0 or array_position(p_scopes,null) is not null
 or not p_scopes <@ array['classes:read','calendar:read','schedule:preview','schedule:write','class-details:read','class-info:write','weekly-plan:write','lesson-plan:write']::text[]
 or (p_scopes && array['class-details:read','class-info:write','weekly-plan:write','lesson-plan:write']::text[] and (cardinality(p_class_ids)=0 or not 'classes:read'=any(p_scopes) or not 'class-details:read'=any(p_scopes)))
 or p_class_ids is null or cardinality(p_class_ids)>50 or array_position(p_class_ids,null) is not null
 or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '30 days'
 or (p_scopes && array['schedule:preview','schedule:write']::text[] and (cardinality(p_class_ids)=0 or not 'classes:read'=any(p_scopes)))
 or ('schedule:write'=any(p_scopes) and not 'schedule:preview'=any(p_scopes))
 or exists(select 1 from unnest(p_class_ids) as requested(class_id) where not exists(select 1 from public.classes c where c.id=requested.class_id)) then
 raise exception using errcode='22023',message='agent_invalid'; end if;
 if (select count(*) from dashboard_private.agent_credentials where created_by=actor and revoked_at is null and expires_at>now())>=20 then raise exception using errcode='54000',message='agent_credential_limit';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.agent_credentials(created_by,label,token_hash,scopes,class_ids,expires_at)
 values(actor,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,p_class_ids,p_expires_at) returning * into row;
 return jsonb_build_object('id',row.id,'label',row.label,'token',raw,'scopes',row.scopes,'classIds',row.class_ids,'expiresAt',row.expires_at);
end$$;

create or replace function public.create_agent_credential_v2(p_label text,p_scopes text[],p_class_ids uuid[],p_expires_at timestamptz,p_all_classes boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1(); raw text; row dashboard_private.agent_credentials;
begin
 if p_all_classes is null or (p_all_classes and cardinality(p_class_ids)<>0) or (not p_all_classes and cardinality(p_class_ids)=0 and 'classes:read'=any(p_scopes)) or ('calendar:write'=any(p_scopes) and not 'calendar:read'=any(p_scopes))
 or nullif(btrim(p_label),'') is null or length(p_label)>80 or p_scopes is null or cardinality(p_scopes)=0 or array_position(p_scopes,null) is not null
 or not p_scopes <@ array['classes:read','calendar:read','schedule:preview','schedule:write','class-details:read','class-info:write','weekly-plan:write','lesson-plan:write','calendar:write']::text[]
 or (p_scopes && array['class-details:read','class-info:write','weekly-plan:write','lesson-plan:write']::text[] and ((cardinality(p_class_ids)=0 and not p_all_classes) or not 'classes:read'=any(p_scopes) or not 'class-details:read'=any(p_scopes)))
 or p_class_ids is null or cardinality(p_class_ids)>50 or array_position(p_class_ids,null) is not null
 or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '30 days'
 or (p_scopes && array['schedule:preview','schedule:write']::text[] and ((cardinality(p_class_ids)=0 and not p_all_classes) or not 'classes:read'=any(p_scopes)))
 or ('schedule:write'=any(p_scopes) and not 'schedule:preview'=any(p_scopes))
 or exists(select 1 from unnest(p_class_ids) as requested(class_id) where not exists(select 1 from public.classes c where c.id=requested.class_id)) then
 raise exception using errcode='22023',message='agent_invalid'; end if;
 if (select count(*) from dashboard_private.agent_credentials where created_by=actor and revoked_at is null and expires_at>now())>=20 then raise exception using errcode='54000',message='agent_credential_limit';end if;
 raw:='tips_agent_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into dashboard_private.agent_credentials(created_by,label,token_hash,scopes,class_ids,expires_at,all_classes)
 values(actor,btrim(p_label),encode(sha256(convert_to(raw,'UTF8')),'hex'),p_scopes,p_class_ids,p_expires_at,p_all_classes) returning * into row;
 return jsonb_build_object('id',row.id,'label',row.label,'token',raw,'scopes',row.scopes,'classIds',row.class_ids,'classAccess',jsonb_build_object('mode',case when row.all_classes then 'all' else 'selected' end,'includesFutureClasses',row.all_classes),'expiresAt',row.expires_at);
end$$;
revoke all on function public.create_agent_credential_v2(text,text[],uuid[],timestamptz,boolean) from public,anon;
grant execute on function public.create_agent_credential_v2(text,text[],uuid[],timestamptz,boolean) to authenticated;

create or replace function public.list_agent_credentials_v1(p_page integer default 1,p_page_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=dashboard_private.agent_require_admin_v1();begin
 if p_page is null or p_page<1 or p_page>10000 or p_page_size is null or p_page_size not in(10,15,20) then raise exception using errcode='22023',message='agent_invalid';end if;
 return jsonb_build_object('total',(select count(*) from dashboard_private.agent_credentials where created_by=actor),'items',
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'scopes',scopes,'classIds',class_ids,'classAccess',jsonb_build_object('mode',case when all_classes then 'all' when cardinality(class_ids)=0 then 'legacy_all_read' else 'selected' end,'includesFutureClasses',all_classes),'createdAt',created_at,'expiresAt',expires_at,'revokedAt',revoked_at,'lastUsedAt',last_used_at) order by created_at desc,id),'[]')
 from (select * from dashboard_private.agent_credentials where created_by=actor order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size) x));
end$$;

create or replace function public.agent_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
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
 result:=jsonb_build_object('apiVersion','1','credentialId',cred.id,'executor',cred.label,'scopes',cred.scopes,'classIds',cred.class_ids,'classAccess',jsonb_build_object('mode',case when cred.all_classes then 'all' when cardinality(cred.class_ids)=0 then 'legacy_all_read' else 'selected' end,'includesFutureClasses',cred.all_classes),'expiresAt',cred.expires_at,'timezone','Asia/Seoul');
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
 if not (cred.all_classes or cid=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
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
 if not (cred.all_classes or preview.class_id=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
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

create or replace function public.agent_api_v2(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.agent_credentials; preview dashboard_private.agent_edit_previews; op dashboard_private.agent_edit_operations;
 cid uuid; key uuid; token uuid; context jsonb; after_state jsonb; result jsonb; command jsonb; page int; err text; statecode text;
 claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); jwtrole text:=current_setting('request.jwt.claim.role',true);
begin
 select * into cred from dashboard_private.agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='agent_forbidden';end if;
 if cred.rate_window is null or cred.rate_window<date_trunc('minute',clock_timestamp()) then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then return jsonb_build_object('error',jsonb_build_object('code','agent_rate_limited'));end if;
 update dashboard_private.agent_credentials set last_used_at=clock_timestamp(),rate_window=date_trunc('minute',clock_timestamp()),rate_count=cred.rate_count+1 where id=cred.id;
 if not 'class-details:read'=any(cred.scopes) or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cred.created_by,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cred.created_by::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 if p_action='health' then
 result:=jsonb_build_object('apiVersion','2','credentialId',cred.id,'executor',cred.label,'scopes',cred.scopes,'classIds',cred.class_ids,'classAccess',jsonb_build_object('mode',case when cred.all_classes then 'all' when cardinality(cred.class_ids)=0 then 'legacy_all_read' else 'selected' end,'includesFutureClasses',cred.all_classes),'expiresAt',cred.expires_at,'timezone','Asia/Seoul');
 elsif p_action in('context','preview') then
 cid:=(p_input->>'classId')::uuid;
 if not (cred.all_classes or cid=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if p_action='preview' then perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=cid for update;end if;
 context:=dashboard_private.agent_edit_context_v2(cid);
 if p_action='context' then result:=context;
 else
 command:=p_input->'command';
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,command);
 if p_input->>'expectedVersion' is distinct from context->>'version' then raise exception using errcode='P0001',message='agent_stale';end if;
 begin
 perform dashboard_private.agent_apply_edit_v2(cid,command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(cid);
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_edit_previews(credential_id,class_id,base_version,command,before_state,after_state) values(cred.id,cid,context->>'version',command,context,after_state) returning * into preview;
 result:=jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'beforeContext',context,'afterContext',after_state,'window',command->'window','notifications',jsonb_build_object('state','not_requested'));
 end if;
 elsif p_action='commit' then
 key:=(p_input->>'requestKey')::uuid;token:=(p_input->>'previewToken')::uuid;
 if key is null or token is null or length(coalesce(p_input->>'sourceReference',''))>500 then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=key;
 if found then
 if op.preview_id<>token or op.source_reference is distinct from nullif(p_input->>'sourceReference','') then raise exception using errcode='22023',message='agent_idempotency_key_reused';end if;
 result:=op.result||jsonb_build_object('replayed',true);
 else
 select * into preview from dashboard_private.agent_edit_previews where id=token and credential_id=cred.id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if not (cred.all_classes or preview.class_id=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,preview.command);
 if exists(select 1 from dashboard_private.agent_edit_operations where preview_id=token) then raise exception using errcode='22023',message='agent_preview_consumed';end if;
 begin
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='agent_preview_expired';end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=preview.class_id for update;
 context:=dashboard_private.agent_edit_context_v2(preview.class_id);
 if context->>'version' is distinct from preview.base_version then raise exception using errcode='P0001',message='agent_stale';end if;
 perform dashboard_private.agent_apply_edit_v2(preview.class_id,preview.command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(preview.class_id);
 result:=jsonb_build_object('operationId',key,'state','applied','classContext',after_state,'window',preview.command->'window','appliedAt',clock_timestamp(),'executor',cred.label,'actorProfileId',cred.created_by,'sourceReference',nullif(p_input->>'sourceReference',''),'requesterVerified',false);
 exception when others then
 get stacked diagnostics err=message_text,statecode=returned_sqlstate;
 result:=jsonb_build_object('operationId',key,'state','failed','error',jsonb_build_object('code',case when statecode='23P01' then 'timetable_resource_conflict' when err='class_schedule_catalog_invalid' then 'agent_invalid_catalog' when err in('agent_stale','agent_preview_expired','agent_not_found','agent_approval_workflow_required','agent_class_not_active','agent_past_change','class_schedule_stale','continuous_class_schedule_runtime_not_ready') then err else 'agent_write_failed' end,'sqlstate',statecode));
 end;
 result:=result||jsonb_build_object('notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 insert into dashboard_private.agent_edit_operations(credential_id,request_key,preview_id,class_id,source_reference,state,result) values(cred.id,key,token,preview.class_id,nullif(p_input->>'sourceReference',''),result->>'state',result);
 end if;
 elsif p_action='operation' then
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=(p_input->>'requestKey')::uuid;
 result:=case when found then op.result else jsonb_build_object('operationId',p_input->>'requestKey','state','unknown','retryWithNewKey',false) end;
 elsif p_action='operations' then
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 then raise exception using errcode='22023',message='agent_invalid';end if;
 select jsonb_build_object('page',page,'pageSize',20,'total',(select count(*) from dashboard_private.agent_edit_operations where credential_id=cred.id),'items',coalesce(jsonb_agg(jsonb_build_object('operationId',request_key,'classId',class_id,'state',state,'createdAt',created_at,'sourceReference',source_reference) order by created_at desc,request_key),'[]')) into result from (select * from dashboard_private.agent_edit_operations where credential_id=cred.id order by created_at desc,request_key limit 20 offset (page-1)*20) x;
 else raise exception using errcode='22023',message='agent_invalid';
 end if;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);perform set_config('request.jwt.claim.role',coalesce(jwtrole,''),true);
 return jsonb_build_object('data',result);
end$$;
-- Snapshot includes private storage for compare-and-swap; HTTP uses a separate
-- explicit projection and never returns notes/content or raw row snapshots.
create function dashboard_private.agent_calendar_context_v1(p_school_id uuid,p_year integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare school jsonb; events jsonb; result jsonb; areas jsonb;
begin
 if p_year is null or p_year<2000 or p_year>2200 then raise exception using errcode='22023',message='agent_invalid_range';end if;
 select jsonb_build_object('id',id,'name',name,'category',category) into school from public.academic_schools where id=p_school_id;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if (select count(*) from public.academic_events where school_id=p_school_id and date>=make_date(p_year,3,1) and date<make_date(p_year+1,3,1))>2500 then raise exception using errcode='22023',message='agent_invalid_range';end if;
 select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('source',case when s.event_version=encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') then s.source else null end) order by e.date,e.id),'[]') into events
 from public.academic_events e left join dashboard_private.agent_calendar_sources s on s.event_id=e.id and s.school_id=e.school_id and s.school_year=p_year
 where e.school_id=p_school_id and e.date>=make_date(p_year,3,1) and e.date<make_date(p_year+1,3,1);
 select coalesce(jsonb_agg(area_key order by area_key),'[]') into areas from public.academic_subject_areas where subject='과학' and is_active;
 result:=jsonb_build_object('school',school,'schoolYear',p_year,'events',events,'scienceAreas',areas);
 return result||jsonb_build_object('version',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end$$;

create function dashboard_private.agent_calendar_apply_v1(p_command jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; patch jsonb; source jsonb; sid uuid; yr integer; eid uuid; day date; existing public.academic_events;
begin
 perform dashboard_private.agent_require_admin_v1();
 sid:=(p_command->>'schoolId')::uuid;yr:=(p_command->>'schoolYear')::int;
 if jsonb_typeof(p_command->'events') is distinct from 'array' or jsonb_array_length(p_command->'events') not between 1 and 100
 or nullif(btrim(p_command->>'reason'),'') is null or length(p_command->>'reason')>300 then raise exception using errcode='22023',message='agent_invalid';end if;
 perform 1 from public.academic_schools where id=sid;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 for item in select value from jsonb_array_elements(p_command->'events') loop
 patch:=item->'patch';source:=item->'source';eid:=(item->>'id')::uuid;day:=(patch->>'date')::date;
 if eid is null or day is null or yr is null or yr not between 2000 and 2200 or day<make_date(yr,3,1) or day>=make_date(yr+1,3,1)
 or jsonb_typeof(patch) is distinct from 'object' or patch-array['title','date','type','grade','note']<>'{}'::jsonb
 or nullif(btrim(patch->>'title'),'') is null or length(patch->>'title')>200
 or patch->>'type' not in('시험기간','영어시험일','수학시험일','과학시험일','체험학습','방학·휴일·기타')
 or nullif(patch->>'grade','') is null or length(patch->>'note')>20000
 or jsonb_typeof(source) is distinct from 'object' or not source ?& array['url','title','authority','checkedAt','schoolIdentityEvidence'] or source->>'url' is null or source->>'authority' is null or source->>'checkedAt' is null or source->>'url' !~ '^https?://[^/@[:space:]]+([/?#]|$)'
 or nullif(btrim(source->>'title'),'') is null or length(source->>'url')>2000 or length(source->>'title')>300
 or source->>'authority' not in('official_school','education_authority') or nullif(btrim(source->>'schoolIdentityEvidence'),'') is null
 or (source->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or (source->>'checkedAt')::timestamptz<clock_timestamp()-interval '30 days'
 then raise exception using errcode='22023',message='agent_invalid';end if;
 if (item->>'insert')::boolean then
 insert into public.academic_events(id,school_id,title,date,type,grade,note) values(eid,sid,patch->>'title',day,patch->>'type',patch->>'grade',patch->>'note');
 else
 select * into existing from public.academic_events where id=eid and school_id=sid and date>=make_date(yr,3,1) and date<make_date(yr+1,3,1) for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if strpos(coalesce(existing.note,''),'[[TIPS_MAKEUP]]')>0 then raise exception using errcode='P0001',message='agent_approval_workflow_required';end if;
 update public.academic_events set title=patch->>'title',date=day,type=patch->>'type',grade=patch->>'grade',note=patch->>'note' where id=eid;
 end if;
 insert into dashboard_private.agent_calendar_sources(event_id,school_id,school_year,source,event_version)
 select eid,sid,yr,source,encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') from public.academic_events e where e.id=eid
 on conflict(event_id) do update set school_id=excluded.school_id,school_year=excluded.school_year,source=excluded.source,event_version=excluded.event_version,updated_at=clock_timestamp();
 end loop;
end$$;

create function public.agent_calendar_api_v1(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare cred dashboard_private.agent_credentials; preview dashboard_private.agent_calendar_previews; op dashboard_private.agent_calendar_operations;
 sid uuid; yr int; key uuid; token uuid; page int; context jsonb; after_state jsonb; result jsonb; command jsonb; err text; statecode text;
 claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); jwtrole text:=current_setting('request.jwt.claim.role',true);
begin
 select * into cred from dashboard_private.agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='agent_forbidden';end if;
 if not 'calendar:read'=any(cred.scopes) or (p_action in('preview','commit','operation','operations') and not 'calendar:write'=any(cred.scopes)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='agent_invalid';end if;
 if cred.rate_window is null or cred.rate_window<date_trunc('minute',clock_timestamp()) then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then return jsonb_build_object('error',jsonb_build_object('code','agent_rate_limited'));end if;
 update dashboard_private.agent_credentials set last_used_at=clock_timestamp(),rate_window=date_trunc('minute',clock_timestamp()),rate_count=cred.rate_count+1 where id=cred.id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cred.created_by,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cred.created_by::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 if p_action='schools' then
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 or length(coalesce(p_input->>'search',''))>100 then raise exception using errcode='22023',message='agent_invalid';end if;
 select jsonb_build_object('page',page,'pageSize',20,'total',(select count(*) from public.academic_schools where strpos(lower(name),lower(coalesce(p_input->>'search','')))>0),'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category) order by name,id),'[]')) into result from (select * from public.academic_schools where strpos(lower(name),lower(coalesce(p_input->>'search','')))>0 order by name,id limit 20 offset (page-1)*20) s;
 elsif p_action in('context','preview') then
 sid:=(p_input->>'schoolId')::uuid;yr:=(p_input->>'schoolYear')::int;
 if p_action='preview' then
 -- This short lock also covers ordinary UI inserts/updates; it prevents phantom
 -- events between version validation and the atomic batch, across all writers.
 lock table public.academic_events in share row exclusive mode;
 perform 1 from public.academic_schools where id=sid for share;
 end if;
 context:=dashboard_private.agent_calendar_context_v1(sid,yr);
 if p_action='context' then result:=context;
 else
 command:=p_input->'command';
 if command->>'schoolId' is distinct from sid::text or command->>'schoolYear' is distinct from yr::text then raise exception using errcode='22023',message='agent_invalid';end if;
 if p_input->>'expectedVersion' is distinct from context->>'version' then raise exception using errcode='P0001',message='agent_stale';end if;
 begin
 perform dashboard_private.agent_calendar_apply_v1(command);
 after_state:=dashboard_private.agent_calendar_context_v1(sid,yr);
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_calendar_previews(credential_id,school_id,school_year,base_version,command,before_state,after_state) values(cred.id,sid,yr,context->>'version',command,context,after_state) returning * into preview;
 result:=jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'beforeContext',context,'afterContext',after_state,'diff',command->'diff');
 end if;
 elsif p_action='commit' then
 key:=(p_input->>'requestKey')::uuid;token:=(p_input->>'previewToken')::uuid;
 if key is null or token is null or length(coalesce(p_input->>'sourceReference',''))>500 then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into op from dashboard_private.agent_calendar_operations where credential_id=cred.id and request_key=key;
 if found then
 if op.preview_id<>token or op.source_reference is distinct from nullif(p_input->>'sourceReference','') then raise exception using errcode='22023',message='agent_idempotency_key_reused';end if;
 result:=op.result||jsonb_build_object('replayed',true);
 else
 select * into preview from dashboard_private.agent_calendar_previews where id=token and credential_id=cred.id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if exists(select 1 from dashboard_private.agent_calendar_operations where preview_id=token) then raise exception using errcode='22023',message='agent_preview_consumed';end if;
 begin
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='agent_preview_expired';end if;
 lock table public.academic_events in share row exclusive mode;
 perform 1 from public.academic_schools where id=preview.school_id for share;
 context:=dashboard_private.agent_calendar_context_v1(preview.school_id,preview.school_year);
 if context->>'version' is distinct from preview.base_version then raise exception using errcode='P0001',message='agent_stale';end if;
 perform dashboard_private.agent_calendar_apply_v1(preview.command);
 after_state:=dashboard_private.agent_calendar_context_v1(preview.school_id,preview.school_year);
 result:=jsonb_build_object('operationId',key,'kind','calendar','state','applied','calendarContext',after_state,'appliedAt',clock_timestamp(),'executor',cred.label,'actorProfileId',cred.created_by,'sourceReference',nullif(p_input->>'sourceReference',''),'requesterVerified',false);
 exception when others then
 get stacked diagnostics err=message_text,statecode=returned_sqlstate;
 result:=jsonb_build_object('operationId',key,'kind','calendar','state','failed','error',jsonb_build_object('code',case when err in('agent_stale','agent_preview_expired','agent_not_found','agent_approval_workflow_required') then err else 'agent_write_failed' end,'sqlstate',statecode));
 end;
 result:=result||jsonb_build_object('notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 insert into dashboard_private.agent_calendar_operations(credential_id,request_key,preview_id,source_reference,state,result) values(cred.id,key,token,nullif(p_input->>'sourceReference',''),result->>'state',result);
 end if;
 elsif p_action='operation' then
 select * into op from dashboard_private.agent_calendar_operations where credential_id=cred.id and request_key=(p_input->>'requestKey')::uuid;
 result:=case when found then op.result else jsonb_build_object('operationId',p_input->>'requestKey','kind','calendar','state','unknown','retryWithNewKey',false) end;
 elsif p_action='operations' then
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 then raise exception using errcode='22023',message='agent_invalid';end if;
 select jsonb_build_object('page',page,'pageSize',20,'total',(select count(*) from dashboard_private.agent_calendar_operations where credential_id=cred.id),'items',coalesce(jsonb_agg(jsonb_build_object('operationId',request_key,'kind','calendar','state',state,'createdAt',created_at,'sourceReference',source_reference) order by created_at desc,request_key),'[]')) into result from (select * from dashboard_private.agent_calendar_operations where credential_id=cred.id order by created_at desc,request_key limit 20 offset (page-1)*20) x;
 else raise exception using errcode='22023',message='agent_invalid';end if;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);perform set_config('request.jwt.claim.role',coalesce(jwtrole,''),true);
 return jsonb_build_object('data',result);
end$$;
revoke all on function dashboard_private.agent_calendar_context_v1(uuid,integer),dashboard_private.agent_calendar_apply_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.agent_calendar_api_v1(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_calendar_api_v1(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
