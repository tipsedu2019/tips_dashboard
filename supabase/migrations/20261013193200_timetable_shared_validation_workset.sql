-- Local structural candidate from fe872. No prior prototype is accumulated.
-- One immutable invocation workset owns raw values, source ordinals, parsed dates,
-- occupancy keys and dated identity columns. All date stages consume that workset.
begin;
set local lock_timeout='5s';
set local statement_timeout='8s';

create type dashboard_private.timetable_validation_row_v1 as (
 v jsonb, dt date, source_ordinal bigint, occupancy_key jsonb,
 class_id text, source_slot_id text, row_id text,
 inherited_id text, overridden_id text, state text
);
create type dashboard_private.timetable_validation_effective_row_v1 as (v jsonb, occupancy_key jsonb);
revoke all on type dashboard_private.timetable_validation_row_v1,
 dashboard_private.timetable_validation_effective_row_v1 from public,anon,authenticated,service_role;

-- No table read, cache, or snapshot. Preserve the original weekly predicate and
-- UNION ALL order; dated rows already have the selected date and decoded keys.
create function dashboard_private.timetable_effective_workset_date_v1(
 r jsonb, d date, rows dashboard_private.timetable_validation_row_v1[]
) returns setof dashboard_private.timetable_validation_effective_row_v1
language sql stable set search_path='' as $workset$
 with weekly as materialized (
   select value x from jsonb_array_elements(r->'shadowSlots')
   where d>=(r->>'asOfDate')::date and (value->>'weekday')::int=extract(dow from d)::int
 ), dated as materialized (
   select s.* from unnest(rows) s where s.dt=d
 ), effective_weekly as materialized (
   select x||jsonb_build_object('date',d) v from weekly
   where not exists(select 1 from dated s where s.class_id=x->>'classId'
     and (s.source_slot_id=x->>'sourceSlotId' or s.overridden_id=x->>'id'
       or (s.state in('skipped','tbd') and s.inherited_id=x->>'id')))
 )
 select row(v,dashboard_private.timetable_occupancy_key_v1(v))::dashboard_private.timetable_validation_effective_row_v1
 from effective_weekly
 union all
 select row(s.v,s.occupancy_key)::dashboard_private.timetable_validation_effective_row_v1
 from dated s where s.state in('active','exception','makeup')
 and not exists(select 1 from weekly where s.inherited_id=x->>'id')
$workset$;
revoke all on function dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])
 from public,anon,authenticated,service_role;

create or replace function dashboard_private.validate_timetable_operating_reference_v1()
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday dashboard_private.timetable_validation_effective_row_v1[];
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
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then diagnostic_mode:='weekly';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- A dated-only change cannot alter effective occupancy on any other date.
 -- Compare BOTH sides with multiplicity: removals can expose weekly defaults.
 -- Weekly/as-of changes still require every actual date, including history and
 -- closed/preparing classes. Each selected date uses the COMPLETE reference.
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
 old_date_reference:=jsonb_build_object('asOfDate',oldref->'asOfDate','shadowSlots',oldref->'shadowSlots');
 new_date_reference:=jsonb_build_object('asOfDate',newref->'asOfDate','shadowSlots',newref->'shadowSlots');
 for d in
 with old_sessions as materialized (select v as value,dt from unnest(old_workset)),
      new_sessions as materialized (select v as value,dt from unnest(new_workset)),
      changed as (
        (select value,dt from old_sessions except all select value,dt from new_sessions)
        union all
        (select value,dt from new_sessions except all select value,dt from old_sessions)
      )
 select distinct dt from (
   select value,dt from changed
   where oldref->'shadowSlots'=newref->'shadowSlots' and oldref->'asOfDate'=newref->'asOfDate'
   union all
   select value,dt from old_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
   union all
   select value,dt from new_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
 ) affected loop
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
 -- NULL wildcard blockers never become confirmed resource overlaps. Both rows
 -- here must have the complete known occupancy contract before disclosing it.
 if x->>'teacherId' is null or x->>'classroomId' is null
 or y->>'teacherId' is null or y->>'classroomId' is null
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

-- CREATE OR REPLACE preserves the existing private signature, owner and ACL.
commit;
