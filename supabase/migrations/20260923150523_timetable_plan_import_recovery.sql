-- Management-only copies from untouched preparing classes or global historical
-- planner preferences. Every public projection is a whitelist, including pending.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create or replace function dashboard_private.timetable_import_text_v1(v jsonb) returns text
language sql immutable set search_path='' as $$ select case when jsonb_typeof(v)='string' then v#>>'{}' else '' end $$;

create or replace function dashboard_private.timetable_import_source_v1(src jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.classes; pref public.app_preferences; entry jsonb; line jsonb; lines jsonb; entries jsonb:='[]'; raw jsonb:='[]'; safe jsonb; sid uuid; piece text; parts text[]; day text; selected uuid[];
begin
 if jsonb_typeof(src) is distinct from 'object' or coalesce(src->>'kind','') not in('preparation','legacy') then raise exception using errcode='22023',message='timetable_invalid'; end if;
 if src->>'kind'='legacy' then
   if exists(select 1 from jsonb_object_keys(src) k where k not in('kind','key')) or src->>'key' not like 'planner:term:%' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   select * into pref from public.app_preferences where key=src->>'key';
   if not found or jsonb_typeof(pref.value->'entries') is distinct from 'object' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   raw:=jsonb_build_object('key',pref.key,'updatedAt',pref.updated_at,'value',pref.value);
   for entry in select value from jsonb_each(pref.value->'entries') order by key loop
     lines:='[]'; sid:=null;
     -- Never project arbitrary old keys, raw entries or student/status fields.
     if jsonb_typeof(entry->'scheduleLines')='array' then
       for line in select value from jsonb_array_elements(entry->'scheduleLines') loop
         lines:=lines||jsonb_build_array(jsonb_build_object('day',dashboard_private.timetable_import_text_v1(line->'day'),'start',dashboard_private.timetable_import_text_v1(line->'start'),'end',dashboard_private.timetable_import_text_v1(line->'end'),
           'teacher',coalesce(nullif(dashboard_private.timetable_import_text_v1(line->'teacher'),''),dashboard_private.timetable_import_text_v1(entry->'teacher')),
           'classroom',coalesce(nullif(dashboard_private.timetable_import_text_v1(line->'classroom'),''),dashboard_private.timetable_import_text_v1(entry->'classroom'))));
       end loop;
     elsif entry ? 'scheduleLines' then lines:=jsonb_build_array(jsonb_build_object('day','','start','','end','','teacher','','classroom','')); end if;
     begin select id into sid from public.classes where id=(entry->>'classId')::uuid; exception when invalid_text_representation then sid:=null; end;
     if nullif(btrim(dashboard_private.timetable_import_text_v1(entry->'subject')),'') is null then raise exception using errcode='22023',message='timetable_import_metadata_missing'; end if;
     safe:=jsonb_build_object('name',coalesce(nullif(left(dashboard_private.timetable_import_text_v1(entry->'className'),200),''),'복구 수업'),
       'subject',left(dashboard_private.timetable_import_text_v1(entry->'subject'),80),'grade','','capacity',null,'tuition',null,'subjectAreaKey',null,
       'sourceClassId',sid,'scheduleLines',lines);
     entries:=entries||jsonb_build_array(safe);
   end loop;
 else
   if exists(select 1 from jsonb_object_keys(src) k where k not in('kind','classIds')) or jsonb_typeof(src->'classIds') is distinct from 'array' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   select array_agg(value::uuid order by value::uuid) into selected from jsonb_array_elements_text(src->'classIds');
   if coalesce(cardinality(selected),0) not between 1 and 500 or cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
      or (select count(*) from public.classes where id=any(selected) and status='개강 준비')<>cardinality(selected) then raise exception using errcode='22023',message='timetable_invalid'; end if;
   for c in select * from public.classes where id=any(selected) order by id loop
     lines:='[]';
     if c.schedule_storage_mode='normalized' then
       select coalesce(jsonb_agg(jsonb_build_object('day',substring('일월화수목금토' from s.weekday+1 for 1),'start',s.start_time::text,'end',s.end_time::text,'teacher',s.teacher_name,'classroom',s.classroom_name,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sourceSlotId',s.id) order by s.id),'[]') into lines from public.class_schedule_slots s where s.class_id=c.id;
     else
       for piece in select btrim(x) from regexp_split_to_table(coalesce(c.schedule,''), E'[\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x where btrim(x)<>'' loop
         parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]+),[[:space:]]*([^()]+)[)])?$');
         if parts is null then lines:=lines||jsonb_build_array(jsonb_build_object('day','','start','','end','','teacher',c.teacher,'classroom',c.room));
         else for day in select regexp_split_to_table(regexp_replace(parts[1],'[ /,]','','g'),'') loop
           lines:=lines||jsonb_build_array(jsonb_build_object('day',day,'start',parts[2],'end',parts[3],'teacher',btrim(coalesce(parts[5],c.teacher)),'classroom',btrim(coalesce(parts[6],c.room))));
         end loop; end if;
       end loop;
     end if;
     safe:=jsonb_build_object('name',c.name,'subject',c.subject,'grade',coalesce(c.grade,''),'capacity',c.capacity,'tuition',c.fee,'subjectAreaKey',c.subject_area_key,'sourceClassId',c.id,'scheduleLines',lines);
     entries:=entries||jsonb_build_array(safe); raw:=raw||jsonb_build_array(safe||jsonb_build_object('scheduleRevision',c.schedule_revision,'schedule',c.schedule,'mode',c.schedule_storage_mode));
   end loop;
 end if;
 if jsonb_array_length(entries) not between 1 and 500 or exists(select 1 from jsonb_array_elements(entries) x where jsonb_array_length(x->'scheduleLines')>2000) then raise exception using errcode='22023',message='timetable_capacity'; end if;
 return jsonb_build_object('source',src,'sourceFingerprint',md5(raw::text),'entries',entries);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='timetable_invalid';
end $$;

create or replace function public.list_timetable_import_sources_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform dashboard_private.timetable_require_v1(null,false,true);
 return jsonb_build_object('preparationClasses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'subject',subject) order by name,id) from public.classes where status='개강 준비'),'[]'),
 'legacyCandidates',coalesce((select jsonb_agg(jsonb_build_object('key',key,'updatedAt',updated_at,'version',case when jsonb_typeof(value->'version') in('number','string') then left(value->>'version',40) else null end,
 'entryCount',case when jsonb_typeof(value->'entries')='object' then (select count(*) from jsonb_object_keys(value->'entries')) else 0 end,
 'parseStatus',case when jsonb_typeof(value->'entries')='object' then 'ready' else 'invalid' end) order by key) from public.app_preferences where key like 'planner:term:%'),'[]'));
end $$;
create or replace function public.preview_timetable_plan_import_v1(p_source jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform dashboard_private.timetable_require_v1(null,false,true);
 return dashboard_private.timetable_import_source_v1(p_source);
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
 ref:=dashboard_private.read_timetable_operating_reference_v1();
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
revoke all on function dashboard_private.timetable_import_text_v1(jsonb),dashboard_private.timetable_import_source_v1(jsonb) from public,anon,authenticated;
revoke all on function public.list_timetable_import_sources_v1(),public.preview_timetable_plan_import_v1(jsonb),public.commit_timetable_plan_import_v1(jsonb) from public,anon;
grant execute on function public.list_timetable_import_sources_v1(),public.preview_timetable_plan_import_v1(jsonb),public.commit_timetable_plan_import_v1(jsonb) to authenticated;
commit;
