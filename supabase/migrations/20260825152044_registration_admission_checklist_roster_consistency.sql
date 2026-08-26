begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ops_registration_details
  add column if not exists admission_checklist jsonb not null default
    '{"applicationSent":false,"makeeduRegistered":false,"invoiceSent":false,"paymentConfirmed":false,"registrationCompleted":false}'::jsonb;

alter table public.ops_registration_details
  add constraint ops_registration_details_admission_checklist_exact_v1
  check (
    pg_catalog.jsonb_typeof(admission_checklist) = 'object'
    and pg_catalog.jsonb_typeof(admission_checklist -> 'applicationSent') = 'boolean'
    and pg_catalog.jsonb_typeof(admission_checklist -> 'makeeduRegistered') = 'boolean'
    and pg_catalog.jsonb_typeof(admission_checklist -> 'invoiceSent') = 'boolean'
    and pg_catalog.jsonb_typeof(admission_checklist -> 'paymentConfirmed') = 'boolean'
    and pg_catalog.jsonb_typeof(admission_checklist -> 'registrationCompleted') = 'boolean'
    and admission_checklist = pg_catalog.jsonb_build_object(
      'applicationSent', admission_checklist -> 'applicationSent',
      'makeeduRegistered', admission_checklist -> 'makeeduRegistered',
      'invoiceSent', admission_checklist -> 'invoiceSent',
      'paymentConfirmed', admission_checklist -> 'paymentConfirmed',
      'registrationCompleted', admission_checklist -> 'registrationCompleted'
    )
  ) not valid;

-- Compatibility projections stay protected, but a checklist-only UPDATE must
-- not repair or otherwise mutate the track-derived parent workflow.
drop trigger if exists prevent_registration_compatibility_override
  on public.ops_registration_details;
create trigger prevent_registration_compatibility_override
before update of
  pipeline_status,
  counselor,
  makeedu_registered,
  makeedu_invoice_sent,
  payment_checked,
  level_test_at,
  level_test_place,
  level_test_material_link,
  level_test_completed_at,
  level_test_result,
  phone_consultation_at,
  visit_consultation_at,
  visit_consultation_place,
  consultation_at,
  class_start_date,
  class_start_session,
  textbook_ready,
  textbook_preparation,
  textbook_billing_issued,
  timetable_roster_updated
on public.ops_registration_details
for each row
execute function public.prevent_registration_compatibility_override();

