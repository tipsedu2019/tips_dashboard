begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Replace retired follow-up tasks with immediate subject-team facts. Existing
-- management rules, delivery evidence, dispatch owners and schedules stay intact.
alter table dashboard_private.notification_rules
  drop constraint notification_rules_workflow_audience_check;
alter table dashboard_private.notification_rules
  add constraint notification_rules_workflow_audience_check check (
    (workflow_key = 'tasks' and audience_key in ('requester_profile','primary_assignee','secondary_assignee','management_team'))
    or (workflow_key = 'word_retests' and audience_key in ('requesting_teacher','assigned_assistant','secondary_assignee','management_team'))
    or (workflow_key = 'registration' and audience_key in ('registration_requester','track_director','management_team','subject_team','applicant_guardian'))
    or (workflow_key in ('transfer','withdrawal') and audience_key in ('requester_profile','management_team'))
    or (workflow_key = 'makeup_requests' and audience_key in ('requester_profile','approver_profile','management_team','executive_team','subject_team'))
    or (workflow_key = 'approvals' and audience_key in ('requester_profile','approver_profile','management_team'))
    or (channel_key = 'google_chat' and audience_key = 'subject_team' and (
      (workflow_key='transfer' and event_key='transfer.completed')
      or (workflow_key='withdrawal' and event_key='withdrawal.completed')
      or (workflow_key='word_retests' and event_key='word_retest.result_reported')
    ))
  );
alter table dashboard_private.notification_rules
  drop constraint notification_rules_word_retest_chat_retired_check;
alter table dashboard_private.notification_rules
  add constraint notification_rules_word_retest_chat_retired_check check (
    not (workflow_key='word_retests' and channel_key='google_chat' and enabled)
    or (event_key='word_retest.result_reported' and audience_key='subject_team')
  );

-- Each new audience receives the current system template and content contract;
-- no existing custom template or enabled preference is reused or overwritten.
do $subject_rules$
declare
  v_item record;
  v_rule_id uuid;
  v_template_id uuid;
  v_contract jsonb;
  v_vars jsonb;
  v_title text;
  v_body text;
