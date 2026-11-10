-- Synthetic-only regression; no operating payloads or credentials.
begin;
select no_plan();
CREATE FUNCTION pg_temp.proof_original_validate() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
   with old_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(old_workset)
   ), new_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(new_workset)
   )
   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select raw_dated,dt from old_raw_dated
          except all select raw_dated,dt from new_raw_dated)
         union all
         (select raw_dated,dt from new_raw_dated
          except all select raw_dated,dt from old_raw_dated)) changed_dated;
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
end $_$;
set local role postgres;
set local timezone='Asia/Seoul';
set local datestyle='ISO, MDY';
set local statement_timeout='8s';
set local lock_timeout='2s';
set local track_functions='pl';

create function pg_temp.proof_id(n int) returns uuid language sql immutable as
$$select ('fe101234-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create temporary table proof_results(label text primary key,passed boolean not null,evidence jsonb);
create function pg_temp.proof_check(p_label text,p_ok boolean,p_evidence jsonb default '{}')
returns void language plpgsql as $$begin
 if p_ok is distinct from true then raise exception 'proof regression failed: % %',p_label,p_evidence;end if;
 insert into pg_temp.proof_results values(p_label,true,p_evidence);
end$$;

-- BEGIN VALIDATION PROOF LIFECYCLE: exact artifacts without transaction wrappers.
create function pg_temp.proof_migration_sql(direction text) returns text language sql immutable as $artifact$
 select case direction when 'forward' then $proof_forward$do $guard$
begin
 if exists(select 1 from (values ('dashboard_private.validate_timetable_operating_reference_v1','5f577a02f6ee20daf14284c62e4ded05'),('dashboard_private.past_lesson_state_correction_allows_blocker_v1','d1b741e9f2caa539d5febfd6891eb63d'),('dashboard_private.timetable_blocker_intersects_v2','6261b24d63f544b1f30f0cd9bfc057df'),('dashboard_private.timetable_occupancy_key_v1','5c3f4066cda815039cf897fbf695076c'),('dashboard_private.timetable_intersects_v1','f3d5e7c63936a6d7354431f9715d2327'),('dashboard_private.agent_require_admin_v1','372cbd99fa9a001dbf90de892c078d43'),('dashboard_private.timetable_effective_workset_date_v1','caa986ad9b43c567d3d4e27c76c6b583'),('dashboard_private.timetable_validation_workset_values_v1','551a6506f0769ec101b2055d95b8eeba'),('dashboard_private.read_timetable_operating_reference_v1','297fe1400b5313adbd978ea859d98fbb'),('dashboard_private.project_class_close_occupancy_v1','011f164b3465bd7bb903fb62f95997b0'),('dashboard_private.academic_class_status_v1','d9afd1267fe111574d8f433f5efa5c25'),('dashboard_private.resolve_legacy_effective_schedule_v1','56506911c07f4bededbb29ae388aedd8'),('dashboard_private.legacy_effective_input_v1','a7960493a119d3f40c6f7e8d569b6337'),('dashboard_private.legacy_effective_binding_v1','1faeef82f1f56913253e54648e805cb1'),('dashboard_private.legacy_effective_context_v1','543848851efa970fad481397db52c402'),('dashboard_private.makeup_legacy_adoption_current_v1','6566ec0f52e38ecea8aa4d63fd4cc7e9'),('dashboard_private.makeup_legacy_adoption_plan_v1','b9d10c2c5e9de854f44ce8a3d4061e35'),('dashboard_private.makeup_legacy_pair_v1','c73f03d09adb2972604eb5fb558a611f'),('public.makeup_numbered_source_instant_v1','2005e5a234562fc1fe7cdbd72fe597ed'),('public.makeup_numbered_instant_v1','4bdbb27535c30fdcfb015956a3cbbfdd'),('public.makeup_numbered_slots_v1','06eb940609077b67f26b5f5452148a45'),('public.makeup_numbered_trim_v1','10e8b7c97d8dffc5452239b0cfa0ff14'),('dashboard_private.makeup_approval_event_meta_v1','efe79d7156af12e2c989e4aad4c9e073'),('dashboard_private.read_timetable_class_weekly_v2','58bed6a653e686b2cb49ee749c0da3ea'),('dashboard_private.read_timetable_weekly_reference_v1','8db71b2ab9ebbd275ab760a05ee616ff'),('dashboard_private.timetable_validation_actor_context_v1','edbdbf1cd4e2114d3ab694149f3857dc'),('public.current_dashboard_role','fd33ff4ac4309ca0f2bf2edd976894b1')) e(identity,body_md5)
  where (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname||'.'||p.proname=e.identity and md5(p.prosrc)=e.body_md5)<>1)
 then raise exception 'close_validation_proof_definition_drift' using errcode='55000';end if;
 if exists(select 1 from (values ('dashboard_private.validate_timetable_operating_reference_v1','plpgsql','v',true,false,'u',100,0,array['search_path=']),('dashboard_private.past_lesson_state_correction_allows_blocker_v1','plpgsql','s',true,false,'u',100,0,array['search_path=']),('dashboard_private.timetable_blocker_intersects_v2','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.timetable_occupancy_key_v1','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.timetable_intersects_v1','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.agent_require_admin_v1','plpgsql','s',true,false,'u',100,0,array['search_path=']),('dashboard_private.timetable_effective_workset_date_v1','sql','s',false,false,'u',100,1000,array['search_path=']),('dashboard_private.timetable_validation_workset_values_v1','sql','i',false,true,'s',1,100,array['search_path=']),('dashboard_private.read_timetable_operating_reference_v1','plpgsql','s',true,false,'u',100,0,array['search_path=']),('dashboard_private.project_class_close_occupancy_v1','plpgsql','s',true,false,'u',100,0,array['search_path=']),('dashboard_private.academic_class_status_v1','sql','s',false,false,'u',100,0,array['search_path=']),('dashboard_private.resolve_legacy_effective_schedule_v1','plpgsql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.legacy_effective_input_v1','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.legacy_effective_binding_v1','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.legacy_effective_context_v1','plpgsql','s',false,false,'u',100,0,array['search_path=']),('dashboard_private.makeup_legacy_adoption_current_v1','plpgsql','s',false,false,'u',100,0,array['search_path=']),('dashboard_private.makeup_legacy_adoption_plan_v1','plpgsql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.makeup_legacy_pair_v1','plpgsql','i',false,false,'u',100,0,array['search_path=']),('public.makeup_numbered_source_instant_v1','sql','i',false,false,'u',100,0,array['search_path=']),('public.makeup_numbered_instant_v1','plpgsql','i',false,false,'u',100,0,array['search_path=','TimeZone=UTC']),('public.makeup_numbered_slots_v1','plpgsql','i',false,false,'u',100,0,array['search_path=']),('public.makeup_numbered_trim_v1','sql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.makeup_approval_event_meta_v1','plpgsql','i',false,false,'u',100,0,array['search_path=']),('dashboard_private.read_timetable_class_weekly_v2','plpgsql','s',false,false,'u',100,0,array['search_path=']),('dashboard_private.read_timetable_weekly_reference_v1','plpgsql','s',true,false,'u',100,0,array['search_path=']),('dashboard_private.timetable_validation_actor_context_v1','sql','s',true,false,'u',100,0,array['search_path=']),('public.current_dashboard_role','sql','s',true,false,'u',100,0,array['search_path=public'])) e(identity,language,volatility,definer,strict,parallel,cost,rows,config)
  join pg_catalog.pg_proc p on p.oid=(select q.oid from pg_catalog.pg_proc q join pg_catalog.pg_namespace n on n.oid=q.pronamespace
   where n.nspname||'.'||q.proname=e.identity limit 1)
  join pg_catalog.pg_language l on l.oid=p.prolang
  where p.proowner<>'postgres'::regrole or l.lanname<>e.language
   or p.provolatile::text<>e.volatility or p.prosecdef<>e.definer or p.proisstrict<>e.strict
   or p.proparallel::text<>e.parallel or p.procost<>e.cost or p.prorows<>e.rows or p.proleakproof
   or array(select replace(setting,'"','') from unnest(p.proconfig) setting) is distinct from e.config)
 then raise exception 'close_validation_proof_dependency_boundary_drift' using errcode='55000';end if;
 if exists(select 1 from pg_catalog.pg_proc p
  where p.oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure
   and (not p.prosecdef or p.provolatile<>'v' or p.proisstrict
    or p.proconfig is null or cardinality(p.proconfig)<>1
    or not(p.proconfig[1]=any(array['search_path=','search_path=""']))
    or p.proowner<>'postgres'::regrole
    or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee<>p.proowner)))
 then raise exception 'close_validation_proof_boundary_drift' using errcode='55000';end if;