create or replace function dashboard_private.set_registration_admission_checklist_item_v1_impl(
  p_task_id uuid,
  p_item text,
  p_checked boolean,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_item text := nullif(pg_catalog.btrim(p_item), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_checklist jsonb;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_checked is null or v_item not in (
    'applicationSent',
    'makeeduRegistered',
    'invoiceSent',
    'paymentConfirmed',
    'registrationCompleted'
  ) then
    raise exception 'registration_admission_checklist_item_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'item', v_item,
    'checked', p_checked
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'set_admission_checklist_item'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'set_admission_checklist_item'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  update public.ops_registration_details detail
  set admission_checklist = pg_catalog.jsonb_set(
    detail.admission_checklist,
    array[v_item],
    pg_catalog.to_jsonb(p_checked),
    false
  )
  where detail.task_id = p_task_id
  returning detail.admission_checklist into v_checklist;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'checklist', v_checklist
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    p_task_id,
    'set_admission_checklist_item',
    v_target_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

alter function dashboard_private.set_registration_admission_checklist_item_v1_impl(
  uuid, text, boolean, text
) owner to postgres;
revoke all on function dashboard_private.set_registration_admission_checklist_item_v1_impl(
  uuid, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.set_registration_admission_checklist_item_v1_impl(
  uuid, text, boolean, text
) to authenticated;

create or replace function public.set_registration_admission_checklist_item_v1(
  p_task_id uuid,
  p_item text,
  p_checked boolean,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.set_registration_admission_checklist_item_v1_impl(
    p_task_id,
    p_item,
    p_checked,
    p_request_key
  );
$$;

alter function public.set_registration_admission_checklist_item_v1(
  uuid, text, boolean, text
) owner to postgres;
revoke all on function public.set_registration_admission_checklist_item_v1(
  uuid, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_registration_admission_checklist_item_v1(
  uuid, text, boolean, text
) to authenticated;

comment on function public.set_registration_admission_checklist_item_v1(
  uuid, text, boolean, text
) is 'Updates exactly one independent manual admission checklist item.';

-- The roster gateway historically surfaced domain conflicts as SQLSTATE 40001.
-- They are decisive check conflicts, not serialization failures.
do $registration_roster_sqlstate_patch$
declare
  v_definition text;
  v_updated_definition text;
  v_retryable_fragment text :=
    'using errcode = ' || pg_catalog.quote_literal('40001');
  v_nonretryable_fragment text :=
    'using errcode = ' || pg_catalog.quote_literal('23514');
  v_occurrences integer;
  v_owner oid;
  v_acl aclitem[];
  v_current_owner oid;
  v_current_acl aclitem[];
begin
  select procedure.proowner, procedure.proacl
  into v_owner, v_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::pg_catalog.regprocedure;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::pg_catalog.regprocedure
  );
  v_occurrences := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, v_retryable_fragment, ''))
  ) / pg_catalog.char_length(v_retryable_fragment);
  if v_occurrences < 1 then
    raise exception 'registration_roster_sqlstate_patch_target_missing'
      using errcode = '55000';
  end if;

  v_updated_definition := pg_catalog.replace(
    v_definition,
    v_retryable_fragment,
    v_nonretryable_fragment
  );
  execute v_updated_definition;

  select procedure.proowner, procedure.proacl
  into v_current_owner, v_current_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::pg_catalog.regprocedure;
  if v_current_owner is distinct from v_owner or v_current_acl is distinct from v_acl then
    raise exception 'registration_roster_sqlstate_patch_metadata_changed'
      using errcode = '55000';
  end if;
end;
$registration_roster_sqlstate_patch$;

-- A completed admission batch now means the enrollment projection is complete.
-- Finance timestamps remain evidence only when the batch actually passed through
-- invoiced or paid; the independent manual checklist never fabricates them.
do $registration_batch_finance_constraint_patch$
declare
  v_constraint_names text[];
  v_constraint_name text;
begin
  select coalesce(
    pg_catalog.array_agg(constraint_row.conname order by constraint_row.conname),
    '{}'::text[]
  )
  into v_constraint_names
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'public.ops_registration_admission_batches'::pg_catalog.regclass
    and constraint_row.contype = 'c'
    and (
      pg_catalog.pg_get_constraintdef(constraint_row.oid)
        ilike '%invoice_sent_at is not null%'
      or pg_catalog.pg_get_constraintdef(constraint_row.oid)
        ilike '%payment_confirmed_at is not null%'
    );

  if pg_catalog.cardinality(v_constraint_names) <> 2 then
    raise exception 'registration_batch_finance_constraint_contract_missing'
      using errcode = '55000';
  end if;

  foreach v_constraint_name in array v_constraint_names
  loop
    execute pg_catalog.format(
      'alter table public.ops_registration_admission_batches drop constraint %I',
      v_constraint_name
    );
  end loop;
end;
$registration_batch_finance_constraint_patch$;

alter table public.ops_registration_admission_batches
  add constraint ops_registration_admission_batches_invoice_evidence_v2
  check (
    status not in ('invoiced', 'paid')
    or invoice_sent_at is not null
  ) not valid,
  add constraint ops_registration_admission_batches_payment_evidence_v2
  check (
    status <> 'paid'
    or payment_confirmed_at is not null
  ) not valid;

create or replace function dashboard_private.finalize_registration_track_enrollments_v1(
  p_track_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student public.students%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class public.classes%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_session jsonb;
  v_name_key text;
  v_parent_phone_key text;
  v_task_id uuid;
  v_student_id uuid;
  v_batch_id uuid;
  v_batch_count integer;
  v_unbatched_count integer;
  v_match_count integer;
  v_row_count integer;
  v_revision_number integer;
  v_source_status text;
  v_changed boolean := false;
  v_enrollment_ids jsonb;
begin
  if p_track_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task.id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task.id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task.id;
  if v_track.pipeline_status not in ('enrollment_processing', 'registered') then
    raise exception 'registration_enrollment_pipeline_invalid' using errcode = '23514';
  end if;

  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
  );
  if v_name_key = '' or v_parent_phone_key = '' then
    raise exception 'registration_student_identity_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  perform 1
  from public.students student
  where student.id = v_task.student_id
    or (
      pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    )
  order by student.id
  for update;

  if v_task.student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_task.student_id;
    if not found
      or pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
      ) <> v_name_key
      or pg_catalog.regexp_replace(
        coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
      ) <> v_parent_phone_key
      or (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
        and v_student.school is distinct from v_detail.school_name
      )
      or (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
        and pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g')
          <> pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
    v_student_id := v_student.id;
  else
    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(student.id order by student.id))[1]
    into v_match_count, v_student_id
    from public.students student
    where pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      );
    if v_match_count > 1 then
      raise exception 'registration_student_identity_ambiguous' using errcode = '23514';
    elsif v_match_count = 0 then
      insert into public.students(
        name,
        grade,
        school,
        contact,
        parent_contact,
        status,
        class_ids,
        waitlist_class_ids
      ) values (
        pg_catalog.btrim(v_task.student_name),
        v_detail.school_grade,
        v_detail.school_name,
        nullif(pg_catalog.btrim(v_detail.student_phone), ''),
        pg_catalog.btrim(v_detail.parent_phone),
        '재원',
        '[]'::jsonb,
        '[]'::jsonb
      ) returning * into v_student;
      v_student_id := v_student.id;
    else
      select student.*
      into v_student
      from public.students student
      where student.id = v_student_id;
    end if;

    update public.ops_tasks task
    set student_id = v_student_id
    where task.id = v_task.id;
  end if;

  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task.id
  order by batch.id
  for update;

  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task.id
  order by enrollment.id
  for update of enrollment;

  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
  )
  order by class.id
  for update;

  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
      and enrollment.textbook_id is not null
  )
  order by textbook.id
  for update;

  select pg_catalog.count(*)
  into v_row_count
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and (
      enrollment.status = 'planned'
      or (enrollment.status = 'enrolled' and enrollment.roster_active)
    );
  if v_row_count = 0 then
    raise exception 'registration_enrollment_required' using errcode = '23514';
  end if;

  select
    pg_catalog.count(distinct enrollment.admission_batch_id),
    pg_catalog.count(*) filter (where enrollment.admission_batch_id is null),
    (pg_catalog.array_agg(
      distinct enrollment.admission_batch_id
      order by enrollment.admission_batch_id
    ) filter (where enrollment.admission_batch_id is not null))[1]
  into v_batch_count, v_unbatched_count, v_batch_id
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'planned';
  if v_batch_count > 1 or (v_batch_count = 1 and v_unbatched_count > 0) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
  ) then
    if v_batch_id is null then
      -- Status-driven registration owns a dedicated compatibility batch. Never
      -- attach this subject to another subject's legacy open batch.
      select coalesce(pg_catalog.max(batch.revision_number), 0) + 1
      into v_revision_number
      from public.ops_registration_admission_batches batch
      where batch.task_id = v_task.id;
      insert into public.ops_registration_admission_batches(
        task_id,
        revision_number,
        status
      ) values (
        v_task.id,
        v_revision_number,
        'completed'
      ) returning id into v_batch_id;
    else
      select batch.*
      into v_batch
      from public.ops_registration_admission_batches batch
      where batch.id = v_batch_id
        and batch.task_id = v_task.id;
      if not found or v_batch.status = 'canceled' then
        raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
      end if;
    end if;

  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
      and (enrollment.status = 'planned' or enrollment.roster_active)
    order by enrollment.class_id, enrollment.id
  loop
    select class.*
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if pg_catalog.btrim(v_class.subject) is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if v_class.status = '종강' or v_class.closed_at is not null then
      raise exception 'registration_class_closed' using errcode = '23514';
    end if;
    if v_enrollment.textbook_id is not null and not (
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
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;

    if v_enrollment.status = 'planned' then
      if v_enrollment.admission_batch_id is null then
        if v_enrollment.student_id is not null or v_enrollment.roster_active then
          raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
        end if;
      elsif v_enrollment.student_id is distinct from v_student_id
        or not v_enrollment.roster_active
      then
        raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
      end if;
      if exists (
        select 1
        from public.ops_registration_enrollments claim
        where claim.student_id = v_student_id
          and claim.class_id = v_enrollment.class_id
          and claim.roster_active
          and claim.id <> v_enrollment.id
      ) then
        raise exception 'registration_student_class_already_active' using errcode = '23514';
      end if;
    elsif v_enrollment.student_id is distinct from v_student_id then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
  end loop;

  begin
    update public.ops_registration_enrollments enrollment
    set
      student_id = v_student_id,
      admission_batch_id = v_batch_id,
      roster_active = true,
      updated_at = pg_catalog.now()
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
  exception
    when unique_violation then
      raise exception 'registration_student_class_already_active' using errcode = '23514';
  end;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
    order by enrollment.class_id, enrollment.id
  loop
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'enrolled',
      'removed',
      v_enrollment.id,
      'registration_workflow_registered',
      p_actor_id
    );
    v_changed := true;
  end loop;

  update public.ops_registration_enrollments enrollment
  set
    status = 'enrolled',
    roster_active = true,
    updated_at = pg_catalog.now()
  where enrollment.track_id = p_track_id
    and enrollment.status = 'planned'
    and enrollment.student_id = v_student_id
    and enrollment.admission_batch_id = v_batch_id
    and enrollment.roster_active;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.students student on student.id = enrollment.student_id
    join public.classes class on class.id = enrollment.class_id
    where enrollment.track_id = p_track_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active
      and (
        not (coalesce(student.class_ids, '[]'::jsonb) ? enrollment.class_id::text)
        or not (coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? enrollment.student_id::text)
        or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? enrollment.class_id::text
        or coalesce(pg_catalog.to_jsonb(class.waitlist_ids), '[]'::jsonb) ? enrollment.student_id::text
      )
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;

  if v_batch_id is not null and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = v_batch_id
      and enrollment.status = 'planned'
  ) then
    update public.ops_registration_admission_batches batch
    set
      status = 'completed',
      updated_at = pg_catalog.now()
    where batch.id = v_batch_id
      and batch.status <> 'canceled';
  end if;

  v_source_status := v_track.pipeline_status;
  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    'registered',
    null,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event_v2(
    v_task.id,
    p_track_id,
    case
      when p_actor_id is null then 'registration_workflow_registered_backfill'
      else 'registration_workflow_registered_roster_finalized'
    end,
    v_source_status,
    'registered',
    case when p_actor_id is null then 'registration_workflow_registered_backfill' else 'manual_status_change' end,
    pg_catalog.jsonb_build_object(
      'studentId', v_student_id,
      'batchId', v_batch_id,
      'changed', v_changed
    ),
    case when p_actor_id is null then 'migration' else 'user' end,
    case when p_actor_id is null then 'registration_workflow_registered_backfill' else null end
  );
  perform dashboard_private.recompute_registration_parent(v_task.id);

  select coalesce(
    pg_catalog.jsonb_agg(enrollment.id order by enrollment.id),
    '[]'::jsonb
  )
  into v_enrollment_ids
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'enrolled'
    and enrollment.roster_active;

  return pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'studentId', v_student_id,
    'batchId', v_batch_id,
    'enrollmentIds', v_enrollment_ids,
    'changed', v_changed
  );