begin
  for v_item in select * from (values
    ('registration','registration.subject_registration_completed','registration.registration_completed','등록',3,'등록 완료',202),
    ('transfer','transfer.completed','transfer.completed','전반',4,'전반 완료',2),
    ('withdrawal','withdrawal.completed','withdrawal.completed','퇴원',5,'퇴원 완료',2),
    ('word_retests','word_retest.result_reported','word_retest.result_reported','영어 단어 재시험',2,'결과 기록',5)
  ) x(workflow,event_key,base_event,label,workflow_sort,event_label,event_sort)
  loop
    v_rule_id := dashboard_private.notification_deterministic_uuid_v1('ops-subject-completion-rule-v1',v_item.event_key);
    v_template_id := dashboard_private.notification_deterministic_uuid_v1('ops-subject-completion-template-v1',v_item.event_key);
    if v_item.workflow<>'registration' then
      if v_item.workflow='transfer' then
        v_title:='✅ [전반] {학생}의 반 이동이 완료됐어요';
        v_body:=E'[변경] {기존반} → {이동반}\n[일정] 기존 반 {기존반종료일}까지 · 새 반 {새반시작일}부터\n{진행정보}';
        v_vars:='[{"key":"student_name","token":"학생","piiClass":"student_name"},{"key":"before_class","token":"기존반","piiClass":"class_name"},{"key":"after_class","token":"이동반","piiClass":"class_name"},{"key":"before_class_end_date","token":"기존반종료일","piiClass":"schedule"},{"key":"after_class_start_date","token":"새반시작일","piiClass":"schedule"},{"key":"progress_line","token":"진행정보","piiClass":"none"}]';
      elsif v_item.workflow='withdrawal' then
        v_title:='✅ [수강 제외] {학생}의 {과목} 수강 제외 처리가 끝났어요';
        v_body:=E'[수업] {수업}\n[일정] {제외일} · {제외회차}부터 제외\n{진행정보}';
        v_vars:='[{"key":"student_name","token":"학생","piiClass":"student_name"},{"key":"subjects","token":"과목","piiClass":"none"},{"key":"class_name","token":"수업","piiClass":"class_name"},{"key":"withdrawal_date","token":"제외일","piiClass":"schedule"},{"key":"withdrawal_round","token":"제외회차","piiClass":"none"},{"key":"progress_line","token":"진행정보","piiClass":"none"}]';
      else
        v_title:='📝 [단어 재시험] {학생}의 재시험 결과가 기록됐어요';
        v_body:=E'[학생] {학생}\n[결과] {점수} / 통과 기준 {통과기준} · {판정}\n{메모정보}';
        v_vars:='[{"key":"student_name","token":"학생","piiClass":"student_name"},{"key":"score","token":"점수","piiClass":"none"},{"key":"pass_threshold","token":"통과기준","piiClass":"none"},{"key":"result","token":"판정","piiClass":"none"},{"key":"memo_line","token":"메모정보","piiClass":"free_text"}]';
      end if;
      select jsonb_build_object('contractVersion','1','availableVariables',v_vars,
        'requiredTokens',jsonb_agg(variable->'token') filter(where variable->>'key' not in ('progress_line','memo_line')),
        'optionalLineTokens',jsonb_agg(variable->'token') filter(where variable->>'key' in ('progress_line','memo_line')),
        'mustHaveFacts',case v_item.workflow when 'transfer' then jsonb_build_array('target','event','before_after','schedule')
          when 'withdrawal' then jsonb_build_array('target','event','schedule') else jsonb_build_array('target','event','result') end,
        'freeTextPriority','[]'::jsonb,'freeTextVisibility','{}'::jsonb,'supportedPayloadVersions',jsonb_build_array(1),
        'fieldPresence',jsonb_object_agg(variable->>'key',jsonb_build_object(
          'required',variable->>'key' not in ('progress_line','memo_line'),'nullDisplay',null,
          'nullBehavior',case when variable->>'key' in ('progress_line','memo_line') then 'omit' else 'reject' end,
          'emptyArrayBehavior',case when variable->>'key' in ('progress_line','memo_line') then 'omit' else 'reject' end)))
      into v_contract from jsonb_array_elements(v_vars) variable;
    end if;
    if v_item.workflow='registration' then
      v_vars:='[{"key":"student_name","token":"학생","piiClass":"student_name"},{"key":"subjects","token":"과목","piiClass":"none"},{"key":"current_status","token":"현재상태","piiClass":"none"}]'::jsonb;
      v_title:='✅ [등록] {학생}의 {과목} 등록이 완료됐어요';
      v_body:=E'[학생] {학생}\n[과목] {과목}\n[상태] {현재상태}';
      v_contract:=jsonb_build_object('contractVersion','1','availableVariables',v_vars,
        'requiredTokens',jsonb_build_array('학생','과목','현재상태'),'optionalLineTokens','[]'::jsonb,
        'mustHaveFacts',jsonb_build_array('target','event','current_state'),'freeTextPriority','[]'::jsonb,
        'freeTextVisibility','{}'::jsonb,'supportedPayloadVersions',jsonb_build_array(1),
        'fieldPresence',jsonb_build_object(
          'student_name',jsonb_build_object('required',true,'nullDisplay',null,'nullBehavior','reject','emptyArrayBehavior','reject'),
          'subjects',jsonb_build_object('required',true,'nullDisplay',null,'nullBehavior','reject','emptyArrayBehavior','reject'),
          'current_status',jsonb_build_object('required',true,'nullDisplay',null,'nullBehavior','reject','emptyArrayBehavior','reject')));
    end if;
    v_contract:=v_contract||jsonb_build_object('destinationPolicy',jsonb_build_object('subjectScoped',true,
      'allowedConnectionKeys',case when v_item.workflow='word_retests' then jsonb_build_array('google_chat.english')
        else jsonb_build_array('google_chat.english','google_chat.math','google_chat.science') end));
    insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,
      rule_variant_key,delivery_mode,enabled,active_template_id,revision,created_actor_kind,updated_actor_kind)
    values(v_rule_id,'global',v_item.workflow,v_item.event_key,'google_chat','subject_team','immediate','immediate',true,v_template_id,1,'system','system');
    insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,
      payload_schema_version,checksum,created_actor_kind,content_contract_version)
    values(v_template_id,v_rule_id,1,v_title,v_body,v_vars,1,
      dashboard_private.notification_seed_template_checksum_v1(v_title,v_body,v_vars,1),'system','1');
    insert into dashboard_private.notification_settings_ui_registry(rule_id,workflow_key,workflow_label,workflow_sort,
      event_key,event_label,group_label,trigger_description,event_sort,audience_key,audience_label,channel_key,channel_label,
      cell_sort,rule_variant_key,delivery_mode,initial_enabled,configuration_kind,activation_locked)
    values(v_rule_id,v_item.workflow,v_item.label,v_item.workflow_sort,v_item.event_key,v_item.event_label,'과목팀 업무 공유',
      case when v_item.workflow='registration' then '과목 진행상태가 등록 완료로 변경되었을 때'
        when v_item.workflow='word_retests' then '영어 단어 재시험 결과가 기록되었을 때'
        else v_item.event_label||' 처리되었을 때' end,
      v_item.event_sort,'subject_team','과목팀','google_chat','Google Chat',2,'immediate','immediate',true,'editable_rule',false);
    insert into dashboard_private.notification_rule_content_contracts(rule_id,workflow_key,event_key,audience_key,
      channel_key,rule_variant_key,contract_version,contract_json)
    values(v_rule_id,v_item.workflow,v_item.event_key,'subject_team','google_chat','immediate','1',v_contract);
    perform dashboard_private.notification_template_compliance_v1(v_rule_id,v_template_id);
  end loop;
