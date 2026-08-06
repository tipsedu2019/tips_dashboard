begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.notification_template_with_korean_tokens_v1(
  p_template text,
  p_allowed_variables jsonb
)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_result text := p_template;
  v_variable record;
begin
  if pg_catalog.jsonb_typeof(p_allowed_variables) <> 'array' then
    raise exception 'notification_template_variables_invalid'
      using errcode = '22023';
  end if;

  for v_variable in
    select variable.item
    from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
  loop
    if nullif(v_variable.item ->> 'key', '') is null
      or nullif(v_variable.item ->> 'token', '') is null
      or (v_variable.item ->> 'token') ~ '[{}]'
    then
      raise exception 'notification_template_variables_invalid'
        using errcode = '22023';
    end if;
    v_result := pg_catalog.replace(
      v_result,
      '{' || (v_variable.item ->> 'key') || '}',
      '{' || (v_variable.item ->> 'token') || '}'
    );
  end loop;

  return v_result;
end;
$$;

create or replace function dashboard_private.notification_template_contract_violations_v1(
  p_rule_id uuid,
  p_title_template text,
  p_body_template text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contract jsonb;
  v_combined text := coalesce(p_title_template, '') || chr(10)
    || coalesce(p_body_template, '');
  v_without_valid_tokens text;
  v_variable record;
  v_token_match text[];
  v_violations jsonb := '[]'::jsonb;
begin
  select contract_row.contract_json
  into v_contract
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.rule_id = p_rule_id;
  if not found then
    raise exception 'notification_content_contract_not_found'
      using errcode = 'P0002';
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_title_template, '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(p_body_template, '')), '') is null
  then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_content_empty',
        'severity', 'error',
        'message', '제목과 본문을 모두 입력해 주세요.'
      )
    );
  end if;
  if pg_catalog.char_length(coalesce(p_title_template, '')) > 200 then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_title_too_long',
        'severity', 'error',
        'message', '제목은 200자 이내로 입력해 주세요.'
      )
    );
  end if;
  if pg_catalog.char_length(coalesce(p_body_template, '')) > 4000 then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_body_too_long',
        'severity', 'error',
        'message', '본문은 4,000자 이내로 입력해 주세요.'
      )
    );
  end if;
  if v_combined ~ '<[^>]*>' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_html_forbidden',
        'severity', 'error',
        'message', 'HTML 태그는 사용할 수 없어요.'
      )
    );
  end if;
  if v_combined ~* '(https?://|javascript:|(^|[[:space:]])//)' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_external_url_forbidden',
        'severity', 'error',
        'message', '알림 내용에서 링크를 제거해 주세요.'
      )
    );
  end if;
  if v_combined ~* '(@all|@everyone|@channel|@here|@전체)' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_broadcast_mention_forbidden',
        'severity', 'error',
        'message', '전체 호출 멘션은 사용할 수 없어요.'
      )
    );
  end if;

  v_without_valid_tokens := pg_catalog.regexp_replace(
    v_combined,
    '[{][^{}]+[}]',
    '',
    'g'
  );
  if v_without_valid_tokens ~ '[{}]' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_braces_malformed',
        'severity', 'error',
        'message', '변수 괄호 형식을 다시 확인해 주세요.'
      )
    );
  end if;

  for v_token_match in
    select matched.value
    from pg_catalog.regexp_matches(
      v_combined,
      '[{]([^{}]+)[}]',
      'g'
    ) matched(value)
  loop
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_contract -> 'availableVariables'
      ) variable(item)
      where variable.item ->> 'key' = v_token_match[1]
        or variable.item ->> 'token' = v_token_match[1]
    ) then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_variable_unknown',
          'severity', 'error',
          'variable', v_token_match[1],
          'message', case
            when v_token_match[1] = 'deep_link'
              then 'deep_link 변수는 새 템플릿에서 사용할 수 없어요. 링크를 제거해 주세요.'
            else '계약에 없는 변수를 제거해 주세요.'
          end
        )
      );
    end if;
  end loop;

  for v_variable in
    select
      available.item ->> 'key' as key,
      required.token as token
    from pg_catalog.jsonb_array_elements(
      v_contract -> 'availableVariables'
    ) available(item)
    join pg_catalog.jsonb_array_elements_text(
      v_contract -> 'requiredTokens'
    ) required(token)
      on required.token = available.item ->> 'token'
  loop
    if pg_catalog.strpos(v_combined, '{' || v_variable.key || '}') = 0
      and pg_catalog.strpos(v_combined, '{' || v_variable.token || '}') = 0
    then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_required_token_missing',
          'severity', 'error',
          'variable', v_variable.token,
          'message', '필수 정보를 알림 내용에 포함해 주세요.'
        )
      );
    end if;
  end loop;

  for v_variable in
    select
      available.item ->> 'key' as key,
      optional.token as token
    from pg_catalog.jsonb_array_elements(
      v_contract -> 'availableVariables'
    ) available(item)
    join pg_catalog.jsonb_array_elements_text(
      v_contract -> 'optionalLineTokens'
    ) optional(token)
      on optional.token = available.item ->> 'token'
  loop
    if (
      pg_catalog.strpos(v_combined, '{' || v_variable.key || '}') > 0
      or pg_catalog.strpos(v_combined, '{' || v_variable.token || '}') > 0
    ) and (
      pg_catalog.strpos(coalesce(p_title_template, ''), '{' || v_variable.key || '}') > 0
      or pg_catalog.strpos(coalesce(p_title_template, ''), '{' || v_variable.token || '}') > 0
      or not exists (
        select 1
        from pg_catalog.regexp_split_to_table(
          coalesce(p_body_template, ''),
          chr(10)
        ) line(value)
        where pg_catalog.btrim(line.value) in (
          '{' || v_variable.key || '}',
          '{' || v_variable.token || '}'
        )
      )
    ) then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_optional_line_invalid',
          'severity', 'error',
          'variable', v_variable.token,
          'message', '선택 정보는 별도 줄에 배치해 주세요.'
        )
      );
    end if;
  end loop;

  if pg_catalog.strpos(v_combined, '[다음]') > 0
    or v_combined ~ '(확인하세요|처리하세요|입력하세요|연락하세요|해주세요|바랍니다)[.! ]*$'
  then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_direct_imperative',
        'severity', 'warning',
        'message', '단체방에서는 특정인을 지시하지 않는 진행 상태 문장을 권장해요.'
      )
    );
  end if;

  return v_violations;
