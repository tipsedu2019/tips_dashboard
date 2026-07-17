begin;

set local lock_timeout = '5s';

do $$
declare
  v_runtime integer;
begin
  if pg_catalog.to_regprocedure(
    'public.common_notification_control_plane_runtime_version()'
  ) is null then
    raise exception 'approval_notification_common_runtime_missing';
  end if;
  execute 'select public.common_notification_control_plane_runtime_version()'
    into v_runtime;
  if v_runtime is distinct from 1 then
    raise exception 'approval_notification_common_runtime_mismatch';
  end if;
end;
$$;

alter table public.approval_events
  add column if not exists request_id uuid,
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.approval_comments
  add column if not exists request_id uuid,
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.approval_events
  drop constraint if exists approval_events_payload_object_check;
alter table public.approval_events
  add constraint approval_events_payload_object_check
  check (pg_catalog.jsonb_typeof(payload) = 'object');

alter table public.approval_comments
  drop constraint if exists approval_comments_payload_object_check;
alter table public.approval_comments
  add constraint approval_comments_payload_object_check
  check (pg_catalog.jsonb_typeof(payload) = 'object');

-- Raw approval sources remain available after a closed request is removed.
-- Their existing RLS policies still hide orphaned rows from ordinary clients.
alter table public.approval_events
  drop constraint if exists approval_events_approval_id_fkey;
alter table public.approval_comments
  drop constraint if exists approval_comments_approval_id_fkey;

create unique index if not exists approval_events_request_id_uidx
  on public.approval_events(request_id)
  where request_id is not null;
create unique index if not exists approval_comments_request_id_uidx
  on public.approval_comments(request_id)
  where request_id is not null;

create or replace function dashboard_private.approval_management_profile_ids_v2()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    array[]::uuid[]
  )
  from public.profiles profile
  where profile.role in ('admin', 'staff')
    and dashboard_private.notification_profile_is_active_v1(profile.id);
$$;

create or replace function dashboard_private.write_approval_notification_event_v2()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_event_key text;
  v_event_type text;
  v_field_name text;
  v_before_value text;
  v_after_value text;
  v_source_event_id uuid := pg_catalog.gen_random_uuid();
  v_actor uuid := auth.uid();
  v_request public.approval_requests%rowtype;
  v_management_profile_ids uuid[];
  v_payload jsonb;
  v_recorded jsonb;
  v_secondary_event_key text;
  v_secondary_event_type text;
  v_secondary_field_name text;
  v_secondary_before_value text;
  v_secondary_after_value text;
  v_secondary_source_event_id uuid;
  v_secondary_request_id uuid;
  v_secondary_recorded jsonb;
  v_canceled_count integer := 0;
  v_actor_role text;
  v_requester_transition boolean := false;
  v_approver_transition boolean := false;