end;
$subject_rules$;

create function dashboard_private.ops_subject_notification_subjects_v1(p_task_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(subject order by subject),'[]'::jsonb) from (
    select distinct btrim(class_row.subject) subject
    from public.ops_tasks task
    left join public.ops_transfer_details transfer on transfer.task_id=task.id
    join public.classes class_row on (task.type='withdrawal' and class_row.id=task.class_id)
      or (task.type='transfer' and class_row.id in (transfer.from_class_id,transfer.to_class_id))
    where task.id=p_task_id and btrim(class_row.subject) in ('영어','수학','과학')
    union select '영어' where exists(select 1 from public.ops_tasks where id=p_task_id and type='word_retest')
  ) subjects;
$$;

create function dashboard_private.record_registration_subject_completion_v1(
  p_task_id uuid,p_track_id uuid,p_source_event_id uuid,p_before_status text,p_workflow_revision integer)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_track public.ops_registration_subject_tracks%rowtype; v_task public.ops_tasks%rowtype;
  v_source public.ops_task_events%rowtype; v_actor_name text; v_payload jsonb;
begin
  select * into strict v_track from public.ops_registration_subject_tracks where id=p_track_id and task_id=p_task_id for share;
  select * into strict v_task from public.ops_tasks where id=p_task_id and type='registration' for share;
  select * into strict v_source from public.ops_task_events where id=p_source_event_id and task_id=p_task_id;
  if v_track.archived_at is not null or v_track.migration_review_required
    or v_track.subject not in ('영어','수학','과학') or v_track.workflow_status<>'registered'
    or p_before_status is null or p_before_status='registered'
    or p_workflow_revision is distinct from v_track.workflow_revision
    or v_source.actor_id is distinct from (select auth.uid()) then
    raise exception 'registration_subject_completion_source_invalid' using errcode='23514';
  end if;
  select name into v_actor_name from public.profiles where id=v_source.actor_id;
  v_payload:=jsonb_build_object('task_id',v_task.id,'track_id',v_track.id,'subject',v_track.subject,
    'notification_subjects',jsonb_build_array(v_track.subject),'student_name',v_task.student_name,
    'before_status',p_before_status,'after_status','registered','status','registered',
    'workflow_revision',v_track.workflow_revision,'actor_name',v_actor_name,'actor_kind','user',
    'source_event_id',v_source.id,'occurred_at',v_source.created_at);
  perform dashboard_private.record_notification_event_v1('global','registration','registration.subject_registration_completed',
    'ops_task_event',v_source.id::text,null,v_source.id::text,v_source.actor_id,v_source.created_at,1,v_payload,null,null);
end;
$$;