end $guard$;

create table dashboard_private.timetable_validation_reuse_proofs(
 transaction_id bigint primary key references dashboard_private.timetable_operating_write_baselines(transaction_id) on delete cascade,
 baseline_hash bytea not null,input_token jsonb not null,reference jsonb not null
);
create table dashboard_private.timetable_validation_reuse_contracts(
 object_kind text not null,object_oid oid not null,fingerprint bytea not null,
 primary key(object_kind,object_oid),check(object_kind in('function','relation','owner'))
);
alter table dashboard_private.timetable_validation_reuse_proofs enable row level security;
alter table dashboard_private.timetable_validation_reuse_contracts enable row level security;
alter table dashboard_private.timetable_validation_reuse_proofs owner to postgres;
alter table dashboard_private.timetable_validation_reuse_contracts owner to postgres;
revoke all on dashboard_private.timetable_validation_reuse_proofs,dashboard_private.timetable_validation_reuse_contracts from public,anon,authenticated,service_role;

create function dashboard_private.timetable_close_validation_input_v1(p_baseline jsonb)
returns jsonb language plpgsql stable set search_path='' as $input$
declare result jsonb;
begin
 -- Existing past-correction checks depend on clock_timestamp, and must always
 -- run afresh. Ordinary saves and already-closed classes also use the old path.
 if exists(select 1 from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current())
 or not exists(select 1 from public.classes c
   where c.status='종강' and c.closed_at=transaction_timestamp()
    and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_baseline->'shadowClasses')='array'
      then p_baseline->'shadowClasses' else '[]'::jsonb end) b where b->>'id'=c.id::text))
 then return null;end if;
 -- Only the reviewed privileged validator execution can use this optimization.
 -- A changed owner/ACL/RLS/function boundary falls back inside that same original
 -- validator, never through a second SECURITY DEFINER copy of its body.
 if not exists(select 1 from pg_catalog.pg_roles r
   join pg_catalog.pg_proc p on p.proowner=r.oid
   where p.oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure
    and r.rolname=current_user and (r.rolsuper or r.rolbypassrls))
 or exists(select 1 from dashboard_private.timetable_validation_reuse_contracts c
   left join pg_catalog.pg_proc p on p.oid=c.object_oid
   where c.object_kind='function' and c.fingerprint is distinct from sha256(convert_to(to_jsonb(p)::text,'UTF8')))
 or exists(select 1 from dashboard_private.timetable_validation_reuse_contracts c
   left join pg_catalog.pg_roles r on r.oid=c.object_oid
   where c.object_kind='owner' and c.fingerprint is distinct from sha256(convert_to(jsonb_build_array(r.rolsuper,r.rolinherit,r.rolbypassrls)::text,'UTF8')))
 or exists(select 1 from dashboard_private.timetable_validation_reuse_contracts c
   left join pg_catalog.pg_class r on r.oid=c.object_oid
   where c.object_kind='relation' and c.fingerprint is distinct from sha256(convert_to(jsonb_build_object('relation',to_jsonb(r)-array['relfilenode','relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'],
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=r.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_catalog.pg_policy p where p.polrelid=r.oid),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by i.indexrelid),'[]') from pg_catalog.pg_index i where i.indrelid=r.oid))::text,'UTF8')))
 then return null;end if;
 select jsonb_build_object(
  'snapshot',pg_current_snapshot()::text,'actor',dashboard_private.timetable_validation_actor_context_v1(),
  'sessionUser',session_user,
  'settings',(select jsonb_object_agg(k,current_setting(k,true)) from unnest(array['role','row_security','TimeZone','DateStyle','IntervalStyle','extra_float_digits','lc_time','client_encoding','standard_conforming_strings','enable_seqscan','enable_indexscan','enable_indexonlyscan','enable_bitmapscan','enable_sort','enable_incremental_sort','enable_hashagg','enable_hashjoin','enable_mergejoin','enable_nestloop','enable_material','enable_memoize','enable_partition_pruning','enable_partitionwise_join','enable_partitionwise_aggregate','enable_parallel_append','enable_parallel_hash','enable_gathermerge','max_parallel_workers_per_gather','work_mem','hash_mem_multiplier','plan_cache_mode','geqo','geqo_threshold','geqo_effort','geqo_seed','join_collapse_limit','from_collapse_limit','cursor_tuple_fraction','random_page_cost','seq_page_cost','cpu_tuple_cost','cpu_index_tuple_cost','cpu_operator_cost','effective_cache_size','jit']) k),
  -- MVCC tuple identity observes untracked request/calendar/catalog changes,
  -- including an equal-valued UPDATE. Classes use all values in stable ID order
  -- so the gateway's unchanged residual UPDATE does not force recomputation.
  'sources',encode(sha256(convert_to(jsonb_build_object('classes',(select sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text,'[]'),'UTF8')) from public.classes c),
   'public.class_schedule_slots',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.class_schedule_slots t),
   'public.class_lesson_sessions',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.class_lesson_sessions t),
   'public.teacher_catalogs',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.teacher_catalogs t),
   'public.classroom_catalogs',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.classroom_catalogs t),
   'public.makeup_requests',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.makeup_requests t),
   'public.makeup_request_events',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.makeup_request_events t),
   'public.academic_events',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.academic_events t),
   'dashboard_private.timetable_plan_transfers',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from dashboard_private.timetable_plan_transfers t),
   'public.profiles',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from public.profiles t),
   'auth.users',(select coalesce(jsonb_agg(jsonb_build_array(t.tableoid,t.ctid::text,t.xmin::text,t.cmin::text) order by t.tableoid,t.ctid),'[]') from auth.users t where t.id=auth.uid()))::text,'UTF8')),'hex'),
  -- Planning metadata is live, not permanently pinned. ANALYZE/rewrites within
  -- a transaction invalidate a proof without disabling later clean transactions.
  'planning',(select jsonb_agg(jsonb_build_array(r.oid,r.relfilenode,r.relpages,r.reltuples,r.relallvisible) order by r.oid)
    from pg_catalog.pg_class r where r.oid=any(array['public.classes'::regclass,'public.class_schedule_slots'::regclass,'public.class_lesson_sessions'::regclass,'public.teacher_catalogs'::regclass,'public.classroom_catalogs'::regclass,'public.makeup_requests'::regclass,'public.makeup_request_events'::regclass,'public.academic_events'::regclass,'dashboard_private.timetable_plan_transfers'::regclass,'public.profiles'::regclass,'auth.users'::regclass])),
  'statistics',(select coalesce(jsonb_agg(jsonb_build_array(s.starelid,s.staattnum,s.stainherit,s.ctid::text,s.xmin::text,s.cmin::text)
    order by s.starelid,s.staattnum,s.stainherit),'[]') from pg_catalog.pg_statistic s where s.starelid=any(array['public.classes'::regclass,'public.class_schedule_slots'::regclass,'public.class_lesson_sessions'::regclass,'public.teacher_catalogs'::regclass,'public.classroom_catalogs'::regclass,'public.makeup_requests'::regclass,'public.makeup_request_events'::regclass,'public.academic_events'::regclass,'dashboard_private.timetable_plan_transfers'::regclass,'public.profiles'::regclass,'auth.users'::regclass]))
 ) into result;
 if result->'actor'='null'::jsonb then return null;end if;
 return result;