begin
  begin
    v_request_id := nullif(
      pg_catalog.current_setting('app.approval_request_id', true),
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      v_request_id := null;
  end;
  if v_actor is null then
    raise exception 'approval_mutation_context_missing' using errcode = '42501';
  end if;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;
  if v_actor_role is null then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;
  -- closure 전에는 이전 브라우저 번들의 직접 writer 권한이 남는다. 최초 생성은
  -- 실제 구버전이 만드는 draft/submitted만 허용하고, UPDATE/DELETE도 아래 상태 전이와
  -- 기존 RLS를 통과한 경우에 한해 임시 request_id로 권위 원본을 남긴다.
  if tg_op = 'INSERT'
    and (new.status is null or new.status not in ('draft', 'submitted'))
  then
    raise exception 'approval_initial_status_invalid' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
      and new.requester_id is distinct from v_actor
    then
      raise exception 'approval_requester_invalid' using errcode = '42501';
    end if;
    if new.status = 'submitted'
      and (
        new.approver_id is null
        or not dashboard_private.notification_profile_is_active_v1(new.approver_id)
      )
    then
      raise exception 'approval_approver_invalid' using errcode = '22023';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status in ('approved', 'canceled') then
      raise exception 'approval_closed_immutable' using errcode = '22023';
    end if;
    -- 결재자는 구형 번들의 상태 전이 필드만 바꿀 수 있다. 본문·제목·대상까지
    -- 같은 UPDATE에 섞어 권위 문서를 변조하는 경로는 trigger에서 차단한다.
    if v_actor is distinct from old.requester_id
      and v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
      and (
        pg_catalog.to_jsonb(new) - array['status', 'decided_at', 'updated_at']::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old) - array['status', 'decided_at', 'updated_at']::text[]
      )
    then
      raise exception 'approval_access_denied' using errcode = '42501';
    end if;
    if new.requester_id is distinct from old.requester_id
      and v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
    then
      raise exception 'approval_requester_invalid' using errcode = '42501';
    end if;
    if new.approver_id is distinct from old.approver_id
      and v_actor is distinct from old.requester_id
      and v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
    then
      raise exception 'approval_access_denied' using errcode = '42501';
    end if;
    if new.status in ('submitted', 'reviewing', 'approved', 'returned')
      and (
        new.approver_id is null
        or not dashboard_private.notification_profile_is_active_v1(new.approver_id)
      )
    then
      raise exception 'approval_approver_invalid' using errcode = '22023';
    end if;
    if new.status is distinct from old.status then
      v_requester_transition := (
        (old.status = 'draft' and new.status = 'submitted')
        or (old.status = 'returned' and new.status = 'submitted')
        or (
          old.status in ('draft', 'submitted', 'reviewing', 'returned')
          and new.status = 'canceled'
        )
      );
      v_approver_transition := (
        (old.status = 'submitted' and new.status = 'reviewing')
        or (old.status = 'reviewing' and new.status = 'approved')
        or (
          old.status in ('submitted', 'reviewing')
          and new.status = 'returned'
        )
      );
      if not v_requester_transition and not v_approver_transition then
        raise exception 'approval_status_transition_invalid' using errcode = '22023';
      end if;
      if v_requester_transition
        and v_actor is distinct from old.requester_id
        and v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
      then
        raise exception 'approval_access_denied' using errcode = '42501';
      end if;
      if v_approver_transition
        and v_actor is distinct from old.approver_id
        and v_actor_role not in ('admin', 'staff', 'super_admin', 'manager')
      then
        raise exception 'approval_access_denied' using errcode = '42501';
      end if;
    end if;
  elsif tg_op = 'DELETE' then
    if v_actor_role <> 'admin'
      or old.status not in ('approved', 'returned', 'canceled')
    then
      raise exception 'approval_access_denied' using errcode = '42501';
    end if;
  end if;
  v_request_id := coalesce(v_request_id, pg_catalog.gen_random_uuid());

  if tg_op = 'INSERT' then
    v_request := new;
    v_event_key := case
      when new.status = 'submitted' then 'approval.submitted'
      else 'approval.created'
    end;
    v_event_type := case
      when new.status = 'submitted' then 'status_changed'
      else 'created'
    end;
    v_field_name := 'status';
    v_after_value := new.status;
  elsif tg_op = 'DELETE' then
    v_request := old;
    if nullif(pg_catalog.current_setting('app.approval_event_key', true), '') is not null
      and pg_catalog.current_setting('app.approval_event_key', true)
        is distinct from 'approval.deleted'
    then
      raise exception 'approval_delete_context_missing' using errcode = '42501';
    end if;
    v_event_key := 'approval.deleted';
    v_event_type := 'deleted';
    v_field_name := 'status';
    v_before_value := old.status;
  else
    v_request := new;
    if new.approver_id is distinct from old.approver_id then
      v_event_key := 'approval.approver_changed';
      v_event_type := 'approver_changed';
      v_field_name := 'approver_id';
      v_before_value := old.approver_id::text;
      v_after_value := new.approver_id::text;

      with canceled as (
        update dashboard_private.notification_deliveries delivery
        set status = 'canceled',
            status_reason = 'recipient_revoked',
            next_attempt_at = null,
            claimed_by = null,
            claim_token = null,
            lease_expires_at = null,
            resolved_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        from dashboard_private.notification_events event_row
        where delivery.event_id = event_row.id
          and event_row.workflow_key = 'approvals'
          and event_row.payload ->> 'approval_id' = old.id::text
          and delivery.audience_key = 'approver_profile'
          and delivery.target_profile_id = old.approver_id
          and delivery.status in ('pending', 'retry_wait')
        returning delivery.id
      ), requested as (
        update dashboard_private.notification_deliveries delivery
        set cancel_requested_at = coalesce(
              delivery.cancel_requested_at,
              pg_catalog.clock_timestamp()
            ),
            cancel_reason = 'recipient_revoked',
            updated_at = pg_catalog.clock_timestamp()
        from dashboard_private.notification_events event_row
        where delivery.event_id = event_row.id
          and event_row.workflow_key = 'approvals'
          and event_row.payload ->> 'approval_id' = old.id::text
          and delivery.audience_key = 'approver_profile'
          and delivery.target_profile_id = old.approver_id
          and delivery.status = 'claimed'
        returning delivery.id
      )
      select pg_catalog.count(*) into v_canceled_count
      from (
        select id from canceled
        union all
        select id from requested
      ) changed
      limit 1;
      if new.status is distinct from old.status then
        v_secondary_event_type := 'status_changed';
        v_secondary_field_name := 'status';
        v_secondary_before_value := old.status;
        v_secondary_after_value := new.status;
        if old.status = 'returned' and new.status = 'submitted' then
          v_secondary_event_key := 'approval.resubmitted';
        elsif old.status = 'draft' and new.status = 'submitted' then
          v_secondary_event_key := 'approval.submitted';
        elsif old.status = 'submitted' and new.status = 'reviewing' then
          v_secondary_event_key := 'approval.review_started';
        elsif old.status = 'reviewing' and new.status = 'approved' then
          v_secondary_event_key := 'approval.approved';
        elsif new.status = 'returned' and old.status in ('submitted', 'reviewing') then
          v_secondary_event_key := 'approval.returned';
        elsif new.status = 'canceled' and old.status <> 'canceled' then
          v_secondary_event_key := 'approval.canceled';
        else
          raise exception 'approval_status_transition_invalid' using errcode = '22023';
        end if;
      end if;
    elsif old.status = 'returned' and new.status = 'submitted' then
      v_event_key := 'approval.resubmitted';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;
    elsif old.status = 'draft' and new.status = 'submitted' then
      v_event_key := 'approval.submitted';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;
    elsif old.status = 'submitted' and new.status = 'reviewing' then
      v_event_key := 'approval.review_started';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;
    elsif old.status = 'reviewing' and new.status = 'approved' then
      v_event_key := 'approval.approved';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;
    elsif new.status = 'returned'
      and old.status in ('submitted', 'reviewing')
    then
      v_event_key := 'approval.returned';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;
    elsif new.status = 'canceled' and old.status <> 'canceled' then
      v_event_key := 'approval.canceled';
      v_event_type := 'status_changed';
      v_field_name := 'status';
      v_before_value := old.status;
      v_after_value := new.status;

      with canceled as (
        update dashboard_private.notification_deliveries delivery
        set status = 'canceled',
            status_reason = 'source_status_changed',
            next_attempt_at = null,
            claimed_by = null,
            claim_token = null,
            lease_expires_at = null,
            resolved_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        from dashboard_private.notification_events event_row
        where delivery.event_id = event_row.id
          and event_row.workflow_key = 'approvals'
          and event_row.payload ->> 'approval_id' = old.id::text
          and delivery.audience_key = 'approver_profile'
          and delivery.status in ('pending', 'retry_wait')
        returning delivery.id
      ), requested as (
        update dashboard_private.notification_deliveries delivery
        set cancel_requested_at = coalesce(
              delivery.cancel_requested_at,
              pg_catalog.clock_timestamp()
            ),
            cancel_reason = 'source_status_changed',
            updated_at = pg_catalog.clock_timestamp()
        from dashboard_private.notification_events event_row
        where delivery.event_id = event_row.id
          and event_row.workflow_key = 'approvals'
          and event_row.payload ->> 'approval_id' = old.id::text
          and delivery.audience_key = 'approver_profile'
          and delivery.status = 'claimed'
        returning delivery.id
      )
      select pg_catalog.count(*) into v_canceled_count
      from (
        select id from canceled
        union all
        select id from requested
      ) changed
      limit 1;
    elsif new.status is distinct from old.status then
      raise exception 'approval_status_transition_invalid' using errcode = '22023';
    else
      return new;
    end if;
  end if;

  v_management_profile_ids :=
    dashboard_private.approval_management_profile_ids_v2();
  v_payload := pg_catalog.jsonb_build_object(
    'approval_id', v_request.id,
    'request_type', v_request.request_type,
    'status', v_request.status,
    'title', v_request.title,
    'requester_profile_id', v_request.requester_id,
    'approver_profile_id', v_request.approver_id,
    'previous_approver_profile_id', case
      when tg_op = 'UPDATE' then old.approver_id
      else null
    end,
    'management_profile_ids', pg_catalog.to_jsonb(v_management_profile_ids),
    'subject', v_request.subject,
    'template_key', v_request.template_key,
    'report_month', v_request.report_month,
    'occurred_at', pg_catalog.clock_timestamp()
  );

  insert into public.approval_events(
    id,
    approval_id,
    actor_id,
    event_type,
    field_name,
    before_value,
    after_value,
    request_id,
    payload,
    created_at
  ) values (
    v_source_event_id,
    v_request.id,
    v_actor,
    v_event_type,
    v_field_name,
    v_before_value,
    v_after_value,
    v_request_id,
    v_payload,
    pg_catalog.clock_timestamp()
  );

  v_recorded := dashboard_private.record_notification_event_v1(
    'global',
    'approvals',
    v_event_key,
    'approval_event',
    v_source_event_id::text,
    null,
    v_source_event_id::text,
    v_actor,
    (v_payload ->> 'occurred_at')::timestamptz,
    1,
    v_payload
  );
  perform v_recorded;

  if v_secondary_event_key is not null then
    v_secondary_source_event_id := pg_catalog.gen_random_uuid();
    v_secondary_request_id := pg_catalog.gen_random_uuid();
    insert into public.approval_events(
      id, approval_id, actor_id, event_type, field_name,
      before_value, after_value, request_id, payload, created_at
    ) values (
      v_secondary_source_event_id,
      v_request.id,
      v_actor,
      v_secondary_event_type,
      v_secondary_field_name,
      v_secondary_before_value,
      v_secondary_after_value,
      v_secondary_request_id,
      v_payload,
      (v_payload ->> 'occurred_at')::timestamptz
    );
    v_secondary_recorded := dashboard_private.record_notification_event_v1(
      'global',
      'approvals',
      v_secondary_event_key,
      'approval_event',
      v_secondary_source_event_id::text,
      null,
      v_secondary_source_event_id::text,
      v_actor,
      (v_payload ->> 'occurred_at')::timestamptz,
      1,
      v_payload
    );
    perform v_secondary_recorded;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function dashboard_private.write_approval_comment_notification_v2()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_context_request_id uuid;
  v_request public.approval_requests%rowtype;
  v_management_profile_ids uuid[];
  v_payload jsonb;
  v_recorded jsonb;
