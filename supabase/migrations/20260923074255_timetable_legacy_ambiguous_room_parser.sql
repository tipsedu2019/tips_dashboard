begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- One comma denotes the two-position compatibility contract, including
-- explicit empty values. More than one comma is ambiguous free text: retain
-- the previous room-name classifier for legacy/shadow rows. Normalized rows
-- already read their exact resource names from class_schedule_slots.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure);
  v_old text := $old$pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0$old$;
  v_new text := $new$(pg_catalog.length(coalesce(matched.parts[4], '')) - pg_catalog.length(pg_catalog.replace(coalesce(matched.parts[4], ''), ',', '')) = 1)$new$;
  v_occurrences integer;
begin
  if pg_catalog.strpos(v_definition, 'class.schedule_storage_mode = ''normalized''') = 0
    or pg_catalog.strpos(v_definition, 'left join public.class_schedule_slots normalized_slot') = 0 then
    raise exception 'academic_timetable_normalized_definition_drift' using errcode = '55000';
  end if;
  v_occurrences := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  if v_occurrences <> 2 then
    raise exception 'academic_timetable_legacy_resource_definition_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

commit;
