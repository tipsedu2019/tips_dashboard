begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- An explicit replacement is append-only provenance, never a rewrite of the
-- original source, canonical snapshot, preview receipt or request ledger.
create table dashboard_private.registration_management_notification_recoveries (
 request_id uuid primary key references dashboard_private.notification_request_ledger(request_id) deferrable initially deferred,
 track_id uuid not null references public.ops_registration_subject_tracks(id) on delete restrict,
 actor_profile_id uuid not null references public.profiles(id) on delete restrict,
 previous_source_event_id uuid not null unique references public.ops_task_events(id) on delete restrict,
 previous_event_id uuid not null unique references dashboard_private.notification_events(id) on delete restrict,
 source_event_id uuid not null unique references public.ops_task_events(id) on delete restrict,
 preview_checksum text not null check(preview_checksum ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 check(previous_source_event_id<>source_event_id)
);
create index registration_management_recovery_track_idx on dashboard_private.registration_management_notification_recoveries(track_id,created_at desc,source_event_id desc);
create table dashboard_private.registration_management_notification_superseded_sources (
 source_event_id uuid primary key references public.ops_task_events(id) on delete restrict,
 recovery_request_id uuid not null unique references dashboard_private.registration_management_notification_recoveries(request_id) deferrable initially deferred,
 created_at timestamptz not null default now()
);
alter table dashboard_private.registration_management_notification_recoveries enable row level security;
alter table dashboard_private.registration_management_notification_superseded_sources enable row level security;
revoke all on table dashboard_private.registration_management_notification_recoveries,
 dashboard_private.registration_management_notification_superseded_sources from public,anon,authenticated,service_role;

alter function dashboard_private.registration_management_notification_source_current_v2(uuid,uuid)
 rename to registration_management_source_current_before_recovery_v2;
create function dashboard_private.registration_management_notification_source_current_v2(p_source_event_id uuid,p_expected_actor_profile_id uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from dashboard_private.registration_management_notification_superseded_sources where source_event_id=p_source_event_id) then return false; end if;
 return dashboard_private.registration_management_source_current_before_recovery_v2(p_source_event_id,p_expected_actor_profile_id);
end;
$$;

-- This is the preceding content renderer with exactly one additional source
-- exclusion. Recovery previews render the new confirming actor from the start.
create function dashboard_private.registration_management_notification_preview_content_v2(p_track_id uuid,p_actor uuid,p_excluded_source_id uuid)
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
  and source.id is distinct from p_excluded_source_id
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

create or replace function dashboard_private.registration_management_notification_preview_context_v1(p_track_id uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_previous uuid;
begin
 v_result:=dashboard_private.registration_management_notification_preview_content_v2(p_track_id,p_actor,null);
 select recovery.previous_source_event_id into v_previous
 from dashboard_private.registration_management_notification_recoveries recovery
 where recovery.track_id=p_track_id
  and dashboard_private.registration_management_notification_source_current_v2(recovery.source_event_id,null)
 order by recovery.created_at desc,recovery.source_event_id desc limit 1;
 if v_previous is not null then
  v_result:=(v_result-'previewChecksum')||jsonb_build_object('recoverySourceEventId',v_previous);
  v_result:=v_result||jsonb_build_object('previewChecksum',dashboard_private.notification_sha256_hex_v1(v_result::text));
 end if;
 return v_result;
end;
$$;

-- A strict history-zero predicate. Even a terminal failed claim or a pending
-- materialized delivery is evidence that this occurrence entered dispatch.
create function dashboard_private.registration_management_notification_recovery_allowed_v1(p_source_event_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_event dashboard_private.notification_events%rowtype;
begin
 if dashboard_private.registration_management_notification_source_current_v2(p_source_event_id,null) is not true then return false; end if;
 select * into v_event from dashboard_private.notification_events where workflow_key='registration'
  and source_type='ops_task_event' and source_id=p_source_event_id::text and occurrence_key=p_source_event_id::text;
 if not found then return false; end if;
 -- Unexpected alternate canonical records are not a history-zero source.
 if (select count(*) from dashboard_private.notification_events candidate where candidate.workflow_key='registration'
   and (candidate.source_id=p_source_event_id::text or candidate.occurrence_key=p_source_event_id::text))<>1 then return false; end if;
 if (select count(*) from dashboard_private.notification_events candidate where candidate.workflow_key='registration'
    and candidate.event_key=v_event.event_key and candidate.source_type='ops_task_event'
    and candidate.payload->>'track_id'=v_event.payload->>'track_id'
    and dashboard_private.registration_management_notification_source_current_v2(candidate.source_id::uuid,null))<>1 then return false; end if;
 return not exists(select 1 from dashboard_private.notification_dispatch_ownership_claims claim
   where claim.workflow_key=v_event.workflow_key and claim.occurrence_key=v_event.occurrence_key)
  and not exists(select 1 from dashboard_private.notification_deliveries where event_id=v_event.id)
  and not exists(select 1 from dashboard_private.notification_audit_logs audit
   join dashboard_private.notification_dispatch_ownership_claims claim on audit.entity_id like claim.id::text||':%'
   where claim.workflow_key=v_event.workflow_key and claim.occurrence_key=v_event.occurrence_key
    and audit.entity_kind='notification_external_attempt')
  and not exists(select 1 from dashboard_private.notification_event_fanout_jobs job where job.event_id=v_event.id
   and (job.status<>'pending' or job.attempt_count<>0 or job.claimed_by is not null or job.claim_token is not null
    or job.lease_expires_at is not null or job.completed_at is not null or job.cursor<>'{}'::jsonb))
  and not exists(select 1 from dashboard_private.notification_target_reconciliation_jobs job
   where job.workflow_key='registration' and (job.source_event_id=v_event.id or (job.source_type='ops_task_event' and job.source_id=v_event.source_id))
    and (job.status<>'pending' or job.attempt_count<>0 or job.claimed_by is not null or job.claim_token is not null
     or job.lease_expires_at is not null or job.completed_at is not null or job.cursor<>'{}'::jsonb or job.canceled_count<>0 or job.fanout_count<>0));
end;
$$;

alter function public.get_registration_management_notification_preview_v1(uuid,integer)
 rename to get_registration_management_preview_before_recovery_v1;
create function public.get_registration_management_notification_preview_v1(p_track_id uuid,p_workflow_revision integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_preview jsonb; v_fresh jsonb; v_source uuid; v_previous uuid;
begin
 v_preview:=public.get_registration_management_preview_before_recovery_v1(p_track_id,p_workflow_revision)
  ||jsonb_build_object('recoveryAvailable',false,'recoverySourceEventId',null);
 select source_id::uuid into v_source from dashboard_private.notification_events
 where id=nullif(v_preview->>'existingEventId','')::uuid and workflow_key='registration' and source_type='ops_task_event';
 if v_preview->>'status'='existing_source_changed' and v_source is not null
  and dashboard_private.registration_management_notification_recovery_allowed_v1(v_source) then
  v_fresh:=dashboard_private.registration_management_notification_preview_content_v2(p_track_id,(select auth.uid()),v_source);
  if (v_fresh->>'canSend')::boolean then
   v_fresh:=(v_fresh-'previewChecksum')||jsonb_build_object('recoverySourceEventId',v_source);
   v_preview:=v_preview||v_fresh||jsonb_build_object('recoveryAvailable',true,
    'previewChecksum',dashboard_private.notification_sha256_hex_v1(v_fresh::text));
  end if;
 end if;
 select previous_event_id into v_previous from dashboard_private.registration_management_notification_recoveries where source_event_id=v_source;
 if v_previous is not null then v_preview:=v_preview||jsonb_build_object('recoveredFromEventId',v_previous); end if;
 return v_preview;
end;
$$;

-- v3 remains compatible, but cannot turn a recovery preview into implicit
-- replacement. Only v4 accepts the old-source identity shown for confirmation.
do $v3_guard$
declare v_definition text; v_anchor text;
begin
 v_definition:=pg_get_functiondef('public.ensure_registration_workflow_notification_v3(uuid,integer,text,text,text)'::regprocedure);
 v_anchor:=' v_preview:=public.get_registration_management_notification_preview_v1(p_track_id,p_workflow_revision);';
 if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then raise exception 'registration_recovery_v3_anchor_invalid' using errcode='55000'; end if;
 execute replace(v_definition,v_anchor,v_anchor||E'\n if (v_preview->>''recoveryAvailable'')::boolean then raise exception ''registration_management_notification_recovery_not_allowed'' using errcode=''23514''; end if;');
end;
$v3_guard$;

-- INSERT fences close the source-current precheck -> claim/materialization
-- gap for both legacy and canonical dispatch. Queue transitions lock their row
-- first; confirmation takes the same queue-row -> source-advisory order.
create function dashboard_private.registration_management_notification_source_fence_v1(p_event_id uuid,p_workflow text,p_occurrence text,p_require_current boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_event dashboard_private.notification_events%rowtype; v_payload jsonb; v_track uuid; v_metadata jsonb;
begin
 select * into v_event from dashboard_private.notification_events where
  (id=p_event_id or (workflow_key=p_workflow and occurrence_key=p_occurrence))
  and workflow_key='registration' and source_type='ops_task_event'
  and event_key in ('registration.case_created','registration.consultation_completed','registration.waiting_transitioned','registration.admission_started')
 order by id limit 1;
 if not found then return; end if;
 select dashboard_private.try_registration_event_jsonb_object(after_value) into v_payload from public.ops_task_events where id=dashboard_private.try_registration_event_uuid(v_event.source_id);
 v_metadata:=v_payload->'metadata'; v_track:=dashboard_private.try_registration_event_uuid(v_payload->>'track_id');
 if v_track is null or v_metadata->>'contractVersion' is distinct from '2' then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-management-notification-v2:'||v_track::text||':'||(v_metadata->>'workflowRevision')||':'||v_event.event_key,0));
 -- A separate statement after waiting observes committed supersession at READ COMMITTED.
 if exists(select 1 from dashboard_private.registration_management_notification_superseded_sources where source_event_id=v_event.source_id::uuid)
  or (p_require_current and dashboard_private.registration_management_notification_source_current_v2(v_event.source_id::uuid,null) is not true) then
  raise exception 'registration_management_notification_snapshot_stale' using errcode='23514';
 end if;
end;
$$;

create function dashboard_private.registration_management_notification_history_insert_fence_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_table_name='notification_dispatch_ownership_claims' then
  perform dashboard_private.registration_management_notification_source_fence_v1(null,new.workflow_key,new.occurrence_key,true);
 else
  perform dashboard_private.registration_management_notification_source_fence_v1(new.event_id,null,null,true);
 end if;
 return new;
end;
$$;
create trigger registration_management_recovery_claim_fence before insert on dashboard_private.notification_dispatch_ownership_claims
 for each row execute function dashboard_private.registration_management_notification_history_insert_fence_v1();
create trigger registration_management_recovery_delivery_fence before insert on dashboard_private.notification_deliveries
 for each row execute function dashboard_private.registration_management_notification_history_insert_fence_v1();

create function dashboard_private.registration_management_notification_queue_fence_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare v_event_id uuid; v_duplicate boolean:=false; v_workflow text; v_occurrence text;
begin
 if tg_table_name='notification_event_fanout_jobs' then
  v_event_id:=new.event_id;
  if tg_op='INSERT' then select exists(select 1 from dashboard_private.notification_event_fanout_jobs where event_id=new.event_id) into v_duplicate; end if;
 else
  v_event_id:=new.source_event_id; v_workflow:=new.workflow_key; v_occurrence:=new.source_id;
  if tg_op='INSERT' then select exists(select 1 from dashboard_private.notification_target_reconciliation_jobs job
   where job.workflow_key=new.workflow_key and job.source_type=new.source_type and job.source_id=new.source_id
    and job.source_revision is not distinct from new.source_revision and job.source_event_id=new.source_event_id
    and job.reconciliation_kind=new.reconciliation_kind) into v_duplicate; end if;
 end if;
 -- Duplicate enqueue does not create a job. Avoid taking source -> row locks
 -- before its existing ON CONFLICT DO NOTHING / SELECT FOR UPDATE replay path.
 if v_duplicate then
  if exists(select 1 from dashboard_private.notification_events event_row
   join dashboard_private.registration_management_notification_superseded_sources old_source on old_source.source_event_id::text=event_row.source_id
   where (event_row.id=v_event_id or (event_row.workflow_key=v_workflow and event_row.occurrence_key=v_occurrence)) and event_row.source_type='ops_task_event') then
   raise exception 'registration_management_notification_snapshot_stale' using errcode='23514';
  end if;
 elsif tg_op='INSERT' or new.status in ('pending','claimed') then
  perform dashboard_private.registration_management_notification_source_fence_v1(v_event_id,v_workflow,v_occurrence,tg_op='UPDATE');
 end if;
 return new;
end;
$$;
create trigger registration_management_recovery_fanout_fence before insert or update on dashboard_private.notification_event_fanout_jobs
 for each row execute function dashboard_private.registration_management_notification_queue_fence_v1();
create trigger registration_management_recovery_target_fence before insert or update on dashboard_private.notification_target_reconciliation_jobs
 for each row execute function dashboard_private.registration_management_notification_queue_fence_v1();

create function public.ensure_registration_workflow_notification_v4(p_track_id uuid,p_workflow_revision integer,p_request_key text,p_intent text,p_expected_preview_checksum text,p_expected_recovery_source_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_request uuid; v_inner uuid; v_fingerprint text;
 v_ledger dashboard_private.notification_request_ledger%rowtype; v_event dashboard_private.notification_events%rowtype;
 v_preview jsonb; v_result jsonb; v_id uuid; v_plan jsonb; v_item jsonb; v_event_key text;
 v_fanout_ids uuid[]; v_target_ids uuid[];
begin
 perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor);
 if p_track_id is null or p_workflow_revision is null or p_workflow_revision<1
  or p_expected_preview_checksum is null or p_expected_preview_checksum !~ '^[a-f0-9]{64}$'
  or p_request_key is null or p_request_key<>btrim(p_request_key)
  or dashboard_private.try_registration_event_uuid(p_request_key) is null
  or p_intent is distinct from 'send_registration_management_notification' then
  raise exception 'registration_management_notification_preview_invalid' using errcode='22023';
 end if;
 v_request:=p_request_key::uuid;
 if p_expected_recovery_source_event_id is null then
  return public.ensure_registration_workflow_notification_v3(p_track_id,p_workflow_revision,p_request_key,p_intent,p_expected_preview_checksum)
   ||jsonb_build_object('recovered',false);
 end if;
 v_fingerprint:=dashboard_private.notification_sha256_hex_v1(jsonb_build_object('actor',v_actor,'track',p_track_id,'revision',p_workflow_revision,
  'intent',p_intent,'preview',p_expected_preview_checksum,'previousSource',p_expected_recovery_source_event_id)::text);
 -- Match the preceding confirmation's fact and settings lock order.
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
 select event_row.* into v_event from dashboard_private.notification_events event_row
 where event_row.workflow_key='registration' and event_row.source_type='ops_task_event'
  and event_row.source_id=p_expected_recovery_source_event_id::text
  and event_row.payload->>'track_id'=p_track_id::text;
 if not found then raise exception 'registration_management_notification_recovery_changed' using errcode='23514'; end if;
 -- Fixed table/ID order, before the shared source advisory lock. A new queue
 -- arriving while these rows were locked is rejected below, never locked here.
 select coalesce(array_agg(locked.id),'{}'::uuid[]) into v_fanout_ids from
  (select id from dashboard_private.notification_event_fanout_jobs where event_id=v_event.id order by id for update) locked;
 select coalesce(array_agg(locked.id),'{}'::uuid[]) into v_target_ids from
  (select id from dashboard_private.notification_target_reconciliation_jobs where workflow_key='registration'
   and (source_event_id=v_event.id or (source_type='ops_task_event' and source_id=v_event.source_id)) order by id for update) locked;
 v_event_key:=v_event.event_key;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-management-notification-v2:'||p_track_id::text||':'||p_workflow_revision::text||':'||v_event_key,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('notification-request:'||v_request::text,0));
 select * into v_ledger from dashboard_private.notification_request_ledger where request_id=v_request;
 if found then
  if v_ledger.request_kind<>'registration_management_notification_recovery_v4' or v_ledger.request_fingerprint<>v_fingerprint then
   raise exception 'notification_idempotency_conflict' using errcode='23514';
  end if;
  return v_ledger.response_payload;
 end if;
 if exists(select 1 from dashboard_private.notification_event_fanout_jobs where event_id=v_event.id and not(id=any(v_fanout_ids)))
  or exists(select 1 from dashboard_private.notification_target_reconciliation_jobs where workflow_key='registration'
   and (source_event_id=v_event.id or (source_type='ops_task_event' and source_id=v_event.source_id)) and not(id=any(v_target_ids))) then
  raise exception 'registration_management_notification_recovery_changed' using errcode='23514';
 end if;
 v_preview:=public.get_registration_management_notification_preview_v1(p_track_id,p_workflow_revision);
 if v_preview->>'recoverySourceEventId' is distinct from p_expected_recovery_source_event_id::text
  or v_preview->>'previewChecksum' is distinct from p_expected_preview_checksum then
  raise exception 'registration_management_notification_recovery_changed' using errcode='23514';
 end if;
 if (v_preview->>'recoveryAvailable')::boolean is not true or (v_preview->>'canSend')::boolean is not true
  or dashboard_private.registration_management_notification_recovery_allowed_v1(p_expected_recovery_source_event_id) is not true then
  raise exception 'registration_management_notification_recovery_not_allowed' using errcode='23514';
 end if;
 insert into dashboard_private.registration_management_notification_superseded_sources(source_event_id,recovery_request_id)
 values(p_expected_recovery_source_event_id,v_request);
 update dashboard_private.notification_event_fanout_jobs set status='succeeded',next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
  outcome_summary=outcome_summary||jsonb_build_object('outcome','superseded','recoveryRequestId',v_request)
 where id=any(v_fanout_ids) and status='pending' and attempt_count=0;
 update dashboard_private.notification_target_reconciliation_jobs set status='succeeded',next_attempt_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
  last_error_code='registration_management_notification_superseded'
 where id=any(v_target_ids) and status='pending' and attempt_count=0;
 -- Separate, derived v2 request preserves its existing ledger contract and
 -- current-source predicate; the outer receipt binds the explicit recovery.
 v_inner:=md5('registration-management-recovery-v4:'||v_request::text)::uuid;
 v_result:=public.ensure_registration_workflow_notification_v2(p_track_id,p_workflow_revision,v_inner::text,p_intent);
 if jsonb_array_length(v_result->'sourceEventIds')<>1 then raise exception 'registration_management_notification_recovery_changed' using errcode='23514'; end if;
 v_id:=(v_result->'sourceEventIds'->>0)::uuid;
 if v_id=p_expected_recovery_source_event_id then raise exception 'registration_management_notification_recovery_changed' using errcode='23514'; end if;
 insert into dashboard_private.registration_management_notification_recoveries(request_id,track_id,actor_profile_id,previous_source_event_id,previous_event_id,source_event_id,preview_checksum)
 values(v_request,p_track_id,v_actor,p_expected_recovery_source_event_id,v_event.id,v_id,p_expected_preview_checksum);
 v_plan:=public.get_registration_core_legacy_dispatch_plan_v1(v_id,v_actor);
 v_item:=v_plan->'items'->0;
 if jsonb_array_length(v_plan->'items')<>1 or v_item->>'ruleId' is distinct from v_preview->>'ruleId'
  or v_item->>'ruleRevision' is distinct from v_preview->>'ruleRevision'
  or v_item->>'templateId' is distinct from v_preview->>'templateId'
  or v_item->>'templateChecksum' is distinct from v_preview->>'templateChecksum'
  or dashboard_private.registration_management_notification_preview_context_v1(p_track_id,v_actor)->>'previewChecksum' is distinct from p_expected_preview_checksum then
  raise exception 'registration_management_notification_preview_changed' using errcode='23514';
 end if;
 insert into dashboard_private.registration_management_notification_previews(source_event_id,track_id,actor_profile_id,preview_checksum,snapshot)
 values(v_id,p_track_id,v_actor,p_expected_preview_checksum,v_preview);
 v_result:=v_result||jsonb_build_object('requestKey',v_request,'recovered',true,'previousSourceEventId',p_expected_recovery_source_event_id,'previousEventId',v_event.id);
 insert into dashboard_private.notification_request_ledger(request_id,request_kind,request_fingerprint,response_payload)
 values(v_request,'registration_management_notification_recovery_v4',v_fingerprint,v_result);
 return v_result;
end;
$$;

-- Final provider gate already calls source_current_v2 and preview validation.
-- Verify both seams remain in the ordered definition before adopting recovery.
do $final_gate_contract$
declare v_definition text;
begin
 v_definition:=pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure);
 if strpos(v_definition,'registration_management_notification_source_current_v2')=0
  or strpos(v_definition,'validate_registration_management_notification_preview_v1')=0
  or strpos(v_definition,'registration_visit_cancellation_source_stale')=0
  or strpos(v_definition,'word_retest_google_chat_retired')=0 then
  raise exception 'registration_recovery_final_gate_invalid' using errcode='55000';
 end if;
end;
$final_gate_contract$;

alter function dashboard_private.registration_management_notification_source_current_v2(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.registration_management_notification_source_current_v2(uuid,uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_source_current_before_recovery_v2(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.registration_management_source_current_before_recovery_v2(uuid,uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_preview_content_v2(uuid,uuid,uuid) owner to postgres;
revoke all on function dashboard_private.registration_management_notification_preview_content_v2(uuid,uuid,uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_preview_context_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.registration_management_notification_preview_context_v1(uuid,uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_recovery_allowed_v1(uuid) owner to postgres;
revoke all on function dashboard_private.registration_management_notification_recovery_allowed_v1(uuid) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_source_fence_v1(uuid,text,text,boolean) owner to postgres;
revoke all on function dashboard_private.registration_management_notification_source_fence_v1(uuid,text,text,boolean) from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_history_insert_fence_v1() owner to postgres;
revoke all on function dashboard_private.registration_management_notification_history_insert_fence_v1() from public,anon,authenticated,service_role;
alter function dashboard_private.registration_management_notification_queue_fence_v1() owner to postgres;
revoke all on function dashboard_private.registration_management_notification_queue_fence_v1() from public,anon,authenticated,service_role;
alter function public.get_registration_management_preview_before_recovery_v1(uuid,integer) owner to postgres;
revoke all on function public.get_registration_management_preview_before_recovery_v1(uuid,integer) from public,anon,authenticated,service_role;
alter function public.get_registration_management_notification_preview_v1(uuid,integer) owner to postgres;
revoke all on function public.get_registration_management_notification_preview_v1(uuid,integer) from public,anon,authenticated,service_role;
alter function public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid) owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_registration_management_notification_preview_v1(uuid,integer) to authenticated;
grant execute on function public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
