-- Preserve supported legacy punctuation and safe original placement for repair.
-- No data rewrite; current authorization, receipt, locks and whitelist remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create or replace function dashboard_private.timetable_import_source_v1(src jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.classes; pref public.app_preferences; entry jsonb; line jsonb; lines jsonb; entries jsonb:='[]'; raw jsonb:='[]'; safe jsonb; sid uuid; piece text; parts text[]; day text; selected uuid[]; detail text; resources text[]; teacher_text text; room_text text;
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
         parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~–][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^()]*)[)])?$');
         if parts is null then
           -- Keep only the schedule string and known placement fields, never a raw row.
           lines:=lines||jsonb_build_array(jsonb_build_object('day',coalesce(substring(piece from '^([월화수목금토일])'),''),'start','','end','','teacher',c.teacher,'classroom',c.room,'originalSchedule',left(piece,2000)));
         else
           detail:=btrim(coalesce(parts[5],'')); teacher_text:=coalesce(c.teacher,''); room_text:=coalesce(c.room,'');
           if detail ~ '[,，/]' then
             resources:=regexp_split_to_array(detail,'[,，/]');
             teacher_text:=btrim(resources[1]); room_text:=btrim(array_to_string(resources[2:cardinality(resources)],', '));
           elsif detail<>'' then
             if detail ~ '(본관|별관|강의실|교실|본[0-9]|별[0-9]|강$|실$)' then room_text:=detail;
             else teacher_text:=detail; end if;
           end if;
           for day in select regexp_split_to_table(regexp_replace(parts[1],'[ /,]','','g'),'') loop
             lines:=lines||jsonb_build_array(jsonb_build_object('day',day,'start',parts[2],'end',parts[3],'teacher',teacher_text,'classroom',room_text,'originalSchedule',left(piece,2000)));
           end loop;
         end if;
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

revoke all on function dashboard_private.timetable_import_source_v1(jsonb) from public, anon, authenticated, service_role;
commit;