exception
 when serialization_failure or deadlock_detected or query_canceled then raise;
 when others then
  -- Optional proof access must not replace the original permission/type error.
  -- The unchanged validator will execute with its actual current privileges.
  return null;
end $input$;

create function dashboard_private.remember_timetable_close_validation_v1(
 p_baseline jsonb,p_baseline_hash bytea,p_input_token jsonb,p_reference jsonb)
returns void language plpgsql set search_path='' as $remember$
begin
 if p_input_token is null or p_reference is null then return;end if;
 if p_input_token=dashboard_private.timetable_close_validation_input_v1(p_baseline)
 and exists(select 1 from dashboard_private.timetable_operating_write_baselines b
   where b.transaction_id=txid_current() and sha256(convert_to(b.reference::text,'UTF8'))=p_baseline_hash) then
  insert into dashboard_private.timetable_validation_reuse_proofs(transaction_id,baseline_hash,input_token,reference)
  values(txid_current(),p_baseline_hash,p_input_token,p_reference)
  on conflict(transaction_id) do update set baseline_hash=excluded.baseline_hash,
   input_token=excluded.input_token,reference=excluded.reference;
 end if;
exception
 when serialization_failure or deadlock_detected or query_canceled then raise;
 when others then return;
end $remember$;

do $install$
declare c pg_catalog.pg_proc; saved_metadata jsonb; actual_metadata jsonb; definition text;
 candidate_body text := $candidate$
