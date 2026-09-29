begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep this reader SECURITY INVOKER and preserve its existing ACL/RLS behavior.
-- These are the same subject aliases as registration_observation_teacher_subject_matches_v1.
-- That helper is private: do not grant clients access merely to populate this selector.
do $migration$
declare
  definition text;
  old_expression constant text := $old$class.subject = any(teacher.subjects)$old$;
  new_expression constant text := $new$case
          when pg_catalog.btrim(class.subject) in ('영어', '영어팀') then teacher.subjects && array['영어', '영어팀']::text[]
          when pg_catalog.btrim(class.subject) in ('수학', '수학팀') then teacher.subjects && array['수학', '수학팀']::text[]
          when pg_catalog.btrim(class.subject) in ('과학', '과학팀') then teacher.subjects && array['과학', '과학팀']::text[]
          else pg_catalog.btrim(class.subject) = any(teacher.subjects)
        end$new$;
begin
  definition := pg_catalog.pg_get_functiondef('public.get_operations_class_lesson_design_detail_v1(uuid)'::regprocedure);
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_expression, ''))) <> pg_catalog.length(old_expression) then
    raise exception 'lesson_design_teacher_alias_dependency_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(definition, old_expression, new_expression);
end;
$migration$;

commit;