begin
  begin
    v_context_request_id := nullif(
      pg_catalog.current_setting('app.approval_request_id', true),
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      v_context_request_id := null;
  end;
  if auth.uid() is null
    or new.author_id is distinct from auth.uid()
  then
    raise exception 'approval_mutation_context_missing' using errcode = '42501';
  end if;
  if v_context_request_id is null and new.request_id is null then
    new.request_id := pg_catalog.gen_random_uuid();
  elsif v_context_request_id is null then
    v_context_request_id := new.request_id;
  elsif new.request_id is null then
    new.request_id := v_context_request_id;
  elsif v_context_request_id <> new.request_id then
    raise exception 'approval_mutation_context_missing' using errcode = '42501';
  end if;

  select request_row.*
  into v_request
  from public.approval_requests request_row
  where request_row.id = new.approval_id
  for share of request_row;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;

  v_management_profile_ids :=
    dashboard_private.approval_management_profile_ids_v2();
  v_payload := pg_catalog.jsonb_build_object(
    'approval_id', v_request.id,
    'comment_id', new.id,
    'request_type', v_request.request_type,
    'status', v_request.status,
    'title', v_request.title,
    'requester_profile_id', v_request.requester_id,
    'approver_profile_id', v_request.approver_id,
    'management_profile_ids', pg_catalog.to_jsonb(v_management_profile_ids),
    'subject', v_request.subject,
    'template_key', v_request.template_key,
    'report_month', v_request.report_month,
    'occurred_at', pg_catalog.clock_timestamp()
  );
  new.payload := v_payload;

  v_recorded := dashboard_private.record_notification_event_v1(
    'global',
    'approvals',
    'approval.comment_added',
    'approval_comment',
    new.id::text,
    null,
    new.id::text,
    new.author_id,
    (v_payload ->> 'occurred_at')::timestamptz,
    1,
    v_payload
  );
  perform v_recorded;
  return new;
end;
$$;

drop trigger if exists write_approval_status_event on public.approval_requests;
drop trigger if exists write_approval_notification_event_v2
  on public.approval_requests;
create trigger write_approval_notification_event_v2
before insert or update or delete on public.approval_requests
for each row execute function
  dashboard_private.write_approval_notification_event_v2();

drop trigger if exists write_approval_comment_notification_v2
  on public.approval_comments;
create trigger write_approval_comment_notification_v2
before insert on public.approval_comments
for each row execute function
  dashboard_private.write_approval_comment_notification_v2();

create or replace function dashboard_private.approval_request_result_v2(
  p_request public.approval_requests,
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(p_request),
    'source_event_id', p_source_id,
    'notification_event_id', event_row.id,
    'fanout_job_id', job.id
  )
  from (select 1) singleton
  left join dashboard_private.notification_events event_row
    on event_row.workflow_key = 'approvals'
   and event_row.source_type = p_source_type
   and event_row.source_id = p_source_id::text
  left join dashboard_private.notification_event_fanout_jobs job
    on job.event_id = event_row.id;
$$;

create or replace function dashboard_private.approval_lock_replay_v2(
  p_request_id uuid,
  p_request_kind text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_fingerprint text;
  v_response jsonb;
begin
  if p_request_id is null
    or nullif(pg_catalog.btrim(p_request_kind), '') is null
    or nullif(pg_catalog.btrim(p_request_fingerprint), '') is null
  then
    raise exception 'approval_request_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.request_kind, ledger.request_fingerprint, ledger.response_payload
  into v_kind, v_fingerprint, v_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_kind <> p_request_kind or v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_response;
  end if;
  return null;
end;
$$;

create or replace function dashboard_private.approval_store_replay_v2(
  p_request_id uuid,
  p_request_kind text,
  p_request_fingerprint text,
  p_response jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    p_request_kind,
    p_request_fingerprint,
    p_response
  );
$$;

create or replace function dashboard_private.approval_set_context_v2(
  p_request_id uuid,
  p_event_key text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'app.approval_request_id',
    p_request_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.approval_event_key',
    coalesce(p_event_key, ''),
    true
  );
end;
$$;

create or replace function dashboard_private.approval_clear_context_v2()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('app.approval_request_id', '', true);
  perform pg_catalog.set_config('app.approval_event_key', '', true);
end;
$$;

create or replace function dashboard_private.approval_validate_input_v2(
  p_input jsonb
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_input is null
    or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_input - array[
      'request_type', 'title', 'approver_id', 'subject', 'template_key',
      'report_month', 'class_summary', 'student_issues', 'next_month_plan',
      'body', 'checklist_items', 'attachment_links', 'memo'
    ]::text[] <> '{}'::jsonb
    or nullif(pg_catalog.btrim(p_input ->> 'title'), '') is null
    or coalesce(p_input ->> 'request_type', 'monthly_report')
      not in ('monthly_report', 'general')
    or coalesce(p_input ->> 'subject', 'general')
      not in ('english', 'math', 'general')
    or (
      p_input ? 'checklist_items'
      and p_input -> 'checklist_items' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_input -> 'checklist_items') <> 'array'
    )
    or (
      nullif(pg_catalog.btrim(p_input ->> 'approver_id'), '') is not null
      and (p_input ->> 'approver_id')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  then
    raise exception 'approval_input_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function dashboard_private.create_approval_request_v2_impl(
  p_input jsonb,
  p_status text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_kind constant text := 'approval_create';
  v_fingerprint text;
  v_replay jsonb;
  v_approver_id uuid;
  v_request public.approval_requests%rowtype;
  v_source_id uuid;
  v_response jsonb;
begin
  if v_actor is null or p_request_id is null
    or p_status is null
    or p_status <> 'draft'
  then
    raise exception 'approval_request_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.approval_validate_input_v2(p_input);
  v_approver_id := nullif(pg_catalog.btrim(p_input ->> 'approver_id'), '')::uuid;
  if v_approver_id is not null
    and not dashboard_private.notification_profile_is_active_v1(v_approver_id)
  then
    raise exception 'approval_approver_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'input', p_input,
    'status', p_status
  )::text);
  v_replay := dashboard_private.approval_lock_replay_v2(
    p_request_id, v_kind, v_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:approvals', 0
  ));
  perform dashboard_private.approval_set_context_v2(p_request_id);

  insert into public.approval_requests(
    request_type,
    status,
    title,
    requester_id,
    approver_id,
    subject,
    template_key,
    report_month,
    class_summary,
    student_issues,
    next_month_plan,
    body,
    checklist_items,
    attachment_links,
    memo,
    submitted_at,
    decided_at
  ) values (
    coalesce(p_input ->> 'request_type', 'monthly_report'),
    p_status,
    pg_catalog.btrim(p_input ->> 'title'),
    v_actor,
    v_approver_id,
    coalesce(p_input ->> 'subject', 'general'),
    coalesce(nullif(pg_catalog.btrim(p_input ->> 'template_key'), ''), 'free'),
    nullif(pg_catalog.btrim(p_input ->> 'report_month'), ''),
    nullif(pg_catalog.btrim(p_input ->> 'class_summary'), ''),
    nullif(pg_catalog.btrim(p_input ->> 'student_issues'), ''),
    nullif(pg_catalog.btrim(p_input ->> 'next_month_plan'), ''),
    nullif(pg_catalog.btrim(p_input ->> 'body'), ''),
    coalesce(p_input -> 'checklist_items', '[]'::jsonb),
    nullif(pg_catalog.btrim(p_input ->> 'attachment_links'), ''),
    nullif(pg_catalog.btrim(p_input ->> 'memo'), ''),
    null,
    null
  ) returning * into v_request;

  select source.id into strict v_source_id
  from public.approval_events source
  where source.request_id = p_request_id;
  v_response := dashboard_private.approval_request_result_v2(
    v_request, 'approval_event', v_source_id
  );
  perform dashboard_private.approval_store_replay_v2(
    p_request_id, v_kind, v_fingerprint, v_response
  );
  perform dashboard_private.approval_clear_context_v2();
  return v_response;