declare skip_unchanged_days boolean:=false; comparison_cutoff date:=(now() at time zone 'Asia/Seoul')::date;
 changed_weekdays integer[]; changed_dated_dates date[]; old_weekly_keys jsonb[]; reuse_weekly_keys boolean:=false; weekly_key_exists boolean;

 -- Private proof only for a close performed in this transaction. The complete
 -- original validator below remains the fallback on every input/contract change.
 proof_token jsonb; proof_baseline_hash bytea; proof_reference jsonb;
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
 if current_user='postgres' then
  proof_token:=dashboard_private.timetable_close_validation_input_v1(oldref);
 end if;
 if proof_token is not null then
  proof_baseline_hash:=sha256(convert_to(oldref::text,'UTF8'));
  select p.reference into proof_reference
  from dashboard_private.timetable_validation_reuse_proofs p
  where p.transaction_id=txid_current() and p.baseline_hash=proof_baseline_hash
    and p.input_token=proof_token;
  if found then return proof_reference;end if;
 end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then if proof_token is not null then perform dashboard_private.remember_timetable_close_validation_v1(oldref,proof_baseline_hash,proof_token,newref);end if; return newref;end if;
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
   with old_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(old_workset)
   ), new_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(new_workset)
   )
   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select raw_dated,dt from old_raw_dated
          except all select raw_dated,dt from new_raw_dated)
         union all
         (select raw_dated,dt from new_raw_dated
          except all select raw_dated,dt from old_raw_dated)) changed_dated;
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
if proof_token is not null then perform dashboard_private.remember_timetable_close_validation_v1(oldref,proof_baseline_hash,proof_token,newref);end if; return newref;
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
end $candidate$;
begin
 select * into c from pg_catalog.pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure;
 if md5(c.prosrc) is distinct from '5f577a02f6ee20daf14284c62e4ded05' or md5(candidate_body) is distinct from '4c8050293e2dbb8cb9ff0a7ae93a413e'
 then raise exception 'close_validation_proof_definition_drift' using errcode='55000';end if;
 definition:=pg_catalog.pg_get_functiondef(c.oid);
 if length(definition)-length(replace(definition,c.prosrc,''))<>length(c.prosrc)
 then raise exception 'close_validation_proof_definition_drift' using errcode='55000';end if;
 saved_metadata:=to_jsonb(c)-'prosrc'-'prosqlbody';
 execute replace(definition,c.prosrc,candidate_body);
 select to_jsonb(p)-'prosrc'-'prosqlbody' into actual_metadata from pg_catalog.pg_proc p where p.oid=c.oid;
 if actual_metadata is distinct from saved_metadata
 then raise exception 'close_validation_proof_metadata_drift' using errcode='55000';end if;
end $install$;
alter function dashboard_private.timetable_close_validation_input_v1(jsonb) owner to postgres;
alter function dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb) owner to postgres;
revoke all on function dashboard_private.timetable_close_validation_input_v1(jsonb),
 dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Pin the installed source and execution boundary, including the new proof
-- helpers. Future source/ACL/owner changes fail closed to fresh validation.
insert into dashboard_private.timetable_validation_reuse_contracts
 select 'function',p.oid,sha256(convert_to(to_jsonb(p)::text,'UTF8'))
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname||'.'||p.proname=any(array['dashboard_private.validate_timetable_operating_reference_v1','dashboard_private.past_lesson_state_correction_allows_blocker_v1','dashboard_private.timetable_blocker_intersects_v2','dashboard_private.timetable_occupancy_key_v1','dashboard_private.timetable_intersects_v1','dashboard_private.agent_require_admin_v1','auth.uid','dashboard_private.timetable_effective_workset_date_v1','dashboard_private.timetable_validation_workset_values_v1','dashboard_private.read_timetable_operating_reference_v1','dashboard_private.project_class_close_occupancy_v1','dashboard_private.academic_class_status_v1','dashboard_private.resolve_legacy_effective_schedule_v1','dashboard_private.legacy_effective_input_v1','dashboard_private.legacy_effective_binding_v1','dashboard_private.legacy_effective_context_v1','dashboard_private.makeup_legacy_adoption_current_v1','dashboard_private.makeup_legacy_adoption_plan_v1','dashboard_private.makeup_legacy_pair_v1','public.makeup_numbered_source_instant_v1','public.makeup_numbered_instant_v1','public.makeup_numbered_slots_v1','public.makeup_numbered_trim_v1','dashboard_private.makeup_approval_event_meta_v1','dashboard_private.read_timetable_class_weekly_v2','dashboard_private.read_timetable_weekly_reference_v1','dashboard_private.timetable_validation_actor_context_v1','public.current_dashboard_role','dashboard_private.timetable_validation_actor_context_v1','public.current_dashboard_role','dashboard_private.timetable_close_validation_input_v1','dashboard_private.remember_timetable_close_validation_v1']);
insert into dashboard_private.timetable_validation_reuse_contracts
 select distinct 'owner',r.oid,sha256(convert_to(jsonb_build_array(r.rolsuper,r.rolinherit,r.rolbypassrls)::text,'UTF8'))
 from pg_catalog.pg_roles r join pg_catalog.pg_proc p on p.proowner=r.oid
 join dashboard_private.timetable_validation_reuse_contracts c on c.object_kind='function' and c.object_oid=p.oid;
insert into dashboard_private.timetable_validation_reuse_contracts
 select 'relation',r.oid,sha256(convert_to(jsonb_build_object('relation',to_jsonb(r)-array['relfilenode','relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'],
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=r.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_catalog.pg_policy p where p.polrelid=r.oid),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by i.indexrelid),'[]') from pg_catalog.pg_index i where i.indrelid=r.oid))::text,'UTF8'))
 from pg_catalog.pg_class r where r.oid=any(array['public.classes'::regclass,'public.class_schedule_slots'::regclass,'public.class_lesson_sessions'::regclass,'public.teacher_catalogs'::regclass,'public.classroom_catalogs'::regclass,'public.makeup_requests'::regclass,'public.makeup_request_events'::regclass,'public.academic_events'::regclass,'dashboard_private.timetable_plan_transfers'::regclass,'public.profiles'::regclass,'auth.users'::regclass,'dashboard_private.timetable_validation_reuse_proofs'::regclass,'dashboard_private.timetable_validation_reuse_contracts'::regclass]);$proof_forward$
 when 'rollback' then $proof_rollback$do $recover$
