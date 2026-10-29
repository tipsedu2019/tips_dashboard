begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Append-only correction to the candidate hours contract. Caller-supplied
-- quantities are not authoritative. The existing class row lock protects the
-- saved full plan used here; no schedule, payment or historical row is changed.
-- These pure private helpers port the management form's authoritativeOnly
-- calculation (withdrawal-schedule-metrics.js and ops-task-workspace.tsx).
-- No current-month fallback sessions are invented. Unsupported metadata or a
-- result outside numeric(8,2) remains unknown, rather than a confirmed quantity.
create function dashboard_private.withdrawal_trim_v1(p text)
returns text language sql immutable set search_path='' as $$
 -- ECMAScript String.trim whitespace and line-terminator set, including BOM.
 select btrim(p,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

create function dashboard_private.withdrawal_first_scalar_v1(p jsonb,keys text[])
returns text language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;
begin
 foreach k in array keys loop
  v:=p->k;
  -- JavaScript || preserves a string '0', but skips numeric zero.
  if v is null or v in('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then continue;end if;
  if jsonb_typeof(v) not in('string','number') then
   raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';end if;
  if jsonb_typeof(v)='number' and keys[1] in('id','billingId','label','billingLabel','scheduleState') then
   -- Ordinary numeric legacy IDs stringify like JS. Other numeric identities
   -- are outside the supported exact-string boundary, never silently changed.
   if (v#>>'{}')::numeric=trunc((v#>>'{}')::numeric) and abs((v#>>'{}')::numeric)<=9007199254740991 then
    return (v#>>'{}')::bigint::text;
   end if;
   raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';
  end if;
  return dashboard_private.withdrawal_trim_v1(v#>>'{}');
 end loop;
 return '';
end $$;

create function dashboard_private.withdrawal_time_minutes_v1(p text)
returns double precision language plpgsql immutable set search_path='' as $$
declare parts text[];
begin
 parts:=regexp_match(p,'^(\d{1,2})(?::(\d{2}))?$');
 if parts is null then return 0;end if;
 return parts[1]::double precision*60+coalesce(parts[2]::double precision,0);
end $$;

create function dashboard_private.withdrawal_hours_string_v1(p double precision)
returns text language plpgsql immutable set search_path='' as $$
declare rounded double precision;scaled double precision;lower_value double precision;
begin
 -- Math.round on nonnegative binary64 values; PostgreSQL round(float8) uses
 -- different tie handling. Bound before formatting, including NaN/Infinity.
 if not(p>=0 and p<=999999.99) then
  raise exception 'withdrawal_hours_unrepresentable' using errcode='22023';end if;
 scaled:=p*10;lower_value:=floor(scaled);
 rounded:=(lower_value+case when scaled-lower_value>=0.5 then 1 else 0 end)/10;
 if rounded>999999.99 then raise exception 'withdrawal_hours_unrepresentable' using errcode='22023';end if;
 if rounded=trunc(rounded) then return rounded::bigint::text;end if;
 return to_char(rounded,'FM9999990.0');
end $$;

create function dashboard_private.withdrawal_metadata_number_v1(p jsonb)
returns double precision language plpgsql immutable set search_path='' as $$
declare value_text text;
begin
 if p is null or p in('null'::jsonb,'false'::jsonb) then return 0;end if;
 if p='true'::jsonb then return 1;end if;
 if jsonb_typeof(p) not in('number','string') then
  raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';end if;
 value_text:=dashboard_private.withdrawal_trim_v1(p#>>'{}');
 if value_text='' then return 0;end if;
 if octet_length(value_text)<>length(value_text) then
  raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';end if;
 if value_text~'^[+-]?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))([eE][+-]?[0-9]+)?$' then
  return value_text::double precision;
 end if;
 -- Do not silently reinterpret JS Number's hex/binary/octal forms as zero.
 if value_text~*'^[+-]?0[xbo]' then
  raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';end if;
 -- Other strings are non-finite in Number(), hence absent in both callers.
 return null;
exception when numeric_value_out_of_range then
 -- PostgreSQL raises on binary64 underflow as well as overflow. JS Number
 -- underflow may become zero, so silently skipping it could change weekdays.
 raise exception 'withdrawal_schedule_metadata_unsupported' using errcode='22023';
end $$;

create function dashboard_private.calculate_teacher_withdrawal_hours_v1(p_class jsonb,p_date date)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 unknown_pair constant jsonb:='{"completed_lesson_hours":"","four_week_lesson_hours":""}';
 plan jsonb:=coalesce(p_class->'schedule_plan','{}');schedule_text text:=coalesce(p_class->>'schedule','');
 sessions jsonb;periods jsonb;items jsonb:='[]';counted jsonb;period jsonb;matches jsonb;label_matches jsonb;
 raw jsonb;v jsonb;item jsonb;previous_item jsonb;selected jsonb;entry record;parts text[];ch text;
 seen_ids text[]:=array[]::text[];id_value text;date_value text;state_value text;billing_id text;billing_label text;
 number_value double precision;duration double precision;minutes double precision;start_minutes double precision;end_minutes double precision;
 hours_by_day double precision[]:=array[0,0,0,0,0,0,0]::double precision[];
 day_order integer[]:=array[]::integer[];days double precision[]:=array[]::double precision[];
 weekday integer;day_value double precision;first_hours double precision:=1;weekly double precision:=0;completed_minutes double precision:=0;
 selected_index integer;cycle_start integer;n integer;session_date date;prior_date date;current_date_value date;
 completed_text text:='';four_week_text text:='';raw_days jsonb;
begin
 if jsonb_typeof(plan)<>'object' then plan:='{}';end if;
 sessions:=case when jsonb_typeof(plan->'sessions')='array' then plan->'sessions'
  when jsonb_typeof(plan->'session_list')='array' then plan->'session_list' else '[]'::jsonb end;
 periods:=case when jsonb_typeof(plan->'billingPeriods')='array' then plan->'billingPeriods'
  when jsonb_typeof(plan->'billing_periods')='array' then plan->'billing_periods' else '[]'::jsonb end;
 -- The existing teacher projection has the same explicit-duration boundary.
 -- Do not mimic object/boolean/array/negative/exponent Number coercions.
 if dashboard_private.teacher_common_schedule_plan_v1(plan)->>'withdrawalHoursUnavailable'='true' then return unknown_pair;end if;

 -- Normalize only the local calculation string. PostgreSQL locale-dependent
 -- \s is not JavaScript's fixed whitespace set (e.g. BOM versus U+0085).
 schedule_text:=translate(schedule_text,
  U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',repeat(' ',25));
 for parts in select regexp_matches(schedule_text,'([월화수목금토일]+) *(\d{1,2})(?::(\d{2}))? *[~\-–—] *(\d{1,2})(?::(\d{2}))?','g') loop
  duration:=((parts[4]::double precision*60+coalesce(parts[5]::double precision,0))
   -(parts[2]::double precision*60+coalesce(parts[3]::double precision,0)))/60;
  if duration<=0 then continue;end if;
  for ch in select regexp_split_to_table(parts[1],'') loop
   weekday:=strpos('일월화수목금토',ch)-1;
   if not(weekday=any(day_order)) then day_order:=array_append(day_order,weekday);end if;
   hours_by_day[weekday+1]:=hours_by_day[weekday+1]+duration;
  end loop;
 end loop;
 if cardinality(day_order)>0 then first_hours:=hours_by_day[day_order[1]+1];end if;

 for entry in select value,ordinality from jsonb_array_elements(sessions) with ordinality loop
  raw:=entry.value;
  if jsonb_typeof(raw)<>'object' then continue;end if;
  date_value:=substring(dashboard_private.withdrawal_first_scalar_v1(raw,array['date','session_date','dateValue','date_value']) from '\d{4}-\d{2}-\d{2}');
  if date_value is null then continue;end if;
  -- Strict date conversion makes malformed saved calendar dates unknown. It
  -- cannot normalize an invalid legacy date into an invented schedule day.
  session_date:=date_value::date;
  id_value:=dashboard_private.withdrawal_first_scalar_v1(raw,array['id','sessionId','session_id','sessionKey','session_key']);
  if id_value<>'' and id_value=any(seen_ids) then continue;end if;
  if id_value<>'' then seen_ids:=array_append(seen_ids,id_value);end if;
  v:=coalesce(nullif(raw->'sessionNumber','null'::jsonb),raw->'session_number');
  number_value:=coalesce(dashboard_private.withdrawal_metadata_number_v1(v),0);
  if number_value<=0 or number_value<>trunc(number_value) then number_value:=0;end if;
  state_value:=lower(dashboard_private.withdrawal_first_scalar_v1(raw,array['scheduleState','schedule_state','state']));
  if state_value='' then state_value:='active';end if;
  billing_id:=dashboard_private.withdrawal_first_scalar_v1(raw,array['billingId','billing_id','periodId','period_id','legacyBillingId','legacy_billing_id']);
  billing_label:=dashboard_private.withdrawal_first_scalar_v1(raw,array['billingLabel','billing_label','periodLabel','period_label','legacyBillingLabel','legacy_billing_label']);
  period:=null;matches:='[]';label_matches:='[]';
  for v in select value from jsonb_array_elements(periods) loop
   if jsonb_typeof(v)<>'object' then continue;end if;
   v:=jsonb_build_object('id',dashboard_private.withdrawal_first_scalar_v1(v,array['id','billingId','billing_id','periodId','period_id']),
    'label',dashboard_private.withdrawal_first_scalar_v1(v,array['label','billingLabel','billing_label','periodLabel','period_label']),
    'start',substring(dashboard_private.withdrawal_first_scalar_v1(v,array['startDate','start_date']) from '\d{4}-\d{2}-\d{2}'),
    'end',substring(dashboard_private.withdrawal_first_scalar_v1(v,array['endDate','end_date']) from '\d{4}-\d{2}-\d{2}'));
   if billing_id<>'' and v->>'id'=billing_id then period:=v;exit;end if;
   if v->>'start'<=date_value and date_value<=v->>'end' then
    matches:=matches||jsonb_build_array(v);
    if billing_label<>'' and v->>'label'=billing_label then label_matches:=label_matches||jsonb_build_array(v);end if;
   end if;
  end loop;
  if period is null then
   if jsonb_array_length(label_matches)=1 then period:=label_matches->0;
   elsif jsonb_array_length(matches)=1 then period:=matches->0;end if;
  end if;
  if billing_id='' then billing_id:=coalesce(period->>'id','');end if;
  if billing_label='' then billing_label:=coalesce(period->>'label','');end if;
  duration:=coalesce(nullif(dashboard_private.withdrawal_first_scalar_v1(raw,
   array['lessonHours','lesson_hours','durationHours','duration_hours','sessionHours','session_hours','hours']),''),'0')::double precision;
  if duration<=0 then
   minutes:=coalesce(nullif(dashboard_private.withdrawal_first_scalar_v1(raw,
    array['lessonMinutes','lesson_minutes','durationMinutes','duration_minutes','minutes']),''),'0')::double precision;
   if minutes>0 then duration:=minutes/60;else
    start_minutes:=dashboard_private.withdrawal_time_minutes_v1(dashboard_private.withdrawal_first_scalar_v1(raw,array['startTime','start_time']));
    end_minutes:=dashboard_private.withdrawal_time_minutes_v1(dashboard_private.withdrawal_first_scalar_v1(raw,array['endTime','end_time']));
    if end_minutes>start_minutes then duration:=(end_minutes-start_minutes)/60;
    else weekday:=extract(dow from session_date)::integer;duration:=hours_by_day[weekday+1];
     if duration<=0 then duration:=first_hours;end if;
    end if;
   end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('index',entry.ordinality,'id',coalesce(nullif(id_value,''),'source-index:'||(entry.ordinality-1)::text),'date',date_value,
   'number',number_value,'state',state_value,'billingId',billing_id,'billingLabel',billing_label,'hours',duration));
 end loop;
 select coalesce(jsonb_agg(value order by value->>'date',case when (value->>'number')::double precision>0
  then (value->>'number')::double precision else 9007199254740991 end,(value->>'index')::integer),'[]') into items
 from jsonb_array_elements(items);
 select coalesce(jsonb_agg(value order by ordinality),'[]') into counted
 from jsonb_array_elements(items) with ordinality where value->>'state' in('active','normal','makeup');
 select value into selected from jsonb_array_elements(items) with ordinality
 where value->>'date'=to_char(p_date,'YYYY-MM-DD') order by (value->>'state' in('active','normal','makeup')) desc,ordinality desc limit 1;

 raw_days:=case when jsonb_typeof(plan->'selectedDays')='array' then plan->'selectedDays'
  when jsonb_typeof(plan->'selected_days')='array' then plan->'selected_days' else '[]'::jsonb end;
 for v in select value from jsonb_array_elements(raw_days) loop
  day_value:=dashboard_private.withdrawal_metadata_number_v1(v);
  if day_value>=0 and day_value<=6 and not(day_value=any(days)) then days:=array_append(days,day_value);end if;
 end loop;
 if cardinality(days)=0 then
  for weekday in 0..6 loop
   if strpos(schedule_text,substr('일월화수목금토',weekday+1,1))>0 then days:=array_append(days,weekday::double precision);end if;
  end loop;
 end if;
 if cardinality(days)=0 then
  for item in select value from jsonb_array_elements(counted) loop
   day_value:=extract(dow from (item->>'date')::date);
   if not(day_value=any(days)) then days:=array_append(days,day_value);end if;
  end loop;
 end if;
 foreach day_value in array days loop
  duration:=0;
  if day_value=trunc(day_value) then duration:=hours_by_day[day_value::integer+1];end if;
  if duration<=0 then
   select (value->>'hours')::double precision into duration from jsonb_array_elements(counted) with ordinality
   where extract(dow from (value->>'date')::date)=day_value and (value->>'hours')::double precision>0 order by ordinality limit 1;
  end if;
  weekly:=weekly+coalesce(duration,0);
 end loop;

 if selected is not null then
  if selected->>'state' in('active','normal','makeup') then
   select ordinality::integer into selected_index from jsonb_array_elements(counted) with ordinality
    where value->>'id'=selected->>'id' order by ordinality limit 1;
   cycle_start:=selected_index;
   if selected->>'billingId'='' then
    while cycle_start>1 loop
     item:=counted->(cycle_start-1);previous_item:=counted->(cycle_start-2);
     if previous_item->>'billingId'<>'' or previous_item->>'billingLabel'<>selected->>'billingLabel' then exit;end if;
     prior_date:=(previous_item->>'date')::date;current_date_value:=(item->>'date')::date;
     if current_date_value-prior_date>62 or (item->>'number')::double precision=1
      or ((previous_item->>'number')::double precision>0 and (item->>'number')::double precision>0
       and (previous_item->>'number')::double precision>=(item->>'number')::double precision) then exit;end if;
     if selected->>'billingLabel'='' and ((previous_item->>'number')::double precision=0 or (item->>'number')::double precision=0)
      and left(previous_item->>'date',7)<>left(item->>'date',7) then exit;end if;
     cycle_start:=cycle_start-1;
    end loop;
   else cycle_start:=1;end if;
   for n in cycle_start..selected_index loop
    item:=counted->(n-1);
    if selected->>'billingId'='' or item->>'billingId'=selected->>'billingId' then
     completed_minutes:=completed_minutes+(item->>'hours')::double precision*60;
    end if;
   end loop;
  end if;
  completed_text:=dashboard_private.withdrawal_hours_string_v1(completed_minutes/60);
 end if;
 if weekly>0 or selected is not null then four_week_text:=dashboard_private.withdrawal_hours_string_v1(weekly*4);end if;
 return jsonb_build_object('completed_lesson_hours',completed_text,'four_week_lesson_hours',four_week_text);
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or invalid_text_representation or invalid_parameter_value then
 return unknown_pair;
end $$;

revoke all on function dashboard_private.withdrawal_trim_v1(text) from public,anon,authenticated;
revoke all on function dashboard_private.withdrawal_first_scalar_v1(jsonb,text[]) from public,anon,authenticated;
revoke all on function dashboard_private.withdrawal_time_minutes_v1(text) from public,anon,authenticated;
revoke all on function dashboard_private.withdrawal_hours_string_v1(double precision) from public,anon,authenticated;
revoke all on function dashboard_private.withdrawal_metadata_number_v1(jsonb) from public,anon,authenticated;
revoke all on function dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date) from public,anon,authenticated;

-- The patches below preserve the existing lock order, owner/revision checks,
-- raw request fingerprint and early receipt replay. Only new history rows are
-- enriched with the actual post-write snapshot; existing history is immutable.

do $server_hours_contract$
declare target regprocedure;definition text;before_contract jsonb;after_contract jsonb;anchors text[];replacements text[];n integer;
begin
 target:='dashboard_private.teacher_request_ops_input_v1(text,jsonb,uuid)'::regprocedure;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig) into before_contract from pg_catalog.pg_proc where oid=target;
 definition:=pg_catalog.pg_get_functiondef(target);
 anchors:=array[
 $a$declare keys text[];ids text[];dates text[];k text;s public.students%rowtype;c public.classes%rowtype;dest public.classes%rowtype;
 old_task public.ops_tasks%rowtype;old_detail public.ops_transfer_details%rowtype;task_input jsonb;detail jsonb;
 allowed_keys text[];hour_keys text[]:=array['completed_lesson_hours','four_week_lesson_hours'];
 old_withdrawal public.ops_withdrawal_details%rowtype;$a$,
 $a$ allowed_keys:=keys||case when d='withdrawal' then hour_keys else array[]::text[] end;
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& keys) or p-allowed_keys<>'{}' then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if d='withdrawal' and p ?| hour_keys then
  if not(p ?& hour_keys) then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  foreach k in array hour_keys loop
   -- Empty means not calculated. Zero is an actual snapshot, never NULL.
   -- The plain-decimal bound matches the existing numeric(8,2) storage.
   if jsonb_typeof(p->k) is distinct from 'string'
     or (p->>k<>'' and (p->>k)!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$') then
    raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  end loop;
 end if;$a$,
 $a$  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo','class_id'])||jsonb_build_object('school_grade',s.grade,'teacher_name',c.teacher);
  if p ?& hour_keys then
   detail:=detail||dashboard_private.teacher_request_json_pick_v1(p,hour_keys);
  elsif p_existing_id is not null then
   -- The outer owner mutation already locks this detail. An old eight-key
   -- client may keep an unchanged snapshot on a note edit, but cannot carry it
   -- onto a different selected date/session without a new calculation.
   select * into old_withdrawal from public.ops_withdrawal_details where task_id=p_existing_id;
   if (p->>'withdrawal_date')::date is distinct from old_withdrawal.withdrawal_date
     or nullif(p->>'withdrawal_session','') is distinct from nullif(old_withdrawal.withdrawal_session,'') then
    detail:=detail||jsonb_build_object('completed_lesson_hours',null,'four_week_lesson_hours',null);
   end if;
  end if;$a$];
 replacements:=array[
 $r$declare keys text[];ids text[];dates text[];k text;s public.students%rowtype;c public.classes%rowtype;dest public.classes%rowtype;
 old_task public.ops_tasks%rowtype;old_detail public.ops_transfer_details%rowtype;task_input jsonb;detail jsonb;
 old_withdrawal public.ops_withdrawal_details%rowtype;$r$,
 $r$ if jsonb_typeof(p) is distinct from 'object' or not(p ?& keys) or p-keys<>'{}' then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;$r$,
 $r$  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo','class_id'])||jsonb_build_object('school_grade',s.grade,'teacher_name',c.teacher);
  if p_existing_id is not null then
   -- teacher_request_lock_v1 already holds the parent/detail FOR UPDATE locks.
   select * into old_withdrawal from public.ops_withdrawal_details where task_id=p_existing_id;
  end if;
  if p_existing_id is null
    or (p->>'withdrawal_date')::date is distinct from old_withdrawal.withdrawal_date
    or nullif(p->>'withdrawal_session','') is distinct from nullif(old_withdrawal.withdrawal_session,'') then
   -- c was selected FOR SHARE above. The UI's monthly ordinal is never used
   -- as a full-plan selector: management uses the selected date end-of-day.
   detail:=detail||dashboard_private.calculate_teacher_withdrawal_hours_v1(
    jsonb_build_object('schedule_plan',c.schedule_plan,'schedule',c.schedule),(p->>'withdrawal_date')::date);
  end if;$r$];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_server_input_version_mismatch' using errcode='55000';end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig) into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_server_input_contract_changed' using errcode='55000';end if;
 target:='dashboard_private.mutate_teacher_own_request_v1_impl(text,uuid,text,jsonb,text,uuid)'::regprocedure;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig) into before_contract from pg_catalog.pg_proc where oid=target;
 definition:=pg_catalog.pg_get_functiondef(target);
 anchors:=array[
 $a$ note text:='';change_id uuid;old_request_setting text:=current_setting('app.ops_transition_request_id',true);$a$,
 $a$ insert into dashboard_private.teacher_request_history_v1(domain,request_id,actor_id,action,note,input_snapshot)
 values(p_domain,i,a,p_action,note,p_input);$a$];
 replacements:=array[
 $r$ note text:='';change_id uuid;old_request_setting text:=current_setting('app.ops_transition_request_id',true);
 history_input jsonb;effective_hours jsonb;$r$,
 $r$ -- Keep receipt fingerprints bound to the original wire input, but retain
 -- the effective post-write hours in this new immutable teacher snapshot.
 -- An eight-key memo edit must not lose retained hours after processing.
 history_input:=p_input;
 if p_domain='withdrawal' and p_action in('create','update') then
  select jsonb_build_object('completed_lesson_hours',coalesce(completed_lesson_hours::text,''),
   'four_week_lesson_hours',coalesce(four_week_lesson_hours::text,'')) into effective_hours
  from public.ops_withdrawal_details where task_id=i;
  -- Entirely unknown legacy requests retain their original eight-key shape.
  if effective_hours is not null and exists(select 1 from jsonb_each_text(effective_hours) h where h.value<>'') and not exists(
   select 1 from jsonb_each_text(effective_hours) h
   where h.value<>'' and h.value!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$'
  ) then history_input:=history_input||effective_hours;end if;
 end if;
 insert into dashboard_private.teacher_request_history_v1(domain,request_id,actor_id,action,note,input_snapshot)
 values(p_domain,i,a,p_action,note,history_input);$r$];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_server_history_version_mismatch' using errcode='55000';end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig) into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_server_history_contract_changed' using errcode='55000';end if;
end;
$server_hours_contract$;

commit;
