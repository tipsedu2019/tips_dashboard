begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function dashboard_private.registration_render_fixed_template_v2(
  p_template text,
  p_payload jsonb,
  p_allowed_variables jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_rendered text := p_template;
  v_variable record;
  v_match text[];
  v_value text;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.jsonb_typeof(p_allowed_variables) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
      where pg_catalog.jsonb_typeof(variable.item) <> 'object'
        or coalesce(variable.item ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or nullif(variable.item ->> 'token', '') is null
        or (variable.item ->> 'token') ~ '[{}[:cntrl:]]'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables)
        with ordinality left_variable(item, ordinality)
      join pg_catalog.jsonb_array_elements(p_allowed_variables)
        with ordinality right_variable(item, ordinality)
        on left_variable.ordinality < right_variable.ordinality
      where left_variable.item ->> 'key' = right_variable.item ->> 'key'
        or left_variable.item ->> 'token' = right_variable.item ->> 'token'
        or left_variable.item ->> 'key' = right_variable.item ->> 'token'
        or left_variable.item ->> 'token' = right_variable.item ->> 'key'
    )
  then
    raise exception 'registration_notification_template_allowlist_invalid'
      using errcode = '22023';
  end if;

  for v_match in
    select match_row
    from pg_catalog.regexp_matches(p_template, '\{([^{}]+)\}', 'g') match_row
  loop
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
      where variable.item ->> 'key' = v_match[1]
        or variable.item ->> 'token' = v_match[1]
    ) then
      raise exception 'registration_notification_template_token_not_allowed:%', v_match[1]
        using errcode = '22023';
    end if;
  end loop;

  for v_variable in
    select
      variable.item ->> 'key' as key,
      variable.item ->> 'token' as token
    from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
    order by variable.item ->> 'key'
  loop
    if pg_catalog.jsonb_typeof(p_payload -> v_variable.key) = 'array' then
      select coalesce(
        pg_catalog.string_agg(value.item #>> '{}', ' · ' order by value.ordinality),
        ''
      )
      into v_value
      from pg_catalog.jsonb_array_elements(p_payload -> v_variable.key)
        with ordinality value(item, ordinality);
    else
      v_value := coalesce(p_payload ->> v_variable.key, '');
    end if;
    v_rendered := pg_catalog.replace(
      v_rendered,
      '{' || v_variable.key || '}',
      v_value
    );
    v_rendered := pg_catalog.replace(
      v_rendered,
      '{' || v_variable.token || '}',
      v_value
    );
  end loop;
  return v_rendered;
end;
$$;

alter function dashboard_private.registration_render_fixed_template_v2(text, jsonb, jsonb)
  owner to postgres;

revoke all on function dashboard_private.registration_render_fixed_template_v2(
  text,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

commit;
