begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Append-only correction for the existing management calculation contract.
-- No stored request, schedule, role, ACL, or historical migration is changed.
-- Keep binary64 durations in memory instead of serializing them through JSONB
-- (whose numeric output can depend on the caller's extra_float_digits setting).
do $withdrawal_numeric_parity$
declare
 target regprocedure;
 definition text;
 before_contract jsonb;
 after_contract jsonb;
 anchors text[];
 replacements text[];
 n integer;
begin
 target:='dashboard_private.withdrawal_first_scalar_v1(jsonb,text[])'::regprocedure;
 select pg_get_functiondef(oid),
  jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig,proparallel,proisstrict,proleakproof)
 into definition,before_contract from pg_catalog.pg_proc where oid=target;
 anchors:=array[$a$return (v#>>'{}')::bigint::text;$a$];
 replacements:=array[$r$return (v#>>'{}')::numeric::bigint::text;$r$];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_numeric_scalar_version_mismatch' using errcode='55000';
  end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig,proparallel,proisstrict,proleakproof)
 into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_numeric_scalar_contract_changed' using errcode='55000';
 end if;

 target:='dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date)'::regprocedure;
 select pg_get_functiondef(oid),
  jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig,proparallel,proisstrict,proleakproof)
 into definition,before_contract from pg_catalog.pg_proc where oid=target;
 anchors:=array[
 $a$ hours_by_day double precision[]:=array[0,0,0,0,0,0,0]::double precision[];$a$,
 $a$  items:=items||jsonb_build_array(jsonb_build_object('index',entry.ordinality,'id',coalesce(nullif(id_value,''),'source-index:'||(entry.ordinality-1)::text),'date',date_value,
   'number',number_value,'state',state_value,'billingId',billing_id,'billingLabel',billing_label,'hours',duration));$a$,
 $a$   select (value->>'hours')::double precision into duration from jsonb_array_elements(counted) with ordinality
   where extract(dow from (value->>'date')::date)=day_value and (value->>'hours')::double precision>0 order by ordinality limit 1;$a$,
 $a$     completed_minutes:=completed_minutes+(item->>'hours')::double precision*60;$a$
 ];
 replacements:=array[
 $r$ hours_by_day double precision[]:=array[0,0,0,0,0,0,0]::double precision[];
 hours_by_index double precision[]:=array[]::double precision[];$r$,
 $r$  -- Original ordinality survives skipped rows, deduplication and sorting.
  hours_by_index[entry.ordinality::integer]:=duration;
  items:=items||jsonb_build_array(jsonb_build_object('index',entry.ordinality,'id',coalesce(nullif(id_value,''),'source-index:'||(entry.ordinality-1)::text),'date',date_value,
   'number',number_value,'state',state_value,'billingId',billing_id,'billingLabel',billing_label));$r$,
 $r$   select hours_by_index[(value->>'index')::integer] into duration from jsonb_array_elements(counted) with ordinality
   where extract(dow from (value->>'date')::date)=day_value and hours_by_index[(value->>'index')::integer]>0 order by ordinality limit 1;$r$,
 $r$     completed_minutes:=completed_minutes+hours_by_index[(item->>'index')::integer]*60;$r$
 ];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_numeric_calculator_version_mismatch' using errcode='55000';
  end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig,proparallel,proisstrict,proleakproof)
 into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_numeric_calculator_contract_changed' using errcode='55000';
 end if;
end;
$withdrawal_numeric_parity$;

commit;
