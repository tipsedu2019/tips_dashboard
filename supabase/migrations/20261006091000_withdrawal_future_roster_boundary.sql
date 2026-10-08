begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Only expose the immutable cutoff of the still-current relation. The current
-- parent SELECT policies allow every authenticated reader; callers below still
-- join those parents as invokers. No queue, task, claim or actor ID is returned.
create function dashboard_private.withdrawal_roster_cutoff_v1(
  p_student_id uuid,
  p_class_id uuid
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutoff date;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'withdrawal_roster_read_forbidden' using errcode = '42501';
  end if;

  select release.last_lesson_date into v_cutoff
  from dashboard_private.withdrawal_roster_release_queue_v1 release
  join public.students student on student.id = release.student_id
  join public.classes class on class.id = release.class_id
  left join public.ops_tasks task on task.id = release.task_id
  cross join lateral (
    select pg_catalog.count(*) as claim_count,
      (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1] as claim_id
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = release.student_id
      and enrollment.class_id = release.class_id
      and enrollment.roster_active
  ) active_claim
  where release.student_id = p_student_id and release.class_id = p_class_id
    and release.status = 'pending'
    and student.status = '재원'
    and coalesce(student.class_ids, '[]'::jsonb) ? release.class_id::text
    and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? release.class_id::text)
    and coalesce(class.student_ids, '[]'::jsonb) ? release.student_id::text
    and not (coalesce(class.waitlist_ids, '[]'::jsonb) ? release.student_id::text)
    and release.expected_history_count = (
      select pg_catalog.count(*) from public.student_class_enrollment_history history
      where history.student_id = release.student_id and history.class_id = release.class_id
    )
    and active_claim.claim_count <= 1
    and active_claim.claim_id is not distinct from release.expected_claim_id
    and (task.id is null and release.expected_claim_id is null
      or task.type = 'withdrawal' and task.status = 'done'
        and task.student_id = release.student_id and task.class_id = release.class_id)
    and (release.expected_claim_id is null or exists (
      select 1 from public.ops_registration_enrollments enrollment
      where enrollment.id = release.expected_claim_id and enrollment.status = 'enrolled'
        and not exists (
          select 1 from public.ops_registration_admission_batches batch
          where batch.id = enrollment.admission_batch_id and batch.status not in ('completed', 'canceled')
        )
    ));
  return v_cutoff;
end;
$$;
alter function dashboard_private.withdrawal_roster_cutoff_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.withdrawal_roster_cutoff_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.withdrawal_roster_cutoff_v1(uuid,uuid) to authenticated;

