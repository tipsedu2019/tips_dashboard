begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Mixed assigned/unassigned slots need an explicit per-slot absence marker.
-- Patch only the verified final definitions and fail closed if they drift.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'dashboard_private.save_continuous_schedule_defaults_rows_v1(public.classes,jsonb)'::regprocedure);
  v_old_varied text := $old_varied$    select count(distinct nullif(teacher_name, '')) > 1
        or count(distinct nullif(classroom_name, '')) > 1
    into v_varied_resources$old_varied$;
  v_new_varied text := $new_varied$    select count(distinct teacher_name) > 1
        or count(distinct classroom_name) > 1
    into v_varied_resources$new_varied$;
  v_old_details text := $old_details$      || case when v_varied_resources
          and (teacher_name <> '' or classroom_name <> '')
        then ' (' || concat_ws(', ', nullif(teacher_name, ''), nullif(classroom_name, '')) || ')'
        else '' end,$old_details$;
  v_new_details text := $new_details$      || case when v_varied_resources
        then ' (' || coalesce(nullif(teacher_name, ''), '교사 미지정')
          || ', ' || coalesce(nullif(classroom_name, ''), '강의실 미지정') || ')'
        else '' end,$new_details$;
begin
  if pg_catalog.strpos(v_definition, v_old_varied) = 0
    or pg_catalog.strpos(v_definition, v_old_details) = 0 then
    raise exception 'class_schedule_projection_definition_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old_varied, v_new_varied),
    v_old_details, v_new_details
  );
end;
$patch$;

-- The weekly timetable parses the projected text for legacy consumers.
-- An explicit unassigned marker must win over class-level fallbacks.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure);
  v_old text := $old$      coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) as row_teacher,
      dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) as row_classroom
$old$;
  v_new text := $new$      case when exists (
        select 1 from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
        where pg_catalog.btrim(token) = '교사 미지정'
      ) then '' else coalesce(
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
      case when exists (
        select 1 from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
        where pg_catalog.btrim(token) = '강의실 미지정'
      ) then '' else dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) end as row_classroom
$new$;
begin
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'academic_timetable_resource_definition_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

commit;
