-- registration_legacy_write_lock
set local lock_timeout = '5s';
lock table public.ops_tasks in share row exclusive mode;
lock table public.ops_registration_details in share row exclusive mode;
lock table public.students in share row exclusive mode;
lock table public.classes in share row exclusive mode;

-- global_roster_projection_preflight
do $$
begin
  if exists (
    select 1
    from public.students student
    cross join lateral (
      values
        ('class_ids', student.class_ids),
        ('waitlist_class_ids', student.waitlist_class_ids)
    ) projection(column_name, value)
    where projection.value is not null
      and jsonb_typeof(projection.value) is distinct from 'array'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values
        ('student_ids', class.student_ids),
        ('waitlist_ids', class.waitlist_ids)
    ) projection(column_name, value)
    where projection.value is not null
      and jsonb_typeof(projection.value) is distinct from 'array'
  ) then
    raise exception 'registration_roster_projection_invalid';
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values
        (coalesce(student.class_ids, '[]'::jsonb)),
        (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral jsonb_array_elements(projection.value) element
    where jsonb_typeof(element) <> 'string'
      or (element #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values
        (coalesce(class.student_ids, '[]'::jsonb)),
        (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral jsonb_array_elements(projection.value) element
    where jsonb_typeof(element) <> 'string'
      or (element #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'registration_roster_projection_invalid';
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values
        (coalesce(student.class_ids, '[]'::jsonb)),
        (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    where jsonb_array_length(projection.value) <> (
      select count(distinct (element #>> '{}')::uuid)
      from jsonb_array_elements(projection.value) element
    )
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values
        (coalesce(class.student_ids, '[]'::jsonb)),
        (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    where jsonb_array_length(projection.value) <> (
      select count(distinct (element #>> '{}')::uuid)
      from jsonb_array_elements(projection.value) element
    )
  ) then
    raise exception 'registration_roster_projection_invalid';
  end if;
end
$$;

create temporary table global_roster_projection_pairs (
  student_id uuid not null,
  class_id uuid not null,
  projection_side text not null,
  roster_mode text not null
) on commit drop;

insert into global_roster_projection_pairs (
  student_id,
  class_id,
  projection_side,
  roster_mode
)
select student.id, (element #>> '{}')::uuid, 'student', 'enrolled'
from public.students student
cross join lateral jsonb_array_elements(coalesce(student.class_ids, '[]'::jsonb)) element
union all
select student.id, (element #>> '{}')::uuid, 'student', 'waitlist'
from public.students student
cross join lateral jsonb_array_elements(coalesce(student.waitlist_class_ids, '[]'::jsonb)) element
union all
select (element #>> '{}')::uuid, class.id, 'class', 'enrolled'
from public.classes class
cross join lateral jsonb_array_elements(coalesce(class.student_ids, '[]'::jsonb)) element
union all
select (element #>> '{}')::uuid, class.id, 'class', 'waitlist'
from public.classes class
cross join lateral jsonb_array_elements(coalesce(class.waitlist_ids, '[]'::jsonb)) element;

create temporary table global_roster_projection_repair_required_pairs
on commit drop
as
with pair_counts as (
  select
    pair.student_id,
    pair.class_id,
    count(*) filter (
      where pair.projection_side = 'student' and pair.roster_mode = 'enrolled'
    ) as student_enrolled_count,
    count(*) filter (
      where pair.projection_side = 'class' and pair.roster_mode = 'enrolled'
    ) as class_enrolled_count,
    count(*) filter (
      where pair.projection_side = 'student' and pair.roster_mode = 'waitlist'
    ) as student_waitlist_count,
    count(*) filter (
      where pair.projection_side = 'class' and pair.roster_mode = 'waitlist'
    ) as class_waitlist_count
  from global_roster_projection_pairs pair
  group by pair.student_id, pair.class_id
)
select
  pair.student_id,
  pair.class_id,
  student.status = '퇴원' as withdrawn_pair,
  not (
    (
      pair.student_enrolled_count = 1
      and pair.class_enrolled_count = 1
      and pair.student_waitlist_count = 0
      and pair.class_waitlist_count = 0
    )
    or (
      pair.student_enrolled_count = 0
      and pair.class_enrolled_count = 0
      and pair.student_waitlist_count = 1
      and pair.class_waitlist_count = 1
    )
  ) as asymmetric_pair
from pair_counts pair
left join public.students student on student.id = pair.student_id
where student.status = '퇴원'
  or not (
    (
      pair.student_enrolled_count = 1
      and pair.class_enrolled_count = 1
      and pair.student_waitlist_count = 0
      and pair.class_waitlist_count = 0
    )
    or (
      pair.student_enrolled_count = 0
      and pair.class_enrolled_count = 0
      and pair.student_waitlist_count = 1
      and pair.class_waitlist_count = 1
    )
  );

-- reviewed_roster_projection_repairs
create temporary table reviewed_roster_projection_repairs_input (
  student_id uuid,
  class_id uuid,
  target_mode text
) on commit drop;

-- Portable placeholder. Add only operator-reviewed production UUIDs and outcomes.
insert into reviewed_roster_projection_repairs_input (student_id, class_id, target_mode)
values (null::uuid, null::uuid, null::text);

create temporary table reviewed_roster_projection_repairs
on commit drop
as
select
  reviewed.student_id,
  reviewed.class_id,
  reviewed.target_mode
from reviewed_roster_projection_repairs_input reviewed
join public.students student on student.id = reviewed.student_id
join public.classes class on class.id = reviewed.class_id;

do $$
begin
  if exists (
    select 1
    from reviewed_roster_projection_repairs reviewed
    where reviewed.target_mode is null
      or reviewed.target_mode not in ('enrolled', 'waitlist', 'removed')
  ) or exists (
    select 1
    from reviewed_roster_projection_repairs reviewed
    group by reviewed.student_id, reviewed.class_id
    having count(*) <> 1
  ) or exists (
    select 1
    from reviewed_roster_projection_repairs reviewed
    left join global_roster_projection_repair_required_pairs required
      on required.student_id = reviewed.student_id
      and required.class_id = reviewed.class_id
    where required.student_id is null
  ) then
    raise exception 'registration_global_roster_repair_required';
  end if;

  if exists (
    select 1
    from global_roster_projection_repair_required_pairs required
    left join reviewed_roster_projection_repairs reviewed
      on reviewed.student_id = required.student_id
      and reviewed.class_id = required.class_id
    where required.withdrawn_pair
      and (reviewed.student_id is null or reviewed.target_mode <> 'removed')
  ) then
    raise exception 'registration_withdrawn_roster_review_required';
  end if;

  if exists (
    select 1
    from global_roster_projection_repair_required_pairs required
    left join reviewed_roster_projection_repairs reviewed
      on reviewed.student_id = required.student_id
      and reviewed.class_id = required.class_id
    where required.asymmetric_pair
      and not required.withdrawn_pair
      and reviewed.student_id is null
  ) then
    raise exception 'registration_global_roster_repair_required';
  end if;
end
$$;

do $$
declare
  repair record;
begin
  for repair in
    select reviewed.student_id, reviewed.class_id, reviewed.target_mode
    from reviewed_roster_projection_repairs reviewed
    join global_roster_projection_repair_required_pairs required
      on required.student_id = reviewed.student_id
      and required.class_id = reviewed.class_id
    order by reviewed.student_id, reviewed.class_id
  loop
    update public.students student
    set
      class_ids = coalesce((
        select jsonb_agg(candidate.id order by candidate.id)
        from (
          select distinct element #>> '{}' as id
          from jsonb_array_elements(coalesce(student.class_ids, '[]'::jsonb)) element
          where (element #>> '{}')::uuid <> repair.class_id
          union
          select repair.class_id::text
          where repair.target_mode = 'enrolled'
        ) candidate
      ), '[]'::jsonb),
      waitlist_class_ids = coalesce((
        select jsonb_agg(candidate.id order by candidate.id)
        from (
          select distinct element #>> '{}' as id
          from jsonb_array_elements(coalesce(student.waitlist_class_ids, '[]'::jsonb)) element
          where (element #>> '{}')::uuid <> repair.class_id
          union
          select repair.class_id::text
          where repair.target_mode = 'waitlist'
        ) candidate
      ), '[]'::jsonb)
    where student.id = repair.student_id;

    update public.classes class
    set
      student_ids = coalesce((
        select jsonb_agg(candidate.id order by candidate.id)
        from (
          select distinct element #>> '{}' as id
          from jsonb_array_elements(coalesce(class.student_ids, '[]'::jsonb)) element
          where (element #>> '{}')::uuid <> repair.student_id
          union
          select repair.student_id::text
          where repair.target_mode = 'enrolled'
        ) candidate
      ), '[]'::jsonb),
      waitlist_ids = coalesce((
        select jsonb_agg(candidate.id order by candidate.id)
        from (
          select distinct element #>> '{}' as id
          from jsonb_array_elements(coalesce(class.waitlist_ids, '[]'::jsonb)) element
          where (element #>> '{}')::uuid <> repair.student_id
          union
          select repair.student_id::text
          where repair.target_mode = 'waitlist'
        ) candidate
      ), '[]'::jsonb)
    where class.id = repair.class_id;

    insert into public.student_class_enrollment_history (
      student_id,
      class_id,
      action,
      previous_mode,
      next_mode,
      memo,
      changed_by
    ) values (
      repair.student_id,
      repair.class_id,
      repair.target_mode,
      null,
      case when repair.target_mode = 'removed' then null else repair.target_mode end,
      'reviewed_roster_projection_repair: prior projection was asymmetric or incompatible with student status',
      null
    );
  end loop;
end
$$;

truncate table global_roster_projection_pairs;

insert into global_roster_projection_pairs (
  student_id,
  class_id,
  projection_side,
  roster_mode
)
select student.id, (element #>> '{}')::uuid, 'student', 'enrolled'
from public.students student
cross join lateral jsonb_array_elements(coalesce(student.class_ids, '[]'::jsonb)) element
union all
select student.id, (element #>> '{}')::uuid, 'student', 'waitlist'
from public.students student
cross join lateral jsonb_array_elements(coalesce(student.waitlist_class_ids, '[]'::jsonb)) element
union all
select (element #>> '{}')::uuid, class.id, 'class', 'enrolled'
from public.classes class
cross join lateral jsonb_array_elements(coalesce(class.student_ids, '[]'::jsonb)) element
union all
select (element #>> '{}')::uuid, class.id, 'class', 'waitlist'
from public.classes class
cross join lateral jsonb_array_elements(coalesce(class.waitlist_ids, '[]'::jsonb)) element;

create temporary table global_roster_projection_symmetric
on commit drop
as
with pair_counts as (
  select
    pair.student_id,
    pair.class_id,
    count(*) filter (
      where pair.projection_side = 'student' and pair.roster_mode = 'enrolled'
    ) as student_enrolled_count,
    count(*) filter (
      where pair.projection_side = 'class' and pair.roster_mode = 'enrolled'
    ) as class_enrolled_count,
    count(*) filter (
      where pair.projection_side = 'student' and pair.roster_mode = 'waitlist'
    ) as student_waitlist_count,
    count(*) filter (
      where pair.projection_side = 'class' and pair.roster_mode = 'waitlist'
    ) as class_waitlist_count
  from global_roster_projection_pairs pair
  group by pair.student_id, pair.class_id
)
select not exists (
  select 1
  from pair_counts pair
  where not (
    (
      pair.student_enrolled_count = 1
      and pair.class_enrolled_count = 1
      and pair.student_waitlist_count = 0
      and pair.class_waitlist_count = 0
    )
    or (
      pair.student_enrolled_count = 0
      and pair.class_enrolled_count = 0
      and pair.student_waitlist_count = 1
      and pair.class_waitlist_count = 1
    )
  )
) as global_roster_projection_symmetric;

do $$
begin
  if exists (
    select 1
    from public.students student
    where student.status = '퇴원'
      and (
        jsonb_array_length(coalesce(student.class_ids, '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(student.waitlist_class_ids, '[]'::jsonb)) > 0
        or exists (
          select 1
          from global_roster_projection_pairs pair
          where pair.student_id = student.id
            and pair.projection_side = 'class'
        )
      )
  ) then
    raise exception 'registration_withdrawn_roster_review_required';
  end if;

  if not (
    select symmetric.global_roster_projection_symmetric
    from global_roster_projection_symmetric symmetric
  ) then
    raise exception 'registration_global_roster_repair_required';
  end if;
end
$$;

-- registration_subject_attribution_preflight
create temporary table registration_legacy_parents
on commit drop
as
select
  task.id as task_id,
  task.title,
  task.subject as raw_subject,
  task.student_id,
  task.class_id,
  task.textbook_id,
  task.student_name,
  task.class_name,
  task.textbook_title,
  task.secondary_assignee_id,
  task.created_at as task_created_at,
  task.updated_at as task_updated_at,
  task.completed_at as task_completed_at,
  detail.task_id is not null as detail_exists,
  detail.pipeline_status,
  detail.inquiry_at,
  detail.level_test_at,
  detail.level_test_place,
  detail.level_test_material_link,
  detail.level_test_completed_at,
  detail.level_test_result,
  detail.counselor,
  detail.phone_consultation_at,
  detail.visit_consultation_at,
  detail.visit_consultation_place,
  detail.consultation_at,
  detail.class_start_date,
  detail.class_start_session,
  detail.textbook_ready,
  detail.admission_notice_sent,
  detail.payment_checked,
  detail.makeedu_registered,
  detail.makeedu_invoice_sent,
  detail.textbook_billing_issued,
  detail.timetable_roster_updated,
  detail.created_at as detail_created_at,
  detail.updated_at as detail_updated_at
from public.ops_tasks task
left join public.ops_registration_details detail on detail.task_id = task.id
where task.type = 'registration';

create temporary table registration_subject_tokens
on commit drop
as
select
  parent.task_id,
  nullif(btrim(token.value), '') as token
from registration_legacy_parents parent
cross join lateral regexp_split_to_table(
  btrim(parent.raw_subject),
  '[[:space:],/;+&|·ㆍ]+'
) token(value)
where nullif(btrim(parent.raw_subject), '') is not null;

create temporary table registration_subject_token_summary
on commit drop
as
select
  parent.task_id,
  nullif(btrim(parent.raw_subject), '') is null as raw_subject_blank,
  count(distinct token.token) filter (
    where token.token in ('영어', '수학')
  ) as recognized_subject_count,
  count(*) filter (
    where token.token is not null
      and token.token not in ('영어', '수학')
  ) as unknown_token_count
from registration_legacy_parents parent
left join registration_subject_tokens token on token.task_id = parent.task_id
group by parent.task_id, parent.raw_subject;

create temporary table registration_automatic_subject_attribution
on commit drop
as
select distinct token.task_id, token.token as subject
from registration_subject_tokens token
join registration_subject_token_summary summary on summary.task_id = token.task_id
where token.token in ('영어', '수학')
  and summary.recognized_subject_count between 1 and 2
  and summary.unknown_token_count = 0
  and not summary.raw_subject_blank;

-- reviewed_registration_subject_attribution
create temporary table reviewed_registration_subject_attribution_input (
  task_id uuid,
  subject text
) on commit drop;

-- Portable placeholder. Add only explicit operator-reviewed registration subjects.
insert into reviewed_registration_subject_attribution_input (task_id, subject)
values (null::uuid, null::text);

create temporary table reviewed_registration_subject_attribution
on commit drop
as
select reviewed.task_id, reviewed.subject
from reviewed_registration_subject_attribution_input reviewed
join registration_legacy_parents parent on parent.task_id = reviewed.task_id;

do $$
begin
  if exists (
    select 1
    from reviewed_registration_subject_attribution reviewed
    where reviewed.subject is null
      or reviewed.subject not in ('영어', '수학')
  ) or exists (
    select 1
    from reviewed_registration_subject_attribution reviewed
    group by reviewed.task_id, reviewed.subject
    having count(*) <> 1
  ) or exists (
    select 1
    from reviewed_registration_subject_attribution reviewed
    join registration_subject_token_summary summary on summary.task_id = reviewed.task_id
    where summary.recognized_subject_count between 1 and 2
      and summary.unknown_token_count = 0
      and not summary.raw_subject_blank
  ) then
    raise exception 'registration_subject_attribution_required';
  end if;

  if exists (
    select 1
    from registration_subject_token_summary summary
    where summary.unknown_token_count > 0
      and not exists (
        select 1
        from reviewed_registration_subject_attribution reviewed
        where reviewed.task_id = summary.task_id
          and reviewed.subject in ('영어', '수학')
      )
  ) then
    raise exception 'registration_subject_token_unrecognized';
  end if;
end
$$;

create temporary table registration_resolved_subjects
on commit drop
as
select automatic.task_id, automatic.subject
from registration_automatic_subject_attribution automatic
union
select reviewed.task_id, reviewed.subject
from reviewed_registration_subject_attribution reviewed
where reviewed.subject in ('영어', '수학');

alter table registration_resolved_subjects
  add primary key (task_id, subject);

do $$
begin
  if exists (
    select 1
    from registration_legacy_parents parent
    left join registration_resolved_subjects resolved on resolved.task_id = parent.task_id
    group by parent.task_id
    having count(distinct resolved.subject) not between 1 and 2
  ) then
    raise exception 'registration_subject_attribution_required';
  end if;
end
$$;

-- registration_roster_evidence_revalidation
create temporary table registration_legacy_directors
on commit drop
as
select
  candidate.task_id,
  min(candidate.profile_id::text)::uuid as director_profile_id
from (
  select distinct parent.task_id, teacher.profile_id
  from registration_legacy_parents parent
  join public.teacher_catalogs teacher
    on teacher.profile_id is not null
    and teacher.is_visible is distinct from false
    and (
      teacher.profile_id = parent.secondary_assignee_id
      or (
        nullif(btrim(parent.counselor), '') is not null
        and btrim(teacher.name) = btrim(parent.counselor)
      )
    )
  join public.profiles profile
    on profile.id = teacher.profile_id
    and profile.role = 'admin'
) candidate
group by candidate.task_id
having count(distinct candidate.profile_id) = 1;

create temporary table registration_required_student_ids
on commit drop
as
select distinct parent.student_id
from registration_legacy_parents parent
join (
  select resolved.task_id
  from registration_resolved_subjects resolved
  group by resolved.task_id
  having count(*) = 1
) single_subject on single_subject.task_id = parent.task_id
where parent.student_id is not null
  and (
    parent.pipeline_status like '4-1.%'
    or parent.pipeline_status like '5-1.%'
    or parent.pipeline_status like '6.%'
    or parent.pipeline_status like '7.%'
  );

create temporary table registration_required_class_ids
on commit drop
as
select distinct parent.class_id
from registration_legacy_parents parent
join (
  select resolved.task_id
  from registration_resolved_subjects resolved
  group by resolved.task_id
  having count(*) = 1
) single_subject on single_subject.task_id = parent.task_id
where parent.class_id is not null
  and (
    parent.pipeline_status like '4-1.%'
    or parent.pipeline_status like '5.%'
    or parent.pipeline_status like '5-1.%'
    or parent.pipeline_status like '6.%'
    or parent.pipeline_status like '7.%'
  );

create temporary table registration_required_director_ids
on commit drop
as
select distinct director.director_profile_id
from registration_legacy_directors director
join (
  select resolved.task_id
  from registration_resolved_subjects resolved
  group by resolved.task_id
  having count(*) = 1
) single_subject on single_subject.task_id = director.task_id;

do $$
declare
  locked_row record;
begin
  for locked_row in
    select student.id
    from public.students student
    join registration_required_student_ids required on required.student_id = student.id
    order by student.id
    for update
  loop
    null;
  end loop;

  for locked_row in
    select class.id
    from public.classes class
    join registration_required_class_ids required on required.class_id = class.id
    order by class.id
    for update
  loop
    null;
  end loop;

  for locked_row in
    select profile.id
    from public.profiles profile
    join registration_required_director_ids required
      on required.director_profile_id = profile.id
    order by profile.id
    for update
  loop
    null;
  end loop;
end
$$;

create temporary table registration_roster_evidence
on commit drop
as
select
  parent.task_id,
  resolved.subject,
  parent.student_id,
  parent.class_id,
  case
    when parent.pipeline_status like '4-1.%' then 'waitlist'
    else 'enrolled'
  end as expected_mode,
  case
    when parent.pipeline_status like '4-1.%' then
      coalesce(student.waitlist_class_ids, '[]'::jsonb) ? parent.class_id::text
      and not (coalesce(student.class_ids, '[]'::jsonb) ? parent.class_id::text)
    else
      coalesce(student.class_ids, '[]'::jsonb) ? parent.class_id::text
      and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? parent.class_id::text)
  end as student_projection_valid,
  case
    when parent.pipeline_status like '4-1.%' then
      coalesce(class.waitlist_ids, '[]'::jsonb) ? parent.student_id::text
      and not (coalesce(class.student_ids, '[]'::jsonb) ? parent.student_id::text)
    else
      coalesce(class.student_ids, '[]'::jsonb) ? parent.student_id::text
      and not (coalesce(class.waitlist_ids, '[]'::jsonb) ? parent.student_id::text)
  end as class_projection_valid,
  (
    student.id is not null
    and student.status = '재원'
    and class.id is not null
    and btrim(class.subject) = resolved.subject
    and case
      when parent.pipeline_status like '4-1.%' then
        coalesce(student.waitlist_class_ids, '[]'::jsonb) ? parent.class_id::text
        and coalesce(class.waitlist_ids, '[]'::jsonb) ? parent.student_id::text
        and not (coalesce(student.class_ids, '[]'::jsonb) ? parent.class_id::text)
        and not (coalesce(class.student_ids, '[]'::jsonb) ? parent.student_id::text)
      else
        coalesce(student.class_ids, '[]'::jsonb) ? parent.class_id::text
        and coalesce(class.student_ids, '[]'::jsonb) ? parent.student_id::text
        and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? parent.class_id::text)
        and not (coalesce(class.waitlist_ids, '[]'::jsonb) ? parent.student_id::text)
    end
  ) as roster_evidence_valid
from registration_legacy_parents parent
join registration_resolved_subjects resolved on resolved.task_id = parent.task_id
join (
  select subject_set.task_id
  from registration_resolved_subjects subject_set
  group by subject_set.task_id
  having count(*) = 1
) single_subject on single_subject.task_id = parent.task_id
left join public.students student on student.id = parent.student_id
left join public.classes class on class.id = parent.class_id
where parent.pipeline_status like '4-1.%'
  or parent.pipeline_status like '7.%';

alter table public.ops_registration_details
  add column common_revision integer not null default 1
  check (common_revision > 0);

alter table public.ops_registration_messages
  add column claim_active boolean;

update public.ops_registration_messages
set claim_active = status in ('pending', 'accepted', 'unknown');

do $$
begin
  if exists (
    select 1
    from public.ops_registration_messages
    where template_key = 'admission_application'
      and claim_active
    group by task_id, template_key
    having count(*) > 1
  ) then
    raise exception 'registration_message_active_claim_review_required';
  end if;
end
$$;

alter table public.ops_registration_messages
  drop constraint if exists ops_registration_messages_status_check,
  add constraint ops_registration_messages_status_check
    check (status in ('pending', 'accepted', 'failed', 'unknown')),
  add constraint ops_registration_messages_claim_state_check
    check (status = 'failed' or claim_active),
  alter column claim_active set default true,
  alter column claim_active set not null;

create unique index ops_registration_one_live_admission_message
  on public.ops_registration_messages(task_id, template_key)
  where claim_active and template_key = 'admission_application';

drop trigger if exists set_updated_at_ops_registration_messages
  on public.ops_registration_messages;
create trigger set_updated_at_ops_registration_messages
before update on public.ops_registration_messages
for each row execute function public.set_updated_at();

revoke select on table public.ops_registration_messages from authenticated;
grant select (id, task_id, template_key, request_key, status, claim_active, created_at, updated_at) on public.ops_registration_messages to authenticated;

create table public.ops_registration_subject_tracks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  subject text not null check (subject in ('영어', '수학')),
  pipeline_status text not null check (pipeline_status in (
    'inquiry', 'migration_review', 'level_test_scheduled', 'level_test_in_progress',
    'consultation_waiting', 'visit_consultation_scheduled', 'waiting',
    'enrollment_decided', 'enrollment_processing', 'registered',
    'not_registered', 'inquiry_closed'
  )),
  director_profile_id uuid references public.profiles(id) on delete restrict,
  director_assignment_source text check (
    director_assignment_source is null
    or director_assignment_source in ('default', 'manual', 'migration')
  ),
  director_assignment_rule_key text,
  director_assigned_at timestamptz,
  waiting_kind text check (waiting_kind is null or waiting_kind in (
    'current_class', 'current_term_opening', 'next_term_opening'
  )),
  level_test_retake_decision text check (
    level_test_retake_decision is null
    or level_test_retake_decision in ('required', 'not_required')
  ),
  level_test_retake_decided_at timestamptz,
  migration_review_required boolean not null default false,
  stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, subject),
  check (
    (
      director_profile_id is null
      and director_assignment_source is null
      and director_assignment_rule_key is null
      and director_assigned_at is null
    )
    or (
      director_profile_id is not null
      and director_assignment_source is not null
      and director_assigned_at is not null
      and (
        (
          director_assignment_source = 'default'
          and nullif(btrim(director_assignment_rule_key), '') is not null
        )
        or (
          director_assignment_source in ('manual', 'migration')
          and director_assignment_rule_key is null
        )
      )
    )
  ),
  check ((pipeline_status = 'migration_review') = migration_review_required),
  check ((pipeline_status = 'waiting') = (waiting_kind is not null))
);

create table public.ops_registration_appointments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  kind text not null check (kind in ('level_test', 'visit_consultation')),
  scheduled_at timestamptz not null,
  place text not null check (nullif(btrim(place), '') is not null),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'canceled')),
  notification_revision integer not null default 1 check (notification_revision > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_level_tests (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null
    references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid not null
    references public.ops_registration_appointments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'absent', 'canceled')),
  started_at timestamptz,
  completed_at timestamptz,
  material_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, attempt_number),
  unique (appointment_id, track_id),
  check (status <> 'in_progress' or started_at is not null),
  check (status not in ('completed', 'absent', 'canceled') or completed_at is not null),
  check (status <> 'completed' or nullif(btrim(material_link), '') is not null)
);

create table public.ops_registration_consultations (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null
    references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid
    references public.ops_registration_appointments(id) on delete restrict,
  mode text not null check (mode in ('phone', 'visit')),
  status text not null check (status in ('waiting', 'scheduled', 'completed', 'canceled')),
  director_profile_id uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  outcome text check (outcome is null or outcome in ('enrollment', 'waiting', 'not_registered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode = 'phone' and appointment_id is null)
    or (mode = 'visit' and appointment_id is not null)
  ),
  check (status <> 'completed' or (completed_at is not null and outcome is not null))
);

create table public.ops_registration_admission_batches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  status text not null default 'draft'
    check (status in ('draft', 'invoiced', 'paid', 'completed', 'canceled')),
  invoice_sent_at timestamptz,
  payment_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, revision_number),
  check (status not in ('invoiced', 'paid', 'completed') or invoice_sent_at is not null),
  check (status not in ('paid', 'completed') or payment_confirmed_at is not null)
);

create table public.ops_registration_enrollments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null
    references public.ops_registration_subject_tracks(id) on delete cascade,
  student_id uuid references public.students(id) on delete restrict,
  admission_batch_id uuid
    references public.ops_registration_admission_batches(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  textbook_id uuid references public.textbooks(id) on delete restrict,
  class_start_date date,
  class_start_session_key text,
  class_start_session text,
  status text not null default 'planned'
    check (status in ('planned', 'waitlisted', 'enrolled', 'canceled')),
  makeedu_registered boolean not null default false,
  roster_active boolean not null default false,
  roster_released_at timestamptz,
  roster_release_reason text,
  roster_release_source_task_id uuid references public.ops_tasks(id) on delete restrict,
  roster_release_kind text check (
    roster_release_kind is null or roster_release_kind in ('withdrawal', 'transfer')
  ),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    class_start_session_key is null
    or class_start_session_key ~ '^\d{4}-\d{2}-\d{2}:[1-9]\d*$'
  ),
  check (
    (
      status = 'planned'
      and admission_batch_id is null
      and student_id is null
      and not roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'planned'
      and admission_batch_id is not null
      and student_id is not null
      and roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'waitlisted'
      and admission_batch_id is null
      and student_id is not null
      and roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'enrolled'
      and admission_batch_id is not null
      and student_id is not null
      and (
        (
          roster_active
          and roster_released_at is null
          and roster_release_reason is null
          and roster_release_source_task_id is null
          and roster_release_kind is null
        )
        or (
          not roster_active
          and roster_released_at is not null
          and nullif(btrim(roster_release_reason), '') is not null
          and roster_release_source_task_id is not null
          and roster_release_kind is not null
        )
      )
    )
    or (
      status = 'canceled'
      and not roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
  ),
  check (
    status not in ('enrolled')
    or (
      class_start_date is not null
      and nullif(btrim(class_start_session_key), '') is not null
      and nullif(btrim(class_start_session), '') is not null
    )
  )
);

create table dashboard_private.ops_registration_mutations (
  actor_id uuid not null
    references public.profiles(id) on delete cascade default auth.uid(),
  request_key text not null,
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  mutation_type text not null,
  target_fingerprint jsonb not null,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key),
  check (nullif(btrim(request_key), '') is not null),
  check (nullif(btrim(mutation_type), '') is not null)
);

create trigger set_updated_at_ops_registration_subject_tracks
before update on public.ops_registration_subject_tracks
for each row execute function public.set_updated_at();

create trigger set_updated_at_ops_registration_appointments
before update on public.ops_registration_appointments
for each row execute function public.set_updated_at();

create trigger set_updated_at_ops_registration_level_tests
before update on public.ops_registration_level_tests
for each row execute function public.set_updated_at();

create trigger set_updated_at_ops_registration_consultations
before update on public.ops_registration_consultations
for each row execute function public.set_updated_at();

create trigger set_updated_at_ops_registration_admission_batches
before update on public.ops_registration_admission_batches
for each row execute function public.set_updated_at();

create trigger set_updated_at_ops_registration_enrollments
before update on public.ops_registration_enrollments
for each row execute function public.set_updated_at();

create unique index ops_registration_enrollments_active_class_uidx
  on public.ops_registration_enrollments(track_id, class_id)
  where status = 'planned' or roster_active;

create unique index ops_registration_enrollments_student_class_claim_uidx
  on public.ops_registration_enrollments(student_id, class_id)
  where roster_active;

create unique index ops_registration_enrollments_one_waitlist_uidx
  on public.ops_registration_enrollments(track_id)
  where status = 'waitlisted';

create unique index ops_registration_admission_batches_one_open_uidx
  on public.ops_registration_admission_batches(task_id)
  where status not in ('completed', 'canceled');

create unique index ops_registration_level_tests_one_active_uidx
  on public.ops_registration_level_tests(track_id)
  where status in ('scheduled', 'in_progress');

create unique index ops_registration_consultations_one_active_uidx
  on public.ops_registration_consultations(track_id)
  where status in ('waiting', 'scheduled');

create index ops_registration_tracks_pipeline_queue_idx
  on public.ops_registration_subject_tracks(pipeline_status, stage_entered_at, task_id);

create index ops_registration_tracks_task_status_idx
  on public.ops_registration_subject_tracks(task_id, pipeline_status);

create index ops_registration_tracks_director_queue_idx
  on public.ops_registration_subject_tracks(
    director_profile_id,
    pipeline_status,
    stage_entered_at
  )
  where director_profile_id is not null;

create index ops_registration_appointments_task_kind_idx
  on public.ops_registration_appointments(task_id, kind, scheduled_at desc);

create index ops_registration_appointments_created_by_idx
  on public.ops_registration_appointments(created_by)
  where created_by is not null;

create index ops_registration_level_tests_track_created_idx
  on public.ops_registration_level_tests(track_id, created_at desc);

create index ops_registration_consultations_track_created_idx
  on public.ops_registration_consultations(track_id, created_at desc);

create index ops_registration_consultations_appointment_idx
  on public.ops_registration_consultations(appointment_id)
  where appointment_id is not null;

create index ops_registration_consultations_director_status_idx
  on public.ops_registration_consultations(director_profile_id, status, created_at);

create index ops_registration_batches_task_status_idx
  on public.ops_registration_admission_batches(task_id, status, revision_number desc);

create index ops_registration_enrollments_track_created_idx
  on public.ops_registration_enrollments(track_id, created_at);

create index ops_registration_enrollments_student_idx
  on public.ops_registration_enrollments(student_id)
  where student_id is not null;

create index ops_registration_enrollments_batch_sort_idx
  on public.ops_registration_enrollments(admission_batch_id, sort_order)
  where admission_batch_id is not null;

create index ops_registration_enrollments_class_idx
  on public.ops_registration_enrollments(class_id);

create index ops_registration_enrollments_textbook_idx
  on public.ops_registration_enrollments(textbook_id)
  where textbook_id is not null;

create index ops_registration_enrollments_roster_release_source_task_idx
  on public.ops_registration_enrollments(roster_release_source_task_id)
  where roster_release_source_task_id is not null;

create index ops_registration_mutations_task_created_idx
  on dashboard_private.ops_registration_mutations(task_id, created_at desc);

create view public.ops_registration_subject_track_summaries
with (security_invoker = true)
as
select
  track.id,
  track.task_id,
  track.subject,
  track.pipeline_status,
  track.director_profile_id,
  track.director_assignment_source,
  track.director_assignment_rule_key,
  track.waiting_kind,
  track.level_test_retake_decision,
  track.migration_review_required,
  track.stage_entered_at,
  track.updated_at,
  active_visit.scheduled_at as visit_scheduled_at,
  active_visit.place as visit_place
from public.ops_registration_subject_tracks track
left join lateral (
  select
    appointment.scheduled_at,
    appointment.place
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
  where consultation.track_id = track.id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
    and appointment.kind = 'visit_consultation'
    and appointment.status = 'scheduled'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_visit on true;

revoke all on table
  public.ops_registration_subject_tracks,
  public.ops_registration_appointments,
  public.ops_registration_level_tests,
  public.ops_registration_consultations,
  public.ops_registration_admission_batches,
  public.ops_registration_enrollments
from public;

revoke all on table
  public.ops_registration_subject_tracks,
  public.ops_registration_appointments,
  public.ops_registration_level_tests,
  public.ops_registration_consultations,
  public.ops_registration_admission_batches,
  public.ops_registration_enrollments
from anon, authenticated;

revoke all on table public.ops_registration_subject_track_summaries from public, anon, authenticated;

grant select on table
  public.ops_registration_subject_tracks,
  public.ops_registration_appointments,
  public.ops_registration_level_tests,
  public.ops_registration_consultations,
  public.ops_registration_admission_batches,
  public.ops_registration_enrollments
to authenticated;

grant select on table public.ops_registration_subject_track_summaries to authenticated;

alter table public.ops_registration_subject_tracks enable row level security;
alter table public.ops_registration_appointments enable row level security;
alter table public.ops_registration_level_tests enable row level security;
alter table public.ops_registration_consultations enable row level security;
alter table public.ops_registration_admission_batches enable row level security;
alter table public.ops_registration_enrollments enable row level security;

revoke all on schema dashboard_private from public;
grant usage on schema dashboard_private to authenticated;
grant usage on schema dashboard_private to service_role;
revoke all on dashboard_private.ops_registration_mutations from public, anon, authenticated;
alter table dashboard_private.ops_registration_mutations enable row level security;

create or replace function dashboard_private.registration_task_has_subject_tracks(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
  );
$$;

alter function dashboard_private.registration_task_has_subject_tracks(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_task_has_subject_tracks(uuid) from public, anon;
grant execute on function dashboard_private.registration_task_has_subject_tracks(uuid) to authenticated;

create policy ops_registration_subject_tracks_authenticated_select
  on public.ops_registration_subject_tracks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_registration_subject_tracks.task_id
    )
  );

create policy ops_registration_appointments_authenticated_select
  on public.ops_registration_appointments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_registration_appointments.task_id
    )
  );

create policy ops_registration_level_tests_authenticated_select
  on public.ops_registration_level_tests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_registration_subject_tracks track
      join public.ops_tasks task on task.id = track.task_id
      where track.id = ops_registration_level_tests.track_id
    )
  );

create policy ops_registration_consultations_authenticated_select
  on public.ops_registration_consultations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_registration_subject_tracks track
      join public.ops_tasks task on task.id = track.task_id
      where track.id = ops_registration_consultations.track_id
    )
  );

create policy ops_registration_admission_batches_authenticated_select
  on public.ops_registration_admission_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_registration_admission_batches.task_id
    )
  );

create policy ops_registration_enrollments_authenticated_select
  on public.ops_registration_enrollments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_registration_subject_tracks track
      join public.ops_tasks task on task.id = track.task_id
      where track.id = ops_registration_enrollments.track_id
    )
  );

-- registration_subject_tracks_backfill
create temporary table registration_backfill_evidence
on commit drop
as
with subject_counts as (
  select resolved.task_id, count(*) as normalized_subject_count
  from registration_resolved_subjects resolved
  group by resolved.task_id
)
select
  parent.*,
  resolved.subject,
  subject_counts.normalized_subject_count,
  director.director_profile_id,
  student.id as resolved_student_id,
  student.status as resolved_student_status,
  class.id as resolved_class_id,
  class.subject as resolved_class_subject,
  class.schedule_plan as resolved_class_schedule_plan,
  class.textbook_ids as resolved_class_textbook_ids,
  roster.roster_evidence_valid,
  (
    parent.class_id is not null
    and class.id = parent.class_id
    and btrim(class.subject) = resolved.subject
  ) as class_subject_valid,
  (
    parent.student_id is not null
    and student.id = parent.student_id
    and student.status = '재원'
  ) as student_identity_valid,
  (
    parent.textbook_id is null
    or (
      jsonb_typeof(coalesce(to_jsonb(class.textbook_ids), '[]'::jsonb)) = 'array'
      and coalesce(to_jsonb(class.textbook_ids), '[]'::jsonb) ? parent.textbook_id::text
    )
  ) as textbook_link_valid,
  (
    parent.class_start_date is null
    and nullif(btrim(parent.class_start_session), '') is null
  ) or (
    parent.class_start_date is not null
    and nullif(btrim(parent.class_start_session), '') is not null
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(to_jsonb(class.schedule_plan) -> 'sessions') = 'array'
            then to_jsonb(class.schedule_plan) -> 'sessions'
          when jsonb_typeof(to_jsonb(class.schedule_plan) -> 'session_list') = 'array'
            then to_jsonb(class.schedule_plan) -> 'session_list'
          else '[]'::jsonb
        end
      ) session
      cross join lateral (
        select
          coalesce(
            session ->> 'date',
            session ->> 'session_date',
            session ->> 'dateValue',
            session ->> 'date_value'
          ) as session_date,
          coalesce(session ->> 'sessionNumber', session ->> 'session_number') as session_number,
          lower(coalesce(
            session ->> 'scheduleState',
            session ->> 'schedule_state',
            session ->> 'state',
            'active'
          )) as session_state
      ) normalized
      where substring(normalized.session_date from '^\d{4}-\d{2}-\d{2}') = parent.class_start_date::text
        and normalized.session_state in ('active', 'normal', 'makeup')
        and case
          when normalized.session_number ~ '^[1-9]\d*$'
            then btrim(parent.class_start_session) = normalized.session_number::integer::text || '회차'
          else false
        end
    )
  ) as saved_schedule_valid,
  (
    parent.class_start_date is not null
    and nullif(btrim(parent.class_start_session), '') is not null
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(to_jsonb(class.schedule_plan) -> 'sessions') = 'array'
            then to_jsonb(class.schedule_plan) -> 'sessions'
          when jsonb_typeof(to_jsonb(class.schedule_plan) -> 'session_list') = 'array'
            then to_jsonb(class.schedule_plan) -> 'session_list'
          else '[]'::jsonb
        end
      ) session
      cross join lateral (
        select
          coalesce(
            session ->> 'date',
            session ->> 'session_date',
            session ->> 'dateValue',
            session ->> 'date_value'
          ) as session_date,
          coalesce(session ->> 'sessionNumber', session ->> 'session_number') as session_number,
          lower(coalesce(
            session ->> 'scheduleState',
            session ->> 'schedule_state',
            session ->> 'state',
            'active'
          )) as session_state
      ) normalized
      where substring(normalized.session_date from '^\d{4}-\d{2}-\d{2}') = parent.class_start_date::text
        and normalized.session_state in ('active', 'normal', 'makeup')
        and case
          when normalized.session_number ~ '^[1-9]\d*$'
            then btrim(parent.class_start_session) = normalized.session_number::integer::text || '회차'
          else false
        end
    )
  ) as required_schedule_valid