end;
$$;

with candidates as (
  select
    rule_row.id as rule_id,
    dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-korean-token-v1',
      rule_row.id::text || '|' || rule_row.active_template_id::text
    ) as template_id,
    next_version.version,
    dashboard_private.notification_template_with_korean_tokens_v1(
      active_template.title_template,
      contract_row.contract_json -> 'availableVariables'
    ) as title_template,
    dashboard_private.notification_template_with_korean_tokens_v1(
      active_template.body_template,
      contract_row.contract_json -> 'availableVariables'
    ) as body_template,
    contract_row.contract_json -> 'availableVariables' as allowed_variables,
    active_template.payload_schema_version,
    contract_row.contract_version
  from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_settings_ui_registry registry
    on registry.rule_id = rule_row.id
   and registry.channel_key <> 'customer_message'
  join dashboard_private.notification_templates active_template
    on active_template.rule_id = rule_row.id
   and active_template.id = rule_row.active_template_id
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = rule_row.id
  cross join lateral (
    select coalesce(pg_catalog.max(existing.version), 0) + 1 as version
    from dashboard_private.notification_templates existing
    where existing.rule_id = rule_row.id
  ) next_version
  where dashboard_private.notification_template_with_korean_tokens_v1(
      active_template.title_template,
      contract_row.contract_json -> 'availableVariables'
    ) is distinct from active_template.title_template
    or dashboard_private.notification_template_with_korean_tokens_v1(
      active_template.body_template,
      contract_row.contract_json -> 'availableVariables'
    ) is distinct from active_template.body_template
)
insert into dashboard_private.notification_templates(
  id,
  rule_id,
  version,
  title_template,
  body_template,
  allowed_variables,
  payload_schema_version,
  checksum,
  created_by,
  created_actor_kind,
  content_contract_version
)
select
  candidates.template_id,
  candidates.rule_id,
  candidates.version,
  candidates.title_template,
  candidates.body_template,
  candidates.allowed_variables,
  candidates.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    candidates.title_template,
    candidates.body_template,
    candidates.allowed_variables,
    candidates.payload_schema_version
  ),
  null,
  'system',
  candidates.contract_version
from candidates
on conflict (id) do nothing;

do $$
declare
  v_replacement record;
begin
  for v_replacement in
    select
      rule_row.id as rule_id,
      replacement.id as template_id
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule_row.id
     and registry.channel_key <> 'customer_message'
    join dashboard_private.notification_templates replacement
      on replacement.rule_id = rule_row.id
     and replacement.id = dashboard_private.notification_deterministic_uuid_v1(
       'notification-template-korean-token-v1',
       rule_row.id::text || '|' || rule_row.active_template_id::text
     )
  loop
    perform dashboard_private.notification_template_compliance_v1(
      v_replacement.rule_id,
      v_replacement.template_id
    );
  end loop;
end;
$$;

with replacements as (
  select
    rule_row.id as rule_id,
    replacement.id
  from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_settings_ui_registry registry
    on registry.rule_id = rule_row.id
   and registry.channel_key <> 'customer_message'
  join dashboard_private.notification_templates replacement
    on replacement.rule_id = rule_row.id
   and replacement.id = dashboard_private.notification_deterministic_uuid_v1(
     'notification-template-korean-token-v1',
     rule_row.id::text || '|' || rule_row.active_template_id::text
   )
)
update dashboard_private.notification_rules rule_row
set
  active_template_id = replacement.id,
  revision = rule_row.revision + 1,
  updated_by = null,
  updated_actor_kind = 'system',
  updated_at = pg_catalog.clock_timestamp()
from replacements replacement
where replacement.rule_id = rule_row.id
  and rule_row.active_template_id <> replacement.id;

alter function dashboard_private.notification_template_with_korean_tokens_v1(text, jsonb)
  owner to postgres;
alter function dashboard_private.notification_template_contract_violations_v1(uuid, text, text)
  owner to postgres;

revoke all on function dashboard_private.notification_template_with_korean_tokens_v1(text, jsonb)
  from public, anon, authenticated, service_role;

commit;
