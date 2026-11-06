-- #234 bounded dated-diff projection reuse diagnostic; no EXPLAIN or large SQL literals.
-- Derived new-candidate input from the preserved validator-phase fixture.
-- Semantic input origin fixture SHA256 00c626ab61bdae13a45e3e548c521178cb457f035df8dd68cb2703c82bfa31d1.
-- This fixture and runner do not read or require that historical artifact.
-- dated_equal_weekly_change means equal dated arrays with a weekly-only change.
-- #234 query-only diagnostic. Install only in a new, task-owned, network-none
-- PostgreSQL database. No product schemas/functions or real data are installed.
-- The runtime verifies every @source region against the two pinned migrations,
-- allowing ONLY dashboard_private -> issue234_dated_diff namespace mapping.
-- Baseline validator migration SHA256:
-- e45ca46ee41fafd1cedce8c6bef74c1c14133f2f2534deb9a49e99ab2970d4e4
-- Workset type/helper migration SHA256:
-- f5df6c1d0494ff8f0d5ad75251e1b3592ee5a14b7a532eb43534413976886559
-- The actual reader, preliminary guards/weekly validation, per-date conflict
-- checks, writer, auth/RLS, and downstream first-conflict DETAIL are unmeasured.
-- This fixture does not rerun the former 45 full-validator assertions or the
-- reader+validator benchmark. Prepared inputs here are wholly synthetic.
-- Enumeration uses the original FOR cursor. Its residual subtracts per-row
-- capture time; it still includes cursor/loop/clock overhead, not pure CPU time.
-- No ORDER BY is added to enumeration. Exact encounter order is reported
-- separately from sorted-set equality and is required for candidate acceptance.
-- The original affected-date producer helpers and cursor SQL are unchanged.
create schema issue234_dated_diff;
revoke all on schema issue234_dated_diff from public;

-- @source row_type
create type issue234_dated_diff.timetable_validation_row_v1 as (
 v jsonb, dt date, source_ordinal bigint, occupancy_key jsonb,
 class_id text, source_slot_id text, row_id text,
 inherited_id text, overridden_id text, state text
);
-- @end-source row_type

-- @source workset_values
create function issue234_dated_diff.timetable_validation_workset_values_v1(
 rows issue234_dated_diff.timetable_validation_row_v1[]
) returns table(value jsonb) language sql immutable strict parallel safe
cost 1 rows 100 set search_path='' as $enumerate$
 select r.v from unnest(rows) r
$enumerate$;
-- @end-source workset_values

create table issue234_dated_diff.input (
 singleton boolean primary key default true check(singleton),
 oldref jsonb, newref jsonb, comparison_cutoff date not null, metadata jsonb not null
);

create function issue234_dated_diff.evaluate(
 oldref jsonb, newref jsonb, comparison_cutoff date, p_variant text
) returns jsonb language plpgsql set search_path='' as $evaluate$
declare
 old_workset issue234_dated_diff.timetable_validation_row_v1[];
 new_workset issue234_dated_diff.timetable_validation_row_v1[];
 old_dates jsonb; new_dates jsonb;
 skip_unchanged_days boolean:=false;
 changed_dated_dates date[]; changed_weekdays integer[];
 d date; encountered date[]:='{}'; sorted_dates date[];
 phase_name text:='variant'; phase_started timestamptz; body_started timestamptz;
 pipeline_started timestamptz:=clock_timestamp();
 enum_total_ms double precision:=0; enum_body_ms double precision:=0;
 phase_ms jsonb:='{"old_prepare":0,"new_prepare":0,"eligibility":0,"dated_diff":0,"weekday_diff":0,"affected_enumeration":0}';
 error_state text; error_message text; error_detail text;
begin
 if p_variant is distinct from 'original' and p_variant is distinct from 'projection_reuse' then
  raise exception 'unknown phase variant' using errcode='22023';
 end if;
 phase_name:='old_prepare';phase_started:=clock_timestamp();