from registration_legacy_parents parent
join registration_resolved_subjects resolved on resolved.task_id = parent.task_id
join subject_counts on subject_counts.task_id = parent.task_id
left join registration_legacy_directors director on director.task_id = parent.task_id
left join public.students student on student.id = parent.student_id
left join public.classes class on class.id = parent.class_id
left join registration_roster_evidence roster
  on roster.task_id = parent.task_id
  and roster.subject = resolved.subject;

create temporary table registration_backfill_candidates
on commit drop
as
with mapped as (
  select
    evidence.*,
    case
      when evidence.pipeline_status like '0.%' then 'inquiry'
      when evidence.pipeline_status like '1.%' then 'level_test_scheduled'
      when evidence.pipeline_status like '1-1.%' then 'consultation_waiting'
      when evidence.pipeline_status like '2.%'
        and evidence.visit_consultation_at is not null
        and nullif(btrim(evidence.visit_consultation_place), '') is not null
        then 'visit_consultation_scheduled'
      when evidence.pipeline_status like '2.%' then 'consultation_waiting'
      when evidence.pipeline_status like '3.%' then 'migration_review'
      when evidence.pipeline_status like '4-1.%' then 'waiting'
      when evidence.pipeline_status like '4-2.%' then 'waiting'
      when evidence.pipeline_status like '4-3.%' then 'waiting'
      when evidence.pipeline_status like '5.%' then 'enrollment_decided'
      when evidence.pipeline_status like '5-1.%'
        or evidence.pipeline_status like '6.%' then 'enrollment_processing'
      when evidence.pipeline_status like '7.%' then 'registered'
      when evidence.pipeline_status like '8.%' then 'not_registered'
      when evidence.pipeline_status like '9.%' then 'inquiry_closed'
      else 'migration_review'
    end as mapped_pipeline_status,
    case
      when not evidence.detail_exists then false
      when evidence.pipeline_status like '0.%' then true
      when evidence.pipeline_status like '1-1.%' then
        evidence.level_test_at is not null
        and nullif(btrim(evidence.level_test_place), '') is not null
        and evidence.level_test_completed_at is not null
        and nullif(btrim(evidence.level_test_material_link), '') is not null
        and evidence.director_profile_id is not null
      when evidence.pipeline_status like '1.%' then
        evidence.level_test_at is not null
        and nullif(btrim(evidence.level_test_place), '') is not null
      when evidence.pipeline_status like '2.%' then
        evidence.director_profile_id is not null
        and (
          (
            evidence.visit_consultation_at is not null
            and nullif(btrim(evidence.visit_consultation_place), '') is not null
          )
          or (
            evidence.visit_consultation_at is null
            and nullif(btrim(evidence.visit_consultation_place), '') is null
          )
        )
      when evidence.pipeline_status like '3.%' then false
      when evidence.pipeline_status like '4-1.%' then
        coalesce(evidence.roster_evidence_valid, false)
      when evidence.pipeline_status like '4-2.%'
        or evidence.pipeline_status like '4-3.%' then true
      when evidence.pipeline_status like '5-1.%' then
        evidence.student_identity_valid
        and evidence.class_subject_valid
        and evidence.required_schedule_valid
        and evidence.textbook_link_valid
        and evidence.admission_notice_sent
      when evidence.pipeline_status like '5.%' then
        evidence.class_subject_valid
        and evidence.saved_schedule_valid
      when evidence.pipeline_status like '6.%' then
        evidence.student_identity_valid
        and evidence.class_subject_valid
        and evidence.required_schedule_valid
        and evidence.textbook_link_valid
        and evidence.admission_notice_sent
        and evidence.makeedu_registered
        and (not evidence.payment_checked or evidence.makeedu_invoice_sent)
      when evidence.pipeline_status like '7.%' then
        evidence.student_identity_valid
        and evidence.class_subject_valid
        and evidence.required_schedule_valid
        and evidence.textbook_link_valid
        and evidence.admission_notice_sent
        and evidence.makeedu_registered
        and evidence.makeedu_invoice_sent
        and evidence.payment_checked
        and coalesce(evidence.roster_evidence_valid, false)
      when evidence.pipeline_status like '8.%'
        or evidence.pipeline_status like '9.%' then true
      else false
    end as legacy_evidence_valid
  from registration_backfill_evidence evidence
), resolved as (
  select
    mapped.*,
    case
      when mapped.mapped_pipeline_status = 'migration_review' then 'migration_review'
      when mapped.normalized_subject_count > 1
        and (
          not mapped.detail_exists
          or (mapped.pipeline_status like '0.%') is not true
        ) then 'migration_review'
      when mapped.normalized_subject_count = 1
        and not coalesce(mapped.legacy_evidence_valid, false) then 'migration_review'
      else mapped.mapped_pipeline_status
    end as resolved_pipeline_status
  from mapped
)
select
  gen_random_uuid() as track_id,
  gen_random_uuid() as appointment_id,
  gen_random_uuid() as batch_id,
  resolved.*,
  resolved.resolved_pipeline_status = 'migration_review' as migration_review_required,
  case
    when resolved.resolved_pipeline_status <> 'waiting' then null
    when resolved.pipeline_status like '4-1.%' then 'current_class'
    when resolved.pipeline_status like '4-2.%' then 'current_term_opening'
    when resolved.pipeline_status like '4-3.%' then 'next_term_opening'
    else null
  end as waiting_kind,
  coalesce(
    case
      when resolved.pipeline_status like '0.%' then resolved.inquiry_at
      when resolved.pipeline_status like '1-1.%' then greatest(
        resolved.level_test_completed_at,
        resolved.level_test_at
      )
      when resolved.pipeline_status like '1.%' then resolved.level_test_at
      when resolved.pipeline_status like '2.%' then greatest(
        resolved.visit_consultation_at,
        resolved.phone_consultation_at
      )
      when resolved.pipeline_status like '3.%' then greatest(
        resolved.consultation_at,
        resolved.visit_consultation_at,
        resolved.phone_consultation_at
      )
      when resolved.pipeline_status like '8.%'
        or resolved.pipeline_status like '9.%' then resolved.task_completed_at
      else null
    end,
    resolved.task_updated_at,
    resolved.task_created_at
  ) as stage_entered_at,
  case
    when resolved.pipeline_status like '7.%' then 'completed'
    when resolved.pipeline_status like '6.%'
      and resolved.payment_checked
      and resolved.makeedu_invoice_sent then 'paid'
    when resolved.pipeline_status like '6.%'
      and resolved.makeedu_invoice_sent then 'invoiced'
    else 'draft'
  end as admission_batch_status