end;
$$;

alter function dashboard_private.finalize_registration_track_enrollments_v1(
  uuid, uuid
) owner to postgres;
revoke all on function dashboard_private.finalize_registration_track_enrollments_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function dashboard_private.set_registration_workflow_status_v1_impl(
  p_track_id uuid,
  p_workflow_status text,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_workflow_status text := nullif(pg_catalog.btrim(p_workflow_status), '');
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_status_changed boolean;
  v_previous_workflow_status text;
  v_finalization jsonb := null;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_expected_workflow_revision is null or p_expected_workflow_revision < 1 then
    raise exception 'registration_workflow_revision_invalid' using errcode = '22023';
  end if;
  if v_workflow_status in (
    'observation_requested',
    'observation_feedback_pending',
    'observation_completed'
  ) then
    raise exception 'registration_observation_transition_requires_action'
      using errcode = '55000';
  end if;
  if v_workflow_status not in (
    'inquiry',
    'level_test_requested',
    'consultation_requested',
    'consultation_completed',
    'waiting_current_class',
    'waiting_new_class',
    'waiting_next_opening',
    'enrollment_requested',
    'payment_in_progress',
    'registered',
    'not_registered',
    'inquiry_only'
  ) then
    raise exception 'registration_workflow_status_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;

  perform dashboard_private.assert_registration_workflow_status_access(
    v_track.id,
    v_workflow_status
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_workflow_status,
    'expectedWorkflowRevision', p_expected_workflow_revision
  );
  select
    mutation.response_payload,
    mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  if v_track.workflow_status in (
    'observation_requested',
    'observation_feedback_pending',
    'observation_completed'
  ) or exists (
    select 1
    from public.ops_registration_observations observation
    where observation.track_id = v_track.id
      and observation.decision_kind is null
      and observation.status in (
        'scheduled', 'attended_feedback_pending', 'completed', 'no_show'
      )
  ) then
    raise exception 'registration_observation_transition_requires_action'
      using errcode = '55000';
  end if;

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_workflow_status_refresh_required' using errcode = '23514';
  end if;

  if v_workflow_status = 'registered' then
    v_finalization := dashboard_private.finalize_registration_track_enrollments_v1(
      v_track.id,
      v_actor_id
    );
  end if;

  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;
  if v_status_changed then
    v_previous_workflow_status := v_track.workflow_status;
    update public.ops_registration_subject_tracks track
    set
      workflow_status = v_workflow_status,
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_workflow_status_changed',
      v_previous_workflow_status,
      v_workflow_status,
      'manual_status_change',
      pg_catalog.jsonb_build_object(
        'workflowStatus', v_workflow_status,
        'workflowRevision', v_track.workflow_revision,
        'enrollmentFinalization', v_finalization
      ),
      'user',
      null
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_track.workflow_status,
    'workflowRevision', v_track.workflow_revision,
    'workflowStatusEnteredAt', v_track.workflow_status_entered_at,
    'enrollmentFinalization', v_finalization
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'set_workflow_status',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) owner to postgres;
revoke all on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) to authenticated;

