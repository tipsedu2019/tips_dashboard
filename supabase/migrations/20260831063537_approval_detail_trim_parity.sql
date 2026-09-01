-- Match the existing JavaScript String.trim DTO mapping before fallback selection.
-- U+0085 is deliberately absent; internal whitespace is never removed.
create or replace function public.get_approval_detail_v1(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_result jsonb;
  v_trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if auth.uid() is null then raise exception 'approval_auth_required' using errcode='42501'; end if;
  if p_id is null then raise exception 'approval_detail_request_invalid' using errcode='22023'; end if;
  select jsonb_build_object(
    'id',r.id,'type',r.request_type,'status',r.status,'title',btrim(r.title,v_trim_chars),
    'requesterId',coalesce(r.requester_id::text,''),
    'requesterLabel',coalesce(nullif(btrim(rp.name,v_trim_chars),''),nullif(btrim(to_jsonb(rp)->>'full_name',v_trim_chars),''),nullif(btrim(rp.email,v_trim_chars),''),rp.id::text,nullif(btrim(to_jsonb(r)->>'requester_label',v_trim_chars),''),'작성자'),
    'approverId',coalesce(r.approver_id::text,''),
    'approverLabel',coalesce(nullif(btrim(ap.name,v_trim_chars),''),nullif(btrim(to_jsonb(ap)->>'full_name',v_trim_chars),''),nullif(btrim(ap.email,v_trim_chars),''),ap.id::text,nullif(btrim(to_jsonb(r)->>'approver_label',v_trim_chars),''),'결재자 미정'),
    'subject',coalesce(nullif(btrim(r.subject,v_trim_chars),''),'general'),
    'templateKey',coalesce(nullif(btrim(r.template_key,v_trim_chars),''),'free'),
    'reportMonth',btrim(coalesce(r.report_month,''),v_trim_chars),
    'classSummary',btrim(coalesce(r.class_summary,''),v_trim_chars),
    'studentIssues',btrim(coalesce(r.student_issues,''),v_trim_chars),
    'nextMonthPlan',btrim(coalesce(r.next_month_plan,''),v_trim_chars),
    'body',coalesce(nullif(btrim(r.body,v_trim_chars),''),btrim(r.memo,v_trim_chars),''),
    'checklistItems',r.checklist_items,
    'attachmentLinks',btrim(coalesce(r.attachment_links,''),v_trim_chars),
    'memo',btrim(coalesce(r.memo,''),v_trim_chars),
    'submittedAt',coalesce(to_jsonb(r.submitted_at),'""'::jsonb),'decidedAt',coalesce(to_jsonb(r.decided_at),'""'::jsonb),
    'createdAt',r.created_at,'updatedAt',r.updated_at,
    'comments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'approvalId',c.approval_id,'authorId',coalesce(c.author_id::text,''),
      'authorLabel',coalesce(nullif(btrim(cp.name,v_trim_chars),''),nullif(btrim(to_jsonb(cp)->>'full_name',v_trim_chars),''),nullif(btrim(cp.email,v_trim_chars),''),cp.id::text,'작성자'),
      'body',btrim(c.body,v_trim_chars),'createdAt',c.created_at) order by c.created_at,c.id)
      from public.approval_comments c left join public.profiles cp on cp.id=c.author_id where c.approval_id=r.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'approvalId',e.approval_id,'actorId',coalesce(e.actor_id::text,''),
      'actorLabel',coalesce(nullif(btrim(ep.name,v_trim_chars),''),nullif(btrim(to_jsonb(ep)->>'full_name',v_trim_chars),''),nullif(btrim(ep.email,v_trim_chars),''),ep.id::text,'시스템'),
      'eventType',btrim(e.event_type,v_trim_chars),'fieldName',btrim(coalesce(e.field_name,''),v_trim_chars),
      'beforeValue',btrim(coalesce(e.before_value,''),v_trim_chars),'afterValue',btrim(coalesce(e.after_value,''),v_trim_chars),
      'createdAt',e.created_at) order by e.created_at,e.id)
      from public.approval_events e left join public.profiles ep on ep.id=e.actor_id where e.approval_id=r.id),'[]'::jsonb)
  ) into v_result
  from public.approval_requests r
  left join public.profiles rp on rp.id=r.requester_id
  left join public.profiles ap on ap.id=r.approver_id
  where r.id=p_id;
  return v_result;
end $$;
-- CREATE OR REPLACE retains the original authenticated-only ACL.