from resolved;

create temporary table registration_active_claim_candidates
on commit drop
as
select
  candidate.task_id,
  candidate.track_id,
  candidate.student_id,
  candidate.class_id,
  candidate.pipeline_status,
  candidate.resolved_pipeline_status
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and candidate.student_identity_valid
  and candidate.class_subject_valid
  and (
    candidate.pipeline_status like '4-1.%'
    or candidate.pipeline_status like '5-1.%'
    or candidate.pipeline_status like '6.%'
    or candidate.pipeline_status like '7.%'
  );

create temporary table registration_duplicate_active_claim_pairs
on commit drop
as
select claim.student_id, claim.class_id, count(*) as claim_count
from registration_active_claim_candidates claim
group by claim.student_id, claim.class_id
having count(*) > 1;

-- reviewed_registration_student_class_claims
create temporary table reviewed_registration_student_class_claims_input (
  student_id uuid,
  class_id uuid,
  target_task_id uuid
) on commit drop;

-- Portable placeholder. A reviewer, never SQL heuristics, selects a historical owner.
insert into reviewed_registration_student_class_claims_input (
  student_id,
  class_id,
  target_task_id
)
values (null::uuid, null::uuid, null::uuid);

create temporary table reviewed_registration_student_class_claims
on commit drop
as
select reviewed.student_id, reviewed.class_id, reviewed.target_task_id
from reviewed_registration_student_class_claims_input reviewed
join public.students student on student.id = reviewed.student_id
join public.classes class on class.id = reviewed.class_id
join registration_legacy_parents parent on parent.task_id = reviewed.target_task_id;