comment on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) is 'Sets manual workflow status; registered atomically finalizes canonical enrollment and roster projections.';

-- Repair only fully proven legacy claims that were already manually marked
-- registered. Ambiguous identity, half-projected roster, closed class, invalid
-- schedule, or duplicate-claim rows are deliberately left untouched.
do $registration_workflow_registered_backfill$
declare
  v_track_id uuid;
  v_returned_sqlstate text;
  v_message_text text;
  v_finalized_count integer := 0;
  v_skipped_count integer := 0;
begin
  for v_track_id in
    select track.id
    from public.ops_registration_subject_tracks track
    join public.ops_tasks task
      on task.id = track.task_id
      and task.type = 'registration'
    join public.ops_registration_details detail
      on detail.task_id = task.id
    where track.workflow_status = 'registered'
      and track.pipeline_status = 'enrollment_processing'
      and task.student_id is not null
      and exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = track.id
          and enrollment.status = 'planned'
          and enrollment.roster_active
          and enrollment.student_id = task.student_id
          and enrollment.admission_batch_id is not null
      )
      and not exists (
        select 1
        from public.ops_registration_enrollments enrollment
        left join public.ops_registration_admission_batches batch
          on batch.id = enrollment.admission_batch_id
        left join public.classes class
          on class.id = enrollment.class_id
        left join public.students student
          on student.id = enrollment.student_id
        where enrollment.track_id = track.id
          and enrollment.status = 'planned'
          and (
            not enrollment.roster_active
            or enrollment.student_id is distinct from task.student_id
            or enrollment.admission_batch_id is null
            or batch.task_id is distinct from task.id
            or batch.status = 'canceled'
            or class.id is null
            or pg_catalog.btrim(class.subject) is distinct from track.subject
            or class.status = '종강'
            or class.closed_at is not null
            or enrollment.class_start_date is null
            or nullif(pg_catalog.btrim(enrollment.class_start_session_key), '') is null
            or nullif(pg_catalog.btrim(enrollment.class_start_session), '') is null
            or enrollment.class_start_lesson_session_id is null
            or student.id is null
            or coalesce(student.class_ids, '[]'::jsonb) ? enrollment.class_id::text
            or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? enrollment.class_id::text
            or coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? enrollment.student_id::text
            or coalesce(pg_catalog.to_jsonb(class.waitlist_ids), '[]'::jsonb) ? enrollment.student_id::text
            or (
              enrollment.textbook_id is not null
              and not (
                exists (
                  select 1
                  from public.textbooks textbook
                  where textbook.id = enrollment.textbook_id
                )
                and pg_catalog.jsonb_typeof(
                  coalesce(pg_catalog.to_jsonb(class.textbook_ids), '[]'::jsonb)
                ) = 'array'
                and coalesce(
                  pg_catalog.to_jsonb(class.textbook_ids), '[]'::jsonb
                ) ? enrollment.textbook_id::text
              )
            )
            or not exists (
              select 1
              from public.class_lesson_sessions lesson
              where lesson.id = enrollment.class_start_lesson_session_id
                and lesson.class_id = enrollment.class_id
                and lesson.end_time is not null
                and (
                  select pg_catalog.count(*)
                  from public.profiles profile
                  where profile.teacher_catalog_id = lesson.teacher_catalog_id
                    and profile.role = 'teacher'
                ) = 1
            )
            or exists (
              select 1
              from public.ops_registration_enrollments other
              where other.student_id = enrollment.student_id
                and other.class_id = enrollment.class_id
                and other.roster_active
                and other.id <> enrollment.id
            )
          )
      )
      and not exists (
        select 1
        from public.ops_registration_enrollments active_enrollment
        where active_enrollment.track_id = track.id
          and active_enrollment.roster_active
          and active_enrollment.status <> 'planned'
      )
      and 1 = (
        select pg_catalog.count(distinct planned_enrollment.admission_batch_id)
        from public.ops_registration_enrollments planned_enrollment
        where planned_enrollment.track_id = track.id
          and planned_enrollment.status = 'planned'
      )
    order by track.task_id, track.id
  loop
    begin
      perform dashboard_private.finalize_registration_track_enrollments_v1(
        v_track_id,
        null
      );
      v_finalized_count := v_finalized_count + 1;
    exception
      when data_exception
        or integrity_constraint_violation
        or no_data_found
      then
        get stacked diagnostics
          v_returned_sqlstate = returned_sqlstate,
          v_message_text = message_text;
        v_skipped_count := v_skipped_count + 1;
        raise warning using message = pg_catalog.format(
          'registration_workflow_registered_backfill_skipped track_id=%s sqlstate=%s message=%s',
          v_track_id::text,
          v_returned_sqlstate,
          v_message_text
        );
    end;
  end loop;
  raise notice using message = pg_catalog.format(
    'registration_workflow_registered_backfill_complete finalized=%s skipped=%s',
    v_finalized_count,
    v_skipped_count
  );
