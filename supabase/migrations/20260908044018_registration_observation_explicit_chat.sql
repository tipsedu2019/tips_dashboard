begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Explicit staff actions have their own receipts. No retired rule, trigger or worker is enabled.
create table dashboard_private.registration_observation_explicit_chat_attempts (
 id uuid primary key default gen_random_uuid(),
 observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
 intent text not null check (intent in ('handoff', 'feedback_request')),
 preview_checksum text not null check (preview_checksum ~ '^[a-f0-9]{64}$'),
 request_id uuid not null unique,
 actor_profile_id uuid not null references public.profiles(id) on delete restrict,
 claim_token uuid not null default gen_random_uuid(),
 status text not null default 'prepared' check (status in ('prepared','sending','sent','failed','unknown')),
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
 external_attempt_at timestamptz,
 provider_reference text,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 check ((status in ('prepared','sending')) = (finished_at is null))
);
create index registration_observation_explicit_chat_source_idx
 on dashboard_private.registration_observation_explicit_chat_attempts(observation_id, intent, created_at desc);
alter table dashboard_private.registration_observation_explicit_chat_attempts enable row level security;
alter table dashboard_private.registration_observation_explicit_chat_attempts owner to postgres;
revoke all on table dashboard_private.registration_observation_explicit_chat_attempts from public, anon, authenticated, service_role;