end;
$$;

create or replace function dashboard_private.update_approval_request_v2_impl(
  p_approval_id uuid,
  p_input jsonb,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_kind constant text := 'approval_update';
  v_fingerprint text;
  v_replay jsonb;
  v_request public.approval_requests%rowtype;
  v_approver_id uuid;
  v_source_id uuid;
  v_response jsonb;
begin
  if v_actor is null or p_approval_id is null or p_request_id is null
    or p_expected_updated_at is null
    or p_status is null
  then
    raise exception 'approval_request_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.approval_validate_input_v2(p_input);
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'approval_id', p_approval_id,
    'input', p_input,
    'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay := dashboard_private.approval_lock_replay_v2(
    p_request_id, v_kind, v_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:approvals', 0
  ));
  select request_row.* into v_request
  from public.approval_requests request_row
  where request_row.id = p_approval_id
  for update of request_row;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_actor is distinct from v_request.requester_id
    and v_role is distinct from 'admin'
    and v_role is distinct from 'staff'
  then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;
  if v_request.status in ('approved', 'canceled') then
    raise exception 'approval_closed_immutable' using errcode = '22023';
  end if;
  if v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'approval_stale_write' using errcode = '40001';
  end if;
  if p_status is distinct from v_request.status then
    raise exception 'approval_status_transition_required' using errcode = '22023';
  end if;

  v_approver_id := nullif(pg_catalog.btrim(p_input ->> 'approver_id'), '')::uuid;
  if v_request.status in ('submitted', 'reviewing')
    and v_approver_id is null
  then
    raise exception 'approval_approver_required' using errcode = '22023';
  end if;
  if v_approver_id is not null
    and not dashboard_private.notification_profile_is_active_v1(v_approver_id)
  then
    raise exception 'approval_approver_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.approval_set_context_v2(p_request_id);
  update public.approval_requests request_row
  set request_type = coalesce(p_input ->> 'request_type', 'monthly_report'),
      title = pg_catalog.btrim(p_input ->> 'title'),
      approver_id = v_approver_id,
      subject = coalesce(p_input ->> 'subject', 'general'),
      template_key = coalesce(
        nullif(pg_catalog.btrim(p_input ->> 'template_key'), ''), 'free'
      ),
      report_month = nullif(pg_catalog.btrim(p_input ->> 'report_month'), ''),
      class_summary = nullif(pg_catalog.btrim(p_input ->> 'class_summary'), ''),
      student_issues = nullif(pg_catalog.btrim(p_input ->> 'student_issues'), ''),
      next_month_plan = nullif(pg_catalog.btrim(p_input ->> 'next_month_plan'), ''),
      body = nullif(pg_catalog.btrim(p_input ->> 'body'), ''),
      checklist_items = coalesce(p_input -> 'checklist_items', '[]'::jsonb),
      attachment_links = nullif(
        pg_catalog.btrim(p_input ->> 'attachment_links'), ''
      ),
      memo = nullif(pg_catalog.btrim(p_input ->> 'memo'), '')
  where request_row.id = p_approval_id
  returning request_row.* into v_request;

  select source.id into v_source_id
  from public.approval_events source
  where source.request_id = p_request_id;
  v_response := dashboard_private.approval_request_result_v2(
    v_request, 'approval_event', v_source_id
  );
  perform dashboard_private.approval_store_replay_v2(
    p_request_id, v_kind, v_fingerprint, v_response
  );
  perform dashboard_private.approval_clear_context_v2();
  return v_response;
