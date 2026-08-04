begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.write_approval_notification_event_v2()'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.write_approval_comment_notification_v2()'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
    or pg_catalog.to_regclass('public.approval_requests') is null
    or pg_catalog.to_regclass('public.approval_events') is null
    or pg_catalog.to_regclass('public.approval_comments') is null
  then
    raise exception 'notification_approval_content_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.approval_profile_display_name_v1(
  p_profile_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(profile.name), '')
  from public.profiles profile
  where profile.id = p_profile_id;
$$;

create or replace function dashboard_private.approval_target_period_v1(
  p_report_month text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then substring(p_report_month from 1 for 4)
        || '년 '
        || (substring(p_report_month from 6 for 2)::integer)::text
        || '월'
    else '기간 미지정'
  end;
$$;

create or replace function dashboard_private.approval_attachment_snapshot_v1(
  p_attachment_links text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with attachment_lines as (
    select pg_catalog.btrim(candidate.value) as value
    from pg_catalog.regexp_split_to_table(
      pg_catalog.coalesce(p_attachment_links, ''),
      E'\\r?\\n'
    ) candidate(value)
    where nullif(pg_catalog.btrim(candidate.value), '') is not null
  ), classified as (
    select case
      when pg_catalog.lower(line.value) ~ '\.(png|jpe?g|gif|webp|heic|svg)(\?|#|[[:space:]]|$)'
        then 'image'
      when pg_catalog.lower(line.value) ~ '\.pdf(\?|#|[[:space:]]|$)'
        then 'pdf'
      when pg_catalog.lower(line.value) ~ '\.(docx?|hwp|hwpx|txt)(\?|#|[[:space:]]|$)'
        then 'document'
      when pg_catalog.lower(line.value) ~ '\.(xlsx?|csv)(\?|#|[[:space:]]|$)'
        then 'spreadsheet'
      when pg_catalog.lower(line.value) ~ '\.pptx?(\?|#|[[:space:]]|$)'
        then 'presentation'
      when pg_catalog.lower(line.value) ~ '\.(mp4|mov|avi|mkv)(\?|#|[[:space:]]|$)'
        then 'video'
      when pg_catalog.lower(line.value) ~ '\.(mp3|wav|m4a|aac)(\?|#|[[:space:]]|$)'
        then 'audio'
      when line.value ~* 'https?://'
        then 'link'
      else 'other'
    end as kind
    from attachment_lines line
  )
  select pg_catalog.jsonb_build_object(
    'count', (select pg_catalog.count(*)::integer from attachment_lines),
    'types', coalesce(
      (select pg_catalog.jsonb_agg(distinct classified.kind order by classified.kind) from classified),
      '[]'::jsonb
    )
  );
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
  v_attachment_snapshot jsonb;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
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
  v_attachment_snapshot :=
    dashboard_private.approval_attachment_snapshot_v1(v_request.attachment_links);
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
    'author_name', dashboard_private.approval_profile_display_name_v1(v_request.requester_id),
    'current_approver_name', dashboard_private.approval_profile_display_name_v1(v_request.approver_id),
    'before_approver_name', case when tg_op = 'UPDATE'
      then dashboard_private.approval_profile_display_name_v1(old.approver_id)
      else null
    end,
    'after_approver_name', dashboard_private.approval_profile_display_name_v1(v_request.approver_id),
    'actor_name', dashboard_private.approval_profile_display_name_v1(v_actor),
    'target_period', dashboard_private.approval_target_period_v1(v_request.report_month),
    'status_changed_at', v_occurred_at,
    'attachment_count', v_attachment_snapshot -> 'count',
    'attachment_types', v_attachment_snapshot -> 'types',
    'memo', v_request.memo,
    'occurred_at', v_occurred_at
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
    v_occurred_at
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
    v_occurred_at,
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
      v_occurred_at
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
      v_occurred_at,
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
  v_attachment_snapshot jsonb;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
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
  v_attachment_snapshot :=
    dashboard_private.approval_attachment_snapshot_v1(v_request.attachment_links);
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
    'author_name', dashboard_private.approval_profile_display_name_v1(v_request.requester_id),
    'current_approver_name', dashboard_private.approval_profile_display_name_v1(v_request.approver_id),
    'actor_name', dashboard_private.approval_profile_display_name_v1(new.author_id),
    'comment_author_name', dashboard_private.approval_profile_display_name_v1(new.author_id),
    'comment_body', new.body,
    'target_period', dashboard_private.approval_target_period_v1(v_request.report_month),
    'status_changed_at', v_occurred_at,
    'attachment_count', v_attachment_snapshot -> 'count',
    'attachment_types', v_attachment_snapshot -> 'types',
    'memo', v_request.memo,
    'occurred_at', v_occurred_at
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
    v_occurred_at,
    1,
    v_payload
  );
  perform v_recorded;
  return new;
end;
$$;

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

revoke all on function dashboard_private.approval_profile_display_name_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_target_period_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.approval_attachment_snapshot_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_approval_notification_event_v2()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_approval_comment_notification_v2()
  from public, anon, authenticated, service_role;

alter function dashboard_private.approval_profile_display_name_v1(uuid)
  owner to postgres;
alter function dashboard_private.approval_target_period_v1(text)
  owner to postgres;
alter function dashboard_private.approval_attachment_snapshot_v1(text)
  owner to postgres;
alter function dashboard_private.write_approval_notification_event_v2()
  owner to postgres;
alter function dashboard_private.write_approval_comment_notification_v2()
  owner to postgres;

commit;
