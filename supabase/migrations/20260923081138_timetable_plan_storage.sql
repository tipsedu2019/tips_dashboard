-- Independent shared plans. Resource UUIDs intentionally have no catalog FK:
-- deleting a catalog entry must retain identity and the last display snapshot.
create table public.timetable_plans (
 id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 120),
 state text not null default 'draft' check (state in ('draft','archived')),
 target_start_date date, target_end_date date,
 meta_revision bigint not null default 0 check(meta_revision>=0), change_sequence bigint not null default 0 check(change_sequence>=0),
 created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(target_start_date is null or target_end_date is null or target_start_date<=target_end_date)
);
create table public.timetable_plan_members (
 plan_id uuid not null references public.timetable_plans(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 access text not null check(access in('viewer','editor')), primary key(plan_id,user_id)
);
create index timetable_plan_members_user_idx on public.timetable_plan_members(user_id,plan_id);
create table public.timetable_plan_items (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.timetable_plans(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 200), subject text not null check(length(btrim(subject)) between 1 and 80), subject_area_key text, grade text not null default '',
 capacity integer check(capacity>=0), tuition integer check(tuition>=0), default_teacher_id uuid, default_classroom_id uuid,
 duration_minutes integer check(duration_minutes between 1 and 1440),
 source_class_id uuid references public.classes(id) on delete set null,
 state text not null default 'draft' check(state in('draft','applied')),
 applied_class_id uuid references public.classes(id) on delete set null, applied_transfer_id uuid, applied_at timestamptz,
 revision bigint not null default 1 check(revision>0), pending_slots jsonb not null default '[]' check(jsonb_typeof(pending_slots)='array'),
 unique(plan_id,id), check((state='draft' and applied_class_id is null and applied_transfer_id is null and applied_at is null) or (state='applied' and applied_transfer_id is not null and applied_at is not null))
);
create table public.timetable_plan_slots (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null, item_id uuid not null,
 weekday smallint not null check(weekday between 0 and 6), start_minute integer not null check(start_minute>=0), end_minute integer not null check(end_minute<=1440 and end_minute>start_minute),
 teacher_catalog_id uuid not null, classroom_catalog_id uuid not null, teacher_name text not null, classroom_name text not null, source_slot_id uuid,
 foreign key(plan_id,item_id) references public.timetable_plan_items(plan_id,id) on delete cascade
);
create index timetable_plan_slots_item_idx on public.timetable_plan_slots(plan_id,item_id);
create index timetable_plan_slots_teacher_idx on public.timetable_plan_slots(plan_id,weekday,teacher_catalog_id);
create index timetable_plan_slots_classroom_idx on public.timetable_plan_slots(plan_id,weekday,classroom_catalog_id);
create table dashboard_private.timetable_plan_mutation_receipts (
 actor_id uuid not null, operation text not null, request_key text not null, request_hash text not null, response jsonb not null,
 created_at timestamptz not null default now(), primary key(actor_id,operation,request_key)
);
create table dashboard_private.timetable_plan_transfers (
 id uuid primary key default gen_random_uuid(), request_key text not null, actor_id uuid not null,
 source_plan_id uuid references public.timetable_plans(id), target_plan_id uuid references public.timetable_plans(id),
 selected_mapping jsonb not null default '[]', revisions jsonb not null default '{}', result jsonb not null default '{}', created_at timestamptz not null default now(), unique(actor_id,request_key)
);
alter table public.timetable_plan_items add foreign key(applied_transfer_id) references dashboard_private.timetable_plan_transfers(id);
create table public.timetable_invalidation_signals (
 id text primary key, plan_id uuid unique references public.timetable_plans(id) on delete cascade,
 change_sequence bigint not null default 0 check(change_sequence>=0), updated_at timestamptz not null default now(),
 check((plan_id is null and id='operating') or (plan_id is not null and id=plan_id::text))
);
insert into public.timetable_invalidation_signals(id) values('operating');

create function dashboard_private.timetable_actor_role_v1() returns text language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p where p.id=auth.uid()
$$;
create function dashboard_private.timetable_teacher_eligible_v1(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.teacher_catalogs t on t.id=p.teacher_catalog_id and t.profile_id=p.id where p.id=p_user and p.role='teacher')
$$;
-- This tiny boolean permission API is also the RLS entrypoint; it exposes no rows.
create function public.can_read_timetable_plan_v1(p_plan_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 dashboard_private.timetable_actor_role_v1() in('admin','staff') or
 (dashboard_private.timetable_teacher_eligible_v1(auth.uid()) and exists(select 1 from public.timetable_plan_members m where m.plan_id=p_plan_id and m.user_id=auth.uid())))
$$;
create function dashboard_private.timetable_require_v1(p_plan uuid, p_edit boolean default false, p_manage boolean default false) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(dashboard_private.timetable_actor_role_v1() in('admin','staff') or
 (not p_manage and public.can_read_timetable_plan_v1(p_plan) and (not p_edit or exists(select 1 from public.timetable_plan_members m where m.plan_id=p_plan and m.user_id=auth.uid() and m.access='editor'))),false)
 then raise exception using errcode='42501',message='timetable_forbidden'; end if;
end $$;
-- Shared lock entrypoint: operating mutations must call before locking classes.
create function dashboard_private.lock_timetable_operating_resources_v1() returns void language sql volatile security definer set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tips:timetable:operational',0))
$$;
create function dashboard_private.emit_timetable_plan_signal_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.timetable_invalidation_signals(id,plan_id,change_sequence) values(new.id::text,new.id,new.change_sequence)
 on conflict(id) do update set change_sequence=excluded.change_sequence,updated_at=clock_timestamp();
 return new;
end $$;
create trigger timetable_plan_signal after insert or update of change_sequence on public.timetable_plans for each row execute function dashboard_private.emit_timetable_plan_signal_v1();

-- One STABLE statement snapshot for live classes, slots and catalogs. No write,
-- no mode activation and no student/roster/contact/history projection.
create function dashboard_private.read_timetable_operating_reference_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record; s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; classes jsonb:='[]'; teachers jsonb; rooms jsonb; payload jsonb; count_parts int; invalid boolean; raw_state jsonb:='[]';
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into teachers from public.teacher_catalogs;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into rooms from public.classroom_catalogs;
 for c in select id,name,subject,grade,status,schedule_revision,schedule_storage_mode,schedule,teacher,room from public.classes
 where dashboard_private.academic_class_status_v1(status,nullif(btrim(start_date),'')::date,nullif(btrim(end_date),'')::date)='수강' order by id loop
 classes:=classes||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status','수강','revision',c.schedule_revision));
 raw_state:=raw_state||to_jsonb(c);
 count_parts:=0; invalid:=false;
 if c.schedule_storage_mode='normalized' then
 for s in select * from public.class_schedule_slots where class_id=c.id order by id loop
 count_parts:=count_parts+1;
 raw_state:=raw_state||jsonb_build_object('normalizedSlot',to_jsonb(s));
 if s.teacher_catalog_id is null or s.classroom_catalog_id is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0 then invalid:=true; continue; end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id',s.id,'sourceSlotId',s.id,'classId',c.id,'weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'classRevision',c.schedule_revision));
 end loop;
 else
 -- Strict complete tokens only. Multi-resource legacy strings remain blocked
 -- unless each whole schedule line can resolve its exact catalog labels.
 for piece in select btrim(x) from regexp_split_to_table(coalesce(c.schedule,''), E'[\\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x loop
 parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]+),[[:space:]]*([^()]+)[)])?$');
 if parts is null then invalid:=true; continue; end if;
 select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(coalesce(parts[5],c.teacher)) having count(*)=1;
 select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(coalesce(parts[6],c.room)) having count(*)=1;
 if tid is null or rid is null then invalid:=true; continue; end if;
 startm:=split_part(parts[2],':',1)::int*60+split_part(parts[2],':',2)::int;
 endm:=split_part(parts[3],':',1)::int*60+split_part(parts[3],':',2)::int;
 if split_part(parts[2],':',2)::int>59 or split_part(parts[3],':',2)::int>59 or startm<0 or startm>=endm or endm>1440 then invalid:=true;continue;end if;
 days:=regexp_replace(parts[1],'[ /,]','','g');
 for d in select regexp_split_to_table(days,'') loop
 count_parts:=count_parts+1;
 sid:=md5(c.id::text||':'||piece||':'||d)::uuid;
 slots:=slots||jsonb_build_array(jsonb_build_object('id',sid,'sourceSlotId',null,'classId',c.id,'weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 end loop;
 end if;
 if invalid or count_parts=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read')); end if;
 end loop;
 payload:=jsonb_build_object('shadowSlots',slots,'shadowClasses',classes,'catalogs',jsonb_build_object('teachers',teachers,'classrooms',rooms),'unresolvedOccupancies',blockers,'complete',jsonb_array_length(blockers)=0);
 return payload||jsonb_build_object('shadowFingerprint',md5((payload||jsonb_build_object('source',raw_state))::text));
end $$;

create function dashboard_private.timetable_item_json_v1(i public.timetable_plan_items) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',i.id,'planId',i.plan_id,'revision',i.revision,'name',i.name,'subject',i.subject,'subjectAreaKey',i.subject_area_key,'grade',i.grade,'capacity',i.capacity,'tuition',i.tuition,'defaultTeacherId',i.default_teacher_id,'defaultClassroomId',i.default_classroom_id,'durationMinutes',i.duration_minutes,'sourceClassId',i.source_class_id,'state',i.state,'appliedClassId',i.applied_class_id,'appliedTransferId',i.applied_transfer_id,'appliedAt',i.applied_at,'pendingSlots',i.pending_slots)
$$;
create function dashboard_private.timetable_slot_json_v1(s public.timetable_plan_slots) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',s.id,'planId',s.plan_id,'itemId',s.item_id,'weekday',s.weekday,'startMinute',s.start_minute,'endMinute',s.end_minute,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sourceSlotId',s.source_slot_id,'teacherName',s.teacher_name,'classroomName',s.classroom_name)
$$;
create function dashboard_private.timetable_plan_json_v1(p public.timetable_plans) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.name,'state',p.state,'metaRevision',p.meta_revision,'changeSequence',p.change_sequence,'targetStartDate',p.target_start_date,'targetEndDate',p.target_end_date)
$$;
create function public.get_timetable_plan_v1(p_plan_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.timetable_plans; ref jsonb; items jsonb; slots jsonb; applied jsonb; members jsonb; total_items int; total_slots int; manage boolean; edit boolean;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 ref:=dashboard_private.read_timetable_operating_reference_v1();
 -- Display-only tombstones retain the original UUID and last saved label.
 ref:=jsonb_set(ref,'{catalogs,teachers}',(ref#>'{catalogs,teachers}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.teacher_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.teacher_catalog_id) from (select s.teacher_catalog_id,max(s.teacher_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.teacher_catalogs t where t.id=s.teacher_catalog_id) group by s.teacher_catalog_id) x),'[]'::jsonb));
 ref:=jsonb_set(ref,'{catalogs,classrooms}',(ref#>'{catalogs,classrooms}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.classroom_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.classroom_catalog_id) from (select s.classroom_catalog_id,max(s.classroom_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.classroom_catalogs t where t.id=s.classroom_catalog_id) group by s.classroom_catalog_id) x),'[]'::jsonb));
 select count(*),coalesce(jsonb_agg(dashboard_private.timetable_item_json_v1(i) order by i.id),'[]') into total_items,items from public.timetable_plan_items i where plan_id=p_plan_id;
 select count(*) into total_slots from public.timetable_plan_slots where plan_id=p_plan_id;
 select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') into slots from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan_id and i.state='draft';
 select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'slots',(select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') from public.timetable_plan_slots s where s.item_id=i.id)) order by i.id),'[]') into applied from public.timetable_plan_items i where i.plan_id=p_plan_id and state='applied';
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(profile.name,''),'access',m.access) order by m.user_id),'[]') into members from public.timetable_plan_members m join public.profiles profile on profile.id=m.user_id where m.plan_id=p_plan_id;
 manage:=dashboard_private.timetable_actor_role_v1() in('admin','staff');
 edit:=manage or exists(select 1 from public.timetable_plan_members where plan_id=p_plan_id and user_id=auth.uid() and access='editor');
 return ref||jsonb_build_object('plan',dashboard_private.timetable_plan_json_v1(p),'items',items,'slots',slots,'appliedSnapshots',applied,'members',members,'permissions',jsonb_build_object('canManage',manage,'canEdit',edit and p.state='draft','canTransfer',manage and p.state='draft'),'capacity',jsonb_build_object('itemCount',total_items,'slotCount',total_slots,'maxItems',500,'maxSlots',2000,'exceeded',total_items>500 or total_slots>2000),'complete',(ref->>'complete')::boolean and total_items<=500 and total_slots<=2000);
end $$;
create function public.get_timetable_plan_revision_v1(p_plan_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; p public.timetable_plans;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 r:=dashboard_private.read_timetable_operating_reference_v1();
 return jsonb_build_object('planId',p.id,'metaRevision',p.meta_revision,'changeSequence',p.change_sequence,'shadowFingerprint',r->>'shadowFingerprint','complete',(r->>'complete')::boolean and (select count(*)<=500 from public.timetable_plan_items where plan_id=p.id) and (select count(*)<=2000 from public.timetable_plan_slots where plan_id=p.id));
end $$;
create function public.list_timetable_plans_v1(p_search text default '',p_archived boolean default false,p_page integer default 1,p_page_size integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n int;
begin
 if auth.uid() is null or not coalesce(dashboard_private.timetable_actor_role_v1() in('admin','staff') or dashboard_private.timetable_teacher_eligible_v1(auth.uid()),false) then raise exception using errcode='42501',message='timetable_forbidden';end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then raise exception using errcode='22023',message='timetable_invalid';end if;
 select count(*) into n from public.timetable_plans p where public.can_read_timetable_plan_v1(p.id) and (p_archived or p.state='draft') and p.name ilike '%'||coalesce(p_search,'')||'%';
 select coalesce(jsonb_agg(dashboard_private.timetable_plan_json_v1(p) order by p.updated_at desc,p.id),'[]') into result from (select * from public.timetable_plans x where public.can_read_timetable_plan_v1(x.id) and (p_archived or x.state='draft') and x.name ilike '%'||coalesce(p_search,'')||'%' order by x.updated_at desc,x.id limit p_page_size offset (p_page-1)*p_page_size) p;
 return jsonb_build_object('plans',result,'total',n,'page',p_page,'pageSize',p_page_size,'canManage',dashboard_private.timetable_actor_role_v1() in('admin','staff'));
end $$;
create function public.list_timetable_share_candidates_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform dashboard_private.timetable_require_v1(null,false,true);
 return (select coalesce(jsonb_agg(jsonb_build_object('userId',id,'name',coalesce(name,''),'role',role) order by name,id),'[]') from public.profiles where dashboard_private.timetable_teacher_eligible_v1(id));
end $$;

create function dashboard_private.timetable_check_capacity_v1(p_plan uuid) returns void language plpgsql stable set search_path='' as $$
begin
 if (select count(*)>500 from public.timetable_plan_items where plan_id=p_plan) or (select count(*)>2000 from public.timetable_plan_slots where plan_id=p_plan) then raise exception using errcode='22023',message='timetable_capacity';end if;
end $$;
create function dashboard_private.timetable_receipt_v1(p_operation text,p_command jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare r dashboard_private.timetable_plan_mutation_receipts;
begin
 if jsonb_typeof(p_command)<>'object' or nullif(btrim(p_command->>'requestKey'),'') is null or length(p_command->>'requestKey')>200 then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into r from dashboard_private.timetable_plan_mutation_receipts where actor_id=auth.uid() and operation=p_operation and request_key=p_command->>'requestKey';
 if found then
 if r.request_hash<>md5(p_command::text) then raise exception using errcode='22023',message='timetable_invalid';end if;
 return r.response;
 end if; return null;
end $$;
create function dashboard_private.timetable_record_receipt_v1(p_operation text,p_command jsonb,p_response jsonb) returns void language sql volatile set search_path='' as $$
 insert into dashboard_private.timetable_plan_mutation_receipts(actor_id,operation,request_key,request_hash,response) values(auth.uid(),p_operation,p_command->>'requestKey',md5(p_command::text),p_response)
$$;
-- Reused by transfer integration. Compare only changed occupancy, but against
-- the complete candidate item, all other draft items and all operating shadows.
create function dashboard_private.validate_timetable_item_slots_v1(p_plan uuid,p_item uuid,p_subject text,p_slots jsonb,p_reference jsonb) returns void language plpgsql stable set search_path='' as $$
declare v jsonb; other jsonb; old public.timetable_plan_slots; changed boolean; tid uuid; rid uuid; sid uuid; day int; a int; b int;
begin
 if jsonb_typeof(p_slots) is distinct from 'array' then raise exception using errcode='22023',message='timetable_invalid';end if;
 if jsonb_array_length(p_slots)>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
 if (select count(*)<>count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_slots) x) then raise exception using errcode='22023',message='timetable_invalid';end if;
 for v in select value from jsonb_array_elements(p_slots) loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in('id','itemId','planId','weekday','startMinute','endMinute','teacherId','classroomId','sourceSlotId','teacherName','classroomName')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 sid:=(v->>'id')::uuid;tid:=(v->>'teacherId')::uuid;rid:=(v->>'classroomId')::uuid;day:=(v->>'weekday')::int;a:=(v->>'startMinute')::int;b:=(v->>'endMinute')::int;
 if sid is null or tid is null or rid is null or (v->>'planId')::uuid is distinct from p_plan or (v->>'itemId')::uuid is distinct from p_item or day is null or day not between 0 and 6 or a is null or b is null or a<0 or b>1440 or a>=b then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into old from public.timetable_plan_slots where id=sid;
 if found and (old.plan_id<>p_plan or old.item_id<>p_item) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if (v->>'sourceSlotId')::uuid is distinct from old.source_slot_id then raise exception using errcode='22023',message='timetable_invalid';end if;
 changed:=old.id is null or (old.weekday,old.start_minute,old.end_minute,old.teacher_catalog_id,old.classroom_catalog_id) is distinct from (day,a,b,tid,rid);
 if not changed then continue;end if;
 if not exists(select 1 from public.teacher_catalogs where id=tid and is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(p_subject,subjects)) or not exists(select 1 from public.classroom_catalogs where id=rid and is_visible and (cardinality(subjects)=0 or p_subject=any(subjects))) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if not coalesce((p_reference->>'complete')::boolean,false) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_slots) x where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan and s.item_id<>p_item and i.state='draft' and s.weekday=day and s.start_minute<b and s.end_minute>a and (s.teacher_catalog_id=tid or s.classroom_catalog_id=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_reference->'shadowSlots') x where (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
end $$;
create function public.mutate_timetable_plan_item_v1(p_command jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare pid uuid:=(p_command->>'planId')::uuid; iid uuid; op text:=p_command->>'operation'; p public.timetable_plans; old public.timetable_plan_items; i public.timetable_plan_items; v jsonb; s public.timetable_plan_slots; ref jsonb; response jsonb; item jsonb:=p_command->'item'; removed jsonb:='[]'; slots jsonb;
begin
 perform dashboard_private.timetable_require_v1(pid,true,false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into p from public.timetable_plans where id=pid for update;
 perform dashboard_private.timetable_require_v1(pid,true,false);
 response:=dashboard_private.timetable_receipt_v1('item.'||op,p_command);if response is not null then return response;end if;
 if p.id is null or op not in('save','delete') or op is null or exists(select 1 from jsonb_object_keys(p_command) k where k not in('operation','planId','expectedMetaRevision','expectedShadowFingerprint','expectedItemRevision','requestKey','item','itemId','slots')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if p.state<>'draft' then raise exception using errcode='42501',message='timetable_forbidden';end if;
 if p.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 iid:=case when op='delete' then (p_command->>'itemId')::uuid else (item->>'id')::uuid end;
 if iid is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into old from public.timetable_plan_items where id=iid for update;
 if old.id is not null and old.plan_id<>pid then raise exception using errcode='22023',message='timetable_invalid';end if;
 if old.state='applied' then raise exception using errcode='42501',message='timetable_forbidden';end if;
 if old.revision is distinct from (p_command->>'expectedItemRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 perform dashboard_private.timetable_check_capacity_v1(pid);
 ref:=dashboard_private.read_timetable_operating_reference_v1();
 if ref->>'shadowFingerprint' is distinct from p_command->>'expectedShadowFingerprint' then raise exception using errcode='P0001',message='timetable_stale';end if;
 if op='delete' then
 if old.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 delete from public.timetable_plan_items where id=iid;removed:=jsonb_build_array(iid);slots:='[]';
 else
 if jsonb_typeof(item) is distinct from 'object' or (item->>'planId')::uuid is distinct from pid or exists(select 1 from jsonb_object_keys(item) k where k not in('id','planId','name','subject','subjectAreaKey','grade','capacity','tuition','defaultTeacherId','defaultClassroomId','durationMinutes','pendingSlots')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if jsonb_typeof(item->'pendingSlots') is distinct from 'array' or jsonb_array_length(item->'pendingSlots')>2000 then raise exception using errcode='22023',message='timetable_invalid';end if;
 for v in select value from jsonb_array_elements(item->'pendingSlots') loop
 if jsonb_typeof(v)<>'object' or v->>'reason' is null or v->>'reason' not in('missing_resource','conflict','invalid_time') or (v->>'id')::uuid is null or jsonb_typeof(v->'sourceText') is distinct from 'string' then raise exception using errcode='22023',message='timetable_invalid';end if;
 end loop;
 perform dashboard_private.validate_timetable_item_slots_v1(pid,iid,item->>'subject',p_command->'slots',ref);
 if (select count(*) from public.timetable_plan_items where plan_id=pid)+(case when old.id is null then 1 else 0 end)>500 or (select count(*) from public.timetable_plan_slots where plan_id=pid and item_id<>iid)+jsonb_array_length(p_command->'slots')>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
 insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes,pending_slots)
 values(iid,pid,item->>'name',item->>'subject',item->>'subjectAreaKey',coalesce(item->>'grade',''),(item->>'capacity')::int,(item->>'tuition')::int,(item->>'defaultTeacherId')::uuid,(item->>'defaultClassroomId')::uuid,(item->>'durationMinutes')::int,item->'pendingSlots')
 on conflict(id) do update set name=excluded.name,subject=excluded.subject,subject_area_key=excluded.subject_area_key,grade=excluded.grade,capacity=excluded.capacity,tuition=excluded.tuition,default_teacher_id=excluded.default_teacher_id,default_classroom_id=excluded.default_classroom_id,duration_minutes=excluded.duration_minutes,pending_slots=excluded.pending_slots,revision=public.timetable_plan_items.revision+1 returning * into i;
 delete from public.timetable_plan_slots where item_id=iid and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_command->'slots') x);
 for v in select value from jsonb_array_elements(p_command->'slots') loop
 select * into s from public.timetable_plan_slots where id=(v->>'id')::uuid;
 insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
 values((v->>'id')::uuid,pid,iid,(v->>'weekday')::int,(v->>'startMinute')::int,(v->>'endMinute')::int,(v->>'teacherId')::uuid,(v->>'classroomId')::uuid,coalesce((select name from public.teacher_catalogs where id=(v->>'teacherId')::uuid),s.teacher_name),coalesce((select name from public.classroom_catalogs where id=(v->>'classroomId')::uuid),s.classroom_name),s.source_slot_id)
 on conflict(id) do update set weekday=excluded.weekday,start_minute=excluded.start_minute,end_minute=excluded.end_minute,teacher_catalog_id=excluded.teacher_catalog_id,classroom_catalog_id=excluded.classroom_catalog_id,teacher_name=excluded.teacher_name,classroom_name=excluded.classroom_name;
 end loop;
 select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(t) order by id),'[]') into slots from public.timetable_plan_slots t where item_id=iid;
 end if;
 update public.timetable_plans set change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=pid returning * into p;
 response:=jsonb_build_object('planId',pid,'metaRevision',p.meta_revision,'changeSequence',p.change_sequence,'shadowFingerprint',ref->>'shadowFingerprint','item',case when op='save' then dashboard_private.timetable_item_json_v1(i) else null end,'slots',slots,'removedItemIds',removed);
 perform dashboard_private.timetable_record_receipt_v1('item.'||op,p_command,response);return response;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception using errcode='22023',message='timetable_invalid';
end $$;

create function public.mutate_timetable_plan_v1(p_command jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op text:=p_command->>'operation'; pid uuid:=(p_command->>'planId')::uuid; sourceid uuid:=(p_command->>'sourcePlanId')::uuid; p public.timetable_plans; src public.timetable_plans; response jsonb; m jsonb; i public.timetable_plan_items; ni uuid;
begin
 perform dashboard_private.timetable_require_v1(pid,false,true);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 perform 1 from public.timetable_plans where id in(pid,sourceid) order by id for update;
 perform dashboard_private.timetable_require_v1(pid,false,true);
 response:=dashboard_private.timetable_receipt_v1('plan.'||op,p_command);if response is not null then return response;end if;
 if pid is null or op is null or op not in('create','rename','clone','share','archive','restore') or exists(select 1 from jsonb_object_keys(p_command) k where k not in('operation','planId','sourcePlanId','expectedMetaRevision','name','targetStartDate','targetEndDate','members','requestKey')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into p from public.timetable_plans where id=pid;
 if op in('create','clone') then
 if p.id is not null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if op='clone' then
 select * into src from public.timetable_plans where id=sourceid;
 if src.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if src.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 perform dashboard_private.timetable_check_capacity_v1(src.id);
 end if;
 insert into public.timetable_plans(id,name,target_start_date,target_end_date,created_by,updated_by) values(pid,p_command->>'name',coalesce((p_command->>'targetStartDate')::date,src.target_start_date),coalesce((p_command->>'targetEndDate')::date,src.target_end_date),auth.uid(),auth.uid()) returning * into p;
 if op='clone' then
 for i in select * from public.timetable_plan_items where plan_id=src.id order by id loop
 ni:=gen_random_uuid();
 insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes,source_class_id,pending_slots)
 values(ni,pid,i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,i.default_teacher_id,i.default_classroom_id,i.duration_minutes,coalesce(i.source_class_id,i.applied_class_id),case when i.state='draft' then i.pending_slots else '[]'::jsonb end);
 if i.state='draft' then
 insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
 select gen_random_uuid(),pid,ni,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,coalesce(source_slot_id,id) from public.timetable_plan_slots where item_id=i.id;
 end if;end loop;end if;
 else
 if p.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
 if p.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint then raise exception using errcode='P0001',message='timetable_stale';end if;
 perform dashboard_private.timetable_check_capacity_v1(pid);
 if p.state='archived' and op not in('restore','share') then raise exception using errcode='42501',message='timetable_forbidden';end if;
 if op='share' then
 if jsonb_typeof(p_command->'members') is distinct from 'array' or (select count(*)<>count(distinct value->>'userId') from jsonb_array_elements(p_command->'members')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 for m in select value from jsonb_array_elements(p_command->'members') loop
 if not dashboard_private.timetable_teacher_eligible_v1((m->>'userId')::uuid) or m->>'access' is null or m->>'access' not in('viewer','editor') or exists(select 1 from jsonb_object_keys(m) k where k not in('userId','access')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 end loop;
 delete from public.timetable_plan_members where plan_id=pid;
 insert into public.timetable_plan_members(plan_id,user_id,access) select pid,(value->>'userId')::uuid,value->>'access' from jsonb_array_elements(p_command->'members');
 end if;
 update public.timetable_plans set name=case when op='rename' then p_command->>'name' else name end,
 target_start_date=case when p_command?'targetStartDate' then (p_command->>'targetStartDate')::date else target_start_date end,
 target_end_date=case when p_command?'targetEndDate' then (p_command->>'targetEndDate')::date else target_end_date end,
 state=case when op='archive' then 'archived' when op='restore' then 'draft' else state end,
 meta_revision=meta_revision+1,change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=pid returning * into p;
 end if;
 response:=jsonb_build_object('plan',dashboard_private.timetable_plan_json_v1(p));
 perform dashboard_private.timetable_record_receipt_v1('plan.'||op,p_command,response);return response;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or check_violation or not_null_violation then raise exception using errcode='22023',message='timetable_invalid';
end $$;

-- Explicit ownership and ACLs, including private history defense in depth.
do $$declare n text; f record;begin
 foreach n in array array['timetable_plans','timetable_plan_members','timetable_plan_items','timetable_plan_slots','timetable_invalidation_signals'] loop
 execute format('alter table public.%I owner to postgres',n);
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from public, anon, authenticated',n);
 execute format('grant select on public.%I to authenticated',n);
 end loop;
 foreach n in array array['timetable_plan_mutation_receipts','timetable_plan_transfers'] loop
 execute format('alter table dashboard_private.%I owner to postgres',n);
 execute format('alter table dashboard_private.%I enable row level security',n);
 execute format('revoke all on dashboard_private.%I from public, anon, authenticated',n);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='dashboard_private' and (p.proname like 'timetable_%_v1' or p.proname in('lock_timetable_operating_resources_v1','read_timetable_operating_reference_v1','emit_timetable_plan_signal_v1','validate_timetable_item_slots_v1'))) or (n.nspname='public' and p.proname in('can_read_timetable_plan_v1','get_timetable_plan_v1','get_timetable_plan_revision_v1','list_timetable_plans_v1','list_timetable_share_candidates_v1','mutate_timetable_plan_v1','mutate_timetable_plan_item_v1')) loop
 execute format('alter function %s owner to postgres',f.signature);
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.can_read_timetable_plan_v1(uuid),public.get_timetable_plan_v1(uuid),public.get_timetable_plan_revision_v1(uuid),public.list_timetable_plans_v1(text,boolean,integer,integer),public.list_timetable_share_candidates_v1(),public.mutate_timetable_plan_v1(jsonb),public.mutate_timetable_plan_item_v1(jsonb) to authenticated;
create policy timetable_plans_read on public.timetable_plans for select to authenticated using(public.can_read_timetable_plan_v1(id));
create policy timetable_members_read on public.timetable_plan_members for select to authenticated using(public.can_read_timetable_plan_v1(plan_id));
create policy timetable_items_read on public.timetable_plan_items for select to authenticated using(public.can_read_timetable_plan_v1(plan_id));
create policy timetable_slots_read on public.timetable_plan_slots for select to authenticated using(public.can_read_timetable_plan_v1(plan_id));
-- Operational singleton uses existing timetable roles without exposing rows.
create function public.can_read_timetable_operating_signal_v1() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and coalesce(dashboard_private.timetable_actor_role_v1() in('admin','staff') or dashboard_private.timetable_teacher_eligible_v1(auth.uid()),false)$$;
alter function public.can_read_timetable_operating_signal_v1() owner to postgres;
revoke all on function public.can_read_timetable_operating_signal_v1() from public,anon,authenticated;
grant execute on function public.can_read_timetable_operating_signal_v1() to authenticated;
create policy timetable_signals_read on public.timetable_invalidation_signals for select to authenticated using(case when plan_id is null then public.can_read_timetable_operating_signal_v1() else public.can_read_timetable_plan_v1(plan_id) end);
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then alter publication supabase_realtime add table public.timetable_invalidation_signals;end if;end $$;