declare c pg_catalog.pg_proc; metadata_before jsonb; definition text;
 original_body text := $original$
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
   with old_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(old_workset)
   ), new_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(new_workset)
   )
   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select raw_dated,dt from old_raw_dated
          except all select raw_dated,dt from new_raw_dated)
         union all
         (select raw_dated,dt from new_raw_dated
          except all select raw_dated,dt from old_raw_dated)) changed_dated;
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
end $original$;
begin
 select * into c from pg_catalog.pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure;
 if md5(c.prosrc) is distinct from '4c8050293e2dbb8cb9ff0a7ae93a413e' or md5(original_body) is distinct from '5f577a02f6ee20daf14284c62e4ded05'
 or (select count(*) from dashboard_private.timetable_validation_reuse_contracts saved
  where saved.object_kind='function' and saved.object_oid in(c.oid,
   'dashboard_private.timetable_close_validation_input_v1(jsonb)'::regprocedure,
   'dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb)'::regprocedure))<>3
 or exists(select 1 from dashboard_private.timetable_validation_reuse_contracts saved
  left join pg_catalog.pg_proc p on p.oid=saved.object_oid
  where saved.object_kind='function' and p.oid in(c.oid,
   'dashboard_private.timetable_close_validation_input_v1(jsonb)'::regprocedure,
   'dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb)'::regprocedure)
   and saved.fingerprint is distinct from sha256(convert_to(to_jsonb(p)::text,'UTF8')))
 or exists(select 1 from dashboard_private.timetable_validation_reuse_contracts saved
  left join pg_catalog.pg_class r on r.oid=saved.object_oid
  where saved.object_kind='relation' and saved.object_oid in(
   'dashboard_private.timetable_validation_reuse_proofs'::regclass,
   'dashboard_private.timetable_validation_reuse_contracts'::regclass)
   and saved.fingerprint is distinct from sha256(convert_to(jsonb_build_object('relation',to_jsonb(r)-array['relfilenode','relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'],
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=r.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_catalog.pg_policy p where p.polrelid=r.oid),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by i.indexrelid),'[]') from pg_catalog.pg_index i where i.indrelid=r.oid))::text,'UTF8')))
 then raise exception 'close_validation_proof_recovery_drift' using errcode='55000';end if;
 metadata_before:=to_jsonb(c)-'prosrc'-'prosqlbody';definition:=pg_catalog.pg_get_functiondef(c.oid);
 if length(definition)-length(replace(definition,c.prosrc,''))<>length(c.prosrc)
 then raise exception 'close_validation_proof_recovery_drift' using errcode='55000';end if;
 execute replace(definition,c.prosrc,original_body);
 if (select to_jsonb(p)-'prosrc'-'prosqlbody' from pg_catalog.pg_proc p where p.oid=c.oid) is distinct from metadata_before
 then raise exception 'close_validation_proof_recovery_metadata_drift' using errcode='55000';end if;
end $recover$;
drop function dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb);
drop function dashboard_private.timetable_close_validation_input_v1(jsonb);
drop table dashboard_private.timetable_validation_reuse_proofs;
drop table dashboard_private.timetable_validation_reuse_contracts;$proof_rollback$ end
$artifact$;
create function pg_temp.proof_registry() returns jsonb language sql stable as $$
 select jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p)-'oid')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','dashboard_private')
$$;
create function pg_temp.proof_migration_capture(p_sql text) returns jsonb language plpgsql as $$
declare s text:='00000';m text;
begin
 begin execute p_sql;exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text;end;
 return jsonb_build_object('sqlstate',s,'message',m);
end$$;
create function pg_temp.proof_lifecycle(p_label text,p_mutation text,p_direction text,p_message text)
returns void language plpgsql as $$
declare answer jsonb;saved jsonb;
begin
 begin
  if p_mutation<>'' then execute p_mutation;end if;
  saved:=pg_temp.proof_registry();answer:=pg_temp.proof_migration_capture(pg_temp.proof_migration_sql(p_direction));
  if answer is distinct from jsonb_build_object('sqlstate','55000','message',p_message)
   or pg_temp.proof_registry() is distinct from saved then raise exception 'lifecycle mismatch % %',p_label,answer;end if;
  raise exception using errcode='ZP001';
 exception when sqlstate 'ZP001' then null;end;
 perform pg_temp.proof_check(p_label,true,answer||jsonb_build_object('expectedState','55000'));
end$$;
select pg_temp.proof_lifecycle('reapplication is rejected atomically','','forward','close_validation_proof_definition_drift');
select pg_temp.proof_lifecycle('recovery rejects function attribute drift',
 'alter function dashboard_private.validate_timetable_operating_reference_v1() cost 99','rollback','close_validation_proof_recovery_drift');
select pg_temp.proof_lifecycle('recovery rejects missing root contract',
 $$delete from dashboard_private.timetable_validation_reuse_contracts where object_kind='function' and object_oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure$$,
 'rollback','close_validation_proof_recovery_drift');
select pg_temp.proof_lifecycle('recovery rejects changed proof table',
 'alter table dashboard_private.timetable_validation_reuse_proofs add column synthetic_unreviewed text','rollback','close_validation_proof_recovery_drift');
do $roundtrip$
declare saved jsonb;answer jsonb;
begin
 saved:=pg_temp.proof_registry();
 answer:=pg_temp.proof_migration_capture(pg_temp.proof_migration_sql('rollback'));
 if answer->>'sqlstate'<>'00000'
 or md5((select prosrc from pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure))<>'5f577a02f6ee20daf14284c62e4ded05'
 then raise exception 'recovery roundtrip failed %',answer;end if;
 perform pg_temp.proof_check('guarded recovery restores exact original body',true);
 perform pg_temp.proof_lifecycle('forward rejects dependency attribute drift',
 'alter function dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb) cost 99','forward','close_validation_proof_dependency_boundary_drift');
 perform pg_temp.proof_lifecycle('forward rejects dependency owner drift',
 'grant create on schema dashboard_private to service_role;alter function dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb) owner to service_role;revoke create on schema dashboard_private from service_role',
 'forward','close_validation_proof_dependency_boundary_drift');
 answer:=pg_temp.proof_migration_capture(pg_temp.proof_migration_sql('forward'));
 if answer->>'sqlstate'<>'00000' or pg_temp.proof_registry() is distinct from saved
 then raise exception 'forward roundtrip changed existing metadata %',answer;end if;
 perform pg_temp.proof_check('roundtrip preserves all function attributes and ACLs',true);
end $roundtrip$;
-- END VALIDATION PROOF LIFECYCLE