do $$
begin
  if exists (
    select 1
    from reviewed_registration_student_class_claims reviewed
    left join registration_duplicate_active_claim_pairs duplicate_pair
      on duplicate_pair.student_id = reviewed.student_id
      and duplicate_pair.class_id = reviewed.class_id
    left join registration_active_claim_candidates claim
      on claim.student_id = reviewed.student_id
      and claim.class_id = reviewed.class_id
      and claim.task_id = reviewed.target_task_id
      and (
        claim.pipeline_status like '4-1.%'
        or claim.pipeline_status like '7.%'
      )
    where duplicate_pair.student_id is null
      or claim.task_id is null
  ) or exists (
    select 1
    from reviewed_registration_student_class_claims reviewed
    group by reviewed.student_id, reviewed.class_id
    having count(*) <> 1
  ) then
    raise exception 'registration_student_class_claim_review_required';
  end if;

  if exists (
    select 1
    from registration_duplicate_active_claim_pairs duplicate_pair
    where exists (
      select 1
      from registration_active_claim_candidates claim
      where claim.student_id = duplicate_pair.student_id
        and claim.class_id = duplicate_pair.class_id
        and (
          claim.pipeline_status like '4-1.%'
          or claim.pipeline_status like '7.%'
        )
    )
      and not exists (
        select 1
        from reviewed_registration_student_class_claims reviewed
        where reviewed.student_id = duplicate_pair.student_id
          and reviewed.class_id = duplicate_pair.class_id
      )
  ) then
    raise exception 'registration_student_class_claim_review_required';
  end if;