end;
$$;

create or replace function dashboard_private.transition_approval_request_v2_impl(
  p_approval_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_kind constant text := 'approval_transition';
  v_fingerprint text;
  v_replay jsonb;
  v_request public.approval_requests%rowtype;
  v_source_id uuid;
  v_response jsonb;
  v_requester_transition boolean;
  v_approver_transition boolean;
begin
  if v_actor is null or p_approval_id is null or p_request_id is null
    or p_expected_updated_at is null
    or p_status is null
    or p_status not in ('submitted', 'reviewing', 'approved', 'returned', 'canceled')
  then
    raise exception 'approval_request_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'approval_id', p_approval_id,
    'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay := dashboard_private.approval_lock_replay_v2(
    p_request_id, v_kind, v_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:approvals', 0
  ));
  select request_row.* into v_request
  from public.approval_requests request_row
  where request_row.id = p_approval_id
  for update of request_row;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'approval_stale_write' using errcode = '40001';
  end if;

  v_requester_transition := (
    (v_request.status = 'draft' and p_status = 'submitted')
    or (v_request.status = 'returned' and p_status = 'submitted')
    or (
      v_request.status in ('draft', 'submitted', 'reviewing', 'returned')
      and p_status = 'canceled'
    )
  );
  v_approver_transition := (
    (v_request.status = 'submitted' and p_status = 'reviewing')
    or (v_request.status = 'reviewing' and p_status = 'approved')
    or (
      v_request.status in ('submitted', 'reviewing')
      and p_status = 'returned'
    )
  );
  if not v_requester_transition and not v_approver_transition then
    raise exception 'approval_status_transition_invalid' using errcode = '22023';
  end if;
  if v_requester_transition
    and v_actor is distinct from v_request.requester_id
    and v_role is distinct from 'admin'
    and v_role is distinct from 'staff'
  then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;
  if v_approver_transition
    and v_actor is distinct from v_request.approver_id
    and v_role is distinct from 'admin'
    and v_role is distinct from 'staff'
  then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;
  if p_status in ('submitted', 'reviewing', 'approved', 'returned')
    and (
      v_request.approver_id is null
      or not dashboard_private.notification_profile_is_active_v1(
        v_request.approver_id
      )
    )
  then
    raise exception 'approval_approver_invalid' using errcode = '22023';
  end if;

  perform dashboard_private.approval_set_context_v2(p_request_id);
  update public.approval_requests request_row
  set status = p_status,
      submitted_at = case
        when p_status = 'submitted' then pg_catalog.clock_timestamp()
        else request_row.submitted_at
      end,
      decided_at = case
        when p_status in ('approved', 'returned', 'canceled')
          then pg_catalog.clock_timestamp()
        when p_status in ('submitted', 'reviewing') then null
        else request_row.decided_at
      end
  where request_row.id = p_approval_id
  returning request_row.* into v_request;

  select source.id into strict v_source_id
  from public.approval_events source
  where source.request_id = p_request_id;
  v_response := dashboard_private.approval_request_result_v2(
    v_request, 'approval_event', v_source_id
  );
  perform dashboard_private.approval_store_replay_v2(
    p_request_id, v_kind, v_fingerprint, v_response
  );
  perform dashboard_private.approval_clear_context_v2();
  return v_response;
