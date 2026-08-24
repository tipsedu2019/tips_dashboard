begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $registration_admission_order_patch$
declare
  v_start_definition text;
  v_start_updated_definition text;
  v_start_old_fragment text;
  v_start_new_fragment text;
  v_start_pipeline_status_old_fragment text;
  v_start_pipeline_status_new_fragment text;
  v_start_pipeline_status_occurrences integer;
  v_start_pipeline_status_forbidden_predicate text :=
    'track.pipeline_status not in (''enrollment_decided'', ''registered'')';
  v_retryable_errcode_fragment text :=
    'using errcode = ' || pg_catalog.quote_literal('40' || '001');
  v_nonretryable_errcode_fragment text :=
    'using errcode = ' || pg_catalog.quote_literal('23514');
  v_start_manual_conflict_count integer := 7;
  v_start_owner oid;
  v_start_acl aclitem[];
  v_identity_definition text;
  v_identity_updated_definition text;
  v_identity_old_fragment text;
  v_identity_new_fragment text;
  v_identity_manual_conflict_count integer := 3;
  v_identity_owner oid;
  v_identity_acl aclitem[];
  v_current_owner oid;
  v_current_acl aclitem[];
begin
  select procedure.proowner, procedure.proacl
  into v_start_owner, v_start_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure;

  select procedure.proowner, procedure.proacl
  into v_identity_owner, v_identity_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure;

  v_start_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
  );
  v_start_old_fragment := $old$if v_detail.admission_notice_sent is not true then
    raise exception 'registration_admission_notice_required' using errcode = '$old$
    || '40'
    || '001'
    || $old$';
  end if;$old$;
  v_start_new_fragment := $new$-- Admission batch creation is independent from optional admission-form delivery.$new$;

  if (
    pg_catalog.char_length(v_start_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(v_start_definition, v_start_old_fragment, '')
      )
  ) <> pg_catalog.char_length(v_start_old_fragment) then
    raise exception 'registration_admission_batch_notice_gate_patch_target_missing'
      using errcode = '55000';
  end if;

  v_start_updated_definition := pg_catalog.replace(
    v_start_definition,
    v_start_old_fragment,
    v_start_new_fragment
  );
  execute v_start_updated_definition;

  v_start_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
  );
  v_start_pipeline_status_old_fragment := $old$if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.pipeline_status not in ('enrollment_decided', 'registered')
  ) then
    raise exception 'registration_invalid_source_state' using errcode = '$old$
    || '40'
    || '001'
    || $old$';
  end if;$old$;
  v_start_pipeline_status_new_fragment :=
    $new$-- Manual workflow state is independent. The selected canonical planned rows
  -- below are the admission batch integrity boundary.$new$;
  v_start_pipeline_status_occurrences := (
    pg_catalog.char_length(v_start_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(v_start_definition, v_start_pipeline_status_old_fragment, '')
      )
  ) / pg_catalog.char_length(v_start_pipeline_status_old_fragment);
  if v_start_pipeline_status_occurrences not in (0, 1) then
    raise exception 'registration_admission_batch_pipeline_status_patch_target_drift'
      using errcode = '55000';
  end if;
  if v_start_pipeline_status_occurrences = 1 then
    v_start_updated_definition := pg_catalog.replace(
      v_start_definition,
      v_start_pipeline_status_old_fragment,
      v_start_pipeline_status_new_fragment
    );
    execute v_start_updated_definition;
  end if;

  v_start_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
  );
  if v_start_definition like '%registration_invalid_source_state%'
    or v_start_definition like '%' || v_start_pipeline_status_forbidden_predicate || '%'
  then
    raise exception 'registration_admission_batch_pipeline_status_patch_target_drift'
      using errcode = '55000';
  end if;

  v_start_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
  );
  if (
    pg_catalog.char_length(v_start_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(v_start_definition, v_retryable_errcode_fragment, '')
      )
  ) <> pg_catalog.char_length(v_retryable_errcode_fragment) * v_start_manual_conflict_count then
    raise exception 'registration_admission_batch_conflict_patch_target_drift'
      using errcode = '55000';
  end if;
  v_start_updated_definition := pg_catalog.replace(
    v_start_definition,
    v_retryable_errcode_fragment,
    v_nonretryable_errcode_fragment
  );
  execute v_start_updated_definition;

  v_identity_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
  );
  v_identity_old_fragment := $old$v_identity_frozen :=
    v_detail.admission_notice_sent
    or exists ($old$;
  v_identity_new_fragment := $new$v_identity_frozen :=
    exists ($new$;

  if (
    pg_catalog.char_length(v_identity_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(v_identity_definition, v_identity_old_fragment, '')
      )
  ) <> pg_catalog.char_length(v_identity_old_fragment) then
    raise exception 'registration_identity_notice_gate_patch_target_missing'
      using errcode = '55000';
  end if;

  v_identity_updated_definition := pg_catalog.replace(
    v_identity_definition,
    v_identity_old_fragment,
    v_identity_new_fragment
  );
  execute v_identity_updated_definition;

  v_identity_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
  );
  if (
    pg_catalog.char_length(v_identity_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(v_identity_definition, v_retryable_errcode_fragment, '')
      )
  ) <> pg_catalog.char_length(v_retryable_errcode_fragment) * v_identity_manual_conflict_count then
    raise exception 'registration_identity_conflict_patch_target_drift'
      using errcode = '55000';
  end if;
  v_identity_updated_definition := pg_catalog.replace(
    v_identity_definition,
    v_retryable_errcode_fragment,
    v_nonretryable_errcode_fragment
  );
  execute v_identity_updated_definition;

  select procedure.proowner, procedure.proacl
  into v_current_owner, v_current_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure;
  if v_current_owner is distinct from v_start_owner
    or v_current_acl is distinct from v_start_acl
  then
    raise exception 'registration_admission_order_patch_metadata_changed'
      using errcode = '55000';
  end if;

  select procedure.proowner, procedure.proacl
  into v_current_owner, v_current_acl
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure;
  if v_current_owner is distinct from v_identity_owner
    or v_current_acl is distinct from v_identity_acl
  then
    raise exception 'registration_admission_order_patch_metadata_changed'
      using errcode = '55000';
  end if;
end;
$registration_admission_order_patch$;

commit;