end
$$;

update registration_backfill_candidates candidate
set
  resolved_pipeline_status = 'migration_review',
  migration_review_required = true,
  waiting_kind = null
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    (
      (candidate.pipeline_status like '5-1.%' or candidate.pipeline_status like '6.%')
      and exists (
        select 1
        from global_roster_projection_pairs pair
        where pair.student_id = candidate.student_id
          and pair.class_id = candidate.class_id
      )
    )
    or exists (
      select 1
      from registration_duplicate_active_claim_pairs duplicate_pair
      where duplicate_pair.student_id = candidate.student_id
        and duplicate_pair.class_id = candidate.class_id
        and not exists (
          select 1
          from reviewed_registration_student_class_claims reviewed
          where reviewed.student_id = duplicate_pair.student_id
            and reviewed.class_id = duplicate_pair.class_id
            and reviewed.target_task_id = candidate.task_id
        )
    )
  );

insert into public.ops_registration_subject_tracks (
  id,
  task_id,
  subject,
  pipeline_status,
  director_profile_id,
  director_assignment_source,
  director_assignment_rule_key,
  director_assigned_at,
  waiting_kind,
  migration_review_required,
  stage_entered_at,
  created_at,
  updated_at
)
select
  candidate.track_id,
  candidate.task_id,
  candidate.subject,
  candidate.resolved_pipeline_status,
  case
    when candidate.normalized_subject_count = 1 then candidate.director_profile_id
    else null
  end,
  case
    when candidate.normalized_subject_count = 1
      and candidate.director_profile_id is not null then 'migration'
    else null
  end,
  null,
  case
    when candidate.normalized_subject_count = 1
      and candidate.director_profile_id is not null then coalesce(
        greatest(
          candidate.consultation_at,
          candidate.visit_consultation_at,
          candidate.phone_consultation_at
        ),
        candidate.task_updated_at,
        candidate.task_created_at
      )
    else null
  end,
  candidate.waiting_kind,
  candidate.migration_review_required,
  candidate.stage_entered_at,
  candidate.task_created_at,
  candidate.task_updated_at
