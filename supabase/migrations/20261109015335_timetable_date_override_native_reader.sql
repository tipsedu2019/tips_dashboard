-- #234: forward only the reader's proven ordinary date-override fast path.
-- Source main 5b6c6f9e; preserve every fallback, caller and function privilege.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $date_override_native_reader$
declare
  target oid := to_regprocedure('dashboard_private.read_timetable_operating_reference_v1()');
  original_body text;
  candidate_body text;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  patch record;
begin
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into original_body, metadata_before
    from pg_catalog.pg_proc p where p.oid = target;
  if metadata_before is null
    or md5(original_body) is distinct from 'bc52c94595c5b2cb294f2c1eebbb6bcc' then
    raise exception 'date_override_native_reader_definition_drift' using errcode = '55000';
  end if;
  candidate_body := original_body;
  for patch in select * from (values
    ($before0$start_hour int; end_hour int;$before0$, $after0$start_hour int; end_hour int; native_values jsonb; date_override jsonb;$after0$),
    ($before1$ native_resolved:=false;effective_input:=null;effective:=null;
$before1$, $after1$ native_resolved:=false;effective_input:=null;effective:=null;
 native_values:=v;
 date_override:=lookup_plan#>array['sessionSchedules',v->>'date'];
 if jsonb_typeof(date_override)='object' then
   -- Field presence owns priority: explicit null/invalid values never inherit.
   -- Keep the original row and plan intact for generic fallback and fingerprints.
   native_values:=jsonb_build_object(
     'startTime',case when v ? 'startTime' then v->'startTime' else date_override->'startTime' end,
     'endTime',case when v ? 'endTime' then v->'endTime' else date_override->'endTime' end,
     'teacherCatalogId',case when v ? 'teacherCatalogId' then v->'teacherCatalogId' else date_override->'teacherCatalogId' end,
     'classroomCatalogId',case when v ? 'classroomCatalogId' then v->'classroomCatalogId' else date_override->'classroomCatalogId' end);
 end if;
$after1$),
    ($before2$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and jsonb_typeof(lookup_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'$before2$, $after2$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and (jsonb_typeof(date_override) is distinct from 'object'
         or (v->'classroomUnresolved' is distinct from 'true'::jsonb
             and date_override->'classroomUnresolved' is distinct from 'true'::jsonb))$after2$),
    ($before3$    and jsonb_typeof(v->'startTime')='string' and jsonb_typeof(v->'endTime')='string'
    and jsonb_typeof(v->'teacherCatalogId')='string' and jsonb_typeof(v->'classroomCatalogId')='string' then
   start_text:=btrim(v->>'startTime');end_text:=btrim(v->>'endTime');
   teacher_text:=btrim(v->>'teacherCatalogId');room_text:=btrim(v->>'classroomCatalogId');
$before3$, $after3$    and jsonb_typeof(native_values->'startTime')='string' and jsonb_typeof(native_values->'endTime')='string'
    and jsonb_typeof(native_values->'teacherCatalogId')='string' and jsonb_typeof(native_values->'classroomCatalogId')='string' then
   start_text:=btrim(native_values->>'startTime');end_text:=btrim(native_values->>'endTime');
   teacher_text:=btrim(native_values->>'teacherCatalogId');room_text:=btrim(native_values->>'classroomCatalogId');
$after3$)
  ) changes(before_text, after_text) loop
    if length(candidate_body) - length(replace(candidate_body, patch.before_text, ''))
      <> length(patch.before_text) then
      raise exception 'date_override_native_reader_anchor_drift' using errcode = '55000';
    end if;
    candidate_body := replace(candidate_body, patch.before_text, patch.after_text);
  end loop;
  if md5(candidate_body) is distinct from '297fe1400b5313adbd978ea859d98fbb' then
    raise exception 'date_override_native_reader_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, original_body, '')) <> length(original_body) then
    raise exception 'date_override_native_reader_definition_drift' using errcode = '55000';
  end if;
  -- Retain the actual installed header, owner, ACL and per-function settings.
  execute replace(definition, original_body, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '297fe1400b5313adbd978ea859d98fbb'
    or metadata_after is distinct from metadata_before then
    raise exception 'date_override_native_reader_metadata_drift' using errcode = '55000';
  end if;
end
$date_override_native_reader$;

commit;
