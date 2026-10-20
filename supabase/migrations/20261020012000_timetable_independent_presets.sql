begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Presets validate their own placements independently from current operations.
-- Existing UUIDs, applied placement history, receipts, locks, owners and ACLs
-- are retained. No table data cleanup, role/RLS/ACL change or automatic class
-- state transition is performed by this migration.

CREATE OR REPLACE FUNCTION public.get_timetable_plan_v1(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.timetable_plans; ref jsonb; items jsonb; slots jsonb; applied jsonb; members jsonb; total_items int; total_slots int; manage boolean; edit boolean;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 -- Compatibility fields contain no operating occupancy. The stable sentinel date
 -- is not an operating business date and cannot stale a preset at midnight.
 ref:=jsonb_build_object('asOfDate','1970-01-01','occupancyValidationVersion',2,
  'shadowSlots','[]'::jsonb,'shadowClasses','[]'::jsonb,'unresolvedOccupancies','[]'::jsonb,
  'datedSessions','[]'::jsonb,'datedUnresolvedOccupancies','[]'::jsonb,
  'datedFingerprint',md5('[]'),'datedComplete',true,'complete',true,
  'catalogs',jsonb_build_object(
   'teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]'::jsonb) from public.teacher_catalogs),
   'classrooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]'::jsonb) from public.classroom_catalogs)));
 -- Display-only tombstones retain the original UUID and last saved label.
 ref:=jsonb_set(ref,'{catalogs,teachers}',(ref#>'{catalogs,teachers}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.teacher_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.teacher_catalog_id) from (select s.teacher_catalog_id,max(s.teacher_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.teacher_catalogs t where t.id=s.teacher_catalog_id) group by s.teacher_catalog_id) x),'[]'::jsonb));
 ref:=jsonb_set(ref,'{catalogs,classrooms}',(ref#>'{catalogs,classrooms}')||coalesce((select jsonb_agg(jsonb_build_object('id',x.classroom_catalog_id,'name',x.name,'isVisible',false,'subjects','[]'::jsonb,'isMissing',true) order by x.classroom_catalog_id) from (select s.classroom_catalog_id,max(s.classroom_name) name from public.timetable_plan_slots s where s.plan_id=p_plan_id and not exists(select 1 from public.classroom_catalogs t where t.id=s.classroom_catalog_id) group by s.classroom_catalog_id) x),'[]'::jsonb));
 -- Keep the wire key for existing clients; it now fingerprints only catalogs.
 ref:=ref||jsonb_build_object('shadowFingerprint',md5((ref->'catalogs')::text));
 select count(*),coalesce(jsonb_agg(dashboard_private.timetable_item_json_v1(i) order by i.id),'[]') into total_items,items from public.timetable_plan_items i where plan_id=p_plan_id;
 select count(*) into total_slots from public.timetable_plan_slots where plan_id=p_plan_id;
 select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') into slots from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan_id and i.state='draft';
 select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'slots',(select coalesce(jsonb_agg(dashboard_private.timetable_slot_json_v1(s) order by s.id),'[]') from public.timetable_plan_slots s where s.item_id=i.id)) order by i.id),'[]') into applied from public.timetable_plan_items i where i.plan_id=p_plan_id and state='applied';
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(profile.name,''),'access',m.access) order by m.user_id),'[]') into members from public.timetable_plan_members m join public.profiles profile on profile.id=m.user_id where m.plan_id=p_plan_id;
 manage:=dashboard_private.timetable_actor_role_v1() in('admin','staff');
 edit:=manage or exists(select 1 from public.timetable_plan_members where plan_id=p_plan_id and user_id=auth.uid() and access='editor');
 return ref||jsonb_build_object('plan',dashboard_private.timetable_plan_json_v1(p),'items',items,'slots',slots,'appliedSnapshots',applied,'members',members,'permissions',jsonb_build_object('canManage',manage,'canEdit',edit and p.state='draft','canTransfer',manage and p.state='draft'),'capacity',jsonb_build_object('itemCount',total_items,'slotCount',total_slots,'maxItems',500,'maxSlots',2000,'exceeded',total_items>500 or total_slots>2000),'complete',(ref->>'complete')::boolean and total_items<=500 and total_slots<=2000);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_timetable_plan_revision_v1(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; p public.timetable_plans;
begin
 perform dashboard_private.timetable_require_v1(p_plan_id);
 select * into p from public.timetable_plans where id=p_plan_id;
 if not found then raise exception using errcode='22023',message='timetable_invalid';end if;
 r:=public.get_timetable_plan_v1(p_plan_id);
 return jsonb_build_object('planId',p.id,'metaRevision',p.meta_revision,'changeSequence',p.change_sequence,'shadowFingerprint',r->>'shadowFingerprint','complete',(r->>'complete')::boolean and (select count(*)<=500 from public.timetable_plan_items where plan_id=p.id) and (select count(*)<=2000 from public.timetable_plan_slots where plan_id=p.id));
end $function$
;

CREATE OR REPLACE FUNCTION dashboard_private.validate_timetable_item_slots_v1(p_plan uuid, p_item uuid, p_subject text, p_slots jsonb, p_reference jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb; old public.timetable_plan_slots; changed boolean; tid uuid; rid uuid; sid uuid; day int; a int; b int;
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
 if exists(select 1 from jsonb_array_elements(p_slots) x where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan and s.item_id<>p_item and s.weekday=day and s.start_minute<b and s.end_minute>a and (s.teacher_catalog_id=tid or s.classroom_catalog_id=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
end $function$
;

create or replace function public.mutate_timetable_plan_item_v1(p_command jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare pid uuid:=(p_command->>'planId')::uuid; iid uuid; op text:=p_command->>'operation'; p public.timetable_plans; old public.timetable_plan_items; i public.timetable_plan_items; v jsonb; s public.timetable_plan_slots; ref jsonb; response jsonb; item jsonb:=p_command->'item'; removed jsonb:='[]'; slots jsonb;
batch_edits jsonb; batch_edit jsonb; edit_op text; edit_ids uuid[]:='{}'; slot_ids uuid[]:='{}'; submitted_slot_count integer:=0; baseline_slots jsonb; candidate_slots jsonb; slot_old public.timetable_plan_slots; batch_item public.timetable_plan_items; final_item_count bigint; final_slot_count bigint; acknowledgements jsonb:='[]'; sid uuid; tid uuid; rid uuid; day integer; a integer; b integer; changed boolean;
begin
 perform dashboard_private.timetable_require_v1(pid,true,false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into p from public.timetable_plans where id=pid for update;
 perform dashboard_private.timetable_require_v1(pid,true,false);
 response:=dashboard_private.timetable_receipt_v1('item.'||op,p_command);if response is not null then return response;end if;
 if op='save_batch' then
  if p.id is null or jsonb_typeof(p_command) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(p_command) k where k not in('operation','planId','expectedMetaRevision','expectedChangeSequence','expectedShadowFingerprint','requestKey','edits'))
   or jsonb_typeof(p_command->'expectedMetaRevision') is distinct from 'number'
   or p_command->>'expectedMetaRevision' !~ '^(0|[1-9][0-9]*)$'
   or jsonb_typeof(p_command->'expectedChangeSequence') is distinct from 'number'
   or p_command->>'expectedChangeSequence' !~ '^(0|[1-9][0-9]*)$'
   or jsonb_typeof(p_command->'expectedShadowFingerprint') is distinct from 'string'
   or nullif(btrim(p_command->>'expectedShadowFingerprint'),'') is null
   or jsonb_typeof(p_command->'requestKey') is distinct from 'string'
   or jsonb_typeof(p_command->'edits') is distinct from 'array'
  then raise exception using errcode='22023',message='timetable_invalid';end if;
  batch_edits:=p_command->'edits';
  if jsonb_array_length(batch_edits) not between 1 and 500 then
   raise exception using errcode='22023',message='timetable_invalid';end if;
  if p.state<>'draft' then raise exception using errcode='42501',message='timetable_forbidden';end if;
  if p.meta_revision is distinct from (p_command->>'expectedMetaRevision')::bigint
   or p.change_sequence is distinct from (p_command->>'expectedChangeSequence')::bigint
  then raise exception using errcode='P0001',message='timetable_stale';end if;

  -- Check shapes before casting identifiers or acquiring deterministic item locks.
  for batch_edit in select value from jsonb_array_elements(batch_edits) loop
   edit_op:=batch_edit->>'operation';
   if jsonb_typeof(batch_edit) is distinct from 'object' then raise exception using errcode='22023',message='timetable_invalid';end if;
   if edit_op is null or edit_op not in('save','delete')
    or not batch_edit?'expectedItemRevision'
    or (jsonb_typeof(batch_edit->'expectedItemRevision') is distinct from 'null'
     and (jsonb_typeof(batch_edit->'expectedItemRevision') is distinct from 'number'
      or batch_edit->>'expectedItemRevision' !~ '^[1-9][0-9]*$'))
    or (edit_op='delete' and jsonb_typeof(batch_edit->'expectedItemRevision')='null')
    or exists(select 1 from jsonb_object_keys(batch_edit) k where
     (edit_op='save' and k not in('operation','item','expectedItemRevision','slots'))
     or (edit_op='delete' and k not in('operation','itemId','expectedItemRevision')))
   then raise exception using errcode='22023',message='timetable_invalid';end if;
   if edit_op='save' and (jsonb_typeof(batch_edit->'item') is distinct from 'object'
    or jsonb_typeof(batch_edit->'slots') is distinct from 'array')
   then raise exception using errcode='22023',message='timetable_invalid';end if;
   iid:=case when edit_op='delete' then (batch_edit->>'itemId')::uuid else (batch_edit#>>'{item,id}')::uuid end;
   if iid is null or iid=any(edit_ids) then raise exception using errcode='22023',message='timetable_invalid';end if;
   edit_ids:=array_append(edit_ids,iid);
   if edit_op='save' then
    submitted_slot_count:=submitted_slot_count+jsonb_array_length(batch_edit->'slots');
    if submitted_slot_count>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
   end if;
  end loop;
  perform id from public.timetable_plan_items where id=any(edit_ids) order by id for update;
  perform dashboard_private.timetable_require_v1(pid,true,false);
  perform dashboard_private.timetable_check_capacity_v1(pid);
  ref:=public.get_timetable_plan_v1(pid);
  if ref->>'shadowFingerprint' is distinct from p_command->>'expectedShadowFingerprint' then
   raise exception using errcode='P0001',message='timetable_stale';end if;
  select coalesce(jsonb_object_agg(z.id::text,to_jsonb(z)),'{}') into baseline_slots
   from public.timetable_plan_slots z where z.plan_id=pid;

  -- Keep the untouched baseline for revision, provenance and resource grandfathering.
  -- Every edit is validated before building a separate final draft occupancy set.
  for batch_edit in select value from jsonb_array_elements(batch_edits) loop
   edit_op:=batch_edit->>'operation';item:=batch_edit->'item';
   iid:=case when edit_op='delete' then (batch_edit->>'itemId')::uuid else (item->>'id')::uuid end;
   select * into old from public.timetable_plan_items where id=iid;
   if old.id is not null and old.plan_id<>pid then raise exception using errcode='22023',message='timetable_invalid';end if;
   if old.state='applied' then raise exception using errcode='42501',message='timetable_forbidden';end if;
   if old.revision is distinct from (batch_edit->>'expectedItemRevision')::bigint then
    raise exception using errcode='P0001',message='timetable_stale';end if;
   if edit_op='delete' then
    if old.id is null then raise exception using errcode='22023',message='timetable_invalid';end if;
    continue;
   end if;
   if (item->>'planId')::uuid is distinct from pid
    or exists(select 1 from jsonb_object_keys(item) k where k not in('id','planId','name','subject','subjectAreaKey','grade','capacity','tuition','defaultTeacherId','defaultClassroomId','durationMinutes','pendingSlots'))
    or jsonb_typeof(item->'pendingSlots') is distinct from 'array'
   then raise exception using errcode='22023',message='timetable_invalid';end if;
   if jsonb_array_length(item->'pendingSlots')>2000 then raise exception using errcode='22023',message='timetable_invalid';end if;
   for v in select value from jsonb_array_elements(item->'pendingSlots') loop
    if jsonb_typeof(v)<>'object' or v->>'reason' is null or v->>'reason' not in('missing_resource','conflict','invalid_time')
     or (v->>'id')::uuid is null or jsonb_typeof(v->'sourceText') is distinct from 'string'
    then raise exception using errcode='22023',message='timetable_invalid';end if;
   end loop;
   -- Match the existing metadata cast and table CHECK contract before any writes.
   batch_item:=jsonb_populate_record(null::public.timetable_plan_items,jsonb_build_object(
    'name',item->>'name','subject',item->>'subject','grade',coalesce(item->>'grade',''),
    'capacity',(item->>'capacity')::int,'tuition',(item->>'tuition')::int,
    'default_teacher_id',(item->>'defaultTeacherId')::uuid,'default_classroom_id',(item->>'defaultClassroomId')::uuid,
    'duration_minutes',(item->>'durationMinutes')::int));
   if batch_item.name is null or length(btrim(batch_item.name)) not between 1 and 200
    or batch_item.subject is null or length(btrim(batch_item.subject)) not between 1 and 80
    or batch_item.capacity<0 or batch_item.tuition<0
    or (batch_item.duration_minutes is not null and batch_item.duration_minutes not between 1 and 1440)
   then raise exception using errcode='22023',message='timetable_invalid';end if;
   for v in select value from jsonb_array_elements(batch_edit->'slots') loop
    if jsonb_typeof(v) is distinct from 'object' then raise exception using errcode='22023',message='timetable_invalid';end if;
    if exists(select 1 from jsonb_object_keys(v) k where k not in('id','itemId','planId','weekday','startMinute','endMinute','teacherId','classroomId','sourceSlotId','teacherName','classroomName'))
    then raise exception using errcode='22023',message='timetable_invalid';end if;
    sid:=(v->>'id')::uuid;tid:=(v->>'teacherId')::uuid;rid:=(v->>'classroomId')::uuid;
    day:=(v->>'weekday')::int;a:=(v->>'startMinute')::int;b:=(v->>'endMinute')::int;
    if sid is null or tid is null or rid is null or (v->>'planId')::uuid is distinct from pid
     or (v->>'itemId')::uuid is distinct from iid or day is null or day not between 0 and 6
     or a is null or b is null or a<0 or b>1440 or a>=b or sid=any(slot_ids)
    then raise exception using errcode='22023',message='timetable_invalid';end if;
    slot_ids:=array_append(slot_ids,sid);
    slot_old:=jsonb_populate_record(null::public.timetable_plan_slots,coalesce(baseline_slots->sid::text,'{}'::jsonb));
    if slot_old.id is not null and (slot_old.plan_id<>pid or slot_old.item_id<>iid) then
     raise exception using errcode='22023',message='timetable_invalid';end if;
    if slot_old.id is null and exists(select 1 from public.timetable_plan_slots z where z.id=sid) then
     raise exception using errcode='22023',message='timetable_invalid';end if;
    if (v->>'sourceSlotId')::uuid is distinct from slot_old.source_slot_id then
     raise exception using errcode='22023',message='timetable_invalid';end if;
   end loop;
  end loop;
  select count(*)+(select count(*) from jsonb_array_elements(batch_edits) e where e->>'operation'='save')
   into final_item_count from public.timetable_plan_items z where z.plan_id=pid and not z.id=any(edit_ids);
  select count(*)+submitted_slot_count into final_slot_count from public.timetable_plan_slots z
   where z.plan_id=pid and not z.item_id=any(edit_ids);
  if final_item_count>500 or final_slot_count>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
  select coalesce(jsonb_agg(q.slot),'[]') into candidate_slots from (
   select dashboard_private.timetable_slot_json_v1(z) slot from public.timetable_plan_slots z
    join public.timetable_plan_items zi on zi.id=z.item_id
    where z.plan_id=pid and not z.item_id=any(edit_ids)
   union all
   select x from jsonb_array_elements(batch_edits) e cross join lateral jsonb_array_elements(e->'slots') x
    where e->>'operation'='save'
  ) q;

  -- Validate changed/new slots against final occupancy, with unchanged baseline slots grandfathered.
  -- This is the final single-item validator's rule set; only cross-item occupancy reads the candidate.
  for batch_edit in select value from jsonb_array_elements(batch_edits) where value->>'operation'='save' loop
   item:=batch_edit->'item';iid:=(item->>'id')::uuid;
   for v in select value from jsonb_array_elements(batch_edit->'slots') loop
    sid:=(v->>'id')::uuid;tid:=(v->>'teacherId')::uuid;rid:=(v->>'classroomId')::uuid;
    day:=(v->>'weekday')::int;a:=(v->>'startMinute')::int;b:=(v->>'endMinute')::int;
    slot_old:=jsonb_populate_record(null::public.timetable_plan_slots,coalesce(baseline_slots->sid::text,'{}'::jsonb));
    changed:=slot_old.id is null or (slot_old.weekday,slot_old.start_minute,slot_old.end_minute,slot_old.teacher_catalog_id,slot_old.classroom_catalog_id)
     is distinct from (day,a,b,tid,rid);
    if not changed then continue;end if;
    if not exists(select 1 from public.teacher_catalogs where id=tid and is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(item->>'subject',subjects))
     or not exists(select 1 from public.classroom_catalogs where id=rid and is_visible and (cardinality(subjects)=0 or item->>'subject'=any(subjects)))
    then raise exception using errcode='22023',message='timetable_invalid';end if;
    if exists(select 1 from jsonb_array_elements(batch_edit->'slots') x where (x->>'id')::uuid<>sid
     and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
    if exists(select 1 from jsonb_array_elements(candidate_slots) x where (x->>'itemId')::uuid<>iid
     and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a
     and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
   end loop;
  end loop;
 -- All baseline/final-candidate checks have passed; write the batch once.
  for batch_edit in select value from jsonb_array_elements(batch_edits) loop
   item:=batch_edit->'item';edit_op:=batch_edit->>'operation';
   iid:=case when edit_op='delete' then (batch_edit->>'itemId')::uuid else (item->>'id')::uuid end;
   if edit_op='delete' then
    delete from public.timetable_plan_items where id=iid;
    acknowledgements:=acknowledgements||jsonb_build_array(jsonb_build_object('itemId',iid,'operation','delete','itemRevision',null));
   else
    insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes,pending_slots)
    values(iid,pid,item->>'name',item->>'subject',item->>'subjectAreaKey',coalesce(item->>'grade',''),(item->>'capacity')::int,(item->>'tuition')::int,(item->>'defaultTeacherId')::uuid,(item->>'defaultClassroomId')::uuid,(item->>'durationMinutes')::int,item->'pendingSlots')
    on conflict(id) do update set name=excluded.name,subject=excluded.subject,subject_area_key=excluded.subject_area_key,grade=excluded.grade,capacity=excluded.capacity,tuition=excluded.tuition,default_teacher_id=excluded.default_teacher_id,default_classroom_id=excluded.default_classroom_id,duration_minutes=excluded.duration_minutes,pending_slots=excluded.pending_slots,revision=public.timetable_plan_items.revision+1 returning * into i;
    delete from public.timetable_plan_slots where item_id=iid and id not in(select (x->>'id')::uuid from jsonb_array_elements(batch_edit->'slots') x);
    for v in select value from jsonb_array_elements(batch_edit->'slots') loop
     s:=jsonb_populate_record(null::public.timetable_plan_slots,coalesce(baseline_slots->((v->>'id')::uuid::text),'{}'::jsonb));
     insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
     values((v->>'id')::uuid,pid,iid,(v->>'weekday')::int,(v->>'startMinute')::int,(v->>'endMinute')::int,(v->>'teacherId')::uuid,(v->>'classroomId')::uuid,coalesce((select name from public.teacher_catalogs where id=(v->>'teacherId')::uuid),s.teacher_name),coalesce((select name from public.classroom_catalogs where id=(v->>'classroomId')::uuid),s.classroom_name),s.source_slot_id)
     on conflict(id) do update set weekday=excluded.weekday,start_minute=excluded.start_minute,end_minute=excluded.end_minute,teacher_catalog_id=excluded.teacher_catalog_id,classroom_catalog_id=excluded.classroom_catalog_id,teacher_name=excluded.teacher_name,classroom_name=excluded.classroom_name;
    end loop;
    acknowledgements:=acknowledgements||jsonb_build_array(jsonb_build_object('itemId',iid,'operation','save','itemRevision',i.revision));
   end if;
  end loop;
  update public.timetable_plans set change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=pid returning * into p;
  response:=jsonb_build_object('planId',pid,'requestKey',p_command->>'requestKey','committedMetaRevision',p.meta_revision,
   'committedChangeSequence',p.change_sequence,'acknowledgements',acknowledgements,'snapshot',public.get_timetable_plan_v1(pid));
  perform dashboard_private.timetable_record_receipt_v1('item.save_batch',p_command,response);return response;
 end if;
 -- Existing single-item save/delete compatibility branch.
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
 ref:=public.get_timetable_plan_v1(pid);
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

create or replace function public.commit_timetable_plan_import_v1(p_command jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare src jsonb:=p_command->'source'; preview jsonb; response jsonb; ref jsonb; entry jsonb; line jsonb; slot jsonb; candidate jsonb; kept jsonb; pending jsonb; reason text; a int; b int; d int; tid uuid; rid uuid; source_slot uuid; pid uuid:=gen_random_uuid(); iid uuid;
begin
 perform dashboard_private.timetable_require_v1(null,false,true);
 if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in('source','sourceFingerprint','name','requestKey')) or length(btrim(coalesce(p_command->>'name',''))) not between 1 and 120 then raise exception using errcode='22023',message='timetable_invalid'; end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();
 perform dashboard_private.timetable_require_v1(null,false,true);
 response:=dashboard_private.timetable_receipt_v1('import',p_command); if response is not null then return response; end if;
 if src->>'kind'='preparation' then perform id from public.classes where id in(select value::uuid from jsonb_array_elements_text(src->'classIds')) order by id for update;
 elsif src->>'kind'='legacy' then perform key from public.app_preferences where key=src->>'key' for share; end if;
 preview:=dashboard_private.timetable_import_source_v1(src);
 if preview->>'sourceFingerprint' is distinct from p_command->>'sourceFingerprint' then raise exception using errcode='P0001',message='timetable_stale'; end if;
 ref:='{}'::jsonb; -- The validator checks only the destination preset.
 insert into public.timetable_plans(id,name,created_by,updated_by) values(pid,btrim(p_command->>'name'),auth.uid(),auth.uid());
 for entry in select value from jsonb_array_elements(preview->'entries') loop
   iid:=gen_random_uuid(); kept:='[]'; pending:='[]';
   insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,source_class_id)
   values(iid,pid,entry->>'name',entry->>'subject',entry->>'subjectAreaKey',entry->>'grade',(entry->>'capacity')::int,(entry->>'tuition')::int,(entry->>'sourceClassId')::uuid);
   for line in select value from jsonb_array_elements(entry->'scheduleLines') loop
     a:=null;b:=null;d:=null;tid:=null;rid:=null;source_slot:=null;reason:=null;
     if length(line->>'day')=1 and strpos('일월화수목금토',line->>'day')>0 then d:=strpos('일월화수목금토',line->>'day')-1; end if;
     if line->>'start' ~ '^[0-9]{1,2}:[0-5][0-9](:00)?$' and line->>'end' ~ '^[0-9]{1,2}:[0-5][0-9](:00)?$' then
       a:=split_part(line->>'start',':',1)::int*60+split_part(line->>'start',':',2)::int;
       b:=split_part(line->>'end',':',1)::int*60+split_part(line->>'end',':',2)::int;
     end if;
     if line ? 'teacherId' then tid:=(line->>'teacherId')::uuid; else select min(id::text)::uuid into tid from public.teacher_catalogs where name=line->>'teacher' having count(*)=1; end if;
     if line ? 'classroomId' then rid:=(line->>'classroomId')::uuid; else select min(id::text)::uuid into rid from public.classroom_catalogs where name=line->>'classroom' having count(*)=1; end if;
     source_slot:=(line->>'sourceSlotId')::uuid;
     if d is null or a is null or b is null or a<0 or a>=b or b>1440 then reason:='invalid_time';
     elsif tid is null or rid is null or not exists(select 1 from public.teacher_catalogs where id=tid and is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(entry->>'subject',subjects)) or not exists(select 1 from public.classroom_catalogs where id=rid and is_visible and (cardinality(subjects)=0 or entry->>'subject'=any(subjects))) then reason:='missing_resource'; end if;
     slot:=jsonb_build_object('id',gen_random_uuid(),'planId',pid,'itemId',iid,'weekday',d,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'sourceSlotId',null);
     if reason is null then
       candidate:=kept||jsonb_build_array(slot);
       begin perform dashboard_private.validate_timetable_item_slots_v1(pid,iid,entry->>'subject',candidate,ref);
       exception when exclusion_violation then reason:='conflict'; end;
     end if;
     if reason is not null then
       pending:=pending||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sourceText',line::text,'reason',reason,'weekday',d,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid));
     else
       -- The normalized source ID is server-derived, never a client supplied ID.
       insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
       values((slot->>'id')::uuid,pid,iid,d,a,b,tid,rid,(select name from public.teacher_catalogs where id=tid),(select name from public.classroom_catalogs where id=rid),source_slot);
       kept:=kept||jsonb_build_array(slot||jsonb_build_object('sourceSlotId',source_slot));
     end if;
   end loop;
   update public.timetable_plan_items set pending_slots=pending,default_teacher_id=(kept->0->>'teacherId')::uuid,default_classroom_id=(kept->0->>'classroomId')::uuid where id=iid;
 end loop;
 perform dashboard_private.timetable_check_capacity_v1(pid);
 update public.timetable_plans set change_sequence=1 where id=pid;
 response:=jsonb_build_object('plan',(public.get_timetable_plan_v1(pid))->'plan');
 perform dashboard_private.timetable_record_receipt_v1('import',p_command,response);
 return response;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception using errcode='22023',message='timetable_invalid';
end $$;

create or replace function dashboard_private.evaluate_timetable_transfer_v1(r jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source_id uuid:=(r#>>'{source,planId}')::uuid; target_id uuid:=(r#>>'{target,planId}')::uuid;
 source_snapshot jsonb; target_snapshot jsonb; ref jsonb; selected uuid[];
 i public.timetable_plan_items; s public.timetable_plan_slots; code text; label text;
 blockers jsonb:='[]'; warnings jsonb:='[]'; mappings jsonb:='[]'; pending_ids jsonb:='[]'; entry jsonb;
 keep_pending boolean:=r->>'onConflict'='keep_pending';
begin
 -- Receipt replay happens before this evaluation in commit. Historical active
 -- receipts remain valid, but a new publication always creates preparing classes.
 if r#>>'{target,kind}'='operational' and r#>>'{target,status}' is distinct from '개강 준비' then
  raise exception using errcode='22023',message='timetable_preparing_required';
 end if;
 source_snapshot:=public.get_timetable_plan_v1(source_id);
 if target_id is not null then target_snapshot:=public.get_timetable_plan_v1(target_id); end if;
 ref:=source_snapshot;
 select array_agg(value::uuid order by value::uuid) into selected from jsonb_array_elements_text(r->'itemIds');
 if source_snapshot#>>'{plan,state}'<>'draft' or (target_id is not null and target_snapshot#>>'{plan,state}'<>'draft') then
   raise exception using errcode='42501',message='timetable_forbidden';
 end if;
 perform dashboard_private.timetable_check_capacity_v1(source_id);
 if target_id is not null then
   perform dashboard_private.timetable_check_capacity_v1(target_id);
   if (target_snapshot#>>'{capacity,itemCount}')::int+cardinality(selected)>500 then
     raise exception using errcode='22023',message='timetable_capacity'; end if;
 end if;
 foreach source_id in array selected loop
   select * into i from public.timetable_plan_items where id=source_id and plan_id=(r#>>'{source,planId}')::uuid;
   if not found or i.state<>'draft' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   mappings:=mappings||jsonb_build_array(jsonb_build_object('sourceId',i.id,'action',case when target_id is null then 'create_preparing_class' else 'create_plan_item' end));
   if jsonb_array_length(i.pending_slots)>0 or not exists(select 1 from public.timetable_plan_slots where item_id=i.id) then
     entry:=jsonb_build_object('sourceId',i.id,'code','unplaced','label','미배치 슬롯을 모두 해결하세요.','relatedIds','[]'::jsonb);
     if keep_pending then warnings:=warnings||jsonb_build_array(entry); else blockers:=blockers||jsonb_build_array(entry); end if;
   end if;
   if target_id is null and ((select count(*) from public.timetable_plan_slots where item_id=i.id)>64
     or (i.subject='과학' and (i.grade not in('고1','고2','고3') or i.subject_area_key is null))
     or (i.subject<>'과학' and i.subject_area_key is not null)
     or (i.subject_area_key is not null and not exists(select 1 from public.academic_subject_areas a where a.subject=i.subject and a.area_key=i.subject_area_key and a.is_active))) then
     blockers:=blockers||jsonb_build_array(jsonb_build_object('sourceId',i.id,'code','metadata','label','수업 기본정보 또는 배치 개수를 확인하세요.','relatedIds','[]'::jsonb));
   end if;
   for s in select * from public.timetable_plan_slots where item_id=i.id order by id loop
     code:=null; label:=null;
     if not exists(select 1 from public.teacher_catalogs t where t.id=s.teacher_catalog_id and t.is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(i.subject,t.subjects))
       or not exists(select 1 from public.classroom_catalogs c where c.id=s.classroom_catalog_id and c.is_visible and (cardinality(c.subjects)=0 or i.subject=any(c.subjects))) then
       code:='missing_resource'; label:='사용 가능한 선생님·강의실을 선택하세요.';
     elsif exists(select 1 from public.timetable_plan_slots x
       where x.plan_id=i.plan_id and x.id<>s.id and x.weekday=s.weekday
       and x.start_minute<s.end_minute and x.end_minute>s.start_minute
       and (x.item_id=s.item_id or x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id))
       or exists(select 1 from public.timetable_plan_slots x
       where x.plan_id=target_id and x.weekday=s.weekday
       and x.start_minute<s.end_minute and x.end_minute>s.start_minute
       and (x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id)) then
       code:='conflict'; label:='선택한 수업 또는 목적지 시간표와 겹칩니다.';
     end if;
     if code is not null then
       entry:=jsonb_build_object('sourceId',i.id,'code',code,'label',label,'relatedIds',jsonb_build_array(s.id));
       if keep_pending then warnings:=warnings||jsonb_build_array(entry); pending_ids:=pending_ids||jsonb_build_array(s.id);
       else blockers:=blockers||jsonb_build_array(entry); end if;
     end if;
   end loop;
   if keep_pending and jsonb_array_length(i.pending_slots)+(select count(*) from public.timetable_plan_slots where item_id=i.id and pending_ids ? id::text)>2000 then
     raise exception using errcode='22023',message='timetable_capacity';
   end if;
 end loop;
 if target_id is not null and (target_snapshot#>>'{capacity,slotCount}')::int+(select count(*) from public.timetable_plan_slots where item_id=any(selected) and not pending_ids ? id::text)>2000 then
   raise exception using errcode='22023',message='timetable_capacity'; end if;
 return jsonb_build_object('request',r,'fingerprint',md5(jsonb_build_object('request',r,'source',source_snapshot,'target',target_snapshot,'reference',ref,'actor',auth.uid(),'role',dashboard_private.timetable_actor_role_v1(),'subjectAreas',(select jsonb_agg(to_jsonb(a) order by a.subject,a.area_key) from public.academic_subject_areas a))::text),
   'shadowFingerprint',ref->>'shadowFingerprint','mappings',mappings,'blockers',blockers,'warnings',warnings,'pendingSlotIds',pending_ids);
end $$;

create or replace function public.commit_timetable_plan_transfer_v1(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r jsonb:=p_command->'request'; p jsonb; response jsonb; snapshot jsonb;
 source_id uuid; target_id uuid; transfer_id uuid:=gen_random_uuid(); target_item_id uuid; class_id uuid;
 selected uuid[]; i public.timetable_plan_items; s public.timetable_plan_slots; new_item public.timetable_plan_items; new_slot public.timetable_plan_slots; c public.classes;
 mappings jsonb:='[]'; applied jsonb:='[]'; removed jsonb:='[]'; created_items jsonb:='[]'; created_slots jsonb:='[]'; new_classes uuid[]:='{}'; slots jsonb; pending jsonb;
begin
 if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in('request','previewFingerprint','requestKey')) then
   raise exception using errcode='22023',message='timetable_invalid'; end if;
 perform dashboard_private.prepare_timetable_transfer_v1(r);
 -- Identical immutable receipt is returned before revisions, selection or preview
 -- revalidation. Authorization is always current, including on a replay.
 response:=dashboard_private.timetable_receipt_v1('transfer',p_command);
 if response is not null then return response; end if;
 p:=dashboard_private.evaluate_timetable_transfer_v1(r);
 if p->>'fingerprint' is distinct from p_command->>'previewFingerprint' then raise exception using errcode='P0001',message='timetable_stale'; end if;
 if jsonb_array_length(p->'blockers')>0 then raise exception using errcode='23P01',message='timetable_resource_conflict'; end if;
 source_id:=(r#>>'{source,planId}')::uuid; target_id:=(r#>>'{target,planId}')::uuid;
 select array_agg(value::uuid order by value::uuid) into selected from jsonb_array_elements_text(r->'itemIds');
 insert into dashboard_private.timetable_plan_transfers(id,request_key,actor_id,source_plan_id,target_plan_id,revisions)
 values(transfer_id,p_command->>'requestKey',auth.uid(),source_id,target_id,jsonb_build_object('previewFingerprint',p->>'fingerprint','request',r));
 for i in select * from public.timetable_plan_items where id=any(selected) order by id for update loop
   if target_id is null then
     -- Existing operating classes are never updated. Initialize only the newly
     -- inserted preparing class and its defaults; no dated sessions or activation.
     insert into public.classes(name,subject,subject_area_key,grade,capacity,fee,status)
       values(i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,'개강 준비') returning * into c;
     class_id:=c.id; new_classes:=array_append(new_classes,class_id);
     select jsonb_agg(jsonb_build_object('weekday',weekday,'startTime',lpad((start_minute/60)::text,2,'0')||':'||lpad((start_minute%60)::text,2,'0'),'endTime',lpad((end_minute/60)::text,2,'0')||':'||lpad((end_minute%60)::text,2,'0'),'teacherCatalogId',teacher_catalog_id,'classroomCatalogId',classroom_catalog_id,'sortOrder',0) order by id) into slots from public.timetable_plan_slots where item_id=i.id;
     perform public.initialize_new_class_schedule_v1(class_id,c.schedule_revision,dashboard_private.continuous_class_schedule_hash_v1(coalesce(c.schedule_plan,'{}'::jsonb)),slots,gen_random_uuid());
     mappings:=mappings||jsonb_build_array(jsonb_build_object('sourceId',i.id,'targetId',class_id,'targetClassId',class_id));
     if r->>'mode'='copy' then
       update public.timetable_plan_items set state='applied',applied_class_id=class_id,applied_transfer_id=transfer_id,applied_at=clock_timestamp(),revision=revision+1 where id=i.id returning * into new_item;
       applied:=applied||jsonb_build_array(dashboard_private.timetable_item_json_v1(new_item));
     end if;
   else
     target_item_id:=gen_random_uuid(); pending:=i.pending_slots;
     for s in select * from public.timetable_plan_slots where item_id=i.id and p->'pendingSlotIds' ? id::text order by id loop
       pending:=pending||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sourceText',dashboard_private.timetable_slot_json_v1(s)::text,'reason',case when exists(select 1 from jsonb_array_elements(p->'warnings') w where w->>'code'='missing_resource' and w->'relatedIds' ? s.id::text) then 'missing_resource' else 'conflict' end,'weekday',s.weekday,'startMinute',s.start_minute,'endMinute',s.end_minute,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id));
     end loop;
     insert into public.timetable_plan_items(id,plan_id,name,subject,subject_area_key,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes,source_class_id,pending_slots)
       values(target_item_id,target_id,i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,i.default_teacher_id,i.default_classroom_id,i.duration_minutes,i.source_class_id,pending) returning * into new_item;
     created_items:=created_items||jsonb_build_array(dashboard_private.timetable_item_json_v1(new_item));
     for s in select * from public.timetable_plan_slots where item_id=i.id and not (p->'pendingSlotIds' ? id::text) order by id loop
       insert into public.timetable_plan_slots(plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name,source_slot_id)
         values(target_id,target_item_id,s.weekday,s.start_minute,s.end_minute,s.teacher_catalog_id,s.classroom_catalog_id,s.teacher_name,s.classroom_name,s.source_slot_id) returning * into new_slot;
       created_slots:=created_slots||jsonb_build_array(dashboard_private.timetable_slot_json_v1(new_slot));
     end loop;
     mappings:=mappings||jsonb_build_array(jsonb_build_object('sourceId',i.id,'targetId',target_item_id,'targetClassId',null));
   end if;
   if r->>'mode'='move' then delete from public.timetable_plan_items where id=i.id; removed:=removed||jsonb_build_array(i.id); end if;
 end loop;
 if target_id is null or r->>'mode'='move' then
   update public.timetable_plans set change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=source_id;
 end if;
 if target_id is not null then
   update public.timetable_plans set change_sequence=change_sequence+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=target_id;
   perform dashboard_private.timetable_check_capacity_v1(target_id);
 end if;
 -- Preserve exact class mappings and preset-owned applied placements.
 -- The mappings and class initialization commit or roll back together.
 update dashboard_private.timetable_plan_transfers set selected_mapping=mappings where id=transfer_id;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
 snapshot:=public.get_timetable_plan_v1(source_id);
 response:=jsonb_build_object('transferId',transfer_id,'shadowFingerprint',snapshot->>'shadowFingerprint','mappings',mappings,'appliedItems',applied,'removedItemIds',removed,'createdItems',created_items,'createdSlots',created_slots,
   'addedShadowSlots',coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'shadowSlots') x where (x->>'classId')::uuid=any(new_classes)),'[]'::jsonb),
   'addedShadowClasses',coalesce((select jsonb_agg(x) from jsonb_array_elements(snapshot->'shadowClasses') x where (x->>'id')::uuid=any(new_classes)),'[]'::jsonb),'snapshot',snapshot);
 update dashboard_private.timetable_plan_transfers set selected_mapping=mappings,result=response where id=transfer_id;
 perform dashboard_private.timetable_record_receipt_v1('transfer',p_command,response);
 return response;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
 raise exception using errcode='22023',message='timetable_invalid';
end $$;

-- Preparing defaults do not reserve operating weekly occupancy. Actual dated
-- session guards and explicit activation guards retain their existing contract.
CREATE OR REPLACE FUNCTION dashboard_private.read_timetable_weekly_reference_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.classes; s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; classes jsonb:='[]'; teachers jsonb; rooms jsonb; payload jsonb; count_parts int; invalid boolean; raw_state jsonb:='[]';
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into teachers from public.teacher_catalogs;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into rooms from public.classroom_catalogs;
 for c in select * from public.classes
 where dashboard_private.academic_class_status_v1(status,nullif(btrim(start_date),'')::date,nullif(btrim(end_date),'')::date)='수강' order by id loop
 classes:=classes||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status',case when c.status='개강 준비' then '개강 준비' else '수강' end,'revision',c.schedule_revision));
 raw_state:=raw_state||jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status',c.status,'schedule_revision',c.schedule_revision,'schedule_storage_mode',c.schedule_storage_mode,'schedule',c.schedule,'teacher',c.teacher,'room',c.room);
 payload:=dashboard_private.read_timetable_class_weekly_v2(c);
 slots:=slots||(payload->'shadowSlots');blockers:=blockers||(payload->'unresolvedOccupancies');
 raw_state:=raw_state||(payload->'source');
 end loop;
 payload:=jsonb_build_object('shadowSlots',slots,'shadowClasses',classes,'catalogs',jsonb_build_object('teachers',teachers,'classrooms',rooms),'unresolvedOccupancies',blockers,'complete',jsonb_array_length(blockers)=0,'occupancyValidationVersion',2);
 return payload||jsonb_build_object('shadowFingerprint',md5((payload||jsonb_build_object('source',raw_state))::text));
end $function$
;

commit;
