do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.profiles'::regclass
      and attname = 'role'
      and not attisdropped
  ) then
    alter table public.profiles
      add column role text not null default 'viewer'
      check (role in ('admin', 'staff', 'teacher', 'assistant', 'viewer'));
  end if;
end;
$migration$;

create or replace function public.worksheet_resolve_profile_id_v1(p_auth_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  with actor as (
    select
      lower(pg_catalog.btrim(coalesce(u.email, ''))) as email,
      pg_catalog.split_part(lower(pg_catalog.btrim(coalesce(u.email, ''))), '@', 1) as email_login,
      pg_catalog.split_part(lower(pg_catalog.btrim(coalesce(u.email, ''))), '@', 2) as email_domain
    from auth.users u
    where u.id = p_auth_user_id
  ), candidates as (
    select
      p.id as profile_id,
      case
        when p.id = p_auth_user_id then 0
        when lower(pg_catalog.btrim(coalesce(to_jsonb(p) ->> 'email', ''))) = a.email then 1
        else 2
      end as priority
    from actor a
    join public.profiles p on (
      p.id = p_auth_user_id
      or (
        a.email <> ''
        and lower(pg_catalog.btrim(coalesce(to_jsonb(p) ->> 'email', ''))) = a.email
      )
      or (
        a.email_domain = 'tipsedu.co.kr'
        and a.email_login <> ''
        and lower(pg_catalog.btrim(coalesce(to_jsonb(p) ->> 'login_id', ''))) = a.email_login
      )
    )
  )
  select (pg_catalog.array_agg(c.profile_id order by c.profile_id))[1]
  from candidates c
  where c.priority = (select min(priority) from candidates)
  having count(*) = 1;
$function$;

revoke execute on function public.worksheet_resolve_profile_id_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.worksheet_resolve_profile_id_v1(uuid)
  to service_role;

create or replace function public.worksheet_actor_profile_id_v1()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select public.worksheet_resolve_profile_id_v1(auth.uid());
$function$;

revoke execute on function public.worksheet_actor_profile_id_v1()
  from public, anon;
grant execute on function public.worksheet_actor_profile_id_v1()
  to authenticated;

create or replace function public.worksheet_actor_is_member_v1(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = public.worksheet_actor_profile_id_v1()
  );
$function$;

revoke execute on function public.worksheet_actor_is_member_v1(uuid)
  from public, anon;
grant execute on function public.worksheet_actor_is_member_v1(uuid)
  to authenticated;

create or replace function public.worksheet_actor_profile_role_v1()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select p.role
  from public.profiles p
  where p.id = (select public.worksheet_actor_profile_id_v1())
  limit 1;
$function$;

revoke execute on function public.worksheet_actor_profile_role_v1()
  from public, anon;
grant execute on function public.worksheet_actor_profile_role_v1()
  to authenticated;

drop policy if exists "members can read worksheet projects"
  on public.worksheet_projects;
create policy "members can read worksheet projects"
  on public.worksheet_projects
  for select
  to authenticated
  using (
    (select public.worksheet_actor_profile_role_v1()) in ('admin', 'staff', 'teacher')
    and worksheet_projects.created_by = (select public.worksheet_actor_profile_id_v1())
    and public.worksheet_actor_is_member_v1(worksheet_projects.organization_id)
  );

drop policy if exists "members can read worksheet exports"
  on public.worksheet_exports;
create policy "members can read worksheet exports"
  on public.worksheet_exports
  for select
  to authenticated
  using (
    (select public.worksheet_actor_profile_role_v1()) in ('admin', 'staff', 'teacher')
    and exists (
      select 1
      from public.worksheet_projects wp
      where wp.id = worksheet_exports.worksheet_project_id
        and wp.created_by = (select public.worksheet_actor_profile_id_v1())
        and public.worksheet_actor_is_member_v1(wp.organization_id)
    )
  );

create index if not exists worksheet_projects_v2_owner_exact_active_idx
  on public.worksheet_projects(
    organization_id,
    created_by,
    document_id,
    content_signature,
    created_at desc
  )
  where schema_version = 2 and deleted_at is null;

drop policy if exists worksheet_profiles_admin_staff_update_other_v1 on public.profiles;
create policy worksheet_profiles_admin_staff_update_other_v1
  on public.profiles
  for update
  to authenticated
  using (
    id <> (select public.worksheet_actor_profile_id_v1())
    and (select public.worksheet_actor_profile_role_v1()) in ('admin', 'staff')
  )
  with check (
    id <> (select public.worksheet_actor_profile_id_v1())
    and (select public.worksheet_actor_profile_role_v1()) in ('admin', 'staff')
  );

create or replace function public.worksheet_guard_profile_role_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_actor_profile_id uuid;
  v_actor_role text;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  v_actor_profile_id := public.worksheet_actor_profile_id_v1();
  if v_actor_profile_id is null then
    raise exception 'profile role change requires an authenticated database actor'
      using errcode = 'P0001';
  end if;

  if v_actor_profile_id = old.id then
    raise exception 'authenticated users cannot change their own profile role'
      using errcode = 'P0001';
  end if;

  select p.role
  into v_actor_role
  from public.profiles p
  where p.id = v_actor_profile_id;

  if v_actor_role is null or v_actor_role not in ('admin', 'staff') then
    raise exception 'profile role change requires a database-backed admin or staff actor'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke execute on function public.worksheet_guard_profile_role_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists worksheet_guard_profile_role_v1 on public.profiles;
create trigger worksheet_guard_profile_role_v1
before update of role on public.profiles
for each row execute function public.worksheet_guard_profile_role_v1();

create or replace function public.worksheet_security_posture_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    to_regprocedure('public.worksheet_resolve_profile_id_v1(uuid)') is not null
    and to_regprocedure('public.worksheet_actor_profile_id_v1()') is not null
    and to_regprocedure('public.worksheet_actor_is_member_v1(uuid)') is not null
    and to_regprocedure('public.worksheet_actor_profile_role_v1()') is not null
    and exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = 'public.worksheet_projects'::regclass
        and relation.relrowsecurity
    )
    and exists (
      select 1
      from pg_catalog.pg_policy policy
      where policy.polrelid = 'public.worksheet_projects'::regclass
        and policy.polname = 'members can read worksheet projects'
        and policy.polcmd = 'r'
        and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like '%created_by%'
        and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like '%worksheet_actor_profile_id_v1%'
    )
    and exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = 'public.worksheet_exports'::regclass
        and relation.relrowsecurity
    )
    and exists (
      select 1
      from pg_catalog.pg_policy policy
      where policy.polrelid = 'public.worksheet_exports'::regclass
        and policy.polname = 'members can read worksheet exports'
        and policy.polcmd = 'r'
        and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like '%created_by%'
        and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like '%worksheet_actor_profile_id_v1%'
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.profiles'::regclass
        and a.attname = 'role'
        and not a.attisdropped
        and a.attnotnull
    )
    and exists (
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_attribute trigger_column
        on trigger_column.attrelid = t.tgrelid
       and trigger_column.attname = 'role'
       and not trigger_column.attisdropped
      where t.tgrelid = 'public.profiles'::regclass
        and t.tgname = 'worksheet_guard_profile_role_v1'
        and not t.tgisinternal
        and t.tgenabled in ('O', 'A')
        and t.tgfoid = to_regprocedure('public.worksheet_guard_profile_role_v1()')
        and t.tgtype = 19
        and t.tgattr::text = trigger_column.attnum::text
    );