end;
$$;

create or replace function dashboard_private.add_approval_comment_v2_impl(
  p_approval_id uuid,
  p_body text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_kind constant text := 'approval_comment_add';
  v_fingerprint text;
  v_replay jsonb;
  v_request public.approval_requests%rowtype;
  v_comment public.approval_comments%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_job_id uuid;
  v_response jsonb;
begin
  if v_actor is null or p_approval_id is null or p_request_id is null
    or nullif(pg_catalog.btrim(p_body), '') is null
    or pg_catalog.char_length(pg_catalog.btrim(p_body)) > 4000
  then
    raise exception 'approval_comment_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'approval_id', p_approval_id,
    'body', pg_catalog.btrim(p_body)
  )::text);
  v_replay := dashboard_private.approval_lock_replay_v2(
    p_request_id, v_kind, v_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:approvals', 0
  ));
  select request_row.* into v_request
  from public.approval_requests request_row
  where request_row.id = p_approval_id
  for share of request_row;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_actor is distinct from v_request.requester_id
    and v_actor is distinct from v_request.approver_id
    and v_role is distinct from 'admin'
    and v_role is distinct from 'staff'
  then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.approval_set_context_v2(p_request_id);
  insert into public.approval_comments(
    approval_id,
    author_id,
    body,
    request_id
  ) values (
    p_approval_id,
    v_actor,
    pg_catalog.btrim(p_body),
    p_request_id
  ) returning * into v_comment;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'approvals'
    and event_row.source_type = 'approval_comment'
    and event_row.source_id = v_comment.id::text;
  select job.id into strict v_job_id
  from dashboard_private.notification_event_fanout_jobs job
  where job.event_id = v_event.id;
  v_response := pg_catalog.jsonb_build_object(
    'comment', pg_catalog.to_jsonb(v_comment),
    'source_event_id', v_comment.id,
    'notification_event_id', v_event.id,
    'fanout_job_id', v_job_id
  );
  perform dashboard_private.approval_store_replay_v2(
    p_request_id, v_kind, v_fingerprint, v_response
  );
  perform dashboard_private.approval_clear_context_v2();
  return v_response;
