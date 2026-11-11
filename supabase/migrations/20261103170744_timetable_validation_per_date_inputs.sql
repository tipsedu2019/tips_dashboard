-- #234: preserve every fresh reader/assertion/finalizer while proving
-- unchanged dated input per date, instead of requiring unchanged entire history.
-- No table data, ACL, role, timeout, close policy or result confirmation changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $migration$
declare
 target oid := to_regprocedure('dashboard_private.validate_timetable_operating_reference_v1()');
 original_metadata jsonb;
 candidate_metadata jsonb;
 original_body text;
begin
 select to_jsonb(p)-'prosrc'-'prosqlbody',p.prosrc into original_metadata,original_body
 from pg_catalog.pg_proc p where p.oid=target;
 if original_metadata is null or md5(original_body) is distinct from '170a6f87d5d590cc432377d33fc7d485' then
  raise exception using errcode='55000',message='timetable_per_date_validator_definition_drift';
 end if;
 execute $definition$
create or replace function dashboard_private.validate_timetable_operating_reference_v1()
returns jsonb language plpgsql security definer set search_path='' as $f$
declare skip_unchanged_days boolean:=false; comparison_cutoff date:=(now() at time zone 'Asia/Seoul')::date;
 changed_weekdays integer[]; changed_dated_dates date[]; old_weekly_keys jsonb[]; reuse_weekly_keys boolean:=false; weekly_key_exists boolean;
 oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday dashboard_private.timetable_validation_effective_row_v1[];
 newday dashboard_private.timetable_validation_effective_row_v1[];
 -- Assigned once per side below, then immutable through the whole date pipeline.
 old_workset dashboard_private.timetable_validation_row_v1[];
 new_workset dashboard_private.timetable_validation_row_v1[];
 old_bucket dashboard_private.timetable_validation_row_v1[];
 new_bucket dashboard_private.timetable_validation_row_v1[];
 old_dates jsonb; new_dates jsonb; old_date_reference jsonb; new_date_reference jsonb;
 diagnostic_mode text; diagnostic_message text; diagnostic_detail text;
 diagnostic_confirmed jsonb:='[]'; diagnostic_unresolved jsonb:='[]';
 diagnostic_confirmed_count int:=0; diagnostic_unresolved_count int:=0;
 diagnostic_missing text[]; diagnostic_row jsonb; diagnostic_class_name text;
 diagnostic_teacher_name text; diagnostic_classroom_name text;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return null;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then return newref;end if;
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select b-'label' from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
           except select ob-'label' from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob) then
 diagnostic_mode:='introduced_unknown';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 -- Cache only keys whose eager preparation cannot introduce a date-cast error.
 -- Empty/non-array inputs and any old date field retain the original EXISTS.
 if jsonb_typeof(oldref->'shadowSlots')='array' and jsonb_typeof(newref->'shadowSlots')='array' then
  if jsonb_array_length(oldref->'shadowSlots')>0 and jsonb_array_length(newref->'shadowSlots')>0 then
   if not exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where b ? 'date') then
    select array_agg(dashboard_private.timetable_occupancy_key_v1(b)) into old_weekly_keys
    from jsonb_array_elements(oldref->'shadowSlots') b;
    reuse_weekly_keys:=true;
   end if;
  end if;
 end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if reuse_weekly_keys then
  weekly_key_exists:=dashboard_private.timetable_occupancy_key_v1(x)=any(old_weekly_keys);
 else
  weekly_key_exists:=exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x));
 end if;
 if weekly_key_exists then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then diagnostic_mode:='weekly';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- A dated-only change cannot alter effective occupancy on any other date.
 -- Compare BOTH sides with multiplicity: removals can expose weekly defaults.
 -- Preserve the full original date universe and every closed/preparing row.
 -- Below, skip only dates whose complete effective inputs are proven equal.
 -- All selected dates retain their COMPLETE per-date reference.
 -- Decode each original array once. Old is fully built before new, retaining
 -- the original global date-cast error boundary. Missing/null dates remain raw
 -- members for the affected multiset but are excluded from the date index.
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(oldref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::dashboard_private.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::dashboard_private.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into old_workset,old_dates from prepared;
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(newref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::dashboard_private.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::dashboard_private.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into new_workset,new_dates from prepared;

 -- Only canonical reader cutoffs and weekly inputs qualify. Prove dated
 -- equality separately for each parsed date below; a future close removal
 -- must not make unchanged historical dates perform the complete comparison.
 skip_unchanged_days:=oldref->'asOfDate'=to_jsonb(comparison_cutoff)
  and newref->'asOfDate'=to_jsonb(comparison_cutoff)
  and case when jsonb_typeof(oldref->'shadowSlots')='array' and jsonb_typeof(newref->'shadowSlots')='array'
  then not exists(select 1 from jsonb_array_elements((oldref->'shadowSlots')||(newref->'shadowSlots')) weekly_entry
    where jsonb_typeof(weekly_entry->'weekday') is distinct from 'number'
       or (weekly_entry->>'weekday') !~ '^[0-6]$') else false end;
 if skip_unchanged_days then
  -- Both worksets have already decoded every original date, old before new.
  -- Keep raw JSON text and multiplicity: numeric identities such as 1 and 1.0
  -- must remain different inputs even though JSONB equality considers them equal.
  -- NULL dates are never skipped by the finite-date guard below.
  if (oldref->'datedSessions')::text collate "C"=(newref->'datedSessions')::text collate "C" then
   changed_dated_dates:='{}'::date[];
  else
   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select v::text collate "C" raw_dated,dt from unnest(old_workset)
          except all select v::text collate "C",dt from unnest(new_workset))
         union all
         (select v::text collate "C" raw_dated,dt from unnest(new_workset)
          except all select v::text collate "C",dt from unnest(old_workset))) changed_dated;
  end if;
  select coalesce(array_agg(distinct (raw_weekly::jsonb->>'weekday')::int),'{}'::integer[]) into changed_weekdays
  from ((select value::text collate "C" as raw_weekly from jsonb_array_elements(oldref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots'))
        union all
        (select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(oldref->'shadowSlots'))) changed_weekly;
 end if;
 old_date_reference:=jsonb_build_object('asOfDate',oldref->'asOfDate','shadowSlots',oldref->'shadowSlots');
 new_date_reference:=jsonb_build_object('asOfDate',newref->'asOfDate','shadowSlots',newref->'shadowSlots');
 -- Date enumeration retains the original value-only multiset and raw-date
 -- expression. Source rows come from the immutable workset, not a second JSON
 -- expansion. Occupancy preparation remains separate from enumeration; no new
 -- sort or preferred date order is introduced.
 for d in
 with old_sessions as materialized (select value from dashboard_private.timetable_validation_workset_values_v1(old_workset)),
      new_sessions as materialized (select value from dashboard_private.timetable_validation_workset_values_v1(new_workset)),
      changed as (
        (select value from old_sessions except all select value from new_sessions)
        union all
        (select value from new_sessions except all select value from old_sessions)
      )
 select distinct (value->>'date')::date from (
   select value from changed
   where oldref->'shadowSlots'=newref->'shadowSlots' and oldref->'asOfDate'=newref->'asOfDate'
   union all
   select value from old_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
   union all
   select value from new_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
 ) affected loop
 if skip_unchanged_days and isfinite(d) and not (d=any(changed_dated_dates))
  and (d<comparison_cutoff or not (extract(dow from d)::int=any(changed_weekdays))) then continue;end if;
 -- The index contains positions, never a second copy of the raw rows.
 select coalesce(array_agg(old_workset[(pos::text)::int] order by ord),'{}'::dashboard_private.timetable_validation_row_v1[])
 into old_bucket from jsonb_array_elements(coalesce(old_dates->d::text,'[]'::jsonb)) with ordinality entries(pos,ord);
 select coalesce(array_agg(row(coalesce(e.v,'null'::jsonb),
   coalesce(e.occupancy_key,dashboard_private.timetable_occupancy_key_v1(coalesce(e.v,'null'::jsonb))))::dashboard_private.timetable_validation_effective_row_v1 order by e.emitted_ordinal),
   '{}'::dashboard_private.timetable_validation_effective_row_v1[])
 into oldday from dashboard_private.timetable_effective_workset_date_v1(old_date_reference,d,old_bucket)
 with ordinality e(v,occupancy_key,emitted_ordinal);
 -- The index contains positions, never a second copy of the raw rows.
 select coalesce(array_agg(new_workset[(pos::text)::int] order by ord),'{}'::dashboard_private.timetable_validation_row_v1[])
 into new_bucket from jsonb_array_elements(coalesce(new_dates->d::text,'[]'::jsonb)) with ordinality entries(pos,ord);
 select coalesce(array_agg(row(coalesce(e.v,'null'::jsonb),
   coalesce(e.occupancy_key,dashboard_private.timetable_occupancy_key_v1(coalesce(e.v,'null'::jsonb))))::dashboard_private.timetable_validation_effective_row_v1 order by e.emitted_ordinal),
   '{}'::dashboard_private.timetable_validation_effective_row_v1[])
 into newday from dashboard_private.timetable_effective_workset_date_v1(new_date_reference,d,new_bucket)
 with ordinality e(v,occupancy_key,emitted_ordinal);
 -- Multiplicity, not mere existence: newly exposed defaults and duplicate keys
 -- must still be checked. Compute each day's counts once against all its rows.
 for x in
 with old_counts as (
   select occupancy_key key,count(*) n
   from unnest(oldday) group by 1
 ), new_counts as (
   select occupancy_key key,count(*) n,
          (jsonb_agg(v order by ord))->0 representative,min(ord) first_ordinal
   from unnest(newday) with ordinality entries(v,occupancy_key,ord) group by 1
 )
 select representative from new_counts n left join old_counts o using(key)
 where n.n>coalesce(o.n,0) order by first_ordinal loop
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d) and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b) and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)) or exists(select 1 from unnest(newday) b where dashboard_private.timetable_intersects_v1(x,b.v)) then diagnostic_mode:='dated';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
return newref;
exception when exclusion_violation then
 -- PostgREST forwards DETAIL through the existing writer RPC. The diagnostic is
 -- optional: formatter/authentication failures retain the conflict. Database
 -- cancellation still propagates normally and rolls the rejected write back.
 -- Require the actual API role, not a client-set JWT role or agent impersonation.
 get stacked diagnostics diagnostic_message=MESSAGE_TEXT;
 if diagnostic_message<>'timetable_resource_conflict'
 or current_setting('role',true) is distinct from 'authenticated' then raise;end if;
 begin
 perform dashboard_private.agent_require_admin_v1();
 -- Only the candidate rejected by the unchanged checks above is explained.
 -- Use the complete already-read final reference, never an old saved draft,
 -- a client-provided comparison, a scoped snapshot, or a second database read.
 if diagnostic_mode in('weekly','dated') then
 for y in select value from jsonb_array_elements(case when diagnostic_mode='weekly'
            then newref->'shadowSlots' else (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from unnest(newday) with ordinality entries(v,occupancy_key,ord)) end)
          where (diagnostic_mode<>'weekly' or value->>'weekday'=x->>'weekday')
          and dashboard_private.timetable_intersects_v1(x,value)
          order by value->>'classId',value->>'id' loop
 -- Optional rooms do not erase a confirmed teacher or same-class conflict.
 -- Malformed/incomplete rows remain in the separate unresolved diagnostics.
 if x->>'teacherId' is null or y->>'teacherId' is null
 or x->>'startMinute' is null or x->>'endMinute' is null
 or y->>'startMinute' is null or y->>'endMinute' is null then continue;end if;
 diagnostic_confirmed_count:=diagnostic_confirmed_count+1;
 if diagnostic_confirmed_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_teacher_name:=null;diagnostic_classroom_name:=null;
 if x->>'teacherId'=y->>'teacherId' then
 select name into diagnostic_teacher_name from public.teacher_catalogs where id=(y->>'teacherId')::uuid;end if;
 if x->>'classroomId'=y->>'classroomId' then
 select name into diagnostic_classroom_name from public.classroom_catalogs where id=(y->>'classroomId')::uuid;end if;
 diagnostic_row:=jsonb_strip_nulls(jsonb_build_object('className',diagnostic_class_name,
 'date',case when diagnostic_mode='dated' then to_jsonb(d) end,
 'weekday',case when diagnostic_mode='weekly' then y->'weekday' end,
 'startMinute',(y->>'startMinute')::int,'endMinute',(y->>'endMinute')::int,
 'overlapStartMinute',greatest((x->>'startMinute')::int,(y->>'startMinute')::int),
 'overlapEndMinute',least((x->>'endMinute')::int,(y->>'endMinute')::int),
 'teacherName',diagnostic_teacher_name,'classroomName',diagnostic_classroom_name,
 'sameClass',case when x->>'classId'=y->>'classId' then true end));
 diagnostic_confirmed:=diagnostic_confirmed||jsonb_build_array(diagnostic_row);
 end loop;
 end if;
 for y in
 select b from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
 where case when diagnostic_mode='introduced_unknown' then
 not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')
 when diagnostic_mode='weekly' then
 (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date)
 and dashboard_private.timetable_blocker_intersects_v2(x,b)
 when diagnostic_mode='dated' then
 (b->>'date' is null or (b->>'date')::date=d)
 and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b)
 and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)
 else false end
 order by b->>'classId',b->>'date',b->>'occupancyFingerprint' loop
 diagnostic_unresolved_count:=diagnostic_unresolved_count+1;
 if diagnostic_unresolved_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_missing:='{}';
 if y->>'date' is null and y->>'weekday' is null then diagnostic_missing:=array_append(diagnostic_missing,'date');end if;
 if y->>'startMinute' is null or y->>'endMinute' is null then diagnostic_missing:=array_append(diagnostic_missing,'time');end if;
 if y->>'teacherId' is null then diagnostic_missing:=array_append(diagnostic_missing,'teacher');end if;
 if y->>'classroomId' is null then diagnostic_missing:=array_append(diagnostic_missing,'classroom');end if;
 if cardinality(diagnostic_missing)=0 then diagnostic_missing:=array['schedule'];end if;
 diagnostic_unresolved:=diagnostic_unresolved||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
 'className',diagnostic_class_name,'date',y->'date','weekday',y->'weekday',
 'missingFields',to_jsonb(diagnostic_missing))));
 end loop;
 diagnostic_detail:=jsonb_build_object('version',1,'confirmed',diagnostic_confirmed,'unresolved',diagnostic_unresolved,
 'confirmedCount',diagnostic_confirmed_count,'unresolvedCount',diagnostic_unresolved_count,
 'truncated',diagnostic_confirmed_count>20 or diagnostic_unresolved_count>20)::text;
 exception when others then diagnostic_detail:=null;
 end;
 if diagnostic_detail is null then raise;end if;
 raise exception using errcode='23P01',message='timetable_resource_conflict',detail=diagnostic_detail;
end $f$;
$definition$;
 select to_jsonb(p)-'prosrc'-'prosqlbody' into candidate_metadata
 from pg_catalog.pg_proc p where p.oid=target;
 if candidate_metadata is distinct from original_metadata
 or (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=target) is distinct from 'f43f5adf0c9ed1ed6b195de6940bb639' then
  raise exception using errcode='55000',message='timetable_per_date_validator_metadata_drift';
 end if;
end $migration$;

commit;
