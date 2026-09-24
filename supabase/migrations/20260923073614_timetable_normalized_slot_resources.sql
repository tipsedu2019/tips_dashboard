begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The two-position compatibility string cannot delimit catalog names that
-- themselves contain commas. For normalized classes, the slot row is the
-- resource authority; legacy/shadow rows keep their previous string parser.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure);
  v_old_meta text := $old_meta$      class.schedule,
      class.status,$old_meta$;
  v_new_meta text := $new_meta$      class.schedule,
      class.schedule_storage_mode,
      class.status,$new_meta$;
  v_old_resources text := $old_resources$      case when pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0 then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 1)) else coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) end as row_teacher,
      case when pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0 then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 2)) else dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) end as row_classroom$old_resources$;
  v_new_resources text := $new_resources$      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.teacher_name, '') else case when pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0 then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 1)) else coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) end end as row_teacher,
      case when class.schedule_storage_mode = 'normalized' then coalesce(normalized_slot.classroom_name, '') else case when pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0 then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 2)) else dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) end end as row_classroom$new_resources$;
  v_old_join text := $old_join$    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    where day_value.day in ('월','화','수','목','금','토','일')$old_join$;
  v_new_join text := $new_join$    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    left join public.class_schedule_slots normalized_slot
      on class.schedule_storage_mode = 'normalized'
      and normalized_slot.class_id = class.id
      and normalized_slot.weekday = case day_value.day
        when '월' then 1 when '화' then 2 when '수' then 3 when '목' then 4
        when '금' then 5 when '토' then 6 else 0 end
      and pg_catalog.to_char(normalized_slot.start_time, 'HH24:MI') = matched.parts[2]
      and pg_catalog.to_char(normalized_slot.end_time, 'HH24:MI') = matched.parts[3]
    where day_value.day in ('월','화','수','목','금','토','일')$new_join$;
begin
  if pg_catalog.strpos(v_definition, v_old_meta) = 0
    or pg_catalog.strpos(v_definition, v_old_resources) = 0
    or pg_catalog.strpos(v_definition, v_old_join) = 0 then
    raise exception 'academic_timetable_normalized_resources_definition_drift'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(v_definition, v_old_meta, v_new_meta),
      v_old_resources, v_new_resources),
    v_old_join, v_new_join);
end;
$patch$;

commit;