-- Synthetic fixture preparation only. Measured writer and validator calls use
-- origin mode, original application triggers, and the final migration body.
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.proof_id(901),'authenticated','authenticated','close-proof-admin@test.invalid','{}','{}');
insert into public.profiles(id,role,name) values(pg_temp.proof_id(901),'admin','Synthetic proof administrator')
on conflict(id) do update set role='admin';
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,1) on conflict(singleton) do update set version=1;
insert into public.class_schedule_sync_groups(id,name,is_default)
select pg_temp.proof_id(902),'Synthetic proof default',true
where not exists(select 1 from public.class_schedule_sync_groups where is_default);
insert into public.teacher_catalogs(id,name,subjects)
select pg_temp.proof_id(100+n),'Proof teacher '||n,array['영어'] from generate_series(1,3) n;
insert into public.classroom_catalogs(id,name,subjects)
select pg_temp.proof_id(200+n),'Proof room '||n,array['영어'] from generate_series(1,3) n;
insert into public.classes(id,name,subject,class_type,grade,teacher,room,schedule,status,
 capacity,fee,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.proof_id(n),'Proof class '||n,'영어','정규','중1','Proof teacher '||n,'Proof room '||n,
 '월 09:00-10:00','수강',12,100000,'[]','[]','[]','{}','[]',case when n=3 then 'normalized' else 'legacy' end,
 jsonb_build_object('sessions',case when n=3 then '[]'::jsonb else jsonb_build_array(
 jsonb_build_object('id','proof-active-'||n,'date','2050-01-03','state','active','scheduleState','active',
 'startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.proof_id(100+n),'classroomCatalogId',pg_temp.proof_id(200+n)),
 jsonb_build_object('id','proof-makeup-'||n,'date','2050-01-04','state','makeup','scheduleState','makeup',
 'startTime','14:00','endTime','15:00','teacherCatalogId',pg_temp.proof_id(100+n),'classroomCatalogId',pg_temp.proof_id(200+n))) end)
from generate_series(1,3) n;
insert into public.class_schedule_sync_group_members(group_id,class_id)
select g.id,pg_temp.proof_id(n) from public.class_schedule_sync_groups g cross join generate_series(1,3) n where g.is_default;
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name)
values(pg_temp.proof_id(301),pg_temp.proof_id(3),1,'09:00','10:00',pg_temp.proof_id(103),'Proof teacher 3',pg_temp.proof_id(203),'Proof room 3');
insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,teacher_name_snapshot,classroom_name_snapshot,origin)
values(pg_temp.proof_id(302),pg_temp.proof_id(3),'proof-normalized',pg_temp.proof_id(301),'2050-01-03','active','09:00','10:00',
 pg_temp.proof_id(103),pg_temp.proof_id(203),'Proof teacher 3','Proof room 3','default');
insert into public.makeup_requests(id,class_id,status,subject,approval_group,class_name,teacher_catalog_id,cancel_date,
 makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.proof_id(401),pg_temp.proof_id(2),'completed','영어','english','Proof class 2',pg_temp.proof_id(102),'2050-01-03',
 '2050-01-04 14:00+09','2050-01-04 15:00+09','Proof room 2',
 '[{"startAt":"2050-01-04T05:00:00.000Z","endAt":"2050-01-04T06:00:00.000Z","classroom":"Proof room 2"}]');
insert into public.makeup_request_events(id,request_id,event_type,payload)
values(pg_temp.proof_id(402),pg_temp.proof_id(401),'created','{}');
insert into public.academic_events(id,date,title,note)
values(pg_temp.proof_id(403),'2050-01-01','Synthetic proof calendar','Synthetic only');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub',pg_temp.proof_id(901)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.proof_id(901),'role','authenticated')::text,true);

create function pg_temp.proof_calls() returns bigint language sql volatile as
$$select coalesce(sum(calls),0)::bigint from pg_stat_xact_user_functions
 where funcid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure$$;
create function pg_temp.proof_capture(p_candidate boolean) returns jsonb language plpgsql as $$
declare v jsonb;s text:='00000';m text;d text;
begin
 begin
  if p_candidate then v:=dashboard_private.validate_timetable_operating_reference_v1();
  else v:=pg_temp.proof_original_validate();end if;
 exception when query_canceled or others then get stacked diagnostics s=returned_sqlstate,m=message_text,d=pg_exception_detail;
 end;
 return jsonb_build_object('sqlstate',s,'message',m,'detail',d,'valueText',v::text);
end$$;
create function pg_temp.proof_prime() returns void language plpgsql as $$
declare answer jsonb;
begin
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
 values(txid_current(),dashboard_private.read_timetable_operating_reference_v1());
 -- Isolate proof equivalence from the gateway integration case below.
 set local session_replication_role=replica;
 update public.classes set status='종강',closed_at=transaction_timestamp(),closed_by=pg_temp.proof_id(901)
 where id=pg_temp.proof_id(1);
 set local session_replication_role=origin;
 answer:=pg_temp.proof_capture(true);
 if answer->>'sqlstate'<>'00000'
 or not exists(select 1 from dashboard_private.timetable_validation_reuse_proofs where transaction_id=txid_current())
 then raise exception 'proof setup failed %',answer->>'sqlstate';end if;
end$$;
create function pg_temp.proof_case(p_label text,p_mutation text,p_hit boolean,p_state text default '00000')
returns void language plpgsql as $$
declare candidate jsonb;original jsonb;calls_before bigint;hit boolean;answer jsonb;
begin
 begin
  perform pg_temp.proof_prime();
  set local session_replication_role=replica;
  if p_mutation<>'' then execute p_mutation;end if;
  set local session_replication_role=origin;
  calls_before:=pg_temp.proof_calls();candidate:=pg_temp.proof_capture(true);
  hit:=candidate->>'sqlstate'='00000' and calls_before=pg_temp.proof_calls();
  original:=pg_temp.proof_capture(false);
  if candidate::text is distinct from original::text or hit is distinct from p_hit or candidate->>'sqlstate'<>p_state
  then raise exception 'proof mismatch %: candidate %, original %, hit % expected %',p_label,
   candidate->>'sqlstate',original->>'sqlstate',hit,p_hit;end if;
  answer:=jsonb_build_object('sqlstate',candidate->>'sqlstate','expectedState',p_state,'cacheHit',hit,
   'exactReturnedTextAndErrorEqual',true,'returnedHash',md5(candidate::text));
  raise exception using errcode='ZP001',message='reset_synthetic_case';
 exception when sqlstate 'ZP001' then null;end;
 perform pg_temp.proof_check(p_label,true,answer);
