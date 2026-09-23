begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Mixed normalized slots always project both resource positions. An empty
-- position is absence; every nonblank catalog name remains literal text.
-- Guard the verified final definitions and fail closed if they drift.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'dashboard_private.save_continuous_schedule_defaults_rows_v1(public.classes,jsonb)'::regprocedure);
  v_old text := $old$      || case when v_varied_resources
        then ' (' || coalesce(nullif(teacher_name, ''), '교사 미지정')
          || ', ' || coalesce(nullif(classroom_name, ''), '강의실 미지정') || ')'
        else '' end,$old$;
  v_new text := $new$      || case when v_varied_resources
        then ' (' || teacher_name
          || ', ' || classroom_name || ')'
        else '' end,$new$;
begin
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'class_schedule_projection_definition_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

-- The existing timetable reads legacy schedule text. When two positions are
-- present it must use them directly, including blanks, without class fallback.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure);
  v_old text := $old$      case when exists (
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
      )) end as row_classroom$old$;
  v_new text := $new$      case when pg_catalog.strpos(coalesce(matched.parts[4], ''), ',') > 0 then pg_catalog.btrim(pg_catalog.split_part(coalesce(matched.parts[4], ''), ',', 1)) else coalesce(
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
