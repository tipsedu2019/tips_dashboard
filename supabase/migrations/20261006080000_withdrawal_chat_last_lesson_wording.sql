begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The withdrawal date/round identifies the last lesson, not the first excluded
-- lesson. Only version the matching system Chat templates; roster policy and
-- existing delivery snapshots are outside this wording change.
do $withdrawal_wording$
declare
  v_candidate record;
  v_template_id uuid;
  v_version bigint;
  v_body text;
begin
  for v_candidate in
    select rule_row.id as rule_id, rule_row.active_template_id,
      active_template.title_template, active_template.body_template,
      active_template.allowed_variables, active_template.payload_schema_version,
      active_template.content_contract_version,
      wording.old_line, wording.new_line
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates active_template
      on active_template.rule_id = rule_row.id
     and active_template.id = rule_row.active_template_id
    join (values
      ('withdrawal.submitted',
       '[일정] {제외일} · {제외회차}부터 제외 예정이에요.',
       '[일정] 퇴원기준일(마지막 수업일): {제외일} · {제외회차}'),
      ('withdrawal.completed',
       '[일정] {제외일} · {제외회차}부터 제외',
       '[일정] 퇴원기준일(마지막 수업일): {제외일} · {제외회차}'),
      ('withdrawal.submitted',
       '[일정] {withdrawal_date} · {withdrawal_round}부터 제외 예정이에요.',
       '[일정] 퇴원기준일(마지막 수업일): {withdrawal_date} · {withdrawal_round}'),
      ('withdrawal.completed',
       '[일정] {withdrawal_date} · {withdrawal_round}부터 제외',
       '[일정] 퇴원기준일(마지막 수업일): {withdrawal_date} · {withdrawal_round}')
    ) wording(event_key, old_line, new_line)
      on wording.event_key = rule_row.event_key
    where rule_row.workflow_key = 'withdrawal'
      and rule_row.channel_key = 'google_chat'
      and active_template.created_actor_kind = 'system'
      and active_template.created_by is null
      and wording.old_line = any(pg_catalog.string_to_array(active_template.body_template, chr(10)))
    order by rule_row.id
    for update of rule_row
  loop
    v_template_id := dashboard_private.notification_deterministic_uuid_v1(
      'withdrawal-chat-last-lesson-wording-v1',
      v_candidate.rule_id::text || '|' || v_candidate.active_template_id::text
    );
    select coalesce(max(template_row.version), 0) + 1 into v_version
    from dashboard_private.notification_templates template_row
    where template_row.rule_id = v_candidate.rule_id;
    v_body := pg_catalog.replace(v_candidate.body_template, v_candidate.old_line, v_candidate.new_line);

    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind,
      content_contract_version
    ) values (
      v_template_id, v_candidate.rule_id, v_version, v_candidate.title_template,
      v_body, v_candidate.allowed_variables, v_candidate.payload_schema_version,
      dashboard_private.notification_seed_template_checksum_v1(
        v_candidate.title_template, v_body, v_candidate.allowed_variables,
        v_candidate.payload_schema_version
      ), null, 'system', v_candidate.content_contract_version
    );
    perform dashboard_private.notification_template_compliance_v1(v_candidate.rule_id, v_template_id);

    update dashboard_private.notification_rules
    set active_template_id = v_template_id, revision = revision + 1,
      updated_by = null, updated_actor_kind = 'system',
      updated_at = pg_catalog.clock_timestamp()
    where id = v_candidate.rule_id
      and active_template_id = v_candidate.active_template_id;
  end loop;
end;
$withdrawal_wording$;

commit;