end;
$registration_workflow_registered_backfill$;

-- A planned admission claim reserves capacity but is not a completed roster.
-- Hide it from both management projections until the registered finalizer has
-- committed enrollment status and both reciprocal arrays.
do $registration_management_roster_projection_patch$
declare
  v_page_definition text;
  v_relation_definition text;
  v_updated_definition text;
  v_old_count_predicate text :=
    'where enrollment.class_id=filtered.id and enrollment.roster_active';
  v_new_count_predicate text :=
    'where enrollment.class_id=filtered.id and enrollment.status=''enrolled'' and enrollment.roster_active';
  v_old_student_status text :=
    'case when enrollment.roster_active then ''enrolled'' else ''waitlisted'' end status,';
  v_new_student_status text :=
    'case when enrollment.status=''enrolled'' and enrollment.roster_active then ''enrolled'' else ''waitlisted'' end status,';
  v_old_student_predicate text :=
    'and (enrollment.roster_active or enrollment.status in (''enrolled'',''waitlist'',''waitlisted''))';
  v_new_student_predicate text :=
    'and ((enrollment.status=''enrolled'' and enrollment.roster_active) or enrollment.status in (''waitlist'',''waitlisted''))';
  v_page_owner oid;
  v_page_acl aclitem[];
  v_relation_owner oid;
  v_relation_acl aclitem[];
  v_current_owner oid;
  v_current_acl aclitem[];