end;
$$;

create or replace function dashboard_private.delete_approval_request_v2_impl(
  p_approval_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_kind constant text := 'approval_delete';
  v_fingerprint text;
  v_replay jsonb;
  v_request public.approval_requests%rowtype;
  v_source_id uuid;
  v_notification_event_id uuid;
  v_fanout_job_id uuid;
  v_response jsonb;
begin
  if v_actor is null or p_approval_id is null or p_request_id is null then
    raise exception 'approval_request_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'approval_id', p_approval_id
  )::text);
  v_replay := dashboard_private.approval_lock_replay_v2(
    p_request_id, v_kind, v_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:approvals', 0
  ));
  select request_row.* into v_request
  from public.approval_requests request_row
  where request_row.id = p_approval_id
  for update of request_row;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_role is distinct from 'admin' then
    raise exception 'approval_access_denied' using errcode = '42501';
  end if;
  if v_request.status not in ('approved', 'returned', 'canceled') then
    raise exception 'approval_delete_requires_closed' using errcode = '22023';
  end if;

  perform dashboard_private.approval_set_context_v2(
    p_request_id, 'approval.deleted'
  );
  delete from public.approval_requests request_row
  where request_row.id = p_approval_id;

  select source.id into strict v_source_id
  from public.approval_events source
  where source.request_id = p_request_id;
  select event_row.id, job.id
  into strict v_notification_event_id, v_fanout_job_id
  from dashboard_private.notification_events event_row
  left join dashboard_private.notification_event_fanout_jobs job
    on job.event_id = event_row.id
  where event_row.workflow_key = 'approvals'
    and event_row.source_type = 'approval_event'
    and event_row.source_id = v_source_id::text;
  v_response := pg_catalog.jsonb_build_object(
    'deleted', true,
    'approval_id', v_request.id,
    'prior_status', v_request.status,
    'source_event_id', v_source_id,
    'notification_event_id', v_notification_event_id,
    'fanout_job_id', v_fanout_job_id
  );
  perform dashboard_private.approval_store_replay_v2(
    p_request_id, v_kind, v_fingerprint, v_response
  );
  perform dashboard_private.approval_clear_context_v2();
  return v_response;