from registration_backfill_candidates candidate
order by candidate.task_id, candidate.subject;

insert into public.ops_registration_appointments (
  id,
  task_id,
  kind,
  scheduled_at,
  place,
  status,
  created_by,
  created_at,
  updated_at
)
select
  candidate.appointment_id,
  candidate.task_id,
  case
    when candidate.pipeline_status like '2.%' then 'visit_consultation'
    else 'level_test'
  end,
  case
    when candidate.pipeline_status like '2.%' then candidate.visit_consultation_at
    else candidate.level_test_at
  end,
  case
    when candidate.pipeline_status like '2.%' then btrim(candidate.visit_consultation_place)
    else btrim(candidate.level_test_place)
  end,
  case
    when candidate.pipeline_status like '1-1.%' then 'completed'
    else 'scheduled'
  end,
  null,
  coalesce(candidate.inquiry_at, candidate.task_created_at),
  candidate.stage_entered_at
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    candidate.pipeline_status like '1.%'
    or candidate.pipeline_status like '1-1.%'
    or (
      candidate.pipeline_status like '2.%'
      and candidate.visit_consultation_at is not null
    )
  )
order by candidate.task_id;

insert into public.ops_registration_level_tests (
  track_id,
  appointment_id,
  attempt_number,
  status,
  started_at,
  completed_at,
  material_link,
  created_at,
  updated_at
)
select
  candidate.track_id,
  candidate.appointment_id,
  1,
  case
    when candidate.pipeline_status like '1-1.%' then 'completed'
    else 'scheduled'
  end,
  case
    when candidate.pipeline_status like '1-1.%' then candidate.level_test_at
    else null
  end,
  case
    when candidate.pipeline_status like '1-1.%' then candidate.level_test_completed_at
    else null
  end,
  case
    when candidate.pipeline_status like '1-1.%'
      then btrim(candidate.level_test_material_link)
    else null
  end,
  coalesce(candidate.inquiry_at, candidate.task_created_at),
  candidate.stage_entered_at
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    candidate.pipeline_status like '1.%'
    or candidate.pipeline_status like '1-1.%'
  )
