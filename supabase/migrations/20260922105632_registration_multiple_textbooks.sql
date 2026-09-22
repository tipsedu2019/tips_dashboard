begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- NULL means an untouched legacy row; readers retain its single-book value.
-- The existing scalar remains the first selected book for older consumers.
alter table public.ops_registration_enrollments add column textbook_ids uuid[];

create function dashboard_private.registration_enrollment_textbook_ids_v1(p_row jsonb)
returns uuid[] language plpgsql immutable security invoker set search_path = '' as $fn$
declare
  v_values jsonb;
  v_value jsonb;
  v_id uuid;
  v_ids uuid[] := array[]::uuid[];
begin
  v_values := case when p_row ? 'textbookIds' then p_row -> 'textbookIds'
    when nullif(p_row ->> 'textbookId','') is null then '[]'::jsonb
    else jsonb_build_array(p_row ->> 'textbookId') end;
  if jsonb_typeof(v_values) is distinct from 'array' then
    raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
  end if;
  for v_value in select value from jsonb_array_elements(v_values) loop
    if jsonb_typeof(v_value) is distinct from 'string'
      or btrim(v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    v_id := btrim(v_value #>> '{}')::uuid;
    if not v_id = any(v_ids) then v_ids := array_append(v_ids, v_id); end if;
  end loop;
  if p_row ? 'textbookIds' and nullif(p_row ->> 'textbookId','') is not null
    and (p_row ->> 'textbookId')::uuid is distinct from v_ids[1] then
    raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
  end if;
  return v_ids;
end;
$fn$;
revoke all on function dashboard_private.registration_enrollment_textbook_ids_v1(jsonb) from public, anon, authenticated;

-- Keep old callers compatible without rewriting historical enrollment facts.
create function dashboard_private.sync_registration_enrollment_textbooks_v1()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.textbook_ids is not distinct from old.textbook_ids then
      if new.textbook_id is distinct from old.textbook_id then
        new.textbook_ids := array_remove(array[new.textbook_id], null);
      end if;
    end if;
  end if;
  if new.textbook_ids is not null then
    if array_ndims(new.textbook_ids) > 1 or array_position(new.textbook_ids, null) is not null
      or cardinality(new.textbook_ids) <> (select count(distinct value) from unnest(new.textbook_ids) value) then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    new.textbook_id := new.textbook_ids[1];
  end if;
  return new;
end;
$fn$;
revoke all on function dashboard_private.sync_registration_enrollment_textbooks_v1() from public, anon, authenticated;
create trigger registration_enrollment_textbooks_sync before insert or update of textbook_id, textbook_ids
on public.ops_registration_enrollments for each row
execute function dashboard_private.sync_registration_enrollment_textbooks_v1();

-- Match the legacy scalar FK's RESTRICT policy for every selected book.
create function dashboard_private.protect_registration_enrollment_textbooks_v1()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' and new.id is not distinct from old.id then return new; end if;
  if exists (select 1 from public.ops_registration_enrollments enrollment
    where enrollment.textbook_ids @> array[old.id]) then
    raise exception 'registration_textbook_in_use' using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
revoke all on function dashboard_private.protect_registration_enrollment_textbooks_v1() from public, anon, authenticated;
create trigger registration_enrollment_textbooks_restrict before delete or update of id
on public.textbooks for each row
execute function dashboard_private.protect_registration_enrollment_textbooks_v1();

-- Patch the final installed definitions, preserving their authorization, locks,
-- request receipts, status independence and no-send boundaries. Every source
-- fragment must match exactly once or the whole migration rolls back.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)', $old$    'textbookId',
$old$, $new$    'textbookId',
    'textbookIds',
$new$),
    ('dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)', $old$  v_textbook_id_text text;$old$, $new$  v_textbook_id_text text;
  v_textbook_ids uuid[];$new$),
    ('dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)', $old$    v_rows := v_rows || pg_catalog.jsonb_build_array($old$, $new$    v_textbook_ids := dashboard_private.registration_enrollment_textbook_ids_v1(v_input);
    v_rows := v_rows || pg_catalog.jsonb_build_array($new$),
    ('dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)', $old$        'textbookId', case
          when v_textbook_id_text is null then null
          else v_textbook_id_text::uuid
        end,$old$, $new$        'textbookId', v_textbook_ids[1],
        'textbookIds', pg_catalog.to_jsonb(v_textbook_ids),$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$    select (row_item.value ->> 'textbookId')::uuid
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    where row_item.value ->> 'textbookId' is not null$old$, $new$    select selected.id
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    cross join lateral pg_catalog.unnest(dashboard_private.registration_enrollment_textbook_ids_v1(row_item.value)) selected(id)$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$    where row_item.value ->> 'textbookId' is not null
      and not (
        exists (
          select 1
          from public.textbooks textbook
          where textbook.id = (row_item.value ->> 'textbookId')::uuid
        )
        and pg_catalog.jsonb_typeof(
          coalesce(pg_catalog.to_jsonb(class.textbook_ids), '[]'::jsonb)
        ) = 'array'
        and coalesce(
          pg_catalog.to_jsonb(class.textbook_ids),
          '[]'::jsonb
        ) ? (row_item.value ->> 'textbookId')
      )$old$, $new$    cross join lateral pg_catalog.unnest(dashboard_private.registration_enrollment_textbook_ids_v1(row_item.value)) selected(id)
    where not exists (select 1 from public.textbooks textbook where textbook.id = selected.id)
      or not coalesce(pg_catalog.to_jsonb(class.textbook_ids), '[]'::jsonb) ? selected.id::text$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$        'textbookId', v_textbook_id,$old$, $new$        'textbookId', v_textbook_id,
        'textbookIds', pg_catalog.to_jsonb(dashboard_private.registration_enrollment_textbook_ids_v1(v_row)),$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$      nullif(row_item.value ->> 'textbookId', '')::uuid as textbook_id,$old$, $new$      nullif(row_item.value ->> 'textbookId', '')::uuid as textbook_id,
      dashboard_private.registration_enrollment_textbook_ids_v1(row_item.value) as textbook_ids,$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$      textbook_id,
$old$, $new$      textbook_id,
      textbook_ids,
$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$      final_rows.textbook_id,$old$, $new$      final_rows.textbook_id,
      final_rows.textbook_ids,$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$        textbook_id = excluded.textbook_id,$old$, $new$        textbook_id = excluded.textbook_id,
        textbook_ids = excluded.textbook_ids,$new$),
    ('dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)', $old$        'textbookId', enrollment.textbook_id,$old$, $new$        'textbookId', enrollment.textbook_id,
        'textbookIds', coalesce(enrollment.textbook_ids, array_remove(array[enrollment.textbook_id], null)),$new$),
    ('dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)', $old$    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
      and enrollment.textbook_id is not null$old$, $new$    select selected.id
    from public.ops_registration_enrollments enrollment
    cross join lateral pg_catalog.unnest(coalesce(enrollment.textbook_ids, array_remove(array[enrollment.textbook_id], null))) selected(id)
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')$new$),
    ('dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)', $old$    if v_enrollment.textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_enrollment.textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_enrollment.textbook_id::text
    ) then$old$, $new$    if exists (
      select 1 from pg_catalog.unnest(coalesce(v_enrollment.textbook_ids, array_remove(array[v_enrollment.textbook_id], null))) selected(id)
      where not exists (select 1 from public.textbooks textbook where textbook.id = selected.id)
        or not coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb) ? selected.id::text
    ) then$new$),
    ('dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)', $old$  v_textbook_name text;$old$, $new$  v_textbook_name text;
  v_textbook_id uuid;
  v_textbook_updated_at timestamptz;
  v_textbook_names text[] := array[]::text[];$new$),
    ('dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)', $old$  if v_enrollment.textbook_id is not null then
    select textbook.*
    into v_textbook
    from public.textbooks textbook
    where textbook.id = v_enrollment.textbook_id
    for share;
    if not found then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;
    v_textbook_name := coalesce(
      nullif(pg_catalog.btrim(v_textbook.name), ''),
      nullif(pg_catalog.btrim(v_textbook.title), '')
    );
    if v_textbook_name is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;
  end if;$old$, $new$  foreach v_textbook_id in array coalesce(v_enrollment.textbook_ids, array_remove(array[v_enrollment.textbook_id], null)) loop
    select textbook.* into v_textbook from public.textbooks textbook
    where textbook.id = v_textbook_id for share;
    if not found then
      raise exception 'registration_customer_message_admission_schedule_incomplete' using errcode = '22023';
    end if;
    v_textbook_name := coalesce(nullif(pg_catalog.btrim(v_textbook.name), ''), nullif(pg_catalog.btrim(v_textbook.title), ''));
    if v_textbook_name is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete' using errcode = '22023';
    end if;
    v_textbook_names := pg_catalog.array_append(v_textbook_names, v_textbook_name);
    v_textbook_updated_at := greatest(v_textbook_updated_at, coalesce(v_textbook.updated_at, v_textbook.created_at, v_enrollment.updated_at));
  end loop;
  v_textbook_name := nullif(pg_catalog.array_to_string(v_textbook_names, ', '), '');$new$),
    ('dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)', $old$      else coalesce(v_textbook.updated_at, v_textbook.created_at, v_enrollment.updated_at)$old$, $new$      else v_textbook_updated_at$new$),
    ('dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)', $old$  if found then
    if v_saved_task_id$old$, $new$  if found then
    if v_saved_task_id is not distinct from v_track.task_id
      and v_saved_type = 'save_registration_enrollment_details' then
      v_saved_fingerprint := pg_catalog.jsonb_set(v_saved_fingerprint, '{rows}',
        dashboard_private.normalize_registration_enrollment_rows_request_v1(v_saved_fingerprint -> 'rows'));
    end if;
    if v_saved_task_id$new$),
    ('public.save_registration_enrollment_rows(uuid,jsonb,text)', $old$  if found then
    if not v_receipt_matches then$old$, $new$  if found then
    if v_saved_task_id is not distinct from v_task_id
      and v_saved_type = 'save_enrollment_rows' then
      v_receipt_matches := pg_catalog.jsonb_set(v_saved_fingerprint, '{rows}',
        dashboard_private.normalize_registration_enrollment_rows_request_v1(v_saved_fingerprint -> 'rows')) = v_target_fingerprint;
    end if;
    if not v_receipt_matches then$new$)
  ) as patches(signature, old_text, new_text) loop
    definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(patch.signature));
    if definition is null or (length(definition) - length(replace(definition, patch.old_text, ''))) / length(patch.old_text) <> 1 then
      raise exception 'registration_multiple_textbooks_dependency_drift: %', patch.signature using errcode = '55000';
    end if;
    execute replace(definition, patch.old_text, patch.new_text);
  end loop;
end;
$migration$;
commit;
