begin transaction read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

with expected_functions(
  function_key,
  function_name,
  is_private,
  authenticated_execute_required,
  reject_40001
) as (
  values
    (
      'workflow_public',
      'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text,
      false,
      true,
      true
    ),
    (
      'workflow_private',
      'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'admission_batch_private',
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::text,
      true,
      true,
      true
    ),
    (
      'case_common_private',
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::text,
      true,
      false,
      true
    ),
    (
      'checklist_public',
      'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)'::text,
      false,
      true,
      true
    ),
    (
      'checklist_private',
      'dashboard_private.set_registration_admission_checklist_item_v1_impl(uuid,text,boolean,text)'::text,
      true,
      true,
      true
    ),
    (
      'enrollment_finalizer_private',
      'dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'roster_projection_private',
      'dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'first_consultation_private',
      'dashboard_private.create_registration_first_consultation_task_v1()'::text,
      true,
      false,
      true
    )
),
functions as (
  select
    expected_functions.function_key,
    expected_functions.function_name,
    expected_functions.is_private,
    expected_functions.authenticated_execute_required,
    expected_functions.reject_40001,
    procedure.oid,
    procedure.prosecdef,
    procedure.proowner,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.pg_get_functiondef(procedure.oid) as definition
  from expected_functions
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(expected_functions.function_name)
)
select (
  (select count(*) from functions where oid is not null) = 9
  and not exists (
    select 1
    from functions
    where oid is null
      or pg_catalog.pg_get_userbyid(proowner) <> 'postgres'
      or (
        pg_catalog.cardinality(proconfig) = 1
        and proconfig[1] in ('search_path=', 'search_path=""')
      ) is distinct from true
      or (is_private and not prosecdef)
      or (not is_private and prosecdef)
      or (reject_40001 and definition like '%40001%')
      or (function_key = 'workflow_public' and definition not like '%dashboard_private.set_registration_workflow_status_v1_impl%')
      or (function_key = 'workflow_private' and (
        definition not like '%registration_workflow_status_refresh_required%'
        or definition not like '%23514%'
        or definition not like '%dashboard_private.finalize_registration_track_enrollments_v1%'
        or definition not like '%enrollmentFinalization%'
      ))
      or (function_key = 'admission_batch_private' and (
        definition like '%registration_admission_notice_required%'
        or definition like '%v_detail.admission_notice_sent%'
        or definition like '%registration_invalid_source_state%'
        or definition not like '%registration_admission_batch_already_open%'
        or definition not like '%registration_admission_batch_already_open'' using errcode = ''23514''%'
        or definition not like '%idempotency_key_reused%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%' || 'for ' || 'up' || 'date of enrollment;' || '%'
      ))
      or (function_key = 'case_common_private' and (
        definition like '%v_detail.admission_notice_sent%'
        or definition not like '%idempotency_key_reused%'
        or definition not like '%registration_common_revision_conflict'' using errcode = ''23514''%'
        or definition not like '%registration_student_identity_correction_required'' using errcode = ''23514''%'
        or definition not like '%message.claim_active%'
        or definition not like '%ops_registration_admission_batches%'
        or definition not like '%enrollment.status = ''planned''%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%' || 'for ' || 'up' || 'date of enrollment;' || '%'
      ))
      or (function_key = 'checklist_public' and (
        definition not like '%dashboard_private.set_registration_admission_checklist_item_v1_impl%'
      ))
      or (function_key = 'checklist_private' and (
        definition not like '%registration_admission_checklist_item_invalid%'
        or definition not like '%applicationSent%'
        or definition not like '%makeeduRegistered%'
        or definition not like '%invoiceSent%'
        or definition not like '%paymentConfirmed%'
        or definition not like '%registrationCompleted%'
        or definition not like '%idempotency_key_reused%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%pg_catalog.jsonb_set%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_tasks')
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
      ))
      or (function_key = 'enrollment_finalizer_private' and (
        definition not like '%registration_enrollment_pipeline_invalid%'
        or definition not like '%registration_enrollment_pipeline_invalid'' using errcode = ''23514''%'
        or definition not like '%dashboard_private.apply_student_class_roster_mode%'
        or definition not like '%status = ''enrolled''%'
        or definition not like '%roster_active = true%'
        or definition not like '%registration_roster_projection_invalid%'
        or definition not like '%v_unbatched_count%'
        or definition not like '%v_batch_count > 1 or (v_batch_count = 1 and v_unbatched_count > 0)%'
        or definition not like '%Status-driven registration owns a dedicated compatibility batch%'
        or definition like '%batch.status not in (''completed'', ''canceled'')%'
        or definition like '%admission_checklist%'
      ))
      or (function_key = 'roster_projection_private' and (
        definition not like '%23514%'
      ))
      or (function_key = 'first_consultation_private' and (
        definition not like '%registration_observation_effective_legacy_slots_v1%'
        or definition not like '%schedule_storage_mode in (''legacy'', ''shadow'')%'
        or definition not like '%registration_first_consultation_assignee_required%'
      ))
  )
  and not exists (
    select 1
    from functions
    where not (
      select
        count(*) = 1 + authenticated_execute_required::integer
        and count(*) filter (
          where (
            (
              case
                when acl.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl.grantee)::text
              end
            ) = 'postgres'
            or (
              authenticated_execute_required
              and (
                case
                  when acl.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl.grantee)::text
                end
              ) = 'authenticated'
            )
          )
          and pg_catalog.pg_get_userbyid(acl.grantor)::text = 'postgres'
          and acl.privilege_type = 'EXECUTE'
          and not acl.is_grantable
        ) = 1 + authenticated_execute_required::integer
      from pg_catalog.aclexplode(
        coalesce(proacl, pg_catalog.acldefault('f', proowner))
      ) acl
    )
  )
  and not exists (
    select 1
    from functions
    cross join (
      values ('public'::name), ('anon'::name), ('service_role'::name)
    ) denied_role(role_name)
    where pg_catalog.has_function_privilege(denied_role.role_name, oid, 'EXECUTE')
  )
  and exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.ops_registration_details'::pg_catalog.regclass
      and trigger.tgname = 'prevent_registration_compatibility_override'
      and not trigger.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger.oid) like
        '%' || 'BEFORE ' || 'UP' || 'DATE OF pipeline_status, counselor, makeedu_registered, makeedu_invoice_sent, payment_checked%'
      and pg_catalog.pg_get_triggerdef(trigger.oid) not like '%admission_checklist%'
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
        'dashboard_private.registration_first_consultation_task_links'::pg_catalog.regclass
      and attribute.attname = 'class_lesson_session_id'
      and not attribute.attisdropped
      and not attribute.attnotnull
  )
) as contract_ok;
rollback;
