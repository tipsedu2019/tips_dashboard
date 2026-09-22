begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Read-only workload projection. Every source and profile read retains caller RLS.
create or replace function dashboard_private.dashboard_workload_items_v1()
returns table (
  item_key text, workflow text, stage text, stage_label text, team text,
  owner_key text, owner_label text, title text, entered_at timestamptz, requested_at timestamptz, href text
)
language sql stable security invoker set search_path = ''
as $function$
  with registration as (
    select 'registration:' || tr.id::text as item_key, 'registration'::text as workflow,
      tr.workflow_status as stage,
      case tr.workflow_status
        when 'inquiry' then '등록 문의' when 'level_test_requested' then '레벨테스트 신청'
        when 'consultation_requested' then '상담 신청' when 'consultation_completed' then '상담 완료 후속 처리'
        when 'waiting_current_class' then '현재반 대기' when 'waiting_new_class' then '신규반 대기'
        when 'waiting_next_opening' then '다음 개강 대기' when 'observation_requested' then '청강 예약'
        when 'observation_feedback_pending' then '청강 원장 확인' when 'observation_completed' then '청강 후속 처리'
        when 'enrollment_requested' then '등록 신청 처리' when 'payment_in_progress' then '입학 진행'
        else tr.workflow_status end as stage_label,
      case when tr.workflow_status in ('consultation_requested','consultation_completed','observation_feedback_pending','observation_completed')
        then tr.subject || '팀' else '관리팀' end as team,
      case when tr.workflow_status in ('consultation_requested','consultation_completed','observation_feedback_pending','observation_completed')
        then tr.director_profile_id else null end as owner_id,
      tr.workflow_status not in ('consultation_requested','consultation_completed','observation_feedback_pending','observation_completed') as team_owned,
      coalesce(nullif(t.student_name,''),nullif(t.title,''),'등록') || ' · ' || tr.subject as title,
      coalesce(tr.workflow_status_entered_at,tr.stage_entered_at,tr.created_at) as entered_at, tr.created_at as requested_at,
      '/admin/registration?taskId=' || t.id::text || '&trackId=' || tr.id::text as href
    from public.ops_registration_subject_tracks tr
    join public.ops_tasks t on t.id=tr.task_id and t.type='registration'
    where tr.archived_at is null and t.status not in ('done','canceled')
      and tr.workflow_status not in ('registered','not_registered','inquiry_only')
  ), operations as (
    select t.type || ':' || t.id::text, t.type, t.status,
      case t.status when 'requested' then '요청 확인' when 'confirmed' then '처리 준비'
        when 'in_progress' then '처리 진행' when 'review_requested' then '요청자 검토'
        when 'on_hold' then '보류' else t.status end,
      nullif(pg_catalog.btrim(case when t.status='review_requested' then t.requested_team else t.assignee_team end),''),
      case when t.status='review_requested' then t.requested_by else coalesce(t.assignee_id,t.secondary_assignee_id) end,
      false,
      coalesce(nullif(t.student_name,''),nullif(t.title,''),'업무') || case when nullif(t.class_name,'') is not null then ' · ' || t.class_name else '' end,
      coalesce((select max(e.created_at) from public.ops_task_events e where e.task_id=t.id and e.field_name='status' and e.after_value=t.status),t.created_at), t.created_at,
      '/admin/' || t.type || '?taskId=' || t.id::text
    from public.ops_tasks t where t.type in ('transfer','withdrawal') and t.status not in ('done','canceled')
  ), makeup as (
    select 'makeup:' || m.id::text, 'makeup', m.status,
      case m.status when 'approval_pending' then '결재 승인' when 'revision_requested' then '보완 요청'
        when 'makeup_pending' then '보강 진행' when 'refund_pending' then '환불 처리'
        when 'manager_pending' then '관리팀 처리' else m.status end,
      case when m.status in ('refund_pending','manager_pending') then '관리팀' else m.subject || '팀' end,
      case when m.status='approval_pending' then m.approver_profile_id
        when m.status='revision_requested' then m.requester_id
        when m.status='makeup_pending' then coalesce(m.teacher_profile_id,m.requester_id) else null end,
      m.status in ('refund_pending','manager_pending'),
      coalesce(nullif(m.class_name,''),'휴보강'),
      coalesce((select max(e.created_at) from public.makeup_request_events e where e.request_id=m.id and e.field_name='status' and e.after_value=m.status),m.created_at), m.created_at,
      '/admin/makeup-requests?requestId=' || m.id::text
    from public.makeup_requests m where m.status not in ('completed','canceled','rejected')
  ), sources as (
    select * from registration union all select * from operations union all select * from makeup
  )
  select s.item_key,s.workflow,s.stage,s.stage_label,
    coalesce(s.team,case when p.role in ('admin','staff') then '관리팀' when p.role='assistant' then '조교팀' end,'팀 미지정'),
    case when s.team_owned then 'team' else coalesce(s.owner_id::text,'unassigned') end,
    case when s.team_owned then '팀 공통' when s.owner_id is null then '담당 미지정'
      else coalesce(nullif(pg_catalog.btrim(p.name),''),nullif(pg_catalog.btrim(p.display_name),''),'이름 미등록') end,
    s.title,s.entered_at,s.requested_at,s.href
  from sources s left join public.profiles p on p.id=s.owner_id
  where (select auth.uid()) is not null;
