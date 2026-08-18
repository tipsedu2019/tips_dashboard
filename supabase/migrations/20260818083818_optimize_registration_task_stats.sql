alter function public.get_ops_task_list_stats_v1(text, jsonb)
  set schema dashboard_private;

alter function dashboard_private.get_ops_task_list_stats_v1(text, jsonb)
  rename to ops_task_list_stats_legacy_v1;

create or replace function dashboard_private.ops_registration_task_stats_v1(
  p_filters jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set timezone = 'Asia/Seoul'
as $function$
  with asserted as materialized (
    select dashboard_private.ops_task_page_assert_filters_v1('registration', p_filters)
  ), base as materialized (
    select
      task.id as task_id,
      task.status as task_status,
      task.title,
      task.student_name,
      detail.parent_phone,
      detail.student_phone,
      detail.school_grade,
      detail.school_name,
      detail.request_note
    from asserted
    cross join public.ops_tasks task
    left join public.ops_registration_details detail on detail.task_id = task.id
    where task.type = 'registration'
      and (
        pg_catalog.jsonb_array_length(p_filters -> 'statuses') = 0
        or task.status in (
          select item #>> '{}'
          from pg_catalog.jsonb_array_elements(p_filters -> 'statuses') item
        )
      )
  ), memberships as materialized (
    select distinct
      base.task_id,
      base.task_status,
      case
        when summary.workflow_status = 'inquiry' then 'inquiry'
        when summary.workflow_status = 'level_test_requested' then 'level_test'
        when summary.workflow_status = 'consultation_requested' then 'consultation_requested'
        when summary.workflow_status = 'consultation_completed' then 'consultation_completed'
        when summary.workflow_status in (
          'waiting_current_class', 'waiting_new_class', 'waiting_next_opening'
        ) then 'waiting'
        when summary.workflow_status in (
          'observation_requested', 'observation_feedback_pending', 'observation_completed'
        ) then 'observation'
        when summary.workflow_status = 'enrollment_requested' then 'enrollment'
        when summary.workflow_status = 'payment_in_progress' then 'payment'
        when summary.workflow_status in ('registered', 'not_registered', 'inquiry_only') then 'completed'
        else null
      end as view_key,
      summary.director_profile_id
    from base
    join public.ops_registration_subject_track_summaries summary
      on summary.task_id = base.task_id
    left join public.profiles director on director.id = summary.director_profile_id
    where nullif(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')),
        '[[:space:]-]+',
        '',
        'g'
      ),
      ''
    ) is null
    or pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.concat_ws(
        ' ',
        base.student_name,
        base.title,
        base.parent_phone,
        base.student_phone,
        base.school_grade,
        base.school_name,
        base.request_note,
        summary.subject,
        director.name,
        summary.visit_place
      )),
      '[[:space:]-]+',
      '',
      'g'
    ) like '%' || pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')),
      '[[:space:]-]+',
      '',
      'g'
    ) || '%'
  ), selected as materialized (
    select distinct memberships.task_id, memberships.task_status
    from memberships
    where memberships.view_key = p_filters ->> 'view'
      and (
        p_filters ->> 'view' not in ('consultation_requested', 'consultation_completed')
        or nullif(p_filters ->> 'consultationOwnerId', '') is null
        or memberships.director_profile_id::text = p_filters ->> 'consultationOwnerId'
      )
  ), status_counts as (
    select selected.task_status, pg_catalog.count(*) as count_value
    from selected
    group by selected.task_status
  ), view_keys(view_key) as (
    values
      ('inquiry'::text),
      ('level_test'::text),
      ('consultation_requested'::text),
      ('consultation_completed'::text),
      ('waiting'::text),
      ('observation'::text),
      ('enrollment'::text),
      ('payment'::text),
      ('completed'::text)
  ), view_counts as (
    select memberships.view_key, pg_catalog.count(distinct memberships.task_id) as count_value
    from memberships
    where memberships.view_key is not null
    group by memberships.view_key
  )
  select pg_catalog.jsonb_build_object(
    'total', (select pg_catalog.count(*) from selected),
    'byStatus', coalesce((
      select pg_catalog.jsonb_object_agg(status_counts.task_status, status_counts.count_value)
      from status_counts
    ), '{}'::jsonb),
    'byView', (
      select pg_catalog.jsonb_object_agg(
        view_keys.view_key,
        coalesce(view_counts.count_value, 0)
      )
      from view_keys
      left join view_counts using (view_key)
    ),
    'metrics', pg_catalog.jsonb_build_object(
      'consultationMine', case
        when p_filters ->> 'view' in ('consultation_requested', 'consultation_completed') then (
          select pg_catalog.count(distinct memberships.task_id)
          from memberships
          where memberships.view_key = p_filters ->> 'view'
            and memberships.director_profile_id = (select auth.uid())
        )
        else 0
      end,
      'consultationAll', case
        when p_filters ->> 'view' in ('consultation_requested', 'consultation_completed') then (
          select pg_catalog.count(distinct memberships.task_id)
          from memberships
          where memberships.view_key = p_filters ->> 'view'
        )
        else 0
      end
    ),
    'facets', '{}'::jsonb
  )
$function$;

create or replace function public.get_ops_task_list_stats_v1(
  p_type text,
  p_filters jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_type = 'registration' then
    return dashboard_private.ops_registration_task_stats_v1(p_filters);
  end if;

  return dashboard_private.ops_task_list_stats_legacy_v1(p_type, p_filters);
end
$function$;

revoke all on function dashboard_private.ops_task_list_stats_legacy_v1(text, jsonb)
  from public, anon;
revoke all on function dashboard_private.ops_registration_task_stats_v1(jsonb)
  from public, anon;
revoke all on function public.get_ops_task_list_stats_v1(text, jsonb)
  from public, anon;

grant execute on function dashboard_private.ops_task_list_stats_legacy_v1(text, jsonb)
  to authenticated;
grant execute on function dashboard_private.ops_registration_task_stats_v1(jsonb)
  to authenticated;
grant execute on function public.get_ops_task_list_stats_v1(text, jsonb)
  to authenticated;

comment on function dashboard_private.ops_registration_task_stats_v1(jsonb) is
  'Counts registration task views in one summary-membership pass without shaping page JSON.';