create function dashboard_private.assert_registration_observation_chat_actor_v1(p_actor uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
 if p_actor is null or not exists(select 1 from public.profiles p where p.id=p_actor and p.role in ('admin','staff'))
   or not dashboard_private.notification_profile_is_active_v1(p_actor) then
   raise exception 'notification_access_denied' using errcode='42501';
 end if;
end;
$$;

create function dashboard_private.registration_observation_explicit_chat_context_v1(p_observation_id uuid,p_intent text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s jsonb; v_identity record; v_connection record; v_context jsonb; v_subject text; v_channel text;
begin
 if p_intent is null or p_intent not in ('handoff','feedback_request') then
  raise exception 'registration_observation_chat_invalid' using errcode='22023';
 end if;
 -- The ordered source definition includes archived-track and normalized/legacy lesson checks.
 s := dashboard_private.get_registration_observation_notification_source_impl_v1(p_observation_id);
 if not exists(select 1 from public.ops_tasks t where t.id=(s->>'taskId')::uuid and t.type='registration' and t.status not in ('done','canceled'))
  or s->>'appointmentStatus' not in ('scheduled','completed')
  or (p_intent='handoff' and (s->>'observationStatus'<>'scheduled' or s->>'appointmentStatus'<>'scheduled'))
  or (p_intent='feedback_request' and (s->>'observationStatus' not in ('scheduled','attended_feedback_pending')
     or (s->>'endsAt')::timestamptz > now() or (s->>'hasFeedback')::boolean)) then
  raise exception 'registration_observation_chat_not_ready' using errcode='23514';
 end if;
 v_subject := s->>'subject';
 v_channel := case v_subject when '영어' then 'english' when '수학' then 'math' when '과학' then 'science' else null end;
 select identity.chat_user_id,identity.identity_revision into v_identity
 from dashboard_private.google_chat_profile_identities identity
 join auth.users account on account.id=identity.profile_id
 where identity.profile_id=(s->>'teacherProfileId')::uuid and identity.verification_status='verified'
  and identity.chat_user_id ~ '^[1-9][0-9]{0,31}$'
  and identity.account_email_snapshot=lower(btrim(account.email))
  and dashboard_private.notification_profile_is_active_v1(identity.profile_id);
 if not found then raise exception 'registration_observation_chat_teacher_unverified' using errcode='23514'; end if;
 select connection.revision,connection.connection_state into v_connection from public.google_chat_webhook_settings connection
 where connection.channel=v_channel and connection.connection_state in ('legacy_active','encrypted_active');
 if not found then raise exception 'registration_observation_chat_connection_missing' using errcode='23514'; end if;
 v_context := jsonb_build_object(
  'observationId',p_observation_id,'taskId',s->>'taskId','intent',p_intent,
  'notificationRevision',s->'notificationRevision','sourceRevision',s->'sourceRevision','bookingFactHash',s->>'bookingFactHash',
  'connectionKey','google_chat.'||v_channel,'connectionRevision',v_connection.revision::text,
  'teacherMention','users/'||v_identity.chat_user_id,'identityRevision',v_identity.identity_revision::text,
  'teacherName',s->>'teacherName','targetLabel',v_subject||'팀 · '||(s->>'teacherName')||' 선생님',
  'renderedTitle',case p_intent when 'handoff' then '청강 담당 전달' else '청강 피드백 요청' end,
  'renderedBody',concat_ws(E'\n','[학생] '||(s->>'studentName'),'[과목] '||v_subject,'[수업] '||(s->>'className'),
    '[일정] '||to_char((s->>'startsAt')::timestamptz at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI')||'–'||to_char((s->>'endsAt')::timestamptz at time zone 'Asia/Seoul','HH24:MI'),
    '[장소] '||(s->>'campus')||' '||(s->>'classroomName'),'[담당] '||(s->>'teacherName')||' 선생님',
    case p_intent when 'handoff' then '예약된 청강 수업의 담당 안내입니다. 수업 후 참석 여부와 수업 적합성 의견을 이 채팅방에 회신해 주세요.'
      else '청강 참석 여부와 수업 적합성 의견을 이 채팅방에 회신해 주세요.' end),
  'href','/admin/registration?taskId='||(s->>'taskId')||'&trackId='||(s->>'trackId')
 );
 return v_context || jsonb_build_object('previewChecksum',dashboard_private.notification_sha256_hex_v1(v_context::text));
end;
$$;

create function public.get_registration_observation_explicit_chat_preview_v1(p_observation_id uuid,p_intent text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_preview jsonb; v_status text;
begin
 perform dashboard_private.assert_registration_observation_chat_actor_v1((select auth.uid()));
 v_preview:=dashboard_private.registration_observation_explicit_chat_context_v1(p_observation_id,p_intent);
 select status into v_status from dashboard_private.registration_observation_explicit_chat_attempts
 where observation_id=p_observation_id and intent=p_intent
  and (status in ('prepared','sending','unknown') or preview_checksum=v_preview->>'previewChecksum')
 order by case when status in ('prepared','sending','unknown') then 0 else 1 end, created_at desc limit 1;
 return v_preview || jsonb_build_object('status',case when v_status in ('prepared','sending','unknown') then 'unknown' else coalesce(v_status,'ready') end,
  'canSend',v_status is null or v_status='failed');
end;
$$;

create function public.begin_registration_observation_explicit_chat_v1(p_observation_id uuid,p_intent text,p_preview_checksum text,p_request_id uuid,p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_preview jsonb; v_attempt dashboard_private.registration_observation_explicit_chat_attempts%rowtype; v_status text;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'notification_access_denied' using errcode='42501'; end if;
 perform dashboard_private.assert_registration_observation_chat_actor_v1(p_actor);
 if p_request_id is null or p_preview_checksum is null or p_preview_checksum !~ '^[a-f0-9]{64}$' then
  raise exception 'registration_observation_chat_invalid' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('observation-chat-request:'||p_request_id::text,0));
 select * into v_attempt from dashboard_private.registration_observation_explicit_chat_attempts where request_id=p_request_id;
 if found then
  if v_attempt.observation_id is distinct from p_observation_id or v_attempt.intent is distinct from p_intent
   or v_attempt.preview_checksum is distinct from p_preview_checksum or v_attempt.actor_profile_id is distinct from p_actor then
   raise exception 'idempotency_key_reused' using errcode='23514';
  end if;
  return jsonb_build_object('acquired',false,'status',case when v_attempt.status in ('prepared','sending') then 'unknown' else v_attempt.status end);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('observation-explicit-chat:'||p_observation_id::text,0));
 v_preview:=dashboard_private.registration_observation_explicit_chat_context_v1(p_observation_id,p_intent);
 if v_preview->>'previewChecksum' is distinct from p_preview_checksum then
  raise exception 'registration_observation_chat_source_changed' using errcode='23514';
 end if;
 select status into v_status from dashboard_private.registration_observation_explicit_chat_attempts
 where observation_id=p_observation_id and intent=p_intent
  and (status in ('prepared','sending','unknown') or (preview_checksum=p_preview_checksum and status='sent'))
 order by created_at desc limit 1 for update;
 if found then return jsonb_build_object('acquired',false,'status',case when v_status='sent' then 'sent' else 'unknown' end); end if;
 insert into dashboard_private.registration_observation_explicit_chat_attempts(observation_id,intent,preview_checksum,request_id,actor_profile_id,snapshot)
 values(p_observation_id,p_intent,p_preview_checksum,p_request_id,p_actor,v_preview) returning * into v_attempt;
 return jsonb_build_object('acquired',true,'attemptId',v_attempt.id,'claimToken',v_attempt.claim_token,'context',v_preview);
end;
$$;

create function public.register_registration_observation_explicit_chat_attempt_v1(p_attempt_id uuid,p_claim_token uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt dashboard_private.registration_observation_explicit_chat_attempts%rowtype; v_preview jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'notification_access_denied' using errcode='42501'; end if;
 select * into v_attempt from dashboard_private.registration_observation_explicit_chat_attempts where id=p_attempt_id for update;
 if not found or v_attempt.claim_token is distinct from p_claim_token or v_attempt.status<>'prepared' then return false; end if;
 perform dashboard_private.assert_registration_observation_chat_actor_v1(v_attempt.actor_profile_id);
 v_preview:=dashboard_private.registration_observation_explicit_chat_context_v1(v_attempt.observation_id,v_attempt.intent);
 if v_preview->>'previewChecksum' is distinct from v_attempt.preview_checksum then
  raise exception 'registration_observation_chat_source_changed' using errcode='23514';
 end if;
 update dashboard_private.registration_observation_explicit_chat_attempts set status='sending',external_attempt_at=clock_timestamp() where id=p_attempt_id;
 return true;
end;
$$;

create function public.finish_registration_observation_explicit_chat_v1(p_attempt_id uuid,p_claim_token uuid,p_status text,p_provider_reference text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt dashboard_private.registration_observation_explicit_chat_attempts%rowtype;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'notification_access_denied' using errcode='42501'; end if;
 if p_status is null or p_status not in ('sent','failed','unknown') then raise exception 'registration_observation_chat_invalid' using errcode='22023'; end if;
 select * into v_attempt from dashboard_private.registration_observation_explicit_chat_attempts where id=p_attempt_id for update;
 if not found or v_attempt.claim_token is distinct from p_claim_token then raise exception 'registration_observation_chat_claim_invalid' using errcode='23514'; end if;
 if v_attempt.status in ('sent','failed','unknown') then return; end if;
 if p_status='sent' and v_attempt.external_attempt_at is null then raise exception 'registration_observation_chat_attempt_missing' using errcode='23514'; end if;
 update dashboard_private.registration_observation_explicit_chat_attempts set status=p_status,
  provider_reference=left(p_provider_reference,256),finished_at=clock_timestamp() where id=p_attempt_id;
end;
$$;

alter function dashboard_private.assert_registration_observation_chat_actor_v1(uuid) owner to postgres;
alter function dashboard_private.registration_observation_explicit_chat_context_v1(uuid,text) owner to postgres;
alter function public.get_registration_observation_explicit_chat_preview_v1(uuid,text) owner to postgres;
alter function public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid) owner to postgres;
alter function public.register_registration_observation_explicit_chat_attempt_v1(uuid,uuid) owner to postgres;
alter function public.finish_registration_observation_explicit_chat_v1(uuid,uuid,text,text) owner to postgres;

revoke all on function dashboard_private.assert_registration_observation_chat_actor_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_observation_explicit_chat_context_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_registration_observation_explicit_chat_preview_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.register_registration_observation_explicit_chat_attempt_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.finish_registration_observation_explicit_chat_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_registration_observation_explicit_chat_preview_v1(uuid,text) to authenticated;
grant execute on function public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid) to service_role;
grant execute on function public.register_registration_observation_explicit_chat_attempt_v1(uuid,uuid) to service_role;
grant execute on function public.finish_registration_observation_explicit_chat_v1(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