$function$;

create or replace function public.get_dashboard_workload_v1()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'dashboard_workload_forbidden' using errcode='42501'; end if;
  with grouped as (
    select team,owner_key,owner_label,workflow,stage,stage_label,count(*) as total,
      count(*) filter(where requested_at <= statement_timestamp()-interval '7 days') as aged,
      min(entered_at) as oldest_at, min(requested_at) as oldest_requested_at,
      sum(greatest(0,extract(epoch from (statement_timestamp()-requested_at)))) as elapsed_seconds
    from dashboard_private.dashboard_workload_items_v1()
    group by team,owner_key,owner_label,workflow,stage,stage_label
  )
  select jsonb_build_object('generatedAt',statement_timestamp(),'groups',coalesce(jsonb_agg(jsonb_build_object(
    'team',team,'ownerKey',owner_key,'ownerLabel',owner_label,'workflow',workflow,'stage',stage,'stageLabel',stage_label,
    'total',total,'aged',aged,'oldestAt',oldest_at,'oldestRequestedAt',oldest_requested_at,'elapsedSeconds',elapsed_seconds
  ) order by team,owner_key,workflow,stage),'[]'::jsonb)) into v_result from grouped;
  return v_result;
end;
$function$;

create or replace function public.list_dashboard_workload_page_v1(
  p_team text default null, p_owner_key text default null, p_workflow text default null,
  p_stage text default null, p_aged_only boolean default false, p_page integer default 1, p_page_size integer default 10
)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'dashboard_workload_forbidden' using errcode='42501'; end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_page_size is null or p_page_size not in (10,15,20)
    or (p_workflow is not null and p_workflow not in ('registration','transfer','withdrawal','makeup'))
  then raise exception 'dashboard_workload_filter_invalid' using errcode='22023'; end if;
  with matched as materialized (
    select * from dashboard_private.dashboard_workload_items_v1() i
    where (p_team is null or i.team=p_team) and (p_owner_key is null or i.owner_key=p_owner_key)
      and (p_workflow is null or i.workflow=p_workflow) and (p_stage is null or i.stage=p_stage)
      and (not coalesce(p_aged_only,false) or i.requested_at <= statement_timestamp()-interval '7 days')
  ), page as (
    select * from matched order by requested_at,item_key limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object('generatedAt',statement_timestamp(),'totalCount',(select count(*) from matched),
    'page',p_page,'pageSize',p_page_size,'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'key',item_key,'workflow',workflow,'stage',stage,'stageLabel',stage_label,'team',team,'ownerKey',owner_key,
      'ownerLabel',owner_label,'title',title,'enteredAt',entered_at,'requestedAt',requested_at,'href',href
    ) order by requested_at,item_key) from page),'[]'::jsonb)) into v_result;
  return v_result;
end;
$function$;

revoke all on function dashboard_private.dashboard_workload_items_v1() from public,anon,service_role;
revoke all on function public.get_dashboard_workload_v1() from public,anon,service_role;
revoke all on function public.list_dashboard_workload_page_v1(text,text,text,text,boolean,integer,integer) from public,anon,service_role;
grant execute on function dashboard_private.dashboard_workload_items_v1() to authenticated;
grant execute on function public.get_dashboard_workload_v1() to authenticated;
grant execute on function public.list_dashboard_workload_page_v1(text,text,text,text,boolean,integer,integer) to authenticated;

commit;