begin
  select procedure.proowner, procedure.proacl
  into v_page_owner, v_page_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::pg_catalog.regprocedure;
  select procedure.proowner, procedure.proacl
  into v_relation_owner, v_relation_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::pg_catalog.regprocedure;

  v_page_definition := pg_catalog.pg_get_functiondef(
    'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::pg_catalog.regprocedure
  );
  if (
    pg_catalog.char_length(v_page_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_page_definition, v_old_count_predicate, ''))
  ) <> pg_catalog.char_length(v_old_count_predicate) then
    raise exception 'registration_management_count_patch_target_missing'
      using errcode = '55000';
  end if;
  v_updated_definition := pg_catalog.replace(
    v_page_definition,
    v_old_count_predicate,
    v_new_count_predicate
  );
  execute v_updated_definition;

  v_relation_definition := pg_catalog.pg_get_functiondef(
    'public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::pg_catalog.regprocedure
  );
  if (
    pg_catalog.char_length(v_relation_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_relation_definition, v_old_student_status, ''))
  ) <> pg_catalog.char_length(v_old_student_status)
    or (
      pg_catalog.char_length(v_relation_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_relation_definition, v_old_student_predicate, ''))
    ) <> pg_catalog.char_length(v_old_student_predicate)
  then
    raise exception 'registration_management_student_patch_target_missing'
      using errcode = '55000';
  end if;
  v_updated_definition := pg_catalog.replace(
    pg_catalog.replace(
      v_relation_definition,
      v_old_student_status,
      v_new_student_status
    ),
    v_old_student_predicate,
    v_new_student_predicate
  );
  execute v_updated_definition;

  select procedure.proowner, procedure.proacl
  into v_current_owner, v_current_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::pg_catalog.regprocedure;
  if v_current_owner is distinct from v_page_owner or v_current_acl is distinct from v_page_acl then
    raise exception 'registration_management_roster_patch_metadata_changed'
      using errcode = '55000';
  end if;

  select procedure.proowner, procedure.proacl
  into v_current_owner, v_current_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::pg_catalog.regprocedure;
  if v_current_owner is distinct from v_relation_owner or v_current_acl is distinct from v_relation_acl then
    raise exception 'registration_management_roster_patch_metadata_changed'
      using errcode = '55000';
  end if;
end;
$registration_management_roster_projection_patch$;

commit;