order by candidate.task_id;

insert into public.ops_registration_consultations (
  track_id,
  appointment_id,
  mode,
  status,
  director_profile_id,
  created_at,
  updated_at
)
select
  candidate.track_id,
  case
    when candidate.pipeline_status like '2.%'
      and candidate.visit_consultation_at is not null then candidate.appointment_id
    else null
  end,
  case
    when candidate.pipeline_status like '2.%'
      and candidate.visit_consultation_at is not null then 'visit'
    else 'phone'
  end,
  case
    when candidate.pipeline_status like '2.%'
      and candidate.visit_consultation_at is not null then 'scheduled'
    else 'waiting'
  end,
  candidate.director_profile_id,
  coalesce(
    candidate.level_test_completed_at,
    candidate.visit_consultation_at,
    candidate.task_updated_at,
    candidate.task_created_at
  ),
  candidate.stage_entered_at
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    candidate.pipeline_status like '1-1.%'
    or candidate.pipeline_status like '2.%'
  )
order by candidate.task_id;

do $$
begin
  if exists (
    select 1
    from registration_backfill_candidates candidate
    where candidate.normalized_subject_count = 1
      and candidate.resolved_pipeline_status <> 'migration_review'
      and (
        candidate.pipeline_status like '4-1.%'
        or candidate.pipeline_status like '5-1.%'
        or candidate.pipeline_status like '6.%'
        or candidate.pipeline_status like '7.%'
      )
    group by candidate.student_id, candidate.class_id
    having count(*) > 1
  ) then
    raise exception 'registration_student_class_claim_review_required';
  end if;
end
$$;

insert into public.ops_registration_admission_batches (
  id,
  task_id,
  revision_number,
  status,
  invoice_sent_at,
  payment_confirmed_at,
  created_at,
  updated_at
)
select
  candidate.batch_id,
  candidate.task_id,
  1,
  candidate.admission_batch_status,
  case
    when candidate.admission_batch_status in ('invoiced', 'paid', 'completed')
      then candidate.task_updated_at
    else null
  end,
  case
    when candidate.admission_batch_status in ('paid', 'completed')
      then candidate.task_updated_at
    else null
  end,
  coalesce((
    select min(message.created_at)
    from public.ops_registration_messages message
    where message.task_id = candidate.task_id
      and message.template_key = 'admission_application'
      and message.status in ('accepted', 'unknown')
  ), candidate.task_created_at),
  candidate.task_updated_at
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    candidate.pipeline_status like '5-1.%'
    or candidate.pipeline_status like '6.%'
    or candidate.pipeline_status like '7.%'
  )
order by candidate.task_id;

insert into public.ops_registration_enrollments (
  track_id,
  student_id,
  admission_batch_id,
  class_id,
  textbook_id,
  class_start_date,
  class_start_session_key,
  class_start_session,
  status,
  makeedu_registered,
  roster_active,
  roster_released_at,
  roster_release_reason,
  roster_release_source_task_id,
  roster_release_kind,
  sort_order,
  created_at,
  updated_at
)
select
  candidate.track_id,
  case
    when candidate.pipeline_status like '5.%' then null
    else candidate.student_id
  end,
  case
    when candidate.pipeline_status like '4-1.%'
      or candidate.pipeline_status like '5.%' then null
    else candidate.batch_id
  end,
  candidate.class_id,
  case
    when not (candidate.pipeline_status like '4-1.%')
      and candidate.textbook_link_valid then candidate.textbook_id
    else null
  end,
  case
    when candidate.pipeline_status like '4-1.%' then null
    else candidate.class_start_date
  end,
  case
    when candidate.pipeline_status like '4-1.%'
      or candidate.class_start_date is null then null
    else candidate.class_start_date::text || ':'
      || substring(btrim(candidate.class_start_session) from '^([1-9][0-9]*)회차$')
  end,
  case
    when candidate.pipeline_status like '4-1.%' then null
    else nullif(btrim(candidate.class_start_session), '')
  end,
  case
    when candidate.pipeline_status like '4-1.%' then 'waitlisted'
    when candidate.pipeline_status like '7.%' then 'enrolled'
    else 'planned'
  end,
  case
    when candidate.pipeline_status like '5-1.%'
      or candidate.pipeline_status like '6.%'
      or candidate.pipeline_status like '7.%' then candidate.makeedu_registered
    else false
  end,
  not (candidate.pipeline_status like '5.%'),
  null,
  null,
  null,
  null,
  0,
  candidate.stage_entered_at,
  candidate.task_updated_at
from registration_backfill_candidates candidate
where candidate.normalized_subject_count = 1
  and candidate.resolved_pipeline_status <> 'migration_review'
  and (
    candidate.pipeline_status like '4-1.%'
    or candidate.pipeline_status like '5.%'
    or candidate.pipeline_status like '5-1.%'
    or candidate.pipeline_status like '6.%'
    or candidate.pipeline_status like '7.%'
  )
order by candidate.task_id;