end;
$$;

create or replace function public.create_approval_request_v2(
  p_input jsonb,
  p_status text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.create_approval_request_v2_impl(
    p_input, p_status, p_request_id
  );
$$;

create or replace function public.update_approval_request_v2(
  p_approval_id uuid,
  p_input jsonb,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.update_approval_request_v2_impl(
    p_approval_id,
    p_input,
    p_status,
    p_expected_updated_at,
    p_request_id
  );
$$;

create or replace function public.transition_approval_request_v2(
  p_approval_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.transition_approval_request_v2_impl(
    p_approval_id,
    p_status,
    p_expected_updated_at,
    p_request_id
  );
$$;

create or replace function public.add_approval_comment_v2(
  p_approval_id uuid,
  p_body text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.add_approval_comment_v2_impl(
    p_approval_id, p_body, p_request_id
  );
$$;

create or replace function public.delete_approval_request_v2(
  p_approval_id uuid,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.delete_approval_request_v2_impl(
    p_approval_id, p_request_id
  );
$$;

-- 구형 번들의 직접 이벤트 쓰기는 업무 상태와 분리돼 위조될 수 있으므로 즉시 닫는다.
-- 요청·댓글 호환 writer만 trigger의 서버 검증 아래 유지한다.
revoke insert, update, delete on public.approval_events from authenticated;
grant select on public.approval_events to authenticated;

drop policy if exists approval_requests_delete_closed_admin_v2
  on public.approval_requests;
create policy approval_requests_delete_closed_admin_v2
on public.approval_requests
for delete
using (
  status in ('approved', 'returned', 'canceled')
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'admin'
  )
);

-- Task 20의 별도 closure marker 전에는 이전 브라우저 번들의 기존 writer 권한을
-- 유지한다. 이 마이그레이션의 trigger가 해당 경로도 권위 이벤트로 정규화한다.
grant select, insert, update, delete on public.approval_requests to authenticated;
grant select, insert on public.approval_comments to authenticated;

revoke all on function dashboard_private.approval_management_profile_ids_v2()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_approval_notification_event_v2()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_approval_comment_notification_v2()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_request_result_v2(
  public.approval_requests, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_lock_replay_v2(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_store_replay_v2(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_set_context_v2(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_clear_context_v2()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_validate_input_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_approval_request_v2_impl(
  jsonb, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.update_approval_request_v2_impl(
  uuid, jsonb, text, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.transition_approval_request_v2_impl(
  uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.add_approval_comment_v2_impl(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.delete_approval_request_v2_impl(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_approval_request_v2(jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.update_approval_request_v2(
  uuid, jsonb, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.transition_approval_request_v2(
  uuid, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.add_approval_comment_v2(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_approval_request_v2(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_approval_request_v2(jsonb, text, uuid)
  to authenticated;
grant execute on function public.update_approval_request_v2(
  uuid, jsonb, text, timestamptz, uuid
) to authenticated;
grant execute on function public.transition_approval_request_v2(
  uuid, text, timestamptz, uuid
) to authenticated;
grant execute on function public.add_approval_comment_v2(uuid, text, uuid)
  to authenticated;
grant execute on function public.delete_approval_request_v2(uuid, uuid)
  to authenticated;

update dashboard_private.notification_rules
set enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where workflow_key = 'approvals'
  and enabled;

do $$
begin
  if exists (
    select 1
    from dashboard_private.notification_rules rule
    where rule.workflow_key = 'approvals'
      and rule.enabled
  ) then
    raise exception 'approval_notification_rules_must_remain_disabled';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid in (
      'public.approval_events'::pg_catalog.regclass,
      'public.approval_comments'::pg_catalog.regclass
    )
      and constraint_row.contype = 'f'
      and constraint_row.confrelid =
        'public.approval_requests'::pg_catalog.regclass
  ) then
    raise exception 'approval_hard_delete_audit_retained';
  end if;
end;
$$;

commit;
