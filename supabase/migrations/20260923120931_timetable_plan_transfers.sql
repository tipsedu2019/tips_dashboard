begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Selected transfers are independent of whole-plan cloning. All writers share
-- the operating key, then lock plans and related classes in UUID order.
create or replace function dashboard_private.prepare_timetable_transfer_v1(r jsonb)
returns void language plpgsql volatile security definer set search_path='' as $$
declare source_id uuid; target_id uuid;
begin
 if jsonb_typeof(r) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(r) k where k not in('source','target','mode','itemIds','onConflict'))
   or jsonb_typeof(r->'source') is distinct from 'object'
   or jsonb_typeof(r->'target') is distinct from 'object'
   or r#>>'{source,kind}' is distinct from 'plan'
   or coalesce(r#>>'{target,kind}','') not in('plan','operational')
   or coalesce(r->>'mode','') not in('copy','move')
   or coalesce(r->>'onConflict','') not in('reject','keep_pending')
   or jsonb_typeof(r->'itemIds') is distinct from 'array'
 then raise exception using errcode='22023',message='timetable_invalid'; end if;
 if exists(select 1 from jsonb_object_keys(r->'source') k where k not in('kind','planId'))
   or exists(select 1 from jsonb_object_keys(r->'target') k where k not in('kind','planId'))
   or jsonb_array_length(r->'itemIds') not between 1 and 500
   or (r->>'onConflict'='keep_pending' and (r->>'mode'<>'copy' or r#>>'{target,kind}'<>'plan'))
 then raise exception using errcode='22023',message='timetable_invalid'; end if;
 source_id:=(r#>>'{source,planId}')::uuid;
 target_id:=(r#>>'{target,planId}')::uuid;
 if source_id is null or (r#>>'{target,kind}'='plan' and (target_id is null or target_id=source_id))
   or (r#>>'{target,kind}'='operational' and r->'target' ? 'planId')
   or exists(select 1 from jsonb_array_elements(r->'itemIds') x where jsonb_typeof(x)<>'string' or (x#>>'{}')::uuid is null)
   or (select count(*)<>count(distinct (value#>>'{}')::uuid) from jsonb_array_elements(r->'itemIds'))
 then raise exception using errcode='22023',message='timetable_invalid'; end if;
 perform dashboard_private.timetable_require_v1(source_id,true,target_id is null);
 if target_id is not null then perform dashboard_private.timetable_require_v1(target_id,true); end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();
 perform id from public.timetable_plans where id in(source_id,target_id) order by id for update;
 -- Sharing/role changes that won the lock must be observed before receipts too.
 perform dashboard_private.timetable_require_v1(source_id,true,target_id is null);
 if target_id is not null then perform dashboard_private.timetable_require_v1(target_id,true); end if;
 if not exists(select 1 from public.timetable_plans where id=source_id)
   or (target_id is not null and not exists(select 1 from public.timetable_plans where id=target_id))
 then raise exception using errcode='22023',message='timetable_invalid'; end if;
 perform c.id from public.classes c where c.status='수강'
   or exists(select 1 from public.timetable_plan_items i where i.plan_id in(source_id,target_id) and c.id in(i.source_class_id,i.applied_class_id))
   or exists(select 1 from public.class_lesson_sessions s where s.class_id=c.id)
   order by c.id for update;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception using errcode='22023',message='timetable_invalid';
end $$;

-- Called only after preparation. Returns per-item blockers and the exact slots
-- a caller explicitly electing plan-copy keep_pending will preserve unplaced.
create or replace function dashboard_private.evaluate_timetable_transfer_v1(r jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source_id uuid:=(r#>>'{source,planId}')::uuid; target_id uuid:=(r#>>'{target,planId}')::uuid;
 source_snapshot jsonb; target_snapshot jsonb; ref jsonb; selected uuid[];
 i public.timetable_plan_items; s public.timetable_plan_slots; code text; label text;
 blockers jsonb:='[]'; warnings jsonb:='[]'; mappings jsonb:='[]'; pending_ids jsonb:='[]'; entry jsonb;
 keep_pending boolean:=r->>'onConflict'='keep_pending'; period_from date; period_to date;
begin
 source_snapshot:=public.get_timetable_plan_v1(source_id);
 if target_id is not null then target_snapshot:=public.get_timetable_plan_v1(target_id); end if;
 ref:=dashboard_private.read_timetable_operating_reference_v1();
 select array_agg(value::uuid order by value::uuid) into selected from jsonb_array_elements_text(r->'itemIds');
 if source_snapshot#>>'{plan,state}'<>'draft' or (target_id is not null and target_snapshot#>>'{plan,state}'<>'draft') then
   raise exception using errcode='42501',message='timetable_forbidden';
 end if;
 perform dashboard_private.timetable_check_capacity_v1(source_id);
 if target_id is not null then
   perform dashboard_private.timetable_check_capacity_v1(target_id);
   period_from:=(target_snapshot#>>'{plan,targetStartDate}')::date;
   period_to:=(target_snapshot#>>'{plan,targetEndDate}')::date;
   if (target_snapshot#>>'{capacity,itemCount}')::int+cardinality(selected)>500 then
     raise exception using errcode='22023',message='timetable_capacity'; end if;
 else period_from:=(ref->>'asOfDate')::date; period_to:='infinity'::date;
 end if;
 foreach source_id in array selected loop
   select * into i from public.timetable_plan_items where id=source_id and plan_id=(r#>>'{source,planId}')::uuid;
   if not found or i.state<>'draft' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   mappings:=mappings||jsonb_build_array(jsonb_build_object('sourceId',i.id,'action',case when target_id is null then 'create_active_class' else 'create_plan_item' end));
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
     elsif not coalesce((ref->>'complete')::boolean,false)
       or exists(select 1 from public.timetable_plan_slots x where x.item_id=any(selected) and x.id<>s.id and x.weekday=s.weekday and x.start_minute<s.end_minute and x.end_minute>s.start_minute and (x.item_id=s.item_id or x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id))
       or exists(select 1 from public.timetable_plan_slots x join public.timetable_plan_items xi on xi.id=x.item_id where x.plan_id=target_id and xi.state='draft' and x.weekday=s.weekday and x.start_minute<s.end_minute and x.end_minute>s.start_minute and (x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id))
       or exists(select 1 from jsonb_array_elements(ref->'shadowSlots') x where (x->>'weekday')::int=s.weekday and (x->>'startMinute')::int<s.end_minute and (x->>'endMinute')::int>s.start_minute and ((x->>'teacherId')::uuid=s.teacher_catalog_id or (x->>'classroomId')::uuid=s.classroom_catalog_id))
       or (period_from is not null and exists(select 1 from jsonb_array_elements(ref->'datedUnresolvedOccupancies') x where x->>'date' is null or (x->>'date')::date between period_from and period_to))
       or (period_from is not null and exists(select 1 from jsonb_array_elements(ref->'datedSessions') x where x->>'state' in('active','exception','makeup') and (x->>'date')::date between period_from and period_to and extract(dow from (x->>'date')::date)::int=s.weekday and (x->>'startMinute')::int<s.end_minute and (x->>'endMinute')::int>s.start_minute and ((x->>'teacherId')::uuid=s.teacher_catalog_id or (x->>'classroomId')::uuid=s.classroom_catalog_id))) then
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

create or replace function public.preview_timetable_plan_transfer_v1(p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform dashboard_private.prepare_timetable_transfer_v1(p_request);
 return dashboard_private.evaluate_timetable_transfer_v1(p_request);
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
     -- Existing operating classes are never updated. Initialize only a freshly
     -- inserted preparing class before activating it in this same transaction.
     insert into public.classes(name,subject,subject_area_key,grade,capacity,fee,status)
       values(i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,'개강 준비') returning * into c;
     class_id:=c.id; new_classes:=array_append(new_classes,class_id);
     select jsonb_agg(jsonb_build_object('weekday',weekday,'startTime',lpad((start_minute/60)::text,2,'0')||':'||lpad((start_minute%60)::text,2,'0'),'endTime',lpad((end_minute/60)::text,2,'0')||':'||lpad((end_minute%60)::text,2,'0'),'teacherCatalogId',teacher_catalog_id,'classroomCatalogId',classroom_catalog_id,'sortOrder',0) order by id) into slots from public.timetable_plan_slots where item_id=i.id;
     perform public.initialize_new_class_schedule_v1(class_id,c.schedule_revision,dashboard_private.continuous_class_schedule_hash_v1(coalesce(c.schedule_plan,'{}'::jsonb)),slots,gen_random_uuid());
     update public.classes set status='수강' where id=class_id;
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

alter function dashboard_private.prepare_timetable_transfer_v1(jsonb) owner to postgres;
alter function dashboard_private.evaluate_timetable_transfer_v1(jsonb) owner to postgres;
revoke all on function dashboard_private.prepare_timetable_transfer_v1(jsonb),dashboard_private.evaluate_timetable_transfer_v1(jsonb) from public,anon,authenticated;
alter function public.preview_timetable_plan_transfer_v1(jsonb) owner to postgres;
alter function public.commit_timetable_plan_transfer_v1(jsonb) owner to postgres;
revoke all on function public.preview_timetable_plan_transfer_v1(jsonb),public.commit_timetable_plan_transfer_v1(jsonb) from public,anon;
grant execute on function public.preview_timetable_plan_transfer_v1(jsonb),public.commit_timetable_plan_transfer_v1(jsonb) to authenticated;

commit;