insert into public.ops_task_events (
  task_id,
  actor_id,
  event_type,
  field_name,
  before_value,
  after_value,
  created_at
)
select
  candidate.task_id,
  null,
  'legacy_registration_imported',
  'registration_subject_track',
  jsonb_build_object(
    'pipelineStatus', candidate.pipeline_status,
    'rawSubject', candidate.raw_subject,
    'studentId', candidate.student_id,
    'classId', candidate.class_id,
    'textbookId', candidate.textbook_id
  )::text,
  jsonb_build_object(
    'version', 1,
    'eventType', 'legacy_registration_imported',
    'subject', candidate.subject,
    'trackId', candidate.track_id,
    'pipelineStatus', candidate.resolved_pipeline_status,
    'migrationReviewRequired', candidate.migration_review_required,
    'legacyEvidenceValid', candidate.legacy_evidence_valid,
    'stageEnteredAt', candidate.stage_entered_at,
    'timestamps', jsonb_build_object(
      'taskCreatedAt', candidate.task_created_at,
      'taskUpdatedAt', candidate.task_updated_at,
      'taskCompletedAt', candidate.task_completed_at,
      'detailCreatedAt', candidate.detail_created_at,
      'detailUpdatedAt', candidate.detail_updated_at,
      'inquiryAt', candidate.inquiry_at,
      'levelTestAt', candidate.level_test_at,
      'levelTestCompletedAt', candidate.level_test_completed_at,
      'phoneConsultationAt', candidate.phone_consultation_at,
      'visitConsultationAt', candidate.visit_consultation_at,
      'consultationAt', candidate.consultation_at,
      'classStartDate', candidate.class_start_date,
      'classStartSession', candidate.class_start_session,
      'invoiceSentAtApproximation', case
        when candidate.admission_batch_status in ('invoiced', 'paid', 'completed')
          then candidate.task_updated_at
        else null
      end,
      'paymentConfirmedAtApproximation', case
        when candidate.admission_batch_status in ('paid', 'completed')
          then candidate.task_updated_at
        else null
      end
    ),
    'legacyBooleans', jsonb_build_object(
      'textbookReady', candidate.textbook_ready,
      'admissionNoticeSent', candidate.admission_notice_sent,
      'paymentChecked', candidate.payment_checked,
      'makeeduRegistered', candidate.makeedu_registered,
      'makeeduInvoiceSent', candidate.makeedu_invoice_sent,
      'textbookBillingIssued', candidate.textbook_billing_issued,
      'timetableRosterUpdated', candidate.timetable_roster_updated
    ),
    'provenance', jsonb_build_object(
      'source', 'registration_subject_tracks_schema',
      'invoiceTimestamp', case
        when candidate.admission_batch_status in ('invoiced', 'paid', 'completed')
          then 'task.updated_at_imported_approximation'
        else null
      end,
      'paymentTimestamp', case
        when candidate.admission_batch_status in ('paid', 'completed')
          then 'task.updated_at_imported_approximation'
        else null
      end
    )
  )::text,
  candidate.stage_entered_at
from registration_backfill_candidates candidate
order by candidate.task_id, candidate.subject;

do $$
begin
  if exists (
    select 1
    from registration_legacy_parents parent
    where (
      select count(*)
      from public.ops_registration_subject_tracks track
      where track.task_id = parent.task_id
    ) not between 1 and 2
      or coalesce((
        select array_agg(resolved.subject order by resolved.subject)
        from registration_resolved_subjects resolved
        where resolved.task_id = parent.task_id
      ), array[]::text[]) <> coalesce((
        select array_agg(track.subject order by track.subject)
        from public.ops_registration_subject_tracks track
        where track.task_id = parent.task_id
      ), array[]::text[])
  ) then
    raise exception 'registration_subject_track_coverage_mismatch';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.roster_active
    group by enrollment.student_id, enrollment.class_id
    having count(*) > 1
  ) or exists (
    select 1
    from registration_backfill_candidates candidate
    where candidate.normalized_subject_count = 1
      and candidate.resolved_pipeline_status <> 'migration_review'
      and (
        candidate.pipeline_status like '4-1.%'
        or candidate.pipeline_status like '5-1.%'
        or candidate.pipeline_status like '6.%'
        or candidate.pipeline_status like '7.%'
      )
      and not exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = candidate.track_id
          and enrollment.student_id = candidate.student_id
          and enrollment.class_id = candidate.class_id
          and enrollment.roster_active
      )
  ) or exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.roster_active
      and (
        (
          enrollment.status = 'planned'
          and exists (
            select 1
            from global_roster_projection_pairs pair
            where pair.student_id = enrollment.student_id
              and pair.class_id = enrollment.class_id
          )
        )
        or (
          enrollment.status = 'waitlisted'
          and not exists (
            select 1
            from global_roster_projection_pairs pair
            where pair.student_id = enrollment.student_id
              and pair.class_id = enrollment.class_id
              and pair.roster_mode = 'waitlist'
          )
        )
        or (
          enrollment.status = 'enrolled'
          and not exists (
            select 1
            from global_roster_projection_pairs pair
            where pair.student_id = enrollment.student_id
              and pair.class_id = enrollment.class_id
              and pair.roster_mode = 'enrolled'
          )
        )
      )
  ) then
    raise exception 'registration_student_class_claim_review_required';
  end if;
end
$$;

drop policy if exists ops_tasks_select on public.ops_tasks;
create policy ops_tasks_select
  on public.ops_tasks
  for select
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff', 'assistant')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  );

drop policy if exists ops_tasks_insert on public.ops_tasks;
create policy ops_tasks_insert
  on public.ops_tasks
  for insert
  to authenticated
  with check (
    type <> 'registration'
    and (
      requested_by is null
      or requested_by = auth.uid()
      or public.current_dashboard_role() in ('admin', 'staff', 'assistant')
    )
  );

drop policy if exists ops_tasks_update on public.ops_tasks;
create policy ops_tasks_update
  on public.ops_tasks
  for update
  to authenticated
  using (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      public.current_dashboard_role() in ('admin', 'staff', 'assistant')
      or requested_by = auth.uid()
      or assignee_id = auth.uid()
      or secondary_assignee_id = auth.uid()
      or dashboard_private.is_ops_word_retest_teacher(id)
    )
  )
  with check (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      public.current_dashboard_role() in ('admin', 'staff', 'assistant')
      or requested_by = auth.uid()
      or assignee_id = auth.uid()
      or secondary_assignee_id = auth.uid()
      or dashboard_private.is_ops_word_retest_teacher(id)
    )
  );

drop policy if exists ops_tasks_delete on public.ops_tasks;
create policy ops_tasks_delete
  on public.ops_tasks
  for delete
  to authenticated
  using (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      public.current_dashboard_role() = 'admin'
      or (
        type = 'general'
        and (
          requested_by = auth.uid()
          or assignee_id = auth.uid()
          or secondary_assignee_id = auth.uid()
        )
      )
      or (
        requested_by = auth.uid()
        and status not in ('done', 'canceled')
      )
      or (
        public.current_dashboard_role() = 'staff'
        and (
          type = 'general'
          or status not in ('done', 'canceled')
        )
      )
    )
  );

drop policy if exists ops_registration_details_insert
  on public.ops_registration_details;

drop policy if exists ops_registration_details_update
  on public.ops_registration_details;
create policy ops_registration_details_update
  on public.ops_registration_details
  for update
  to authenticated
  using (
    not exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = ops_registration_details.task_id
    )
    and exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = ops_registration_details.task_id
        and (
          public.current_dashboard_role() = 'admin'
          or ops_tasks.status not in ('done', 'canceled')
        )
    )
  )
  with check (
    not exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = ops_registration_details.task_id
    )
    and exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = ops_registration_details.task_id
        and (
          public.current_dashboard_role() = 'admin'
          or ops_tasks.status not in ('done', 'canceled')
        )
    )
  );

drop policy if exists ops_registration_details_delete
  on public.ops_registration_details;
create policy ops_registration_details_delete
  on public.ops_registration_details
  for delete
  to authenticated
  using (
    not exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = ops_registration_details.task_id
    )
    and exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = ops_registration_details.task_id
        and (
          public.current_dashboard_role() = 'admin'
          or (
            public.current_dashboard_role() = 'staff'
            and ops_tasks.status not in ('done', 'canceled')
          )
        )
    )
  );

drop policy if exists ops_task_events_write on public.ops_task_events;
create policy ops_task_events_write
  on public.ops_task_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ops_tasks
      where ops_tasks.id = ops_task_events.task_id
    )
    and (
      not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = ops_task_events.task_id
      )
      or event_type not in ('registration_track_event', 'legacy_registration_imported', 'customer_message_sent', 'registration_admission_message_reconciled', 'registration_admission_message_retry_released', 'registration_subject_removed')
    )
  );

create or replace function dashboard_private.prevent_registration_type_reclassification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.type is distinct from new.type
    and (old.type = 'registration' or new.type = 'registration')
  then
    raise exception 'registration_type_reclassification_forbidden';
  end if;

  return new;
end;
$$;

alter function dashboard_private.prevent_registration_type_reclassification()
  owner to postgres;
revoke all on function dashboard_private.prevent_registration_type_reclassification()
  from public, anon, authenticated;

drop trigger if exists prevent_registration_type_reclassification
  on public.ops_tasks;
create trigger prevent_registration_type_reclassification
before update of type on public.ops_tasks
for each row
execute function dashboard_private.prevent_registration_type_reclassification();
