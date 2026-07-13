begin;

select plan(7);

insert into public.ops_tasks(id, title, type, status, priority, subject)
values
  ('00000000-0000-4000-8000-000000000951', '호환성 등록', 'registration', 'requested', 'normal', '영어'),
  ('00000000-0000-4000-8000-000000000952', '호환성 퇴원', 'withdrawal', 'requested', 'normal', '영어'),
  ('00000000-0000-4000-8000-000000000953', '호환성 전반', 'transfer', 'requested', 'normal', '영어');

insert into public.ops_registration_details(task_id)
values ('00000000-0000-4000-8000-000000000951');

insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status)
values (
  '00000000-0000-4000-8000-000000000954',
  '00000000-0000-4000-8000-000000000951',
  '영어',
  'inquiry'
);

select lives_ok(
  $$update public.ops_tasks set subject = '수학'
    where id = '00000000-0000-4000-8000-000000000952'$$,
  'withdrawal parent updates read NEW.id without resolving NEW.task_id'
);

select lives_ok(
  $$update public.ops_tasks set subject = '수학'
    where id = '00000000-0000-4000-8000-000000000953'$$,
  'transfer parent updates read NEW.id without resolving NEW.task_id'
);

select lives_ok(
  $$update public.ops_tasks set subject = '영어'
    where id = '00000000-0000-4000-8000-000000000951'$$,
  'a canonical registration parent projection remains writable'
);

select throws_ok(
  $$update public.ops_tasks set subject = '수학'
    where id = '00000000-0000-4000-8000-000000000951'$$,
  '23514',
  'registration_compatibility_override_denied',
  'a track-backed registration parent still rejects compatibility overrides'
);

select lives_ok(
  $$update public.ops_registration_details set pipeline_status = '0. 등록 문의'
    where task_id = '00000000-0000-4000-8000-000000000951'$$,
  'a canonical registration detail projection remains writable'
);

select throws_ok(
  $$update public.ops_registration_details set pipeline_status = '9. 문의만'
    where task_id = '00000000-0000-4000-8000-000000000951'$$,
  '23514',
  'registration_compatibility_override_denied',
  'a track-backed registration detail still rejects compatibility overrides'
);

create temporary table unexpected_compatibility_trigger_row (
  id uuid primary key,
  task_id uuid,
  subject text
);

create trigger prevent_registration_compatibility_override
before update of subject on unexpected_compatibility_trigger_row
for each row execute function public.prevent_registration_compatibility_override();

insert into unexpected_compatibility_trigger_row(id, task_id, subject)
values (
  '00000000-0000-4000-8000-000000000955',
  '00000000-0000-4000-8000-000000000956',
  '영어'
);

select throws_ok(
  $$update unexpected_compatibility_trigger_row set subject = '수학'
    where id = '00000000-0000-4000-8000-000000000955'$$,
  '23514',
  'registration_compatibility_trigger_table_invalid',
  'the security-definer trigger rejects every unexpected relation OID'
);

select * from finish();

rollback;
