begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.notification_legacy_content_identity_v1(
  p_workflow_key text,
  p_event_key text,
  p_audience_key text,
  p_channel_key text,
  p_rule_variant_key text
)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (
    p_workflow_key || '|' || p_event_key || '|' || p_audience_key || '|'
      || p_channel_key || '|' || p_rule_variant_key
  ) in (
    select identity.value
    from pg_catalog.jsonb_array_elements_text(
      -- notification_legacy_content_identity_fixture_begin
      $legacy_identities$
[
  "makeup_requests|makeup.approval_canceled|approver_profile|in_app|immediate",
  "makeup_requests|makeup.approval_canceled|executive_team|google_chat|immediate",
  "makeup_requests|makeup.approval_canceled|management_team|google_chat|immediate",
  "makeup_requests|makeup.approval_canceled|management_team|in_app|immediate",
  "makeup_requests|makeup.approval_canceled|requester_profile|in_app|immediate",
  "makeup_requests|makeup.approval_canceled|subject_team|google_chat|immediate",
  "makeup_requests|makeup.approved|approver_profile|in_app|immediate",
  "makeup_requests|makeup.approved|executive_team|google_chat|immediate",
  "makeup_requests|makeup.approved|management_team|google_chat|immediate",
  "makeup_requests|makeup.approved|management_team|in_app|immediate",
  "makeup_requests|makeup.approved|requester_profile|in_app|immediate",
  "makeup_requests|makeup.approved|subject_team|google_chat|immediate",
  "makeup_requests|makeup.refund_completed|approver_profile|in_app|immediate",
  "makeup_requests|makeup.refund_completed|executive_team|google_chat|immediate",
  "makeup_requests|makeup.refund_completed|management_team|google_chat|immediate",
  "makeup_requests|makeup.refund_completed|management_team|in_app|immediate",
  "makeup_requests|makeup.refund_completed|requester_profile|in_app|immediate",
  "makeup_requests|makeup.refund_completed|subject_team|google_chat|immediate",
  "makeup_requests|makeup.refund_requested|approver_profile|in_app|immediate",
  "makeup_requests|makeup.refund_requested|executive_team|google_chat|immediate",
  "makeup_requests|makeup.refund_requested|management_team|google_chat|immediate",
  "makeup_requests|makeup.refund_requested|management_team|in_app|immediate",
  "makeup_requests|makeup.refund_requested|subject_team|google_chat|immediate",
  "makeup_requests|makeup.rejected|requester_profile|in_app|immediate",
  "makeup_requests|makeup.rejected|subject_team|google_chat|immediate",
  "makeup_requests|makeup.revision_requested|requester_profile|in_app|immediate",
  "makeup_requests|makeup.revision_requested|subject_team|google_chat|immediate",
  "makeup_requests|makeup.submitted|approver_profile|in_app|immediate",
  "makeup_requests|makeup.submitted|executive_team|google_chat|immediate",
  "makeup_requests|makeup.submitted|management_team|google_chat|immediate",
  "makeup_requests|makeup.submitted|management_team|in_app|immediate",
  "makeup_requests|makeup.submitted|subject_team|google_chat|immediate",
  "registration|registration.appointment_reminder_due|management_team|google_chat|offset_before",
  "registration|registration.appointment_reminder_due|management_team|google_chat|previous_day_at",
  "registration|registration.appointment_reminder_due|management_team|google_chat|same_day_at",
  "registration|registration.appointment_reminder_due|management_team|in_app|offset_before",
  "registration|registration.appointment_reminder_due|management_team|in_app|previous_day_at",
  "registration|registration.appointment_reminder_due|management_team|in_app|same_day_at",
  "registration|registration.appointment_reminder_due|track_director|in_app|offset_before",
  "registration|registration.appointment_reminder_due|track_director|in_app|previous_day_at",
  "registration|registration.appointment_reminder_due|track_director|in_app|same_day_at",
  "registration|registration.case_closed|management_team|google_chat|immediate",
  "registration|registration.case_created|management_team|google_chat|immediate",
  "registration|registration.phone_consultation_ready|track_director|in_app|immediate",
  "registration|registration.registration_completed|management_team|google_chat|immediate",
  "registration|registration.visit_canceled|management_team|google_chat|immediate",
  "registration|registration.visit_canceled|track_director|in_app|immediate",
  "registration|registration.visit_replaced|management_team|google_chat|immediate",
  "registration|registration.visit_replaced|track_director|in_app|immediate",
  "registration|registration.visit_rescheduled|management_team|google_chat|immediate",
  "registration|registration.visit_rescheduled|track_director|in_app|immediate",
  "registration|registration.visit_scheduled|management_team|google_chat|immediate",
  "registration|registration.visit_scheduled|track_director|in_app|immediate",
  "registration|registration.visit_subject_deselected|management_team|google_chat|immediate",
  "registration|registration.visit_subject_deselected|track_director|in_app|immediate",
  "transfer|transfer.completed|management_team|google_chat|immediate",
  "transfer|transfer.submitted|management_team|google_chat|immediate",
  "withdrawal|withdrawal.completed|management_team|google_chat|immediate",
  "withdrawal|withdrawal.submitted|management_team|google_chat|immediate"
]
      $legacy_identities$::jsonb
      -- notification_legacy_content_identity_fixture_end
    ) identity(value)
  );
