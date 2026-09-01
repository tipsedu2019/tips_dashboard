-- Read-only, invoker projection. Existing request/comment/event/profile RLS is
-- the authority boundary, including the legacy involved/operator predicates.
create or replace function public.get_approval_detail_v1(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'approval_auth_required' using errcode='42501'; end if;
  if p_id is null then raise exception 'approval_detail_request_invalid' using errcode='22023'; end if;
  select jsonb_build_object(
    'id',r.id,'type',r.request_type,'status',r.status,'title',btrim(r.title),
    'requesterId',coalesce(r.requester_id::text,''),
    'requesterLabel',coalesce(nullif(btrim(rp.name),''),nullif(btrim(to_jsonb(rp)->>'full_name'),''),nullif(btrim(rp.email),''),rp.id::text,nullif(btrim(to_jsonb(r)->>'requester_label'),''),'작성자'),
    'approverId',coalesce(r.approver_id::text,''),
    'approverLabel',coalesce(nullif(btrim(ap.name),''),nullif(btrim(to_jsonb(ap)->>'full_name'),''),nullif(btrim(ap.email),''),ap.id::text,nullif(btrim(to_jsonb(r)->>'approver_label'),''),'결재자 미정'),
    'subject',coalesce(nullif(btrim(r.subject),''),'general'),
    'templateKey',coalesce(nullif(btrim(r.template_key),''),'free'),
    'reportMonth',btrim(coalesce(r.report_month,'')),
    'classSummary',btrim(coalesce(r.class_summary,'')),
    'studentIssues',btrim(coalesce(r.student_issues,'')),
    'nextMonthPlan',btrim(coalesce(r.next_month_plan,'')),
    'body',coalesce(nullif(btrim(r.body),''),btrim(r.memo),''),
    -- The existing client checklist parser handles tolerated legacy JSON,
    -- including JSONnull, nonarrays, invalid items, duplicate IDs and checked.
    'checklistItems',r.checklist_items,
    'attachmentLinks',btrim(coalesce(r.attachment_links,'')),
    'memo',btrim(coalesce(r.memo,'')),
    'submittedAt',coalesce(to_jsonb(r.submitted_at),'""'::jsonb),'decidedAt',coalesce(to_jsonb(r.decided_at),'""'::jsonb),
    'createdAt',r.created_at,'updatedAt',r.updated_at,
    'comments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'approvalId',c.approval_id,'authorId',coalesce(c.author_id::text,''),
      'authorLabel',coalesce(nullif(btrim(cp.name),''),nullif(btrim(to_jsonb(cp)->>'full_name'),''),nullif(btrim(cp.email),''),cp.id::text,'작성자'),
      'body',btrim(c.body),'createdAt',c.created_at) order by c.created_at,c.id)
      from public.approval_comments c left join public.profiles cp on cp.id=c.author_id where c.approval_id=r.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'approvalId',e.approval_id,'actorId',coalesce(e.actor_id::text,''),
      'actorLabel',coalesce(nullif(btrim(ep.name),''),nullif(btrim(to_jsonb(ep)->>'full_name'),''),nullif(btrim(ep.email),''),ep.id::text,'시스템'),
      'eventType',btrim(e.event_type),'fieldName',btrim(coalesce(e.field_name,'')),
      'beforeValue',btrim(coalesce(e.before_value,'')),'afterValue',btrim(coalesce(e.after_value,'')),
      'createdAt',e.created_at) order by e.created_at,e.id)
      from public.approval_events e left join public.profiles ep on ep.id=e.actor_id where e.approval_id=r.id),'[]'::jsonb)
  ) into v_result
  from public.approval_requests r
  left join public.profiles rp on rp.id=r.requester_id
  left join public.profiles ap on ap.id=r.approver_id
  where r.id=p_id;
  return v_result;
end $$;
revoke all on function public.get_approval_detail_v1(uuid) from public,anon;
grant execute on function public.get_approval_detail_v1(uuid) to authenticated;

create or replace function public.list_approval_numbered_page_v1(p_view text,p_page integer,p_page_size integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'approval_auth_required' using errcode='42501'; end if;
  if p_view is null or p_view not in('mine','review','open','done','returned')
    or p_page is null or p_page<1 or p_page_size is null or p_page_size not in(10,15,20)
  then raise exception 'approval_numbered_request_invalid' using errcode='22023'; end if;
  with authorized as materialized (
    select r.id,r.updated_at,r.requester_id=auth.uid() as mine,
      r.approver_id=auth.uid() and r.status not in('approved','returned','canceled') as review,
      r.status not in('approved','returned','canceled') as open,
      r.status='approved' as done,r.status='returned' as returned
    from public.approval_requests r
  ), counts as (
    select jsonb_build_object('mine',count(*) filter(where mine),'review',count(*) filter(where review),
      'open',count(*) filter(where open),'done',count(*) filter(where done),'returned',count(*) filter(where returned)) as tabs from authorized
  ), selected as materialized (
    select id,updated_at from authorized
    where case p_view when 'mine' then mine when 'review' then review when 'open' then open when 'done' then done else returned end
    order by updated_at desc,id desc limit p_page_size offset (p_page::bigint-1)*p_page_size
  )
  select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(counts.tabs->>p_view)::bigint,'tabCounts',counts.tabs,
    'rows',coalesce((select jsonb_agg(public.get_approval_detail_v1(selected.id) order by selected.updated_at desc,selected.id desc) from selected),'[]'::jsonb))
  into v_result from counts;
  return v_result;
end $$;
revoke all on function public.list_approval_numbered_page_v1(text,integer,integer) from public,anon;
grant execute on function public.list_approval_numbered_page_v1(text,integer,integer) to authenticated;