-- @source old_prepare
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(oldref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::issue234_dated_diff.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::issue234_dated_diff.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into old_workset,old_dates from prepared;
-- @end-source old_prepare

 phase_ms:=phase_ms||jsonb_build_object(phase_name,extract(epoch from clock_timestamp()-phase_started)*1000);
 phase_name:='new_prepare';phase_started:=clock_timestamp();
-- @source new_prepare
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(newref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::issue234_dated_diff.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::issue234_dated_diff.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into new_workset,new_dates from prepared;
-- @end-source new_prepare

 phase_ms:=phase_ms||jsonb_build_object(phase_name,extract(epoch from clock_timestamp()-phase_started)*1000);
 phase_name:='eligibility';phase_started:=clock_timestamp();
-- @source eligibility
 skip_unchanged_days:=oldref->'asOfDate'=to_jsonb(comparison_cutoff)
  and newref->'asOfDate'=to_jsonb(comparison_cutoff)
  and case when jsonb_typeof(oldref->'shadowSlots')='array' and jsonb_typeof(newref->'shadowSlots')='array'
  then not exists(select 1 from jsonb_array_elements((oldref->'shadowSlots')||(newref->'shadowSlots')) weekly_entry
    where jsonb_typeof(weekly_entry->'weekday') is distinct from 'number'
       or (weekly_entry->>'weekday') !~ '^[0-6]$') else false end;
-- @end-source eligibility

 phase_ms:=phase_ms||jsonb_build_object(phase_name,extract(epoch from clock_timestamp()-phase_started)*1000);
 if skip_unchanged_days then
  phase_name:='dated_diff';phase_started:=clock_timestamp();
  if p_variant='original' then
-- @source dated_original
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
-- @end-source dated_original
  else
-- @source dated_projection_reuse
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
-- @end-source dated_projection_reuse
  end if;

  phase_ms:=phase_ms||jsonb_build_object(phase_name,extract(epoch from clock_timestamp()-phase_started)*1000);
  phase_name:='weekday_diff';phase_started:=clock_timestamp();
-- @source weekday_diff
  select coalesce(array_agg(distinct (raw_weekly::jsonb->>'weekday')::int),'{}'::integer[]) into changed_weekdays
  from ((select value::text collate "C" as raw_weekly from jsonb_array_elements(oldref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots'))
        union all
        (select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(oldref->'shadowSlots'))) changed_weekly;
-- @end-source weekday_diff

  phase_ms:=phase_ms||jsonb_build_object(phase_name,extract(epoch from clock_timestamp()-phase_started)*1000);
 end if;
 phase_name:='affected_enumeration';phase_started:=clock_timestamp();
-- @source affected_original
 for d in
 with old_sessions as materialized (select value from issue234_dated_diff.timetable_validation_workset_values_v1(old_workset)),
      new_sessions as materialized (select value from issue234_dated_diff.timetable_validation_workset_values_v1(new_workset)),
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
-- @end-source affected_original

  body_started:=clock_timestamp();
  encountered:=array_append(encountered,d);
  enum_body_ms:=enum_body_ms+extract(epoch from clock_timestamp()-body_started)*1000;
 end loop;
 enum_total_ms:=extract(epoch from clock_timestamp()-phase_started)*1000;
 phase_ms:=phase_ms||jsonb_build_object('affected_enumeration',greatest(0,enum_total_ms-enum_body_ms));
 select coalesce(array_agg(x order by x nulls first),'{}'::date[]) into sorted_dates from unnest(encountered) x;
 return jsonb_build_object(
  'sqlstate','00000','phaseMs',phase_ms,
  'pipelineMs',extract(epoch from clock_timestamp()-pipeline_started)*1000,
  'output',jsonb_build_object('sortedHash',md5(to_jsonb(sorted_dates)::text),
   'encounterHash',md5(to_jsonb(encountered)::text),'sortedDates',to_jsonb(sorted_dates),
   'encounterDates',to_jsonb(encountered),
   'changedDatedDates',case when changed_dated_dates is null then null else
    (select to_jsonb(coalesce(array_agg(x order by x nulls first),'{}'::date[])) from unnest(changed_dated_dates) x) end,
   'changedWeekdays',case when changed_weekdays is null then null else
    (select to_jsonb(coalesce(array_agg(x order by x),'{}'::integer[])) from unnest(changed_weekdays) x) end),
  'counters',jsonb_build_object('oldRows',cardinality(old_workset),'newRows',cardinality(new_workset),
   'oldDateBuckets',(select count(*) from jsonb_object_keys(old_dates)),
   'newDateBuckets',(select count(*) from jsonb_object_keys(new_dates)),
   'changedDatedDates',cardinality(changed_dated_dates),'changedWeekdays',cardinality(changed_weekdays),
   'affectedDates',cardinality(encountered),'eligible',skip_unchanged_days),
  'instrumentation',jsonb_build_object('enumerationTotalMs',enum_total_ms,'captureBodyMs',enum_body_ms,
   'scope','FOR cursor residual includes cursor/loop/clock overhead; no downstream comparison'));
exception when others then
 get stacked diagnostics error_state=returned_sqlstate,error_message=message_text,error_detail=pg_exception_detail;
 return jsonb_build_object('sqlstate',error_state,'errorPhase',phase_name,
  'message',error_message,'detail',error_detail,'phaseMs',phase_ms);
end
$evaluate$;

-- Synthetic rows are deterministic and never come from a database snapshot.
create function issue234_dated_diff.row_value(p_id text,p_date text)
returns jsonb language sql immutable set search_path='' as $row$
 select jsonb_build_object('id',p_id,'classId','synthetic-class','date',p_date,
  'sourceSlotId','synthetic-slot','state','active','startMinute',540,'endMinute',600,
  'teacherId','synthetic-teacher','classroomId','synthetic-room')
$row$;
create function issue234_dated_diff.ref(p_dated jsonb,p_weekly jsonb default '[]',p_cutoff text default '2026-11-06')
returns jsonb language sql immutable set search_path='' as $ref$
 select jsonb_build_object('datedSessions',p_dated,'shadowSlots',p_weekly,'asOfDate',p_cutoff,
  'unresolvedOccupancies','[]'::jsonb,'datedUnresolvedOccupancies','[]'::jsonb)
$ref$;

create function issue234_dated_diff.seed_case(p_class_count integer,p_distribution text)
returns jsonb language plpgsql set search_path='' as $seed$
declare cutoff date:='2026-11-06'; history_count integer; sessions jsonb; weekly jsonb;
 oldref jsonb; newref jsonb; meta jsonb;
begin
 if p_class_count<>84 or p_class_count is null
  or p_distribution not in('close_history','dated_equal_weekly_change') or p_distribution is null then
  raise exception 'unsupported synthetic phase workload' using errcode='22023';
 end if;
 history_count:=case when p_distribution='close_history' then 120 else 8 end;
 select jsonb_agg(issue234_dated_diff.row_value('row-'||c||'-'||n,(cutoff+n-history_count)::text)
  ||jsonb_build_object('classId','synthetic-class-'||c,'sourceSlotId','slot-'||c,
    'teacherId','synthetic-teacher-'||c,'classroomId','synthetic-room-'||c,
    'className','Synthetic class '||c,'teacherName','Synthetic teacher '||c,
    'label','Synthetic phase measurement','source','synthetic') order by c,n)
 into sessions from generate_series(1,p_class_count) c cross join generate_series(0,127) n;
 select jsonb_agg((issue234_dated_diff.row_value('weekly-'||c,null)-'date')
  ||jsonb_build_object('classId','synthetic-class-'||c,'sourceSlotId','slot-'||c,'weekday',c%7) order by c)
 into weekly from generate_series(1,p_class_count) c;
 oldref:=issue234_dated_diff.ref(sessions,weekly,cutoff::text);
 if p_distribution='close_history' then
  select jsonb_agg(v order by ord) into sessions
   from jsonb_array_elements(sessions) with ordinality e(v,ord) where v->>'id'<>'row-1-127';
  newref:=issue234_dated_diff.ref(sessions,weekly,cutoff::text);
 else
  newref:=issue234_dated_diff.ref(sessions,jsonb_set(weekly,'{0,teacherId}','"synthetic-changed-teacher"'),cutoff::text);
 end if;
 meta:=jsonb_build_object('classCount',p_class_count,'distribution',p_distribution,
  'datesPerClass',128,'historicalDates',history_count,'currentFutureDates',128-history_count,
  'oldRows',jsonb_array_length(oldref->'datedSessions'),'newRows',jsonb_array_length(newref->'datedSessions'),
  'cutoff',cutoff,'oldRefBytes',octet_length(oldref::text),'newRefBytes',octet_length(newref::text),
  'oldRefHash',md5(oldref::text),'newRefHash',md5(newref::text),
  'scope','synthetic JSON input; reader/prechecks/full validator/writer/auth are not executed');
 truncate issue234_dated_diff.input;
 insert into issue234_dated_diff.input values(true,oldref,newref,cutoff,meta);
 return meta;
end
$seed$;

create function issue234_dated_diff.sample(p_variant text)
returns jsonb language plpgsql set search_path='' as $sample$
declare p issue234_dated_diff.input; result jsonb; started timestamptz:=clock_timestamp(); fetch_ms numeric;
begin
 select * into strict p from issue234_dated_diff.input;
 fetch_ms:=extract(epoch from clock_timestamp()-started)*1000;
 result:=issue234_dated_diff.evaluate(p.oldref,p.newref,p.comparison_cutoff,p_variant);
 return result||jsonb_build_object('phaseMs',(result->'phaseMs')||jsonb_build_object('input_fetch',fetch_ms),
  'inputFetchScope','synthetic JSON input fetch, not actual reader',
  'planCacheMode',current_setting('plan_cache_mode'));
end
$sample$;

-- These small cases concern the newly compared SELECT boundary, not a rerun
-- of the former frozen/full-validator 45-assertion suite. Even for inputs that
-- the omitted early validator guards would return/reject, expected results
-- describe ONLY eager old/new preparation and affected-date enumeration.
create table issue234_dated_diff.semantic_cases(
 ordinal integer primary key,label text unique,oldref jsonb,newref jsonb,
 expected_state text not null,expected_phase text,expected_dates jsonb,
 expected_raw_changed_dates jsonb,message_fragment text
);
insert into issue234_dated_diff.semantic_cases values
 (1,'empty arrays',issue234_dated_diff.ref('[]'),issue234_dated_diff.ref('[]'),'00000',null,'[]','[]',null),
 (2,'both dated arrays missing',issue234_dated_diff.ref('[]')-'datedSessions',issue234_dated_diff.ref('[]')-'datedSessions','00000',null,'[]','[]',null),
 (3,'both SQL NULL references',null,null,'00000',null,'[]',null,null),
 (4,'JSON null dated array retains scalar error',issue234_dated_diff.ref('null'),issue234_dated_diff.ref('[]'),'22023','old_prepare',null,null,'scalar'),
 (5,'empty date text retains old decode error',issue234_dated_diff.ref('[{"date":""}]'),issue234_dated_diff.ref('[]'),'22007','old_prepare',null,null,'""'),
 (6,'old malformed wins before new malformed',issue234_dated_diff.ref('[{"date":"old-not-a-date"}]'),issue234_dated_diff.ref('[{"date":"2026-02-30"}]'),'22007','old_prepare',null,null,'old-not-a-date'),
 (7,'new malformed after complete valid old',issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),issue234_dated_diff.ref('[{"date":"2026-02-30"}]'),'22008','new_prepare',null,null,'2026-02-30'),
 (8,'duplicate multiplicity two to one',issue234_dated_diff.ref('[{"date":"2026-11-06"},{"date":"2026-11-06"}]'),issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),'00000',null,'["2026-11-06"]','["2026-11-06"]',null),
 (9,'duplicate multiplicity one to two',issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),issue234_dated_diff.ref('[{"date":"2026-11-06"},{"date":"2026-11-06"}]'),'00000',null,'["2026-11-06"]','["2026-11-06"]',null),
 (10,'reordered JSON preserves value multiset',issue234_dated_diff.ref('[{"date":"2026-11-05","id":"a"},{"date":"2026-11-07","id":"b"}]'),issue234_dated_diff.ref('[{"date":"2026-11-07","id":"b"},{"date":"2026-11-05","id":"a"}]'),'00000',null,'[]','[]',null),
 (11,'numeric JSONB equality differs from raw text change',issue234_dated_diff.ref('[{"date":"2026-11-06","sourceSlotId":1}]'),issue234_dated_diff.ref('[{"date":"2026-11-06","sourceSlotId":1.0}]'),'00000',null,'[]','["2026-11-06"]',null),
 (12,'different raw date spelling same parsed date',issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),issue234_dated_diff.ref('[{"date":"November 6, 2026"}]'),'00000',null,'["2026-11-06"]','["2026-11-06"]',null),
 (13,'missing and JSON null dates preserve one NULL date',issue234_dated_diff.ref('[{"id":"missing"},{"id":"null","date":null},null]'),issue234_dated_diff.ref('[]'),'00000',null,'[null]','[]',null),
 (14,'weekly-only change enumerates both date sides',issue234_dated_diff.ref('[{"date":"2026-11-05"},{"date":"2026-11-07"}]','[{"weekday":5,"id":"old"}]'),issue234_dated_diff.ref('[{"date":"2026-11-05"},{"date":"2026-11-07"}]','[{"weekday":5,"id":"new"}]'),'00000',null,'["2026-11-05","2026-11-07"]','[]',null),
 (15,'cutoff-only change retains all dates',issue234_dated_diff.ref('[{"date":"2026-11-05"},{"date":"2026-11-07"}]'),issue234_dated_diff.ref('[{"date":"2026-11-05"},{"date":"2026-11-07"}]','[]','2026-11-07'),'00000',null,'["2026-11-05","2026-11-07"]',null,null),
 (16,'both missing branch operands do not become an ELSE',issue234_dated_diff.ref('[{"date":"2026-11-06"}]')-'shadowSlots'-'asOfDate',issue234_dated_diff.ref('[]')-'shadowSlots'-'asOfDate','00000',null,'[]',null,null),
 (17,'one missing weekly operand selects complete universe',issue234_dated_diff.ref('[{"date":"2026-11-05"}]')-'shadowSlots',issue234_dated_diff.ref('[{"date":"2026-11-07"}]'),'00000',null,'["2026-11-05","2026-11-07"]',null,null),
 (18,'equal JSON null weekly operands keep changed branch',issue234_dated_diff.ref('[{"date":"2026-11-06"}]','null'),issue234_dated_diff.ref('[]','null'),'00000',null,'["2026-11-06"]',null,null),
 (19,'infinite and NULL date universe remains intact',issue234_dated_diff.ref('[{"date":"-infinity"},{"date":"infinity"},{"date":null}]'),issue234_dated_diff.ref('[]'),'00000',null,'[null,"-infinity","infinity"]','["-infinity","infinity"]',null),
 (20,'unchanged nonempty rows have no affected date',issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),issue234_dated_diff.ref('[{"date":"2026-11-06"}]'),'00000',null,'[]','[]',null);

