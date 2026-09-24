begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Activation retains legacy schedule spelling (for example 9:00), while slots
-- store typed times. Compare time values, with CASE guarding invalid legacy
-- tokens before casting; preserve 24:00 as the distinct end-of-day boundary.
-- The slot's existing start_time < end_time constraint enforces interval order.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure);
  v_old text := $old$      and pg_catalog.to_char(normalized_slot.start_time, 'HH24:MI') = matched.parts[2]
      and pg_catalog.to_char(normalized_slot.end_time, 'HH24:MI') = matched.parts[3]$old$;
  v_new text := $new$      and normalized_slot.start_time = case
        when matched.parts[2] ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        then matched.parts[2]::time end
      and normalized_slot.end_time = case
        when matched.parts[3] ~ '^(([01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        then matched.parts[3]::time end$new$;
begin
  if (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
      <> pg_catalog.length(v_old) then
    raise exception 'academic_timetable_normalized_time_definition_drift'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

commit;