end$$;

select pg_temp.proof_case('unchanged full source','',true,'00000');
select pg_temp.proof_case('unchanged physical class update','update public.classes set name=name',true,'00000');
select pg_temp.proof_case('class metadata changed','update public.classes set name=name||'' changed'' where id=pg_temp.proof_id(2)',false,'00000');
select pg_temp.proof_case('class content changed','update public.classes set schedule_plan=jsonb_set(schedule_plan,''{sessions,0,content}'',''"changed synthetic content"'') where id=pg_temp.proof_id(2)',false,'00000');
select pg_temp.proof_case('malformed session container','update public.classes set schedule_plan=jsonb_set(schedule_plan,''{sessions}'',''null''::jsonb) where id=pg_temp.proof_id(2)',false,'23P01');
select pg_temp.proof_case('invalid date row','update public.classes set schedule_plan=jsonb_set(schedule_plan,''{sessions,0,date}'',''"invalid"'') where id=pg_temp.proof_id(2)',false,'23P01');
select pg_temp.proof_case('missing optional plan','update public.classes set schedule_plan=null where id=pg_temp.proof_id(2)',false,'00000');
select pg_temp.proof_case('request tuple changed','update public.makeup_requests set reason=''new synthetic reason''',false,'00000');
select pg_temp.proof_case('request event tuple changed','update public.makeup_request_events set payload=payload',false,'00000');
select pg_temp.proof_case('calendar tuple changed','update public.academic_events set note=note||'' ''',false,'00000');
select pg_temp.proof_case('teacher catalog changed','update public.teacher_catalogs set is_visible=not is_visible where id=pg_temp.proof_id(102)',false,'00000');
select pg_temp.proof_case('room catalog changed','update public.classroom_catalogs set subjects=array[''영어'',''수학''] where id=pg_temp.proof_id(202)',false,'00000');
select pg_temp.proof_case('weekly slot inserted','insert into public.class_schedule_slots(class_id,weekday,start_time,end_time) values(pg_temp.proof_id(1),1,''09:00'',''10:00'')',false,'00000');
select pg_temp.proof_case('normalized source row inserted','insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,origin) values(pg_temp.proof_id(1),''synthetic-probe'',''2050-01-01'',''tbd'',''manual'')',false,'00000');
select pg_temp.proof_case('transfer source changed','insert into dashboard_private.timetable_plan_transfers(request_key,actor_id,selected_mapping) values(''synthetic-probe'',pg_temp.proof_id(901),''[]'')',false,'00000');
select pg_temp.proof_case('profile tuple changed','update public.profiles set name=''Synthetic changed actor'' where id=pg_temp.proof_id(901)',false,'00000');
select pg_temp.proof_case('account tuple changed','update auth.users set raw_user_meta_data=''{"test":true}'' where id=pg_temp.proof_id(901)',false,'00000');
select pg_temp.proof_case('actor identity changed','select set_config(''request.jwt.claim.sub'',pg_temp.proof_id(9999)::text,true)',false,'00000');
select pg_temp.proof_case('timezone changed','set local timezone=''UTC''',false,'00000');
select pg_temp.proof_case('datestyle changed','set local datestyle=''ISO, DMY''',false,'00000');
select pg_temp.proof_case('close context changed','select set_config(''app.class_close_mutation'',''different-context'',true)',false,'00000');
select pg_temp.proof_case('schedule context changed','select set_config(''app.class_schedule_mutation'',''different-context'',true)',false,'00000');
select pg_temp.proof_case('baseline changed','update dashboard_private.timetable_operating_write_baselines set reference=jsonb_set(reference,''{shadowFingerprint}'',''"different-baseline"'') where transaction_id=txid_current()',false,'00000');
select pg_temp.proof_case('source function definition drift','create or replace function public.makeup_numbered_trim_v1(value text) returns text language sql immutable as ''select btrim($1)''',false,'00000');
select pg_temp.proof_case('source function attributes drift','alter function public.makeup_numbered_trim_v1(text) cost 99',false,'00000');
select pg_temp.proof_case('source function ACL drift','grant execute on function dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb) to anon',false,'00000');
select pg_temp.proof_case('proof table ACL drift falls back','grant select on dashboard_private.timetable_validation_reuse_proofs to anon',false,'00000');
select pg_temp.proof_case('proof table definition drift falls back','alter table dashboard_private.timetable_validation_reuse_proofs add column synthetic_probe text',false,'00000');
select pg_temp.proof_case('later normalized overlap still conflicts','update public.class_schedule_slots set teacher_catalog_id=pg_temp.proof_id(102),classroom_catalog_id=pg_temp.proof_id(202) where id=pg_temp.proof_id(301)',false,'23P01');
select pg_temp.proof_case('planner setting changed','set local enable_seqscan=off',false,'00000');
select pg_temp.proof_case('RLS policy changed','create policy synthetic_proof_policy on public.classes for select using(true)',false,'00000');
select pg_temp.proof_case('root COST drift','alter function dashboard_private.validate_timetable_operating_reference_v1() cost 99',false,'00000');
-- Ownership transfer requires CREATE on both schemas even for a BYPASSRLS
-- database owner. Grant only inside this rolled-back synthetic case and revoke
-- before evaluating either validator; no application privilege remains relaxed.
select pg_temp.proof_case('root owner drift preserves permission error',format(
 'grant create on schema dashboard_private,%I to service_role;alter function dashboard_private.validate_timetable_operating_reference_v1() owner to service_role;alter function pg_temp.proof_original_validate() owner to service_role;revoke create on schema dashboard_private,%I from service_role',
 pg_my_temp_schema()::regnamespace::text,pg_my_temp_schema()::regnamespace::text),false,'42501');