create function issue234_dated_diff.semantic_checks()
returns jsonb language plpgsql set search_path='' as $semantics$
declare c issue234_dated_diff.semantic_cases; a jsonb;b jsonb;
 state_ok boolean;value_ok boolean;raw_ok boolean;error_ok boolean;encounter_ok boolean;
 all_expected boolean:=true;all_parity boolean:=true;all_encounter boolean:=true;cases jsonb:='[]';
begin
 for c in select * from issue234_dated_diff.semantic_cases order by ordinal loop
  a:=issue234_dated_diff.evaluate(c.oldref,c.newref,'2026-11-06','original');
  b:=issue234_dated_diff.evaluate(c.oldref,c.newref,'2026-11-06','projection_reuse');
  state_ok:=a->>'sqlstate'=c.expected_state and b->>'sqlstate'=c.expected_state;
  error_ok:=a->>'errorPhase' is not distinct from c.expected_phase
   and b->>'errorPhase' is not distinct from c.expected_phase
   and a->>'message' is not distinct from b->>'message'
   and a->>'detail' is not distinct from b->>'detail'
   and (c.message_fragment is null or (strpos(a->>'message',c.message_fragment)>0 and strpos(b->>'message',c.message_fragment)>0));
  value_ok:=c.expected_dates is null or (a#>'{output,sortedDates}'=c.expected_dates and b#>'{output,sortedDates}'=c.expected_dates);
  raw_ok:=c.expected_raw_changed_dates is null or (a#>'{output,changedDatedDates}'=c.expected_raw_changed_dates and b#>'{output,changedDatedDates}'=c.expected_raw_changed_dates);
  encounter_ok:=a#>'{output,encounterDates}' is not distinct from b#>'{output,encounterDates}';
  all_expected:=all_expected and coalesce(state_ok and error_ok and value_ok and raw_ok,false);
  all_parity:=all_parity and (a->'counters' is not distinct from b->'counters')
   and (a#>'{output,sortedDates}' is not distinct from b#>'{output,sortedDates}');
  all_encounter:=all_encounter and encounter_ok;
  cases:=cases||jsonb_build_array(jsonb_build_object('label',c.label,'expectedSqlstate',c.expected_state,
   'expectedOutcomePass',coalesce(state_ok and error_ok and value_ok and raw_ok,false),
   'encounterParity',encounter_ok,'original',a-'phaseMs'-'pipelineMs'-'instrumentation',
   'projectionReuse',b-'phaseMs'-'pipelineMs'-'instrumentation'));
 end loop;
 return jsonb_build_object('caseCount',jsonb_array_length(cases),'planCacheMode',current_setting('plan_cache_mode'),
  'expectedOutcomesPass',all_expected,'sortedAndCounterParity',all_parity,'encounterParity',all_encounter,
  'status',case when all_expected and all_parity then 'pass' else 'fail' end,
  'encounterOrderEqualInAllCases',all_encounter,
  'candidateOrderPreserved',all_expected and all_parity and all_encounter,'cases',cases,
  'scope','query/preparation only; downstream first-conflict/full-validator parity is unproven');
end
$semantics$;

revoke all on all tables in schema issue234_dated_diff from public;
revoke all on all functions in schema issue234_dated_diff from public;
revoke all on type issue234_dated_diff.timetable_validation_row_v1 from public;