$function$;

revoke execute on function public.worksheet_security_posture_v1()
  from public, anon, authenticated;
grant execute on function public.worksheet_security_posture_v1()
  to service_role;

create or replace function public.record_worksheet_v2_export(
  p_organization_id uuid,
  p_user_id uuid,
  p_project_snapshot jsonb,
  p_content_signature text,
  p_mode text,
  p_paper_kind text,
  p_format public.export_format,
  p_problem_count integer,
  p_renderer_version text,
  p_problem_ids text[] default null
)
returns table (
  history_entry_id uuid,
  export_id uuid,
  export_created_at timestamptz,
  snapshot_created boolean
)
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_document_id uuid;
  v_document_revision integer;
  v_content_signature text;
  v_expected_problem_count integer;
  v_history_entry_id uuid;
  v_export_id uuid;
  v_export_created_at timestamptz;
  v_snapshot_created boolean := false;
begin
  if p_organization_id is null
    or p_user_id is null
    or p_mode is null
    or p_mode not in ('student', 'teacher', 'explanation', 'quick-answer')
    or p_paper_kind is null
    or p_paper_kind not in ('detail-check', 'transformed')
    or p_format is null
    or p_problem_count is null
    or p_problem_count < 0
    or nullif(btrim(p_renderer_version), '') is null
    or nullif(btrim(p_content_signature), '') is null
  then
    raise exception 'invalid worksheet V2 export arguments' using errcode = '23514';
  end if;

  if p_project_snapshot is null
    or (jsonb_typeof(p_project_snapshot) = 'object') is not true
    or (p_project_snapshot ?& array[
      'schemaVersion', 'documentId', 'title', 'school', 'grade', 'className',
      'outputSettings', 'passages', 'detailCheckBatches', 'problems',
      'revision', 'createdAt', 'updatedAt'
    ]) is not true
    or (jsonb_typeof(p_project_snapshot -> 'schemaVersion') = 'number') is not true
    or (p_project_snapshot ->> 'schemaVersion' = '2') is not true
    or (jsonb_typeof(p_project_snapshot -> 'documentId') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'title') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'school') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'grade') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'className') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'outputSettings') = 'object') is not true
    or (jsonb_typeof(p_project_snapshot -> 'passages') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'detailCheckBatches') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'problems') = 'array') is not true
    or (jsonb_typeof(p_project_snapshot -> 'revision') = 'number') is not true
    or ((p_project_snapshot ->> 'revision') ~ '^(0|[1-9][0-9]*)$') is not true
    or (jsonb_typeof(p_project_snapshot -> 'createdAt') = 'string') is not true
    or (jsonb_typeof(p_project_snapshot -> 'updatedAt') = 'string') is not true
    or ((p_project_snapshot ->> 'documentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true
  then
    raise exception 'invalid worksheet V2 snapshot' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    where (jsonb_typeof(batch.value -> 'sets') = 'array') is not true
  ) or exists (
    select 1
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    cross join lateral jsonb_array_elements(batch.value -> 'sets') detail_set(value)
    where (jsonb_typeof(detail_set.value -> 'items') = 'array') is not true
  ) then
    raise exception 'invalid worksheet V2 detail-check snapshot' using errcode = '23514';
  end if;

  if (p_project_snapshot ->> 'revision')::numeric > 2147483647 then
    raise exception 'worksheet V2 revision is out of range' using errcode = '23514';
  end if;

  if p_paper_kind = 'detail-check' then
    if p_problem_ids is not null then
      raise exception 'detail-check exports do not accept transformed problem IDs'
        using errcode = '23514';
    end if;

    select coalesce(sum(jsonb_array_length(detail_set.value -> 'items')), 0)::integer
    into v_expected_problem_count
    from jsonb_array_elements(p_project_snapshot -> 'detailCheckBatches') batch(value)
    cross join lateral jsonb_array_elements(batch.value -> 'sets') detail_set(value);
  elsif p_problem_ids is null then
    v_expected_problem_count := jsonb_array_length(p_project_snapshot -> 'problems');
  else
    if cardinality(p_problem_ids) = 0
      or cardinality(p_problem_ids) > jsonb_array_length(p_project_snapshot -> 'problems')
      or exists (
        select 1
        from unnest(p_problem_ids) selected(problem_id)
        where nullif(btrim(selected.problem_id), '') is null
      )
      or (
        select count(distinct selected.problem_id)
        from unnest(p_problem_ids) selected(problem_id)
      ) <> cardinality(p_problem_ids)
      or exists (
        select 1
        from unnest(p_problem_ids) selected(problem_id)
        where not exists (
          select 1
          from jsonb_array_elements(p_project_snapshot -> 'problems') problem(value)
          where jsonb_typeof(problem.value) = 'object'
            and jsonb_typeof(problem.value -> 'id') = 'string'
            and problem.value ->> 'id' = selected.problem_id
        )
      )
    then
      raise exception 'invalid transformed problem ID selection' using errcode = '23514';
    end if;

    v_expected_problem_count := cardinality(p_problem_ids);
  end if;

  if p_problem_count <> v_expected_problem_count then
    raise exception 'worksheet V2 export problem count mismatch' using errcode = '23514';
  end if;

  v_document_id := (p_project_snapshot ->> 'documentId')::uuid;
  v_document_revision := (p_project_snapshot ->> 'revision')::integer;
  v_content_signature := btrim(p_content_signature);

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'worksheet organization membership required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_user_id::text || ':' || v_document_id::text || ':' || v_content_signature,
    0
  ));

  select wp.id
  into v_history_entry_id
  from public.worksheet_projects wp
  where wp.organization_id = p_organization_id
    and wp.created_by = p_user_id
    and wp.schema_version = 2
    and wp.document_id = v_document_id
    and wp.content_signature = v_content_signature
    and wp.project_snapshot = p_project_snapshot
    and wp.deleted_at is null
  order by wp.created_at desc, wp.id desc
  limit 1;

  if v_history_entry_id is null then
    insert into public.worksheet_projects (
      organization_id,
      subject,
      title,
      school,
      grade,
      class_name,
      settings,
      created_by,
      schema_version,
      project_snapshot,
      document_id,
      document_revision,
      content_signature
    ) values (
      p_organization_id,
      'english',
      p_project_snapshot ->> 'title',
      p_project_snapshot ->> 'school',
      p_project_snapshot ->> 'grade',
      p_project_snapshot ->> 'className',
      p_project_snapshot -> 'outputSettings',
      p_user_id,
      2,
      p_project_snapshot,
      v_document_id,
      v_document_revision,
      v_content_signature
    )
    returning id into v_history_entry_id;
    v_snapshot_created := true;
  end if;

  insert into public.worksheet_exports (
    worksheet_project_id,
    exported_by,
    mode,
    format,
    problem_count,
    renderer_version,
    render_settings
  ) values (
    v_history_entry_id,
    p_user_id,
    p_mode,
    p_format,
    p_problem_count,
    btrim(p_renderer_version),
    jsonb_build_object(
      'printColumnCount', case when p_paper_kind = 'transformed' then 2 else 1 end,
      'paperKind', p_paper_kind,
      'pageSize', 'A4',
      'orientation', 'portrait'
    ) || case
      when p_problem_ids is null then '{}'::jsonb
      else jsonb_build_object('problemIds', to_jsonb(p_problem_ids))
    end
  )
  returning id, created_at into v_export_id, v_export_created_at;

  return query
  select v_history_entry_id, v_export_id, v_export_created_at, v_snapshot_created;
end;
$function$;

revoke execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, text, public.export_format, integer, text, text[]
) from public, anon, authenticated;
grant execute on function public.record_worksheet_v2_export(
  uuid, uuid, jsonb, text, text, text, public.export_format, integer, text, text[]
) to service_role;