-- Patch final definitions in place, preserving all permission, lock, replay and
-- manual fact/status separation logic. Only new transitions into registered emit.
do $subject_producers$
declare v_definition text; v_anchor text; v_patch text;
begin
  v_definition:=pg_get_functiondef('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::regprocedure);
  v_anchor:='  v_previous_workflow_status text;';
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
    or strpos(v_definition,'''enrollmentFinalization'', null')=0 then
    raise exception 'registration_subject_completion_setter_drift' using errcode='55000'; end if;
  v_definition:=replace(v_definition,v_anchor,v_anchor||E'\n  v_source_event_id uuid;\n  v_source_event_ids jsonb := ''[]''::jsonb;');
  v_anchor:='    perform dashboard_private.write_registration_track_event_v2(';
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'registration_subject_completion_event_drift' using errcode='55000'; end if;
  v_definition:=replace(v_definition,v_anchor,'    v_source_event_id := dashboard_private.write_registration_track_event_v2(');
  v_anchor:=$anchor$      'user',
      null
    );
  end if;$anchor$;
  v_patch:=$patch$      'user',
      null
    );
    if v_workflow_status='registered' and not v_track.migration_review_required then
      perform dashboard_private.record_registration_subject_completion_v1(
        v_track.task_id,v_track.id,v_source_event_id,v_previous_workflow_status,v_track.workflow_revision);
      v_source_event_ids:=pg_catalog.jsonb_build_array(v_source_event_id);
    end if;
  end if;$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'registration_subject_completion_record_drift' using errcode='55000'; end if;
  v_definition:=replace(v_definition,v_anchor,v_patch);
  v_anchor:=$anchor$    'enrollmentFinalization', null
  );$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'registration_subject_completion_response_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,$patch$    'enrollmentFinalization', null,
    'sourceEventIds',v_source_event_ids
  );$patch$);

  v_definition:=pg_get_functiondef('dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'::regprocedure);
  v_anchor:=$anchor$    'task_id', p_task.id,$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_transition_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,v_anchor||E'\n    ''notification_subjects'', dashboard_private.ops_subject_notification_subjects_v1(p_task.id),');

  v_definition:=pg_get_functiondef('dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks,text,uuid,text,text,text,jsonb,uuid)'::regprocedure);
  -- The authoritative merge occurs after p_extra_payload, preventing a caller
  -- from selecting another team's destination.
  v_anchor:=$anchor$    'task_id', p_task.id,$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_word_source_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,v_anchor||E'\n    ''notification_subjects'', case when p_task.type=''word_retest'' then pg_catalog.jsonb_build_array(''영어'') else ''[]''::jsonb end,');
end;
$subject_producers$;

create function dashboard_private.notification_subject_completion_source_current_v1(p_event_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select case
      when event_row.event_key='registration.subject_registration_completed' then exists(
        select 1 from public.ops_registration_subject_tracks track
        where track.id::text=event_row.payload->>'track_id' and track.task_id=task.id
          and track.archived_at is null and not track.migration_review_required and track.workflow_status='registered'
          and track.workflow_revision::text=event_row.payload->>'workflow_revision'
          and event_row.payload->>'status'='registered' and event_row.payload->>'after_status'='registered'
          and event_row.payload->>'before_status'<>'registered'
          and event_row.payload->'notification_subjects'=jsonb_build_array(track.subject))
      when event_row.event_key in ('transfer.completed','withdrawal.completed') then task.status='done'
        and event_row.payload->'notification_subjects'=dashboard_private.ops_subject_notification_subjects_v1(task.id)
      when event_row.event_key='word_retest.result_reported' then task.type='word_retest' and task.status<>'canceled'
        and event_row.payload->'notification_subjects'=jsonb_build_array('영어') and exists(
          select 1 from public.ops_word_retests word where word.task_id=task.id
            and coalesce(to_jsonb(word.first_score),'null'::jsonb) is not distinct from coalesce(event_row.payload->'first_score','null'::jsonb)
            and coalesce(to_jsonb(word.second_score),'null'::jsonb) is not distinct from coalesce(event_row.payload->'second_score','null'::jsonb)
            and coalesce(to_jsonb(word.third_score),'null'::jsonb) is not distinct from coalesce(event_row.payload->'third_score','null'::jsonb)
            and coalesce(to_jsonb(word.cutoff_question_count),'null'::jsonb) is not distinct from coalesce(event_row.payload->'cutoff_question_count','null'::jsonb)
            and coalesce(to_jsonb(word.total_question_count),'null'::jsonb) is not distinct from coalesce(event_row.payload->'total_question_count','null'::jsonb)
            and coalesce(to_jsonb(word.score_out_of_100),'null'::jsonb) is not distinct from coalesce(event_row.payload->'score_out_of_100','null'::jsonb)
            and word.retest_status=event_row.payload->>'retest_status')
      else false end
    from dashboard_private.notification_events event_row
    join public.ops_task_events source on source.id::text=event_row.source_id
    join public.ops_tasks task on task.id=source.task_id and task.id::text=event_row.payload->>'task_id'
    where event_row.id=p_event_id and event_row.source_type='ops_task_event'
      and event_row.occurrence_key=event_row.source_id and event_row.payload_schema_version=1
  ),false);
$$;

create function dashboard_private.subject_completion_date_v1(p_date text,p_occurred_at text)
returns text language sql immutable strict set search_path='' as $$
  select case when extract(year from p_date::date)=extract(year from p_occurred_at::timestamptz at time zone 'Asia/Seoul') then ''
    else extract(year from p_date::date)::integer::text||'년 ' end
    ||extract(month from p_date::date)::integer::text||'월 '||extract(day from p_date::date)::integer::text||'일('
    ||(array['일','월','화','수','목','금','토'])[extract(dow from p_date::date)::integer+1]||')';
$$;

-- Render the four shared facts from the versioned templates without injecting
-- SQL/internal identifiers. Other legacy events retain their existing renderer.
create function dashboard_private.render_subject_completion_template_v1(p_template text,p_event_key text,p_payload jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare v_rendered text:=p_template; v_variables jsonb; v_item record; v_scores text; v_result text;
  v_max_score numeric; v_threshold numeric; v_total numeric;
begin
  v_variables:=jsonb_build_object('학생',p_payload->>'student_name','과목',p_payload->>'subject','현재상태','등록 완료');
  if p_event_key='transfer.completed' then
    v_variables:=v_variables||jsonb_build_object('기존반',p_payload->>'before_class','이동반',p_payload->>'after_class',
      '기존반종료일',dashboard_private.subject_completion_date_v1(p_payload->>'before_class_end_date',p_payload->>'occurred_at'),
      '새반시작일',dashboard_private.subject_completion_date_v1(p_payload->>'after_class_start_date',p_payload->>'occurred_at'),
      '진행정보','[진행] '||(p_payload->>'actor_name')||'이 반 이동 처리를 완료했어요.');
  elsif p_event_key='withdrawal.completed' then
    v_variables:=v_variables||jsonb_build_object('과목',p_payload->>'selected_subject','수업',p_payload->>'selected_class',
      '제외일',dashboard_private.subject_completion_date_v1(p_payload->>'applied_withdrawal_date',p_payload->>'occurred_at'),
      '제외회차',p_payload->>'applied_withdrawal_round','진행정보',case when jsonb_array_length(p_payload->'other_active_subjects')>0
        then '[상태] 다른 과목 수강은 그대로 유지돼요.' else '' end);
  elsif p_event_key='word_retest.result_reported' then
    select max(value::numeric) into v_max_score from (values
      (1,p_payload->>'first_score'),(2,p_payload->>'second_score'),(3,p_payload->>'third_score')) score(ordinal,value)
      where value is not null;
    v_threshold:=(p_payload->>'cutoff_question_count')::numeric; v_total:=(p_payload->>'total_question_count')::numeric;
    if v_max_score is null or v_threshold is null or v_total is null or v_total<=0 or v_threshold<0
      or v_threshold>v_total or v_max_score<0 or v_max_score>v_total
      or ((p_payload->>'result_summary')='passed') is distinct from (v_max_score>=v_threshold) then
      raise exception 'ops_subject_completion_content_invalid' using errcode='22023'; end if;
    v_scores:=trim_scale(round(v_max_score,2))::text||'점';
    v_result:=case p_payload->>'result_summary' when 'passed' then '통과' when 'failed' then '불통과' else null end;
    v_variables:=v_variables||jsonb_build_object('점수',v_scores,'통과기준',trim_scale(round(v_threshold,2))::text||'점','판정',v_result,'메모정보','');
  elsif p_event_key<>'registration.subject_registration_completed' then
    raise exception 'ops_subject_completion_event_invalid' using errcode='22023';
  end if;
  for v_item in select key,value from jsonb_each_text(v_variables) loop
    if strpos(v_rendered,'{'||v_item.key||'}')>0 and v_item.value is null then
      raise exception 'ops_subject_completion_content_invalid' using errcode='22023'; end if;
    v_rendered:=replace(v_rendered,'{'||v_item.key||'}',coalesce(v_item.value,''));
  end loop;
  v_rendered:=btrim(v_rendered);
  if v_rendered ~ '[{}]' or length(v_rendered)>4000 or v_rendered='' then
    raise exception 'ops_subject_completion_content_invalid' using errcode='22023'; end if;
  return v_rendered;
end;
$$;

create function dashboard_private.get_subject_completion_legacy_plan_v1(p_source_event_id uuid,p_actor_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event dashboard_private.notification_events%rowtype; v_task public.ops_tasks%rowtype;
  v_source public.ops_task_events%rowtype; v_actor_role text; v_items jsonb; v_href text;
begin
  select * into v_event from dashboard_private.notification_events
  where source_type='ops_task_event' and source_id=p_source_event_id::text and occurrence_key=p_source_event_id::text
    and event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported');
  if not found then return null; end if;
  select * into strict v_source from public.ops_task_events where id=p_source_event_id;
  select * into strict v_task from public.ops_tasks where id=v_source.task_id;
  select role into v_actor_role from public.profiles where id=p_actor_profile_id;
  if p_actor_profile_id is null or not dashboard_private.notification_profile_is_active_v1(p_actor_profile_id)
    or (v_task.type='registration' and not dashboard_private.registration_actor_is_active_manager_v1(p_actor_profile_id))
    or (v_task.type<>'registration' and not coalesce(v_source.actor_id=p_actor_profile_id or v_task.requested_by=p_actor_profile_id
      or v_task.assignee_id=p_actor_profile_id or v_task.secondary_assignee_id=p_actor_profile_id or v_actor_role in ('admin','staff'),false)) then
    raise exception 'ops_task_legacy_dispatch_forbidden' using errcode='42501'; end if;
  if not dashboard_private.notification_subject_completion_source_current_v1(v_event.id) then
    return jsonb_build_object('sourceEventId',p_source_event_id,'taskId',v_task.id,'items','[]'::jsonb,'stale',true); end if;
  v_href:=case when v_task.type='registration' then '/admin/registration?taskId='||v_task.id::text
    else dashboard_private.notification_ops_task_deep_link_v1(v_task.type,v_task.id,v_event.payload->>'status') end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',v_event.id,'eventKey',v_event.event_key,'occurrenceKey',v_event.occurrence_key,
    'ruleId',snapshot.item->>'rule_id','ruleRevision',snapshot.item->>'rule_revision','templateId',template_row.id,
    'templateChecksum',template_row.checksum,'channelKey','google_chat','audienceKey',snapshot.item->>'audience_key',
    'targetGeneration','0','targetKind','connection','targetKey','connection:'||target.connection_key,
    'targetProfileId',null,'connectionKey',target.connection_key,'targetSnapshot',jsonb_build_object('connection_key',target.connection_key),
    'renderedTitle',dashboard_private.render_subject_completion_template_v1(template_row.title_template,v_event.event_key,v_event.payload),
    'renderedBody',dashboard_private.render_subject_completion_template_v1(template_row.body_template,v_event.event_key,v_event.payload),
    'href',v_href,'scheduledFor',v_event.occurred_at
  ) order by snapshot.item->>'rule_id',target.connection_key),'[]'::jsonb) into v_items
  from jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template_row on template_row.id=(snapshot.item->>'template_id')::uuid
    and template_row.rule_id=(snapshot.item->>'rule_id')::uuid
  join dashboard_private.notification_rules current_rule on current_rule.id=template_row.rule_id and current_rule.enabled
  cross join lateral (
    select case subject.value when '영어' then 'google_chat.english' when '수학' then 'google_chat.math' when '과학' then 'google_chat.science' end as connection_key
    from jsonb_array_elements_text(v_event.payload->'notification_subjects') subject(value)
    where snapshot.item->>'audience_key'='subject_team' and subject.value in ('영어','수학','과학')
      and (v_event.event_key<>'word_retest.result_reported' or subject.value='영어')
  ) target
  where snapshot.item->>'channel_key'='google_chat' and snapshot.item->>'audience_key'='subject_team'
    and (snapshot.item->>'enabled')::boolean;
  return jsonb_build_object('sourceEventId',p_source_event_id,'taskId',v_task.id,'items',v_items);
end;
$$;

-- Preserve final wrappers and their historical policies for every other event.
alter function public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid) rename to get_ops_task_legacy_dispatch_before_subject_completion_v1;
create function public.get_ops_task_legacy_dispatch_plan_v1(p_source_event_id uuid,p_actor_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_plan jsonb; v_existing jsonb;
begin
  v_plan:=dashboard_private.get_subject_completion_legacy_plan_v1(p_source_event_id,p_actor_profile_id);
  if v_plan is not null then
    if exists(select 1 from public.ops_task_events where id=p_source_event_id and event_type in ('transfer.completed','withdrawal.completed')) then
      v_existing:=public.get_ops_task_legacy_dispatch_before_subject_completion_v1(p_source_event_id,p_actor_profile_id);
      return v_existing||jsonb_build_object('items',coalesce(v_existing->'items','[]'::jsonb)||coalesce(v_plan->'items','[]'::jsonb));
    end if;
    return v_plan;
  end if;
  return public.get_ops_task_legacy_dispatch_before_subject_completion_v1(p_source_event_id,p_actor_profile_id);
end;
$$;

-- The provider boundary rechecks current source facts and the narrow result
-- exception. Pending historical word-retest deliveries are not reactivated.
do $subject_external_fence$
declare v_definition text; v_anchor text; v_patch text;
begin
  v_definition:=pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure);
  v_anchor:=$anchor$  if v_claim.workflow_key = 'word_retests' and v_claim.channel_key = 'google_chat' then$anchor$;
  v_patch:=$patch$  if v_claim.workflow_key = 'word_retests' and v_claim.channel_key = 'google_chat' and not exists (
    select 1 from dashboard_private.notification_events event_row
    join dashboard_private.notification_rules rule_row on rule_row.id=v_claim.rule_id
    where event_row.workflow_key='word_retests' and event_row.occurrence_key=v_claim.occurrence_key
      and event_row.event_key='word_retest.result_reported' and rule_row.event_key=event_row.event_key
      and rule_row.audience_key='subject_team' and rule_row.enabled
      and v_claim.target_key='connection:google_chat.english'
      and dashboard_private.notification_subject_completion_source_current_v1(event_row.id)
      and exists(select 1 from jsonb_array_elements(event_row.rule_snapshot) item
        where item->>'rule_id'=rule_row.id::text and (item->>'enabled')::boolean)
  ) then$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
    or strpos(v_definition,'registration_management_notification_preview_changed')=0 then
    raise exception 'ops_subject_completion_external_fence_drift' using errcode='55000'; end if;
  v_definition:=replace(v_definition,v_anchor,v_patch);
  v_anchor:=$anchor$  v_entity_id := v_claim.id::text || ':'$anchor$;
  v_patch:=$patch$  if exists(select 1 from dashboard_private.notification_rules rule_row
    where rule_row.id=v_claim.rule_id and rule_row.audience_key='subject_team'
      and rule_row.event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported'))
    and not exists(select 1 from dashboard_private.notification_events event_row
      join dashboard_private.notification_rules rule_row on rule_row.id=v_claim.rule_id
      where event_row.workflow_key=v_claim.workflow_key and event_row.occurrence_key=v_claim.occurrence_key
        and rule_row.event_key=event_row.event_key and rule_row.workflow_key=event_row.workflow_key and rule_row.enabled
        and dashboard_private.notification_subject_completion_source_current_v1(event_row.id)
        and exists(select 1 from jsonb_array_elements_text(event_row.payload->'notification_subjects') subject(value)
          where v_claim.target_key='connection:'||case subject.value when '영어' then 'google_chat.english' when '수학' then 'google_chat.math' when '과학' then 'google_chat.science' end)) then
    return pg_catalog.jsonb_build_object('allowed',false,'reason','ops_subject_completion_source_stale');
  end if;
  v_entity_id := v_claim.id::text || ':'$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_external_source_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,v_patch);
end;
$subject_external_fence$;

-- Provider policy consumes trusted event and audience identities from the
-- claimed delivery, never from render payload or a destination inference.
do $subject_delivery_identity$
declare v_definition text; v_anchor text;
begin
  v_definition:=pg_get_functiondef('public.begin_notification_delivery_send_v1(uuid,uuid)'::regprocedure);
  v_anchor:=$anchor$    'channel_key', v_delivery.channel_key,$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_delivery_identity_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,v_anchor||E'\n    ''event_key'', v_event.event_key,\n    ''audience_key'', v_delivery.audience_key,');
end;
$subject_delivery_identity$;

do $subject_canonical_revalidation$
declare v_definition text; v_anchor text; v_patch text;
begin
  v_definition:=pg_get_functiondef('public.revalidate_immediate_notification_delivery_v1(text,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'::regprocedure);
  v_anchor:=$anchor$              and dashboard_private.registration_track_event_key_v1(
                source.after_value::jsonb ->> 'event_type',
                coalesce(source.after_value::jsonb -> 'metadata', '{}'::jsonb)
              ) = p_event_key$anchor$;
  v_patch:=$patch$              and (dashboard_private.registration_track_event_key_v1(
                source.after_value::jsonb ->> 'event_type',
                coalesce(source.after_value::jsonb -> 'metadata', '{}'::jsonb)
              ) = p_event_key or (
                p_event_key='registration.subject_registration_completed'
                and source.after_value::jsonb->>'event_type'='registration_workflow_status_changed'
                and source.after_value::jsonb->>'destination'='registered'
                and v_delivery.audience_key='subject_team'
                and dashboard_private.notification_subject_completion_source_current_v1(v_event.id)
              ))$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_revalidation_source_drift' using errcode='55000'; end if;
  v_definition:=replace(v_definition,v_anchor,v_patch);
  v_anchor:=$anchor$  if not v_source_exists then$anchor$;
  v_patch:=$patch$  if v_delivery.audience_key='subject_team'
    and p_event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported')
    and (not dashboard_private.notification_subject_completion_source_current_v1(v_event.id)
      or v_delivery.channel_key<>'google_chat' or v_delivery.target_kind<>'connection'
      or v_delivery.target_key is distinct from 'connection:'||v_delivery.connection_key
      or not exists(select 1 from jsonb_array_elements_text(v_event.payload->'notification_subjects') subject(value)
        where v_delivery.connection_key=case subject.value when '영어' then 'google_chat.english' when '수학' then 'google_chat.math' when '과학' then 'google_chat.science' end)) then
    v_source_exists:=false;
  end if;
  if not v_source_exists then$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
    raise exception 'ops_subject_completion_revalidation_target_drift' using errcode='55000'; end if;
  execute replace(v_definition,v_anchor,v_patch);
end;
$subject_canonical_revalidation$;

alter function dashboard_private.ops_subject_notification_subjects_v1(uuid) owner to postgres;
alter function dashboard_private.record_registration_subject_completion_v1(uuid,uuid,uuid,text,integer) owner to postgres;
alter function dashboard_private.notification_subject_completion_source_current_v1(uuid) owner to postgres;
alter function dashboard_private.render_subject_completion_template_v1(text,text,jsonb) owner to postgres;
alter function dashboard_private.subject_completion_date_v1(text,text) owner to postgres;
alter function dashboard_private.get_subject_completion_legacy_plan_v1(uuid,uuid) owner to postgres;
alter function public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.ops_subject_notification_subjects_v1(uuid),
  dashboard_private.record_registration_subject_completion_v1(uuid,uuid,uuid,text,integer),
  dashboard_private.notification_subject_completion_source_current_v1(uuid),
  dashboard_private.render_subject_completion_template_v1(text,text,jsonb),
  dashboard_private.subject_completion_date_v1(text,text),
  dashboard_private.get_subject_completion_legacy_plan_v1(uuid,uuid),
  public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