$$;

create or replace function dashboard_private.notification_legacy_content_projection_v1(
  p_rule_id uuid,
  p_title_template text,
  p_body_template text,
  p_render_context jsonb,
  p_href text
)
returns jsonb
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  v_contract dashboard_private.notification_rule_content_contracts%rowtype;
  v_title text := p_title_template;
  v_body text := p_body_template;
  v_combined text := p_title_template || chr(10) || p_body_template;
  v_match text[];
  v_variable jsonb;
  v_presence jsonb;
  v_key text;
  v_token text;
  v_value text;
  v_required boolean;
  v_null_behavior text;
  v_empty_array_behavior text;
  v_optional_tokens jsonb;
  v_expected_root text;
  v_path text;
begin
  if pg_catalog.jsonb_typeof(p_render_context) <> 'object'
    or p_href !~ '^/admin/'
    or p_href ~ '(^//|#|https?://)'
    or p_href ~* '%(2e|2f|5c)'
    or pg_catalog.strpos(p_href, pg_catalog.chr(92)) > 0
    or p_href ~ '[[:cntrl:]]'
  then
    raise exception 'render_validation_failed' using errcode = '22023';
  end if;

  select contract_row.*
  into v_contract
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.rule_id = p_rule_id;
  if not found
    or not dashboard_private.notification_legacy_content_identity_v1(
      v_contract.workflow_key,
      v_contract.event_key,
      v_contract.audience_key,
      v_contract.channel_key,
      v_contract.rule_variant_key
    )
  then
    raise exception 'notification_legacy_content_identity_not_owned'
      using errcode = '42501';
  end if;

  v_expected_root := case v_contract.workflow_key
    when 'registration' then '/admin/registration'
    when 'transfer' then '/admin/transfer'
    when 'withdrawal' then '/admin/withdrawal'
    when 'makeup_requests' then '/admin/makeup-requests'
    else null
  end;
  v_path := pg_catalog.split_part(p_href, '?', 1);
  if v_expected_root is null
    or not (
      v_path = v_expected_root
      or v_path like v_expected_root || '/%'
    )
    or v_path ~ '(^|/)\.{1,2}(/|$)'
  then
    raise exception 'render_validation_failed' using errcode = '22023';
  end if;

  v_optional_tokens := coalesce(
    v_contract.contract_json -> 'optionalLineTokens',
    '[]'::jsonb
  );
  if pg_catalog.jsonb_typeof(v_contract.contract_json -> 'availableVariables') <> 'array'
    or pg_catalog.jsonb_typeof(v_contract.contract_json -> 'fieldPresence') <> 'object'
    or pg_catalog.jsonb_typeof(v_optional_tokens) <> 'array'
  then
    raise exception 'render_validation_failed' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_render_context) context_key(key)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_contract.contract_json -> 'availableVariables'
      ) variable(item)
      where variable.item ->> 'key' = context_key.key
    )
  ) then
    raise exception 'render_validation_failed' using errcode = '22023';
  end if;

  for v_match in
    select distinct match_row.captures
    from pg_catalog.regexp_matches(v_combined, '\{([^{}]+)\}', 'g')
      as match_row(captures)
  loop
    v_token := v_match[1];
    select variable.item
    into v_variable
    from pg_catalog.jsonb_array_elements(
      v_contract.contract_json -> 'availableVariables'
    ) variable(item)
    where variable.item ->> 'token' = v_token;
    if not found then
      raise exception 'notification_legacy_content_unknown_token:%', v_token
        using errcode = '22023';
    end if;

    v_key := v_variable ->> 'key';
    v_presence := v_contract.contract_json -> 'fieldPresence' -> v_key;
    if v_presence is null
      or pg_catalog.jsonb_typeof(v_presence) <> 'object'
    then
      raise exception 'render_validation_failed' using errcode = '22023';
    end if;
    v_required := coalesce((v_presence ->> 'required')::boolean, false);
    v_null_behavior := coalesce(v_presence ->> 'nullBehavior', 'omit');
    v_empty_array_behavior := coalesce(
      v_presence ->> 'emptyArrayBehavior',
      'omit'
    );

    if not (p_render_context ? v_key) then
      if v_required then
        raise exception 'notification_legacy_content_required_field_missing:%', v_key
          using errcode = '22023';
      elsif not (v_optional_tokens ? v_token) then
        raise exception 'render_validation_failed' using errcode = '22023';
      end if;
      v_value := '';
    elsif pg_catalog.jsonb_typeof(p_render_context -> v_key) = 'null' then
      if v_null_behavior = 'display'
        and nullif(v_presence ->> 'nullDisplay', '') is not null
      then
        v_value := v_presence ->> 'nullDisplay';
      elsif v_null_behavior = 'omit' and not v_required then
        v_value := '';
      else
        raise exception 'notification_legacy_content_null_field_invalid:%', v_key
          using errcode = '22023';
      end if;
    elsif pg_catalog.jsonb_typeof(p_render_context -> v_key) = 'array' then
      if pg_catalog.jsonb_array_length(p_render_context -> v_key) = 0 then
        if v_empty_array_behavior = 'allow' then
          v_value := '';
        elsif v_empty_array_behavior = 'omit' and not v_required then
          v_value := '';
        else
          raise exception 'notification_legacy_content_empty_array_invalid:%', v_key
            using errcode = '22023';
        end if;
      elsif exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_render_context -> v_key) item(value)
        where pg_catalog.jsonb_typeof(item.value) <> 'string'
      ) then
        raise exception 'render_validation_failed' using errcode = '22023';
      else
        select pg_catalog.string_agg(item.value #>> '{}', ' · ' order by item.ordinality)
        into v_value
        from pg_catalog.jsonb_array_elements(p_render_context -> v_key)
          with ordinality item(value, ordinality);
      end if;
    elsif pg_catalog.jsonb_typeof(p_render_context -> v_key) = 'string' then
      v_value := p_render_context ->> v_key;
    else
      raise exception 'render_validation_failed' using errcode = '22023';
    end if;

    if v_value ~ '<[^>]*>'
      or v_value ~* '(https?://|//|www\.)'
      or v_value ~* '(^|[^a-z0-9_])@(all|everyone|here|channel)($|[^a-z0-9_])'
      or v_value ~ '[[:cntrl:]]'
    then
      raise exception 'notification_legacy_content_unsafe_value:%', v_key
        using errcode = '22023';
    end if;
    v_title := pg_catalog.replace(v_title, '{' || v_token || '}', v_value);
    v_body := pg_catalog.replace(v_body, '{' || v_token || '}', v_value);
  end loop;

  v_title := pg_catalog.btrim(v_title);
  v_body := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(v_body, E'[ \t]+\n', E'\n', 'g'),
      E'\n[ \t]*\n+',
      E'\n\n',
      'g'
    )
  );
  if v_title = ''
    or v_body = ''
    or v_title ~ '[{}]'
    or v_body ~ '[{}]'
    or pg_catalog.char_length(v_title) > 200
    or pg_catalog.char_length(v_body) > 4000
  then
    raise exception 'render_validation_failed' using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'renderedTitle', v_title,
    'renderedBody', v_body,
    'href', p_href
  );
end;
$$;

revoke all on function dashboard_private.notification_legacy_content_identity_v1(
  text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_legacy_content_projection_v1(
  uuid, text, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.notification_legacy_content_projection_v1(
  uuid, text, text, jsonb, text
) to service_role;

alter function dashboard_private.notification_legacy_content_identity_v1(
  text, text, text, text, text
) owner to postgres;
alter function dashboard_private.notification_legacy_content_projection_v1(
  uuid, text, text, jsonb, text
) owner to postgres;

commit;