create function dashboard_private.withdrawal_roster_includes_date_v1(
  p_student_id uuid,
  p_class_id uuid,
  p_lesson_date date
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(p_lesson_date <= dashboard_private.withdrawal_roster_cutoff_v1(p_student_id,p_class_id), true);
$$;
alter function dashboard_private.withdrawal_roster_includes_date_v1(uuid,uuid,date) owner to postgres;
revoke all on function dashboard_private.withdrawal_roster_includes_date_v1(uuid,uuid,date)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.withdrawal_roster_includes_date_v1(uuid,uuid,date) to authenticated;

-- Home readers need only pending reservations, not one lookup per live roster
-- pair. Materialize each validated cutoff once, at the queue's bounded scale.
create function dashboard_private.withdrawal_current_roster_cutoffs_v1()
returns table(student_id uuid, class_id uuid, last_lesson_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'withdrawal_roster_read_forbidden' using errcode = '42501';
  end if;
  return query
    with pending as materialized (
      select release.student_id, release.class_id,
        dashboard_private.withdrawal_roster_cutoff_v1(release.student_id,release.class_id) as cutoff
      from dashboard_private.withdrawal_roster_release_queue_v1 release
      where release.status = 'pending'
    )
    select pending.student_id, pending.class_id, pending.cutoff
    from pending where pending.cutoff is not null;
end;
$$;
alter function dashboard_private.withdrawal_current_roster_cutoffs_v1() owner to postgres;
revoke all on function dashboard_private.withdrawal_current_roster_cutoffs_v1()
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.withdrawal_current_roster_cutoffs_v1() to authenticated;

-- Keep the existing invoker/RLS contract and every other statistics branch.
-- A pending withdrawal ends after its last lesson date, even before the no-send
-- release worker has removed the current roster projection.
do $withdrawal_future_roster_boundary$
declare
  v_target regprocedure :=
    'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::regprocedure;
  v_definition text;
  v_before record;
  v_with_anchor text := $anchor$    with visible_classes as materialized ($anchor$;
  v_with_replacement text := $replacement$    with withdrawal_cutoffs as materialized (
      select student_id, class_id, last_lesson_date
      from dashboard_private.withdrawal_current_roster_cutoffs_v1()
    ),
    visible_classes as materialized ($replacement$;
  v_anchor text := $anchor$      join public.students student on student.id::text = enrolled.student_id
      join public.academic_schools school
        on $anchor$;
  v_replacement text;
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.withdrawal_roster_includes_date_v1(uuid,uuid,date)'
  ) is null then
    raise exception 'withdrawal_future_roster_helper_required' using errcode = '55000';
  end if;

  select proowner, proacl, prosecdef, provolatile, proconfig
  into strict v_before
  from pg_catalog.pg_proc
  where oid = v_target;
  if v_before.prosecdef or v_before.provolatile <> 's' then
    raise exception 'withdrawal_future_roster_function_contract_changed' using errcode = '55000';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
    <> pg_catalog.length(v_anchor)
    or pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_with_anchor, ''))
      <> pg_catalog.length(v_with_anchor)
  then
    raise exception 'withdrawal_future_roster_patch_target_missing' using errcode = '55000';
  end if;
  v_replacement := $replacement$      join public.students student on student.id::text = enrolled.student_id
      left join withdrawal_cutoffs cutoff
        on cutoff.student_id = student.id and cutoff.class_id = session.class_id
      join public.academic_schools school
        on (cutoff.last_lesson_date is null or session.session_date <= cutoff.last_lesson_date)
          and $replacement$;
  v_definition := pg_catalog.replace(v_definition, v_with_anchor, v_with_replacement);
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  if exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_target
      and (
        proowner is distinct from v_before.proowner
        or proacl is distinct from v_before.proacl
        or prosecdef is distinct from v_before.prosecdef
        or provolatile is distinct from v_before.provolatile
        or proconfig is distinct from v_before.proconfig
      )
  ) then
    raise exception 'withdrawal_future_roster_patch_metadata_changed' using errcode = '55000';
  end if;
end;
$withdrawal_future_roster_boundary$;

-- Supply only cutoff dates for the RLS-visible reciprocal roster pairs. Keep the
-- final home RPC's validation, source projections, owner, ACL and invoker mode.
do $withdrawal_future_roster_sources$
declare
  v_target regprocedure := 'public.get_dashboard_conflict_sources_v1(date,date)'::regprocedure;
  v_definition text;
  v_before record;
  v_anchor text := $anchor$    'sessionDates', coalesce(($anchor$;
  v_replacement text := $replacement$    'withdrawalRosterCutoffs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'studentId', pair.student_id,
          'classId', pair.class_id,
          'lastLessonDate', pair.last_lesson_date
        ) order by pair.class_id, pair.student_id
      )
      from dashboard_private.withdrawal_current_roster_cutoffs_v1() pair
      join public.classes class on class.id = pair.class_id
      join public.students student on student.id = pair.student_id
    ), '[]'::jsonb),
    'sessionDates', coalesce(($replacement$;
begin
  select proowner, proacl, prosecdef, provolatile, proconfig
  into strict v_before
  from pg_catalog.pg_proc
  where oid = v_target;
  if v_before.prosecdef or v_before.provolatile <> 's' then
    raise exception 'withdrawal_future_roster_source_contract_changed' using errcode = '55000';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  if pg_catalog.strpos(v_definition, '''withdrawalRosterCutoffs''') > 0
    or pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
      <> pg_catalog.length(v_anchor)
  then
    raise exception 'withdrawal_future_roster_source_patch_target_missing' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
  if exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_target
      and (
        proowner is distinct from v_before.proowner
        or proacl is distinct from v_before.proacl
        or prosecdef is distinct from v_before.prosecdef
        or provolatile is distinct from v_before.provolatile
        or proconfig is distinct from v_before.proconfig
      )
  ) then
    raise exception 'withdrawal_future_roster_source_patch_metadata_changed' using errcode = '55000';
  end if;
end;
$withdrawal_future_roster_sources$;

commit;
