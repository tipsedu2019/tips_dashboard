begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Atomic manual-save extension of the existing item RPC. Existing owner, ACL
-- and single-item save/delete behavior are retained; operating readers are reused.
create or replace function public.mutate_timetable_plan_item_v1(p_command jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare pid uuid:=(p_command->>'planId')::uuid; iid uuid; op text:=p_command->>'operation'; p public.timetable_plans; old public.timetable_plan_items; i public.timetable_plan_items; v jsonb; s public.timetable_plan_slots; ref jsonb; response jsonb; item jsonb:=p_command->'item'; removed jsonb:='[]'; slots jsonb;
batch_edits jsonb; batch_edit jsonb; edit_op text; edit_ids uuid[]:='{}'; slot_ids uuid[]:='{}'; submitted_slot_count integer:=0; baseline_slots jsonb; candidate_slots jsonb; slot_old public.timetable_plan_slots; batch_item public.timetable_plan_items; final_item_count bigint; final_slot_count bigint; acknowledgements jsonb:='[]'; sid uuid; tid uuid; rid uuid; day integer; a integer; b integer; changed boolean; dt date;
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
  ref:=dashboard_private.read_timetable_operating_reference_v1();
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
    where z.plan_id=pid and zi.state='draft' and not z.item_id=any(edit_ids)
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
    if exists(select 1 from jsonb_array_elements(ref->'unresolvedOccupancies') z where dashboard_private.timetable_blocker_intersects_v2(v,z)) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
    if exists(select 1 from jsonb_array_elements(batch_edit->'slots') x where (x->>'id')::uuid<>sid
     and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
    if exists(select 1 from jsonb_array_elements(candidate_slots) x where (x->>'itemId')::uuid<>iid
     and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a
     and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
    if exists(select 1 from jsonb_array_elements(ref->'shadowSlots') x where (x->>'weekday')::int=day
     and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a
     and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then
     raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
    if p.target_start_date is not null and p.target_end_date is not null then
     if exists(select 1 from jsonb_array_elements(ref->'datedUnresolvedOccupancies') z
      where (z->>'date' is null or (z->>'date')::date between p.target_start_date and p.target_end_date)
      and dashboard_private.timetable_blocker_intersects_v2(v,z)) then
      raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
     for dt in select distinct (value->>'date')::date from jsonb_array_elements(ref->'datedSessions')
      where (value->>'date')::date between p.target_start_date and p.target_end_date loop
      if extract(dow from dt)::int=day and exists(select 1 from jsonb_array_elements(ref->'datedSessions') x
       where x->>'state' in('active','exception','makeup') and (x->>'date')::date=dt
       and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a
       and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then
       raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
     end loop;
    end if;
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

commit;