select pg_temp.proof_case('past correction requires fresh validation','insert into dashboard_private.past_lesson_state_correction_contexts(transaction_id,actor_profile_id,class_id,lesson_id,session_date,corrected_plan,target_occupancy,reviewed_blockers,review_hash) values(txid_current(),pg_temp.proof_id(901),pg_temp.proof_id(2),''unknown'',''2000-01-01'',''{}'',''{}'',''[]'',''synthetic'')',false,'00000');
select pg_temp.proof_case('numeric representation remains exact','update public.classes set schedule_plan=jsonb_set(schedule_plan,''{amount}'',''1.0''::jsonb) where id=pg_temp.proof_id(2)',false,'00000');
select pg_temp.proof_case('reader cancellation propagates','create or replace function dashboard_private.read_timetable_operating_reference_v1() returns jsonb language plpgsql security definer set search_path='''' as $cancel$begin raise exception ''synthetic_cancel'' using errcode=''57014'';end $cancel$',false,'57014');
select pg_temp.proof_case('reader serialization failure propagates','create or replace function dashboard_private.read_timetable_operating_reference_v1() returns jsonb language plpgsql security definer set search_path='''' as $cancel$begin raise exception ''synthetic_serialization'' using errcode=''40001'';end $cancel$',false,'40001');

select pg_temp.proof_check('proof and contract tables remain inaccessible',
 not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
 cross join unnest(array['dashboard_private.timetable_validation_reuse_proofs','dashboard_private.timetable_validation_reuse_contracts']) relation_name
 where has_table_privilege(role_name,relation_name,'SELECT,INSERT,UPDATE,DELETE')));
select pg_temp.proof_check('proof helpers remain inaccessible',
 not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
 cross join unnest(array['dashboard_private.timetable_close_validation_input_v1(jsonb)',
 'dashboard_private.remember_timetable_close_validation_v1(jsonb,bytea,jsonb,jsonb)']) function_name
 where has_function_privilege(role_name,function_name,'EXECUTE')));
select pg_temp.proof_check('proof tables have RLS enabled',
 (select bool_and(relrowsecurity) from pg_class where oid in(
 'dashboard_private.timetable_validation_reuse_proofs'::regclass,'dashboard_private.timetable_validation_reuse_contracts'::regclass)));

do $boundary$
declare a jsonb;b jsonb;n bigint;root_meta jsonb;
begin
 -- No baseline still returns NULL and creates no proof.
 perform pg_temp.proof_check('no baseline remains NULL',dashboard_private.validate_timetable_operating_reference_v1() is null);
 begin
  insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
  values(txid_current(),dashboard_private.read_timetable_operating_reference_v1());
  n:=pg_temp.proof_calls();a:=pg_temp.proof_capture(true);b:=pg_temp.proof_capture(false);
  if a::text is distinct from b::text or pg_temp.proof_calls()<>n+2
   or exists(select 1 from dashboard_private.timetable_validation_reuse_proofs where transaction_id=txid_current())
  then raise exception 'ordinary non-close path changed';end if;
  raise exception using errcode='ZP001';
 exception when sqlstate 'ZP001' then null;end;
 perform pg_temp.proof_check('ordinary saves retain fresh validation',true);
 begin
  perform pg_temp.proof_prime();
  delete from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
  if exists(select 1 from dashboard_private.timetable_validation_reuse_proofs where transaction_id=txid_current())
  then raise exception 'proof escaped baseline lifetime';end if;
  raise exception using errcode='ZP001';
 exception when sqlstate 'ZP001' then null;end;
 perform pg_temp.proof_check('baseline deletion cascades proof removal',true);
end $boundary$;

-- An actual gateway close retains all three validation invocations and both
-- assertions, including the deferred finalizer. Only two full reader calls are
-- needed for the unchanged source state; legacy makeup and normalized rows
-- coexist. Original regression suites cover roster release and rejected writes.
create function pg_temp.proof_gateway_integration() returns void language plpgsql security definer set search_path='' as $gateway$
declare reader_before bigint;validator_before bigint;assert_before bigint;answer jsonb;patch jsonb;evidence jsonb;
begin
 begin
  select jsonb_build_object('name',name,'class_type',class_type,'subject',subject,'subject_area_key',subject_area_key,
   'grade',grade,'teacher',teacher,'room',room,'schedule',schedule,'capacity',capacity,'fee',fee,
   'status','종강','textbook_ids',textbook_ids,'textbook_usage',textbook_usage) into patch from public.classes where id=pg_temp.proof_id(1);
  reader_before:=pg_temp.proof_calls();
  select coalesce(sum(calls),0) into validator_before from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure;
  select coalesce(sum(calls),0) into assert_before from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure;
  answer:=public.update_class_operational_v1(pg_temp.proof_id(1),patch,pg_temp.proof_id(801),null);
  set constraints all immediate;
  evidence:=jsonb_build_object('reads',pg_temp.proof_calls()-reader_before,
   'validations',(select coalesce(sum(calls),0)-validator_before from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure),
   'assertions',(select coalesce(sum(calls),0)-assert_before from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),
   'status',answer#>>'{classRow,status}','receiptStatus',answer#>>'{closeResult,status}',
   'proofs',(select count(*) from dashboard_private.timetable_validation_reuse_proofs where transaction_id=txid_current()));
  if evidence is distinct from '{"reads":2,"validations":3,"assertions":2,"status":"종강","receiptStatus":"종강","proofs":0}'::jsonb
  then raise exception 'gateway boundary mismatch: %',evidence;end if;
  raise exception using errcode='ZP001';
 exception when sqlstate 'ZP001' then null;end;
 perform pg_temp.proof_check('gateway retains assertions and deferred validation',true,evidence);
end $gateway$;
revoke all on function pg_temp.proof_gateway_integration() from public;
grant execute on function pg_temp.proof_gateway_integration() to authenticated;
set local role authenticated;
select pg_temp.proof_gateway_integration();
reset role;

select ok(passed,label) from pg_temp.proof_results order by label;
select is(evidence->>'sqlstate',evidence->>'expectedState',label||': exact SQLSTATE') from pg_temp.proof_results where evidence ? 'expectedState' order by label;
select * from finish();
rollback;
