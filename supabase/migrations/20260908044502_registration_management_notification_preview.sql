begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Preview receipts bind the existing explicit source to the content confirmed by
-- its operator. They are not another delivery queue or an automatic trigger.
create table dashboard_private.registration_management_notification_previews (
 source_event_id uuid primary key references public.ops_task_events(id) on delete restrict,
 track_id uuid not null references public.ops_registration_subject_tracks(id) on delete restrict,
 actor_profile_id uuid not null references public.profiles(id) on delete restrict,
 preview_checksum text not null check (preview_checksum ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
 created_at timestamptz not null default now()
);
alter table dashboard_private.registration_management_notification_previews enable row level security;
revoke all on table dashboard_private.registration_management_notification_previews from public,anon,authenticated,service_role;

create function dashboard_private.registration_management_notification_preview_context_v1(p_track_id uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 s jsonb; v_rule dashboard_private.notification_rules%rowtype;
 v_template dashboard_private.notification_templates%rowtype;
 v_mention dashboard_private.notification_rule_mention_settings%rowtype;
 v_connection public.google_chat_webhook_settings%rowtype;
 v_identity jsonb; v_profile uuid; v_actor uuid := p_actor; v_event text;
 v_payload jsonb; v_result jsonb; v_reason text := ''; v_status text := 'ready';
begin
 perform dashboard_private.assert_registration_actor_is_active_manager_v1(p_actor);
 s := dashboard_private.registration_management_notification_fact_snapshot_v2(p_track_id,p_actor);
 if s is null or s->>'archivedAt' is not null then
  raise exception 'registration_track_not_found' using errcode='P0002';
 end if;
 -- v2 may reuse an earlier operator's exact source. Preview the frozen author
 -- in that source, so a second operator never confirms different rendered text.
 select source.actor_id into v_actor from public.ops_task_events source
 where source.task_id=(s->>'taskId')::uuid
  and source.event_type='registration_track_event'
  and source.field_name='registration_track:'||p_track_id::text
  and dashboard_private.registration_management_notification_source_current_v2(source.id,null)
 order by source.created_at desc,source.id desc limit 1;
 v_actor:=coalesce(v_actor,p_actor);
 s := dashboard_private.registration_management_notification_fact_snapshot_v2(p_track_id,v_actor);
 v_event := dashboard_private.registration_management_notification_event_key_v2(s->>'workflowStatus');
 select * into v_rule from dashboard_private.notification_rules
 where scope_key='global' and workflow_key='registration' and event_key=v_event
  and channel_key='google_chat' and audience_key='management_team' order by id limit 1;
 select * into v_template from dashboard_private.notification_templates where id=v_rule.active_template_id and rule_id=v_rule.id;
 select * into v_mention from dashboard_private.notification_rule_mention_settings where rule_id=v_rule.id;
 select * into v_connection from public.google_chat_webhook_settings where channel='admin';
 v_profile := nullif(s->>'directorProfileId','')::uuid;
 select jsonb_build_object('profileId',profile.id,'name',coalesce(nullif(profile.name,''),'담당 원장'),
  'identityRevision',identity.identity_revision::text,
  'userName',case when identity.verification_status='verified'
   and identity.chat_user_id ~ '^[1-9][0-9]{0,31}$'
   and identity.account_email_snapshot=lower(btrim(account.email))
   and dashboard_private.notification_profile_is_active_v1(profile.id)
   then 'users/'||identity.chat_user_id else null end)
 into v_identity from public.profiles profile
 left join dashboard_private.google_chat_profile_identities identity on identity.profile_id=profile.id
 left join auth.users account on account.id=profile.id where profile.id=v_profile;
 if v_event is null or s->>'taskStatus' in ('done','canceled') then
  v_status:='not_ready'; v_reason:='현재 진행상태에는 보낼 관리팀 알림이 없습니다.';
 elsif nullif(btrim(s->>'studentName'),'') is null or nullif(btrim(s->>'subject'),'') is null
  or (v_event='registration.case_created' and (nullif(btrim(s->>'schoolGrade'),'') is null or s->>'inquiryAt' is null)) then
  v_status:='not_ready'; v_reason:='알림에 필요한 학생 이름·과목·학년·문의 시각을 확인해 주세요.';
 elsif v_rule.id is null or not v_rule.enabled then
  v_status:='rule_disabled'; v_reason:='이 진행단계의 관리팀 알림이 꺼져 있습니다.';
 elsif v_template.id is null then
  v_status:='template_missing'; v_reason:='이 진행단계의 알림 내용을 확인해 주세요.';
 elsif dashboard_private.notification_dispatch_enabled_v1('registration',v_event) then
  v_status:='owner_changed'; v_reason:='현재 직접 발송을 사용할 수 없습니다. 알림 운영 상태를 확인해 주세요.';
 elsif v_connection.channel is null or v_connection.connection_state not in ('legacy_active','encrypted_active')
  or (nullif(btrim(v_connection.webhook_url),'') is null and nullif(btrim(v_connection.webhook_url_ciphertext),'') is null) then
  v_status:='connection_missing'; v_reason:='관리팀 Google Chat 수신 채팅방을 연결해 주세요.';
 end if;
 v_payload := jsonb_build_object('student_name',s->>'studentName','grade',s->>'schoolGrade',
  'subject',s->>'subject','subjects',s->'activeSubjects','current_status',s->>'currentStatus',
  'inquiry_at',coalesce(dashboard_private.registration_notification_kst_datetime_v1(nullif(s->>'inquiryAt','')::timestamptz,now()),'확인 필요'),
  'actor_name',s->>'actorDisplayName','progress_line',coalesce(s->>'progressLine',''),
  'memo_line',coalesce(s->>'memoLine',''),'memo',s->>'memo','reason_line','');
 v_result:=jsonb_build_object('trackId',p_track_id,'taskId',s->>'taskId','workflowRevision',s->'workflowRevision',
  'eventKey',v_event,'stepLabel',s->>'currentStatus','sourceActorId',v_actor,
  'factsChecksum',dashboard_private.registration_management_notification_fact_checksum_v2(s),
  'ruleId',v_rule.id,'ruleRevision',v_rule.revision::text,'ruleEnabled',coalesce(v_rule.enabled,false),
  'templateId',v_template.id,'templateChecksum',v_template.checksum,
  'mentionRevision',v_mention.revision::text,'mentionEnabled',coalesce(v_mention.mention_enabled,false),
  'mentionIdentity',v_identity,
  'mentionUserNames',case when v_mention.mention_enabled and v_identity->>'userName' is not null then jsonb_build_array(v_identity->>'userName') else '[]'::jsonb end,
  'mentionLabel',case when v_mention.mention_enabled and v_identity->>'userName' is not null then v_identity->>'name' else '담당자 멘션 없음' end,
  'connectionKey','google_chat.management','connectionRevision',v_connection.revision::text,
  'targetLabel','관리팀 Google Chat 채팅방',
  'renderedTitle',case when v_template.id is not null then dashboard_private.registration_render_fixed_template_v2(v_template.title_template,v_payload,v_template.allowed_variables) else '' end,
  'renderedBody',case when v_template.id is not null then dashboard_private.registration_render_fixed_template_v2(v_template.body_template,v_payload,v_template.allowed_variables) else '' end,
  'href','/admin/registration?taskId='||(s->>'taskId')||'&trackId='||p_track_id::text,
  'status',v_status,'reason',v_reason,'canSend',v_status='ready');
 return v_result||jsonb_build_object('previewChecksum',dashboard_private.notification_sha256_hex_v1(v_result::text));
end;
$$;

create function public.get_registration_management_notification_preview_v1(p_track_id uuid,p_workflow_revision integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_preview jsonb; v_existing dashboard_private.notification_events%rowtype; v_snapshot jsonb; v_status text;
begin
 v_preview:=dashboard_private.registration_management_notification_preview_context_v1(p_track_id,(select auth.uid()));
 if p_workflow_revision is null or v_preview->>'workflowRevision' is distinct from p_workflow_revision::text then
  raise exception 'registration_management_notification_refresh_required' using errcode='23514';
 end if;
 -- Read existing receipts before offering a confirm action. Metadata is kept
 -- outside the content checksum: first confirmation creates a source, but
 -- must not change the content fingerprint merely by creating its receipt.
 select event_row.* into v_existing from dashboard_private.notification_events event_row
 where event_row.workflow_key='registration' and event_row.event_key=v_preview->>'eventKey'
  and event_row.source_type='ops_task_event' and event_row.payload->>'track_id'=p_track_id::text
  and dashboard_private.registration_management_notification_source_current_v2(event_row.source_id::uuid,null)
 order by event_row.created_at desc,event_row.id desc limit 1;
 if found then
  select item into v_snapshot from jsonb_array_elements(v_existing.rule_snapshot) item
  where item->>'channel_key'='google_chat' and item->>'audience_key'='management_team' limit 1;
  v_status:=case
   when exists(select 1 from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.workflow_key='registration' and claim.occurrence_key=v_existing.occurrence_key
     and claim.channel_key='google_chat' and claim.terminal_outcome='sent')
    or exists(select 1 from dashboard_private.notification_deliveries delivery where delivery.event_id=v_existing.id and delivery.channel_key='google_chat' and delivery.status='sent') then 'already_sent'
   when exists(select 1 from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.workflow_key='registration' and claim.occurrence_key=v_existing.occurrence_key and claim.channel_key='google_chat')
    or exists(select 1 from dashboard_private.notification_deliveries delivery where delivery.event_id=v_existing.id and delivery.channel_key='google_chat'
      and (delivery.last_attempt_started_at is not null or delivery.status in ('sending','delivery_unknown'))) then 'delivery_unknown'
   when v_snapshot->>'enabled' is distinct from 'true'
    or v_snapshot->>'rule_id' is distinct from v_preview->>'ruleId'
    or v_snapshot->>'rule_revision' is distinct from v_preview->>'ruleRevision'
    or v_snapshot->>'template_id' is distinct from v_preview->>'templateId'
    or exists(select 1 from dashboard_private.registration_management_notification_previews binding
      where binding.source_event_id=v_existing.source_id::uuid and binding.preview_checksum<>v_preview->>'previewChecksum') then 'existing_source_changed'
   else null end;
  v_preview:=v_preview||jsonb_build_object('existingEventId',v_existing.id,'existingRequestedAt',v_existing.occurred_at,
   'existingRuleEnabled',coalesce((v_snapshot->>'enabled')::boolean,false));
  if v_status is not null then
   v_preview:=v_preview||jsonb_build_object('canSend',false,'status',v_status,'reason',case v_status
    when 'already_sent' then '같은 등록 정보의 관리팀 알림을 이미 전달했습니다.'
    when 'delivery_unknown' then '기존 알림의 처리 이력이 있습니다. 발송 상태를 먼저 확인해 주세요.'
    else '이전 알림 요청에 저장된 설정과 현재 설정이 다릅니다. 이전 기록을 확인해 주세요.' end);
  end if;
 end if;
 return v_preview;
end;
$$;

create function public.ensure_registration_workflow_notification_v3(p_track_id uuid,p_workflow_revision integer,p_request_key text,p_intent text,p_expected_preview_checksum text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_preview jsonb; v_result jsonb; v_id uuid; v_existing text; v_plan jsonb; v_item jsonb;
begin
 perform dashboard_private.assert_registration_actor_is_active_manager_v1((select auth.uid()));
 if p_expected_preview_checksum is null or p_expected_preview_checksum !~ '^[a-f0-9]{64}$' then
  raise exception 'registration_management_notification_preview_invalid' using errcode='22023';
 end if;
 -- Match v2's fact locks first. Rule/mention/connection changes cannot cross
 -- confirmation; the dispatch adapter performs another read before transport.
 perform 1 from public.ops_tasks task join public.ops_registration_subject_tracks track on track.task_id=task.id
 join public.ops_registration_details detail on detail.task_id=task.id where track.id=p_track_id
 for update of task,track,detail;
 perform 1 from dashboard_private.notification_rules where scope_key='global' and workflow_key='registration'
  and channel_key='google_chat' and audience_key='management_team' order by id for share;
 perform 1 from dashboard_private.notification_rule_mention_settings mention
 join dashboard_private.notification_rules rule on rule.id=mention.rule_id where rule.workflow_key='registration'
 order by mention.rule_id for share of mention;
 perform 1 from public.google_chat_webhook_settings where channel='admin' for share;
 perform 1 from public.profiles profile join public.ops_registration_subject_tracks track on track.director_profile_id=profile.id
  where track.id=p_track_id for share of profile;
 perform 1 from dashboard_private.google_chat_profile_identities identity join public.ops_registration_subject_tracks track on track.director_profile_id=identity.profile_id
  where track.id=p_track_id for share of identity;
 perform 1 from auth.users account join public.ops_registration_subject_tracks track on track.director_profile_id=account.id
  where track.id=p_track_id for share of account;
 v_preview:=public.get_registration_management_notification_preview_v1(p_track_id,p_workflow_revision);
 if v_preview->>'previewChecksum' is distinct from p_expected_preview_checksum then
  raise exception 'registration_management_notification_preview_changed' using errcode='23514';
 end if;
 if not (v_preview->>'canSend')::boolean then
  raise exception 'registration_management_notification_not_ready' using errcode='23514';
 end if;
 v_result:=public.ensure_registration_workflow_notification_v2(p_track_id,p_workflow_revision,p_request_key,p_intent);
 if jsonb_array_length(v_result->'sourceEventIds')<>1 then
  raise exception 'registration_management_notification_refresh_required' using errcode='23514';
 end if;
 v_id:=(v_result->'sourceEventIds'->>0)::uuid;
 v_plan:=public.get_registration_core_legacy_dispatch_plan_v1(v_id,(select auth.uid()));
 if jsonb_array_length(v_plan->'items')<>1 then
  raise exception 'registration_management_notification_existing_source_changed' using errcode='23514';
 end if;
 v_item:=v_plan->'items'->0;
 if v_item->>'ruleId' is distinct from v_preview->>'ruleId'
  or v_item->>'ruleRevision' is distinct from v_preview->>'ruleRevision'
  or v_item->>'templateId' is distinct from v_preview->>'templateId'
  or v_item->>'templateChecksum' is distinct from v_preview->>'templateChecksum' then
  raise exception 'registration_management_notification_existing_source_changed' using errcode='23514';
 end if;
 select preview_checksum into v_existing from dashboard_private.registration_management_notification_previews where source_event_id=v_id;
 if found and v_existing is distinct from p_expected_preview_checksum then
  raise exception 'registration_management_notification_existing_source_changed' using errcode='23514';
 end if;
 insert into dashboard_private.registration_management_notification_previews(source_event_id,track_id,actor_profile_id,preview_checksum,snapshot)
 values(v_id,p_track_id,(select auth.uid()),p_expected_preview_checksum,v_preview) on conflict(source_event_id) do nothing;
 return v_result;
end;
$$;

-- Wrap the final v2 plan, retaining its authorization and current-facts fence.
alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid) rename to get_registration_core_legacy_dispatch_plan_before_preview_v1;
create function public.get_registration_core_legacy_dispatch_plan_v1(p_source_event_id uuid,p_actor_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan jsonb; v_binding dashboard_private.registration_management_notification_previews%rowtype; v_preview jsonb; v_items jsonb;
begin
 v_plan:=public.get_registration_core_legacy_dispatch_plan_before_preview_v1(p_source_event_id,p_actor_profile_id);
 select * into v_binding from dashboard_private.registration_management_notification_previews where source_event_id=p_source_event_id;
 if not found then return v_plan; end if;
 if not dashboard_private.registration_management_notification_source_current_v2(p_source_event_id,null) then
  return v_plan||jsonb_build_object('items','[]'::jsonb);
 end if;
 v_preview:=dashboard_private.registration_management_notification_preview_context_v1(v_binding.track_id,v_binding.actor_profile_id);
 if v_preview->>'previewChecksum' is distinct from v_binding.preview_checksum or not (v_preview->>'canSend')::boolean then
  raise exception 'registration_management_notification_preview_changed' using errcode='23514';
 end if;
 select coalesce(jsonb_agg(item || jsonb_build_object('renderedTitle',v_binding.snapshot->>'renderedTitle',
  'renderedBody',v_binding.snapshot->>'renderedBody','mentionUserNames',v_binding.snapshot->'mentionUserNames',
  'previewChecksum',v_binding.preview_checksum,'previewSourceEventId',p_source_event_id)), '[]'::jsonb)
 into v_items from jsonb_array_elements(v_plan->'items') item;
 return v_plan||jsonb_build_object('items',v_items);
end;
$$;

create function public.validate_registration_management_notification_preview_v1(p_source_event_id uuid,p_expected_preview_checksum text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_binding dashboard_private.registration_management_notification_previews%rowtype; v_preview jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'notification_access_denied' using errcode='42501'; end if;
 select * into v_binding from dashboard_private.registration_management_notification_previews where source_event_id=p_source_event_id;
 if not found or v_binding.preview_checksum is distinct from p_expected_preview_checksum then return false; end if;
 v_preview:=dashboard_private.registration_management_notification_preview_context_v1(v_binding.track_id,v_binding.actor_profile_id);
 return v_preview->>'previewChecksum'=p_expected_preview_checksum
  and (v_preview->>'canSend')::boolean
  and dashboard_private.registration_management_notification_source_current_v2(p_source_event_id,null);
end;
$$;

-- Extend the final ordered provider gate; preserve cancellation, retired word
-- retest, ownership and v2 fact fences already installed before this migration.
do $management_preview_external_fence$
declare v_definition text; v_anchor text; v_replacement text;
begin
 v_definition:=pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure);
 v_anchor:='  v_entity_id := v_claim.id::text || ';
 v_replacement:=$patch$  if exists (
    select 1 from dashboard_private.registration_management_notification_previews preview
    join dashboard_private.notification_events event_row on event_row.source_type='ops_task_event'
      and event_row.source_id=preview.source_event_id::text and event_row.workflow_key='registration'
    where event_row.workflow_key=v_claim.workflow_key and event_row.occurrence_key=v_claim.occurrence_key
      and public.validate_registration_management_notification_preview_v1(preview.source_event_id,preview.preview_checksum) is not true
  ) then
    raise exception 'registration_management_notification_preview_changed' using errcode='23514';
  end if;
  v_entity_id := v_claim.id::text || $patch$;
 if strpos(v_definition,'registration_visit_cancellation_source_stale')=0
   or strpos(v_definition,'word_retest_google_chat_retired')=0
   or strpos(v_definition,'registration_management_notification_snapshot_stale')=0
   or length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
  raise exception 'registration_management_preview_gate_anchor_invalid' using errcode='55000';
 end if;
 execute replace(v_definition,v_anchor,v_replacement);
end;
$management_preview_external_fence$;

revoke all on function dashboard_private.registration_management_notification_preview_context_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_registration_management_notification_preview_v1(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.ensure_registration_workflow_notification_v3(uuid,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_registration_core_legacy_dispatch_plan_before_preview_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.validate_registration_management_notification_preview_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_registration_management_notification_preview_v1(uuid,integer) to authenticated;
grant execute on function public.ensure_registration_workflow_notification_v3(uuid,integer,text,text,text) to authenticated;
grant execute on function public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid) to service_role;
grant execute on function public.validate_registration_management_notification_preview_v1(uuid,text) to service_role;
-- Adopt the four explicit management stages without enabling mentions or
-- changing any existing operator choice. Retired observation rules stay intact.
insert into dashboard_private.notification_rule_mention_settings(rule_id,mention_enabled,revision)
select rule.id,false,1 from dashboard_private.notification_rules rule
where rule.scope_key='global' and rule.workflow_key='registration'
 and rule.channel_key='google_chat' and rule.audience_key='management_team'
 and rule.event_key in ('registration.case_created','registration.consultation_completed',
  'registration.waiting_transitioned','registration.admission_started')
on conflict(rule_id) do nothing;

notify pgrst,'reload schema';
commit;
