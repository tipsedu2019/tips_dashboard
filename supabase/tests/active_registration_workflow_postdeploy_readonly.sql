begin transaction read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

with expected_functions(
  function_key,
  function_name,
  security_definer_required,
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
    ),
    (
      'observation_enter_public',
      'public.enter_registration_observation_v1(uuid,integer,text)'::text,
      false,
      true,
      true
    ),
    (
      'observation_enter_private',
      'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'notification_v1_retired_public',
      'public.ensure_registration_workflow_notification_v1(uuid,integer)'::text,
      false,
      false,
      true
    ),
    (
      'feedback_submit_public',
      'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)'::text,
      false,
      false,
      true
    ),
    (
      'feedback_submit_private',
      'dashboard_private.submit_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,integer,text)'::text,
      false,
      false,
      true
    ),
    (
      'feedback_correct_public',
      'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)'::text,
      false,
      false,
      true
    ),
    (
      'feedback_correct_private',
      'dashboard_private.correct_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,text,text)'::text,
      false,
      false,
      true
    ),
    (
      'case_common_compat_private',
      'dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'case_unified_private',
      'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)'::text,
      true,
      true,
      true
    ),
    (
      'subject_sync_private',
      'dashboard_private.sync_registration_case_subjects_impl(uuid,text[],text)'::text,
      true,
      true,
      true
    ),
    (
      'notification_record_private',
      'dashboard_private.record_registration_management_notification_v1(uuid,text,uuid,uuid,bigint,timestamp with time zone,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'case_create_private',
      'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'case_create_public',
      'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::text,
      false,
      true,
      true
    ),
    (
      'case_create_legacy_public',
      'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::text,
      false,
      true,
      true
    ),
    (
      'collaboration_guard_private',
      'dashboard_private.enforce_registration_collaboration_write_role_v1()'::text,
      true,
      false,
      true
    ),
    (
      'notification_explicit_v2_public',
      'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'notification_event_key_v2_private',
      'dashboard_private.registration_management_notification_event_key_v2(text)'::text,
      true,
      false,
      true
    ),
    (
      'notification_snapshot_v2_private',
      'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'notification_checksum_v2_private',
      'dashboard_private.registration_management_notification_fact_checksum_v2(jsonb)'::text,
      true,
      false,
      true
    ),
    (
      'notification_source_current_v2_private',
      'dashboard_private.registration_management_notification_source_current_v2(uuid,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'notification_suppress_v2_private',
      'dashboard_private.suppress_registration_management_notification_source_v2(text,text)'::text,
      true,
      false,
      true
    ),
    (
      'manager_actor_private',
      'dashboard_private.registration_actor_is_active_manager_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'manager_actor_assert_private',
      'dashboard_private.assert_registration_actor_is_active_manager_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'manager_replay_assert_private',
      'dashboard_private.assert_registration_task_replay_access_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'manager_write_fence_private',
      'dashboard_private.enforce_registration_manager_write_fence_v1()'::text,
      true,
      false,
      true
    ),
    (
      'appointment_integrity_private',
      'dashboard_private.assert_registration_appointment_integrity_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'appointment_integrity_track_private',
      'dashboard_private.assert_registration_appointment_integrity_from_track_v1()'::text,
      true,
      false,
      true
    ),
    (
      'archive_active_subject_private',
      'dashboard_private.registration_appointment_has_active_subject_v1(uuid,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'appointment_details_private',
      'dashboard_private.save_registration_appointment_details_impl(uuid,uuid,text,timestamp with time zone,text,uuid[],integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'appointment_cancel_private',
      'dashboard_private.cancel_registration_appointment_impl(uuid,integer,text,text)'::text,
      true,
      false,
      true
    ),
    (
      'appointment_cancel_compat_private',
      'dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(uuid,integer,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'phone_consultation_private',
      'dashboard_private.save_registration_phone_consultation_v1_impl(uuid,text)'::text,
      true,
      true,
      true
    ),
    (
      'waiting_details_private',
      'dashboard_private.save_registration_waiting_details_v2_impl(uuid,text,uuid,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'consultation_details_private',
      'dashboard_private.save_registration_consultation_details_impl(uuid,text,text,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'consultation_result_public',
      'public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'director_assignment_private',
      'dashboard_private.assign_registration_track_director_impl(uuid,uuid,text,text,integer,text)'::text,
      true,
      false,
      true
    ),
    (
      'director_assignment_compat_private',
      'dashboard_private.assign_registration_track_director_with_reminders_v1_impl(uuid,uuid,text,text,integer,text)'::text,
      true,
      true,
      true
    ),
    (
      'enrollment_details_private',
      'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)'::text,
      true,
      true,
      true
    ),
    (
      'enrollment_details_base_private',
      'dashboard_private.save_registration_enrollment_details_impl_base(uuid,jsonb,text)'::text,
      true,
      false,
      true
    ),
    (
      'enrollment_rows_canonical_private',
      'dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'enrollment_observation_reference_private',
      'dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'appointment_parent_reconcile_private',
      'dashboard_private.reconcile_registration_appointment_parent_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'level_test_result_private',
      'dashboard_private.save_registration_level_test_result_impl(uuid,text,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'visit_event_v2_private',
      'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)'::text,
      true,
      false,
      true
    ),
    (
      'visit_event_v2_base_private',
      'dashboard_private.write_registration_track_event_v2_base(uuid,uuid,text,text,text,text,jsonb,text,text)'::text,
      true,
      false,
      true
    ),
    (
      'visit_notification_snapshot_private',
      'dashboard_private.registration_visit_notification_fact_snapshot_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'visit_notification_source_current_private',
      'dashboard_private.registration_visit_notification_source_current_v1(uuid)'::text,
      true,
      false,
      true
    ),
    (
      'visit_notification_ensure_public',
      'public.ensure_registration_visit_notification_v1(uuid,integer,text,text)'::text,
      true,
      true,
      true
    ),
    (
      'visit_notification_plan_base_public',
      'public.get_registration_visit_legacy_dispatch_plan_v1_base(uuid,uuid)'::text,
      true,
      false,
      true
    ),
    (
      'visit_notification_plan_public',
      'public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid)'::text,
      true,
      true,
      true
    )
),
functions as (
  select
    expected_functions.function_key,
    expected_functions.function_name,
    expected_functions.security_definer_required,
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
  (select count(*) from functions where oid is not null) = 59
  and not exists (
    select 1
    from functions
    where oid is null
      or pg_catalog.pg_get_userbyid(proowner) <> 'postgres'
      or (
        pg_catalog.cardinality(proconfig) = 1
        and proconfig[1] in ('search_path=', 'search_path=""')
      ) is distinct from true
      or (security_definer_required and not prosecdef)
      or (not security_definer_required and prosecdef)
      or (reject_40001 and definition like '%40001%')
      or (function_key = 'workflow_public' and definition not like '%dashboard_private.set_registration_workflow_status_v1_impl%')
      or (function_key = 'workflow_private' and (
        definition not like '%registration_workflow_status_refresh_required%'
        or definition not like '%23514%'
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
        or definition not like '%workflow_status = v_workflow_status%'
        or definition not like '%workflow_revision = track.workflow_revision + 1%'
        or definition not like '%dashboard_private.write_registration_track_event_v2%'
        or definition not like '%registration_workflow_status_changed%'
        or definition not like '%''enrollmentFinalization'', null%'
        or definition like '%dashboard_private.finalize_registration_track_enrollments_v1%'
        or definition like '%dashboard_private.apply_student_class_roster_mode%'
        or definition like '%dashboard_private.record_registration_management_notification_v1%'
        or definition like '%ensure_registration_workflow_notification_v1%'
        or definition like '%registration_observation_%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_tasks')
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_(details|enrollments)')
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
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%dashboard_private.assert_registration_mutation_access%'
        or definition not like '%coalesce(''등록: '' || v_student_name, ''등록'')%'
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_tasks')
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_details')
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
        or definition like '%registration_student_identity_correction_required%'
        or definition like '%message.claim_active%'
        or definition like '%ops_registration_admission_batches%'
        or definition like '%ops_registration_enrollments%'
        or definition like '%enrollment.status = ''planned''%'
        or definition like '%assert_registration_reminder_runtime_v1%'
        or definition like '%notification_control_plane%'
        or definition like '%cancel_registration_appointment_reminders_v1%'
        or definition like '%materialize_registration_appointment_reminders_v1%'
        or definition like '%recompute_registration_parent%'
        or definition like '%registration_student_name_required%'
        or definition like '%registration_school_grade_required%'
        or definition like '%registration_parent_phone_required%'
        or definition like '%registration_parent_phone_invalid%'
        or definition like '%registration_inquiry_at_required%'
        or definition like '%assert_registration_subject_enabled%'
        or definition like '%registration_science_grade_invalid%'
        or definition like '%workflow_status%'
      ))
      or (function_key = 'case_common_compat_private' and (
        definition not like '%dashboard_private.update_registration_case_common_impl%'
        or definition not like '%''notificationJobs''%''[]''::jsonb%'
        or definition like '%assert_registration_reminder_runtime_v1%'
        or definition like '%notification_control_plane%'
        or definition like '%cancel_registration_appointment_reminders_v1%'
        or definition like '%materialize_registration_appointment_reminders_v1%'
        or definition like '%record_notification_event_v1%'
        or definition like '%ops_registration_appointments%'
        or definition like '%ops_registration_admission_batches%'
        or definition like '%ops_registration_enrollments%'
        or definition like '%recompute_registration_parent%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_(tasks|registration_details|registration_subject_tracks|registration_appointments)')
      ))
      or (function_key = 'case_unified_private' and (
        definition not like '%dashboard_private.update_registration_case_common_with_reminders_v1_impl%'
        or definition not like '%dashboard_private.sync_registration_case_subjects_impl%'
        or definition not like '%registration_common_revision_conflict'' using errcode = ''23514''%'
        or definition not like '%registration_subjects_conflict'' using errcode = ''23514''%'
        or definition not like '%idempotency_key_reused%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%track.archived_at is null%'
        or definition like '%registration_subject_removal_blocked%'
        or definition like '%assert_registration_reminder_runtime_v1%'
        or definition like '%notification_control_plane%'
        or definition like '%assert_registration_subject_enabled%'
        or definition like '%registration_science_grade_invalid%'
        or definition like '%recompute_registration_parent%'
        or definition like '%ops_registration_admission_batches%'
        or definition like '%ops_registration_enrollments%'
        or definition ~* ('de' || 'lete[[:space:]]+from[[:space:]]+public[.]ops_registration_subject_tracks')
      ))
      or (function_key = 'subject_sync_private' and (
        definition not like '%dashboard_private.assert_registration_mutation_access%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%idempotency_key_reused'' using errcode = ''22023''%'
        or definition not like '%pg_catalog.cardinality(v_subjects) not between 0 and 3%'
        or definition not like '%archived_at = pg_catalog.now()%'
        or definition not like '%archived_by = v_actor_id%'
        or definition not like '%archived_at = null%'
        or definition not like '%registration_subject_archived%'
        or definition not like '%registration_subject_restored%'
        or definition not like '%registration_subjects_synced%'
        or definition not like '%registration_subject_track_coverage_mismatch%using errcode = ''23514''%'
        or definition like '%registration_subject_removal_blocked%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%record_registration_management_notification_v1%'
        or definition like '%ops_registration_admission_batches%'
        or definition like '%ops_registration_enrollments%'
        or definition ~* ('de' || 'lete[[:space:]]+from[[:space:]]+public[.]ops_registration_subject_tracks')
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
      or (function_key = 'observation_enter_public' and (
        definition not like '%dashboard_private.enter_registration_observation_v1_impl%'
      ))
      or (function_key = 'observation_enter_private' and (
        definition not like '%dashboard_private.registration_observation_response_v1%'
        or definition not like '%null, null, false%'
        or definition like '%registration_observation_stale_revision%'
        or definition like '%dashboard_private.write_registration_track_event_v2%'
        or definition like '%public.ops_registration_observations%'
        or definition like '%v_track.workflow_revision <> p_expected_workflow_revision%'
        or definition like '%v_track.workflow_status <>%'
        or definition like '%set_registration_workflow_status%'
        or definition like '%transition_registration_track_status%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
      ))
      or (function_key = 'notification_v1_retired_public' and (
        definition not like '%registration_workflow_notification_v1_retired%'
        or definition not like '%55000%'
        or definition like '%registration_management_notification_requested%'
        or definition like '%dashboard_private.record_registration_management_notification_v1%'
        or definition like '%dashboard_private.notification_request_ledger%'
      ))
      or (function_key = 'notification_explicit_v2_public' and (
        definition not like '%dashboard_private.registration_actor_is_active_manager_v1%'
        or definition not like '%p_intent is distinct from ''send_registration_management_notification''%'
        or definition not like '%dashboard_private.try_registration_event_uuid(v_request_key)%'
        or definition not like '%registration_management_notification_intent_invalid%using errcode = ''22023''%'
        or definition not like '%registration_management_notification_refresh_required%using errcode = ''23514''%'
        or definition not like '%registration_management_notification_not_ready%using errcode = ''23514''%'
        or definition not like '%dashboard_private.registration_management_notification_fact_snapshot_v2(%v_track.id,%v_actor%'
        or definition not like '%dashboard_private.registration_management_notification_fact_checksum_v2%'
        or definition not like '%dashboard_private.notification_request_ledger%'
        or definition not like '%ledger.request_id = v_request_id%'
        or definition not like '%registration_management_notification_v2%'
        or definition not like '%v_request_fingerprint := pg_catalog.md5%'
        or definition not like '%''actorProfileId'', v_actor%'
        or definition not like '%''trackId'', v_track.id%'
        or definition not like '%''workflowRevision'', v_track.workflow_revision%'
        or definition not like '%''eventKey'', v_event_key%'
        or definition not like '%''intent'', p_intent%'
        or definition not like '%v_ledger.request_fingerprint <> v_request_fingerprint%'
        or definition not like '%idempotency_key_reused%using errcode = ''22023''%'
        or definition not like '%dashboard_private.registration_management_notification_source_current_v2%'
        or definition not like '%dashboard_private.suppress_registration_management_notification_source_v2%'
        or definition not like '%registration_management_notification_snapshot_stale%'
        or definition not like '%registration-management-notification-v2:%'
        or definition not like '%with candidate_sources as materialized%'
        or definition not like '%source.task_id = v_track.task_id%'
        or definition not like '%source.field_name = ''registration_track:'' || v_track.id::text%'
        or definition not like '%''alreadyRequested'', v_already_requested%'
        or definition not like '%v_reusable_source := found%'
        or definition not like '%v_reusable_source := found%dashboard_private.registration_management_notification_source_current_v2%'
        or definition not like '%v_reusable_source then%dashboard_private.registration_management_notification_fact_snapshot_v2(%v_source.actor_id%'
        or definition not like '%else%v_source_event_id := dashboard_private.write_registration_track_event_v2%'
        or definition not like '%registration_management_notification_requested%'
        or definition not like '%manual_notification_v2%'
        or definition not like '%dashboard_private.record_registration_management_notification_v1%'
        or definition not like '%''sourceEventId'', v_source.id%'
        or definition not like '%''factsChecksum'', v_facts_checksum%'
        or definition not like '%''ready'', false%'
        or definition not like '%''sourceEventIds'', ''[]''::jsonb%'
        or definition like '%set_registration_workflow_status_v1%'
        or definition like '%finalize_registration_track_enrollments_v1%'
        or definition like '%registration_observation_%'
      ))
      or (function_key = 'notification_event_key_v2_private' and (
        definition not like '%''consultation_requested''%''registration.case_created''%'
        or definition not like '%''consultation_completed''%''registration.consultation_completed''%'
        or definition not like '%''waiting_current_class''%''registration.waiting_transitioned''%'
        or definition not like '%''enrollment_requested''%''registration.admission_started''%'
      ))
      or (function_key = 'notification_snapshot_v2_private' and (
        definition not like '%''taskId''%task.id%'
        or definition not like '%''trackId''%track.id%'
        or definition not like '%''studentName''%task.student_name%'
        or definition not like '%''taskStatus''%task.status%'
        or definition not like '%''requestedBy''%task.requested_by%'
        or definition not like '%''schoolGrade''%detail.school_grade%'
        or definition not like '%''inquiryAt''%detail.inquiry_at%'
        or definition not like '%''memo''%nullif(pg_catalog.btrim(coalesce(detail.request_note, '''')), '''')%'
        or definition not like '%''subject''%track.subject%'
        or definition not like '%''activeSubjects''%pg_catalog.array_agg(%'
        or definition not like '%dashboard_private.registration_subject_sort_order(%active_track.subject%'
        or definition not like '%active_track.id%active_track.archived_at is null%'
        or definition not like '%''pipelineStatus''%track.pipeline_status%'
        or definition not like '%''workflowStatus''%track.workflow_status%'
        or definition not like '%''workflowRevision''%track.workflow_revision%'
        or definition not like '%''currentStatus''%case track.workflow_status%'
        or definition not like '%''directorProfileId''%track.director_profile_id%'
        or definition not like '%''actorProfileId''%p_actor_profile_id%'
        or definition not like '%''actorDisplayName''%coalesce(%nullif(actor.name, '''')%nullif(actor.email, '''')%'
        or definition not like '%''actorKind''%when p_actor_profile_id is null then ''system''%'
        or definition not like '%''progressLine''%''[진행] 관리팀 확인을 기다리고 있어요.''%'
        or definition not like '%''memoLine''%''[메모] '' || pg_catalog.btrim(detail.request_note)%'
        or definition not like '%left join public.profiles actor%actor.id = p_actor_profile_id%'
        or definition not like '%''archivedAt''%track.archived_at%'
      ))
      or (function_key = 'notification_checksum_v2_private' and (
        definition not like '%dashboard_private.notification_sha256_hex_v1(p_snapshot::text)%'
      ))
      or (function_key = 'notification_source_current_v2_private' and (
        definition not like '%registration_management_notification_requested%'
        or definition not like '%''send_registration_management_notification''%'
        or definition not like '%v_metadata ->> ''contractVersion'' <> ''2''%'
        or definition not like '%v_request_id := dashboard_private.try_registration_event_uuid%'
        or definition not like '%v_metadata ->> ''factsChecksum'' !~ ''^[a-f0-9]{64}$''%'
        or definition not like '%p_expected_actor_profile_id is not null%'
        or definition not like '%dashboard_private.registration_actor_is_active_manager_v1%'
        or definition not like '%dashboard_private.registration_management_notification_fact_snapshot_v2(%v_track_id,%v_source.actor_id%'
        or definition not like '%v_snapshot ->> ''archivedAt'' is not null%'
        or definition not like '%v_metadata ->> ''workflowRevision''%v_snapshot ->> ''workflowRevision''%'
        or definition not like '%dashboard_private.registration_management_notification_fact_checksum_v2%'
        or definition not like '%from dashboard_private.notification_events canonical%'
        or definition not like '%canonical.source_id = v_source.id::text%'
        or definition not like '%v_canonical.source_revision%v_snapshot ->> ''workflowRevision''%'
        or definition not like '%v_canonical.actor_profile_id is distinct from v_source.actor_id%'
        or definition not like '%v_canonical.payload ->> ''task_id''%v_snapshot ->> ''taskId''%'
        or definition not like '%v_canonical.payload ->> ''track_id''%v_snapshot ->> ''trackId''%'
        or definition not like '%v_canonical.payload ->> ''student_name''%v_snapshot ->> ''studentName''%'
        or definition not like '%v_canonical.payload ->> ''grade''%v_snapshot ->> ''schoolGrade''%'
        or definition not like '%v_canonical.payload ->> ''subject''%v_snapshot ->> ''subject''%'
        or definition not like '%v_canonical.payload -> ''subjects''%v_snapshot -> ''activeSubjects''%'
        or definition not like '%v_canonical.payload ->> ''inquiry_at''%v_snapshot ->> ''inquiryAt''%'
        or definition not like '%v_canonical.payload ->> ''status''%v_snapshot ->> ''pipelineStatus''%'
        or definition not like '%v_canonical.payload ->> ''workflow_status''%v_snapshot ->> ''workflowStatus''%'
        or definition not like '%v_canonical.payload ->> ''current_status''%v_snapshot ->> ''currentStatus''%'
        or definition not like '%v_canonical.payload ->> ''requester_profile_id''%v_snapshot ->> ''requestedBy''%'
        or definition not like '%v_canonical.payload ->> ''director_profile_id''%v_snapshot ->> ''directorProfileId''%'
        or definition not like '%v_canonical.payload ->> ''memo''%v_snapshot ->> ''memo''%'
        or definition not like '%v_canonical.payload ->> ''actor_name''%v_snapshot ->> ''actorDisplayName''%'
        or definition not like '%v_canonical.payload ->> ''actor_kind''%v_snapshot ->> ''actorKind''%'
        or definition not like '%v_canonical.payload ->> ''progress_line''%v_snapshot ->> ''progressLine''%'
        or definition not like '%v_canonical.payload ->> ''memo_line''%v_snapshot ->> ''memoLine''%'
        or definition not like '%v_canonical.payload ->> ''source_event_id''%v_source.id::text%'
        or definition not like '%from dashboard_private.notification_request_ledger ledger%'
        or definition not like '%ledger.request_id = v_request_id%'
        or definition not like '%v_ledger.request_kind = ''registration_management_notification_v2''%'
        or definition not like '%v_ledger.request_fingerprint = pg_catalog.md5%'
        or definition not like '%v_ledger.response_payload ->> ''sourceEventId'' = v_source.id::text%'
        or definition not like '%v_ledger.response_payload ->> ''trackId'' = v_track_id::text%'
        or definition not like '%v_ledger.response_payload ->> ''workflowRevision''%v_snapshot ->> ''workflowRevision''%'
        or definition not like '%v_ledger.response_payload ->> ''eventKey'' = v_event_key%'
        or definition not like '%v_ledger.response_payload ->> ''intent''%''send_registration_management_notification''%'
        or definition not like '%v_ledger.response_payload ->> ''factsChecksum'' = v_facts_checksum%'
      ))
      or (function_key = 'notification_suppress_v2_private' and (
        definition not like '%job.status in (''pending'', ''claimed'')%'
        or definition not like '%delivery.status in (''pending'', ''claimed'', ''retry_wait'')%'
        or definition not like '%delivery.status = ''sending''%'
        or definition not like '%ownership.state = ''reserved''%'
        or definition not like '%ownership.state = ''dispatch_started''%'
        or definition not like '%stale_notification_suppressed%'
        or definition not like '%external_attempt_uncertainty_preserved%'
      ))
      or (function_key = 'manager_actor_private' and (
        definition not like '%from public.profiles actor%'
        or definition not like '%join auth.users account%'
        or definition not like '%account.deleted_at is null%'
        or definition not like '%account.banned_until <= pg_catalog.now()%'
        or definition not like '%actor.role in (''admin'', ''staff'')%'
      ))
      or (function_key = 'manager_actor_assert_private' and (
        definition not like '%dashboard_private.registration_actor_is_active_manager_v1%'
        or definition not like '%registration_access_denied%using errcode = ''42501''%'
      ))
      or (function_key = 'manager_replay_assert_private' and (
        definition not like '%v_task_type = ''registration''%'
        or definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
      ))
      or (function_key = 'manager_write_fence_private' and (
        definition not like '%v_actor uuid := (select auth.uid())%'
        or definition not like '%v_actor is null%'
        or definition not like '%tg_table_name = ''ops_tasks''%'
        or definition not like '%dashboard_private.registration_actor_is_active_manager_v1(v_actor)%'
        or definition not like '%registration_manager_write_access_denied%using errcode = ''42501''%'
      ))
      or (function_key = 'appointment_integrity_private' and (
        definition not like '%v_appointment.kind = ''level_test''%'
        or definition not like '%attempt.status in (''scheduled'', ''in_progress'')%'
        or definition not like '%v_appointment.kind not in (''level_test'', ''visit_consultation'')%'
        or definition not like '%consultation.mode = ''visit''%'
        or definition not like '%registration_invalid_source_state%using errcode = ''23514''%'
      ))
      or (function_key = 'appointment_integrity_track_private' and (
        definition not like '%new.pipeline_status is not distinct from old.pipeline_status%'
        or definition not like '%dashboard_private.assert_registration_appointment_integrity_v1%'
      ))
      or (function_key = 'archive_active_subject_private' and (
        definition not like '%appointment.id = p_appointment_id%'
        or definition not like '%track.task_id = p_task_id%'
        or pg_catalog.regexp_count(definition, 'track[.]archived_at is null') < 3
      ))
      or (function_key = 'appointment_details_private' and (
        definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
        or definition not like '%registration_appointment_revision_conflict%using errcode = ''23514''%'
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_appointments')
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_level_tests.*status = ''canceled''')
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_consultations.*status = ''canceled''')
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition like '%assert_registration_track_director_ready%'
        or definition like '%registration_appointment_participants_locked%'
        or definition like '%transition_registration_track_status%'
        or definition like '%recompute_registration_parent%'
        or definition like '%write_registration_track_event%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notificationTargets%'
        or definition like '%notificationJobs%'
      ))
      or (function_key = 'appointment_cancel_private' and (
        definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_appointments.*status = ''canceled''')
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_level_tests.*status = ''canceled''')
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_consultations.*status = ''canceled''')
        or definition not like '%registration_appointment_revision_conflict%using errcode = ''23514''%'
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
        or definition ~* ('in' || 'sert[[:space:]]+into[[:space:]]+public[.]ops_registration_consultations')
        or definition like '%transition_registration_track_status%'
        or definition like '%recompute_registration_parent%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notificationTargets%'
        or definition like '%notificationJobs%'
      ))
      or (function_key = 'appointment_cancel_compat_private' and (
        definition not like '%dashboard_private.cancel_registration_appointment_impl%'
        or definition like '%assert_registration_reminder_runtime_v1%'
        or definition like '%cancel_registration_appointment_reminders_v1%'
        or definition like '%notification_control_plane%'
      ))
      or (function_key = 'phone_consultation_private' and (
        definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
        or definition !~* ('in' || 'sert[[:space:]]+into[[:space:]]+public[.]ops_registration_consultations')
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition like '%assert_registration_track_director_ready%'
        or definition like '%write_registration_track_event%'
        or definition like '%recompute_registration_parent%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'waiting_details_private' and (
        definition not like '%waiting_detail_kind = v_waiting_kind%'
        or definition not like '%waiting_detail_class_id = p_class_id%'
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition like '%write_registration_track_event%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'consultation_details_private' and (
        definition not like '%note = v_note%'
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition like '%p_status <> ''completed'' and v_note is not null%'
        or definition like '%write_registration_track_event%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'consultation_result_public' and (
        definition not like '%status = ''completed''%'
        or definition not like '%outcome = v_outcome%'
        or definition not like '%note = v_note%'
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_subject_tracks')
        or definition like '%ops_registration_observations%'
        or definition like '%ops_registration_enrollments%'
        or definition like '%apply_student_class_roster_mode%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'director_assignment_private' and (
        definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
        or definition not like '%director_profile_id = p_director_profile_id%'
        or definition not like '%dashboard_private.is_active_subject_director%'
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_registration_(appointments|consultations|details)')
        or definition ~* ('up' || 'date[[:space:]]+public[.]ops_tasks')
        or definition like '%registration_director_assignment_terminal%'
        or definition like '%registration_visit_reassign_requires_reschedule%'
        or definition like '%recompute_registration_parent%'
        or definition like '%materialize_registration_phone_legacy_v1%'
        or definition like '%dashboard_notifications%'
        or definition like '%notification_%'
      ))
      or (function_key = 'director_assignment_compat_private' and (
        definition not like '%dashboard_private.assign_registration_track_director_impl%'
        or definition like '%assert_registration_reminder_runtime_v1%'
        or definition like '%notification_control_plane%'
        or definition like '%materialize_registration_appointment_reminders_v1%'
      ))
      or (function_key = 'enrollment_details_private' and (
        definition not like '%dashboard_private.save_registration_enrollment_rows_canonical_v1%'
        or definition not like '%enrollment_detail_rows = v_rows%'
        or definition not like '%externalReconciliationRequired%'
        or definition like '%write_registration_track_event%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%workflow_status%'
        or definition like '%pipeline_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'enrollment_details_base_private' and (
        definition not like '%dashboard_private.save_registration_enrollment_details_impl%'
      ))
      or (function_key = 'enrollment_rows_canonical_private' and (
        definition like '%registration_invalid_source_state%'
        or definition like '%assert_registration_observation_runtime_v1%'
        or definition like '%write_registration_track_event%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%notification_%'
      ))
      or (function_key = 'enrollment_observation_reference_private' and (
        definition like '%observation.status = ''completed''%'
        or definition like '%observation.attendance = ''attended''%'
        or definition like '%observation.suitability_result = ''fit''%'
        or definition like '%observation.decision_kind = ''enrollment''%'
      ))
      or (function_key = 'appointment_parent_reconcile_private' and (
        definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_appointments')
        or definition not like '%notification_revision = appointment.notification_revision + 1%'
        or definition like '%cancel_registration_appointment_reminders_v1%'
        or definition like '%notification_events%'
        or definition like '%notification_deliveries%'
        or definition like '%recompute_registration_parent%'
        or definition like '%pipeline_status%'
        or definition like '%workflow_status%'
      ))
      or (function_key = 'level_test_result_private' and (
        definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
        or definition !~* ('up' || 'date[[:space:]]+public[.]ops_registration_level_tests')
        or definition not like '%dashboard_private.record_registration_fact_audit_v1%'
        or definition not like '%dashboard_private.reconcile_registration_appointment_parent_v1%'
        or definition like '%write_registration_track_event%'
        or definition like '%cancel_registration_appointment_reminders_v1%'
        or definition like '%recompute_registration_parent%'
        or definition like '%transition_registration_track_status%'
        or definition like '%pipeline_status%'
        or definition like '%workflow_status%'
        or definition like '%notification_events%'
        or definition like '%notification_deliveries%'
      ))
      or (function_key = 'visit_event_v2_private' and (
        definition not like '%dashboard_private.write_registration_track_event_v2_base%'
      ))
      or (function_key = 'visit_event_v2_base_private' and (
        not (
          definition like '%registration_visit_notification_revision_mismatch%using errcode = ''23514''%'
          or (
            definition like '%dashboard_private.write_registration_track_event_payload_v3%'
            and pg_catalog.to_regprocedure(
              'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
            ) is not null
          )
        )
      ))
      or (function_key = 'visit_notification_snapshot_private' and (
        definition not like '%appointment.kind = ''visit_consultation''%'
        or definition not like '%consultation.status = ''scheduled''%'
        or definition not like '%track.archived_at is null%'
        or definition not like '%notificationRevision%'
        or definition not like '%recipientRevision%'
      ))
      or (function_key = 'visit_notification_source_current_private' and (
        definition not like '%dashboard_private.notification_events%'
        or definition not like '%registration_visit_notification_fact_snapshot_v1%'
        or definition not like '%source_revision%notificationRevision%'
        or definition not like '%recipient_revision%recipientRevision%'
        or definition not like '%track_ids%trackIds%'
        or definition not like '%director_profile_ids%directorProfileIds%'
      ))
      or (function_key = 'visit_notification_ensure_public' and (
        definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
        or definition not like '%p_intent is distinct from ''send_registration_visit_notification''%'
        or definition not like '%registration_visit_notification_not_ready%using errcode = ''23514''%'
        or definition not like '%notification_request_ledger%'
        or definition not like '%dashboard_private.registration_visit_notification_source_current_v1%'
        or definition not like '%dashboard_private.write_registration_track_event_v2%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%track.archived_at is null%'
        or definition like '%begin_registration_%external_attempt%'
        or definition like ('%net' || '.http_%')
        or definition ~* ('in' || 'sert[[:space:]]+into[[:space:]]+dashboard_private[.]notification_deliveries')
        or definition ~* ('in' || 'sert[[:space:]]+into[[:space:]]+public[.]ops_registration_customer_messages')
      ))
      or (function_key = 'visit_notification_plan_base_public' and (
        definition not like '%registration_visit_notification_event_not_found%'
        or definition not like '%dashboard_private.notification_events%'
      ))
      or (function_key = 'visit_notification_plan_public' and (
        definition not like '%v_actor_id uuid := (select auth.uid())%'
        or definition not like '%p_actor_profile_id is distinct from v_actor_id%'
        or definition not like '%registration_access_denied%using errcode = ''42501''%'
        or definition not like '%dashboard_private.assert_registration_actor_is_active_manager_v1%v_actor_id%'
        or definition not like '%dashboard_private.registration_visit_notification_source_current_v1%'
        or definition not like '%public.get_registration_visit_legacy_dispatch_plan_v1_base%'
        or definition not like '%registration_visit_notification_refresh_required%using errcode = ''23514''%'
      ))
      or (function_key = 'notification_record_private' and (
        definition not like '%track.archived_at is null%'
        or definition not like '%dashboard_private.record_notification_event_v1%'
        or definition not like '%''subjects'', pg_catalog.to_jsonb(v_subjects)%'
      ))
      or (function_key in (
        'feedback_submit_private', 'feedback_correct_private'
      ) and (
        definition not like '%registration_observation_feedback_retired%'
        or definition not like '%55000%'
      ))
      or (function_key = 'case_create_private' and (
        definition not like '%from public.profiles actor%'
        or definition not like '%join auth.users account%'
        or definition not like '%actor.role in (''admin'', ''staff'')%'
        or definition not like '%pg_catalog.pg_advisory_xact_lock%'
        or definition not like '%dashboard_private.ops_registration_mutations%'
        or definition not like '%registration_case_created%'
        or definition not like '%pg_catalog.cardinality(v_subjects) not between 0 and 3%'
        or definition not like '%coalesce(v_priority, ''normal'')%'
        or definition not like '%coalesce(''등록: '' || v_student_name, ''등록'')%'
        or definition not like '%create_case_with_initial_workflow_v1%'
        or definition not like '%''subjectPlans''%'
        or definition not like '%''levelTestAppointment''%'
        or definition not like '%''visitAppointment''%'
        or definition not like '%''directorOverrides''%'
        or definition like '%registration_student_name_required%'
        or definition like '%registration_school_grade_required%'
        or definition like '%registration_parent_phone_invalid%'
        or definition like '%registration_inquiry_at_required%'
        or definition like '%assert_registration_subject_enabled%'
        or definition like '%registration_science_grade_invalid%'
        or definition like '%recompute_registration_parent%'
        or definition like '%ops_registration_admission_batches%'
        or definition like '%ops_registration_messages%'
        or definition like '%ops_registration_enrollments%'
        or definition like '%ops_registration_appointments%'
        or definition like '%notification_%'
        or definition like '%reminder%'
        or definition like '%assert_registration_intake_runtime%'
      ))
      or (function_key = 'case_create_public' and (
        definition not like '%dashboard_private.create_registration_case_impl%'
        or definition like '%create_registration_case_with_reminders_v1_impl%'
        or definition like '%create_registration_case_with_initial_workflow_v1_impl%'
      ))
      or (function_key = 'case_create_legacy_public' and (
        definition not like '%dashboard_private.create_registration_case_impl%'
        or definition not like '%''appointments'', ''[]''::jsonb%'
        or definition not like '%''notificationTargets'', ''[]''::jsonb%'
        or definition not like '%''notificationJobs'', ''[]''::jsonb%'
        or definition like '%create_registration_case_with_reminders_v1_impl%'
        or definition like '%create_registration_case_with_initial_workflow_v1_impl%'
        or definition like '%assert_registration_intake_runtime%'
      ))
      or (function_key = 'collaboration_guard_private' and (
        definition not like '%actor.role in (''admin'', ''staff'')%'
        or definition not like '%registration_collaboration_write_access_denied%using errcode = ''42501''%'
        or definition not like '%v_actor is not null%'
        or definition not like '%task.type = ''registration''%'
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
  and pg_catalog.to_regprocedure(
    'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid)'
  ) is null
  and exists (
    select 1
    from pg_catalog.pg_class ledger
    where ledger.oid =
        'dashboard_private.notification_request_ledger'::pg_catalog.regclass
      and ledger.relkind = 'r'
      and ledger.relrowsecurity
      and pg_catalog.pg_get_userbyid(ledger.relowner) = 'postgres'
      and not exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            ledger.relacl,
            pg_catalog.acldefault('r', ledger.relowner)
          )
        ) acl
        where (
          case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)::text
          end
        ) in ('PUBLIC', 'anon', 'authenticated')
      )
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
        'dashboard_private.notification_request_ledger'::pg_catalog.regclass
      and attribute.attname = 'request_id'
      and attribute.atttypid = 'uuid'::pg_catalog.regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
        'dashboard_private.notification_request_ledger'::pg_catalog.regclass
      and constraint_row.conname = 'notification_request_ledger_pkey'
      and constraint_row.contype = 'p'
      and constraint_row.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'PRIMARY KEY (request_id)'
  )
  and not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and (
        relation.relname = 'ops_tasks'
        or pg_catalog.substr(relation.relname, 1, 17) = 'ops_registration_'
      )
      and not exists (
        select 1
        from pg_catalog.pg_trigger trigger
        where trigger.tgrelid = relation.oid
          and trigger.tgname = 'enforce_registration_manager_write_fence_v1'
          and trigger.tgfoid =
            'dashboard_private.enforce_registration_manager_write_fence_v1()'::pg_catalog.regprocedure
          and not trigger.tgisinternal
          and trigger.tgenabled = 'O'
          and trigger.tgtype = 31
      )
  )
  and exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
      and trigger.tgname = 'registration_appointment_integrity_on_track'
      and trigger.tgfoid =
        'dashboard_private.assert_registration_appointment_integrity_from_track_v1()'::pg_catalog.regprocedure
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 25
      and trigger.tgdeferrable
      and trigger.tginitdeferred
  )
  and not exists (
    select 1
    from (
      values
        (
          'registration_observation_google_chat_materializer'::name,
          'dashboard_private.registration_observation_domain_events'::pg_catalog.regclass
        ),
        (
          'registration_observation_google_chat_assignment_materializer'::name,
          'dashboard_private.notification_assignment_change_facts'::pg_catalog.regclass
        ),
        (
          'capture_lightweight_registration_booking_alerts'::name,
          'public.ops_registration_appointments'::pg_catalog.regclass
        ),
        (
          'write_registration_phone_queue_event_v1'::name,
          'public.ops_registration_consultations'::pg_catalog.regclass
        ),
        (
          'capture_registration_observation_teacher_change'::name,
          'public.ops_registration_observations'::pg_catalog.regclass
        ),
        (
          'capture_registration_director_change'::name,
          'public.ops_task_events'::pg_catalog.regclass
        )
    ) retired(trigger_name, relation_id)
    join pg_catalog.pg_trigger trigger
      on trigger.tgrelid = retired.relation_id
     and trigger.tgname = retired.trigger_name
     and not trigger.tgisinternal
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
        'public.ops_registration_consultations'::pg_catalog.regclass
      and attribute.attname = 'director_profile_id'
      and not attribute.attisdropped
      and not attribute.attnotnull
  )
  and pg_catalog.to_regprocedure(
    'dashboard_private.cancel_registration_archived_subject_delivery_v1()'
  ) is null
  and not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
      and trigger.tgname = 'cancel_registration_archived_subject_delivery'
      and not trigger.tgisinternal
  )
  and not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger.tgfoid
    where trigger.tgrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
      and not trigger.tgisinternal
      and pg_catalog.pg_get_functiondef(procedure.oid) ~*
        '(notification_deliveries|registration_customer_reminder_jobs|ops_registration_customer_messages|registration_customer_message_bundles)'
  )
  and not exists (
    select 1
    from (
      select
        expected.function_key,
        procedure.oid,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from (
        values
          (
            'bundle_collect',
            'dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid,text,text,date,timestamp with time zone)'::text
          ),
          (
            'bundle_materialize',
            'dashboard_private.materialize_registration_customer_message_bundle_v1(uuid,text,text,date,timestamp with time zone)'::text
          ),
          (
            'reminder_sync',
            'dashboard_private.sync_registration_customer_reminder_jobs_v1()'::text
          ),
          (
            'reminder_claim',
            'public.claim_registration_customer_reminder_job_v1()'::text
          ),
          (
            'reminder_begin',
            'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::text
          ),
          (
            'observation_prepare',
            'public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)'::text
          ),
          (
            'observation_chat_source',
            'dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)'::text
          ),
          (
            'customer_source',
            'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::text
          ),
          (
            'appointment_source',
            'dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text,uuid)'::text
          ),
          (
            'waiting_admission_source',
            'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'::text
          ),
          (
            'provider_marker',
            'public.mark_registration_customer_message_attempt_started_v1(uuid,uuid,uuid,jsonb)'::text
          )
      ) expected(function_key, signature)
      left join pg_catalog.pg_proc procedure
        on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    ) delivery_guard
    where delivery_guard.oid is null
      or (
        delivery_guard.function_key = 'bundle_collect'
        and pg_catalog.regexp_count(
          delivery_guard.definition,
          'track[.]archived_at is null'
        ) < 3
      )
      or (
        delivery_guard.function_key = 'bundle_materialize'
        and (
          delivery_guard.definition not like '%order by track.id%for share%'
          or delivery_guard.definition not like '%track.task_id = p_task_id%'
          or delivery_guard.definition not like '%track.archived_at is not null%'
          or delivery_guard.definition not like '%registration_customer_message_bundle_source_ineligible%'
        )
      )
      or (
        delivery_guard.function_key = 'reminder_sync'
        and (
          delivery_guard.definition not like '%return 0%'
          or delivery_guard.definition like
            '%dashboard_private.registration_customer_reminder_jobs%'
          or delivery_guard.definition like
            '%dashboard_private.registration_appointment_has_active_subject_v1%'
        )
      )
      or (
        delivery_guard.function_key = 'reminder_claim'
        and (
          delivery_guard.definition not like '%return null%'
          or delivery_guard.definition like
            '%dashboard_private.registration_customer_reminder_jobs%'
          or delivery_guard.definition like
            '%dashboard_private.resolve_registration_customer_message_source_v1_impl%'
        )
      )
      or (
        delivery_guard.function_key = 'reminder_begin'
        and (
          delivery_guard.definition not like
            '%dashboard_private.resolve_registration_customer_message_source_v1_impl%'
          or delivery_guard.definition not like
            '%dashboard_private.registration_appointment_has_active_subject_v1%'
          or delivery_guard.definition not like '%''subject_archived''%'
        )
      )
      or (
        delivery_guard.function_key = 'observation_prepare'
        and delivery_guard.definition not like
          '%track.archived_at is null%get_registration_observation_notification_source_impl_v1%'
      )
      or (
        delivery_guard.function_key in (
          'observation_chat_source',
          'customer_source'
        )
        and delivery_guard.definition not like '%track.archived_at is null%'
      )
      or (
        delivery_guard.function_key = 'appointment_source'
        and (
          delivery_guard.definition not like '%level_test.track_id%track.archived_at is null%'
          or delivery_guard.definition not like '%consultation.track_id%track.archived_at is null%'
        )
      )
      or (
        delivery_guard.function_key = 'waiting_admission_source'
        and (
          delivery_guard.definition not like '%track.id = p_source_id%track.archived_at is null%'
          or delivery_guard.definition not like '%pipeline_status in (%'
          or delivery_guard.definition not like '%ops_registration_enrollments%'
          or pg_catalog.regexp_count(
            delivery_guard.definition,
            'track[.]archived_at is null'
          ) < 5
        )
      )
      or (
        delivery_guard.function_key = 'provider_marker'
        and delivery_guard.definition not like
          '%dashboard_private.registration_customer_message_assert_current_v1%'
      )
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
        'public.ops_registration_customer_messages'::pg_catalog.regclass
      and constraint_row.conname =
        'ops_registration_customer_messages_dedupe_key_key'
      and constraint_row.contype = 'u'
      and constraint_row.convalidated
  )
  and pg_catalog.to_regclass(
    'public.ops_registration_customer_messages_dedupe_key_active_uidx'
  ) is null
  and (
    select pg_catalog.count(*) = 8
    from (
      values
        ('dashboard_private.registration_customer_message_booking_bundle_revision_idx'::text),
        ('dashboard_private.registration_customer_message_reminder_bundle_revision_idx'::text),
        ('public.ops_reg_customer_msg_appointment_revision_once_idx'::text),
        ('public.ops_reg_customer_msg_reminder_lifetime_once_idx'::text),
        ('public.ops_reg_customer_msg_waiting_once_idx'::text),
        ('public.ops_reg_customer_msg_admission_once_idx'::text),
        ('public.ops_reg_customer_msg_observation_revision_once_idx'::text),
        ('public.ops_reg_customer_msg_booking_bundle_once_idx'::text)
    ) expected(index_name)
    join pg_catalog.pg_class index_relation
      on index_relation.oid = pg_catalog.to_regclass(expected.index_name)
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    where index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and pg_catalog.lower(coalesce(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        ''
      )) not like '%subject_archived%'
      and pg_catalog.lower(coalesce(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        ''
      )) not like '%canceled%'
  )
  and (
    select pg_catalog.count(*) = 2
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
      and not attribute.attisdropped
      and not attribute.attnotnull
      and (
        (
          attribute.attname = 'archived_at'
          and attribute.atttypid =
            'timestamp with time zone'::pg_catalog.regtype
        )
        or (
          attribute.attname = 'archived_by'
          and attribute.atttypid = 'uuid'::pg_catalog.regtype
        )
      )
  )
  and (
    select pg_catalog.count(*) = 2
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
      and constraint_row.convalidated
      and (
        (
          constraint_row.conname =
            'ops_registration_subject_tracks_archived_by_fkey'
          and constraint_row.contype = 'f'
        )
        or (
          constraint_row.conname =
            'ops_registration_subject_tracks_archive_pair_check'
          and constraint_row.contype = 'c'
          and pg_catalog.pg_get_constraintdef(constraint_row.oid)
            like '%archived_at IS NULL%archived_by IS NULL%archived_at IS NOT NULL%archived_by IS NOT NULL%'
        )
      )
  )
  and exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'ops_registration_subject_tracks'
      and policy.policyname = 'ops_registration_subject_tracks_select_v2'
      and policy.roles = array['authenticated']::name[]
      and policy.cmd = 'SELECT'
      and policy.qual like '%archived_at IS NULL%'
      and policy.qual like '%can_read_ops_task_v1(task_id)%'
  )
  and exists (
    select 1
    from pg_catalog.pg_class view_relation
    where view_relation.oid =
        'public.ops_registration_subject_track_summaries'::pg_catalog.regclass
      and view_relation.relkind = 'v'
      and pg_catalog.pg_get_userbyid(view_relation.relowner) = 'postgres'
      and view_relation.reloptions @> array['security_invoker=true']::text[]
      and pg_catalog.pg_get_viewdef(view_relation.oid, true)
        ~* 'where[[:space:]]+[(]?track[.]archived_at[[:space:]]+is[[:space:]]+null'
  )
  and not exists (
    select 1
    from (
      select
        expected.signature,
        procedure.oid,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from (
        values
          ('dashboard_private.ops_task_page_source_v1(text,jsonb)'::text),
          ('dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::text)
      ) expected(signature)
      left join pg_catalog.pg_proc procedure
        on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    ) list_source
    where list_source.oid is null
      or list_source.definition !~* 'left[[:space:]]+join[[:space:]]+lateral[[:space:]]*[(]'
      or list_source.definition not like '%matching_track.matching_track_id is not null%'
      or list_source.definition not like '%p_filters ->> ''view'' = ''inquiry''%'
      or list_source.definition not like '%active_track.task_id = common.id%'
  )
  and exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
        'public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'
      )
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%dashboard_private.assert_registration_actor_is_active_manager_v1%'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%dashboard_private.registration_management_notification_source_current_v2%'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%public.get_registration_core_legacy_dispatch_plan_v1_base%'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%''items'', ''[]''::jsonb%'
  )
  and not exists (
    select 1
    from (
      select
        expected.function_key,
        procedure.oid,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from (
        values
          (
            'legacy_begin_final_gate',
            'public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'::text
          ),
          (
            'external_attempt_final_gate',
            'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::text
          )
      ) expected(function_key, signature)
      left join pg_catalog.pg_proc procedure
        on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    ) final_gate
    where final_gate.oid is null
      or final_gate.definition not like
        '%dashboard_private.registration_management_notification_source_current_v2%'
      or final_gate.definition not like
        '%registration_management_notification_snapshot_stale%'
      or (
        final_gate.function_key = 'legacy_begin_final_gate'
        and final_gate.definition not like '%''acquired'', false%'
      )
      or (
        final_gate.function_key = 'external_attempt_final_gate'
        and final_gate.definition not like '%v_reason := ''registration_management_notification_snapshot_stale''%'
      )
  )
  and not exists (
    select 1
    from (
      values
        ('dashboard_private.create_registration_case_with_reminders_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::text),
        ('dashboard_private.create_registration_case_with_initial_workflow_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::text)
    ) retired_create(signature)
    cross join (
      values
        ('public'::name),
        ('anon'::name),
        ('authenticated'::name),
        ('service_role'::name)
    ) denied_role(role_name)
    where pg_catalog.to_regprocedure(retired_create.signature) is null
      or pg_catalog.has_function_privilege(
        denied_role.role_name,
        pg_catalog.to_regprocedure(retired_create.signature),
        'EXECUTE'
      )
  )
  and (
    select pg_catalog.count(*) = 3
    from pg_catalog.pg_trigger trigger
    where trigger.tgname = 'enforce_registration_collaboration_write_role_v1'
      and trigger.tgrelid in (
        'public.ops_task_comments'::pg_catalog.regclass,
        'public.ops_task_attachments'::pg_catalog.regclass,
        'public.ops_task_events'::pg_catalog.regclass
      )
      and trigger.tgfoid =
        'dashboard_private.enforce_registration_collaboration_write_role_v1()'::pg_catalog.regprocedure
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 31
  )
  and (
    select pg_catalog.count(*) = 3
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and (
        (
          policy.tablename = 'ops_task_comments'
          and policy.policyname = 'ops_task_comments_write'
        )
        or (
          policy.tablename = 'ops_task_attachments'
          and policy.policyname = 'ops_task_attachments_write'
        )
        or (
          policy.tablename = 'ops_task_events'
          and policy.policyname = 'ops_task_events_write'
        )
      )
      and policy.roles = array['authenticated']::name[]
      and policy.cmd = ('IN' || 'SERT')
      and policy.with_check like
        '%registration_observation_current_actor_is_active_manager_v1%'
  )
  and exists (
    select 1
    from dashboard_private.registration_customer_reminder_settings settings
    where settings.singleton
      and not settings.enabled
  )
  and not exists (
    select 1
    from "cron".job job
    where job.jobname = 'tips-registration-customer-reminder-v1'
  )
  and not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid =
        'dashboard_private.registration_customer_reminder_settings'::pg_catalog.regclass
      and trigger.tgname = 'sync_registration_customer_reminder_cron_active'
      and not trigger.tgisinternal
  )
  and not exists (
    select 1
    from dashboard_private.registration_customer_reminder_jobs job
    where job.status in ('pending', 'claimed')
  )
  and not exists (
    select 1
    from (
      select
        expected.function_key,
        procedure.oid,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from (
        values
          (
            'reminder_materializer',
            'dashboard_private.materialize_registration_observation_solapi_events_v1(integer)'::text
          ),
          (
            'reminder_sync',
            'dashboard_private.sync_registration_customer_reminder_jobs_v1()'::text
          ),
          (
            'reminder_claim',
            'public.claim_registration_customer_reminder_job_v1()'::text
          ),
          (
            'reminder_backlog',
            'public.has_registration_customer_reminder_backlog_v1()'::text
          ),
          (
            'reminder_continue',
            'public.continue_registration_customer_reminder_worker_v1()'::text
          ),
          (
            'reminder_invoke',
            'dashboard_private.invoke_registration_customer_reminder_worker_v1()'::text
          ),
          (
            'reminder_schedule_ready',
            'dashboard_private.registration_customer_reminder_schedule_ready_v1()'::text
          ),
          (
            'reminder_schedule_manage',
            'public.manage_registration_customer_reminder_schedule_v1(text)'::text
          )
      ) expected(function_key, signature)
      left join pg_catalog.pg_proc procedure
        on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    ) automatic_reminder_fence
    where automatic_reminder_fence.oid is null
      or automatic_reminder_fence.definition like '%40001%'
      or automatic_reminder_fence.definition like ('%net' || '.http_%')
      or automatic_reminder_fence.definition ~* (
        '(in' || 'sert[[:space:]]+into|up' || 'date)[[:space:]]+'
        || '(dashboard_private[.]registration_customer_reminder_jobs|'
        || 'dashboard_private[.]registration_observation_solapi_event_consumptions|'
        || 'public[.]ops_registration_customer_messages)'
      )
      or (
        automatic_reminder_fence.function_key in (
          'reminder_materializer', 'reminder_sync'
        )
        and automatic_reminder_fence.definition not like '%return 0%'
      )
      or (
        automatic_reminder_fence.function_key in (
          'reminder_claim', 'reminder_continue', 'reminder_invoke'
        )
        and automatic_reminder_fence.definition not like '%return null%'
        and automatic_reminder_fence.definition not like '%select null::bigint%'
      )
      or (
        automatic_reminder_fence.function_key in (
          'reminder_backlog', 'reminder_schedule_ready'
        )
        and automatic_reminder_fence.definition not like '%false%'
      )
      or (
        automatic_reminder_fence.function_key = 'reminder_schedule_manage'
        and automatic_reminder_fence.definition not like
          '%registration_customer_reminder_schedule_retired%using errcode = ''55000''%'
      )
  )
  and not exists (
    select 1
    from (
      values
        ('dashboard_private.materialize_registration_observation_solapi_events_v1(integer)'::text, false),
        ('dashboard_private.sync_registration_customer_reminder_jobs_v1()'::text, false),
        ('dashboard_private.invoke_registration_customer_reminder_worker_v1()'::text, false),
        ('dashboard_private.registration_customer_reminder_schedule_ready_v1()'::text, false),
        ('public.claim_registration_customer_reminder_job_v1()'::text, true),
        ('public.has_registration_customer_reminder_backlog_v1()'::text, true),
        ('public.continue_registration_customer_reminder_worker_v1()'::text, true),
        ('public.manage_registration_customer_reminder_schedule_v1(text)'::text, true)
    ) expected(signature, service_role_execute_required)
    left join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    where procedure.oid is null
      or not procedure.prosecdef
      or pg_catalog.pg_get_userbyid(procedure.proowner) <> 'postgres'
      or pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) is distinct from expected.service_role_execute_required
  )
  and exists (
    select 1
    from dashboard_private.lightweight_registration_alert_runtime_settings settings
    where settings.singleton
      and not settings.enabled
  )
  and not exists (
    select 1
    from "cron".job job
    where job.jobname = 'tips-lightweight-registration-reminder-v1'
  )
  and not exists (
    select 1
    from dashboard_private.lightweight_registration_alert_deliveries delivery
    where delivery.status in ('pending', 'claimed')
  )
  and not exists (
    select 1
    from dashboard_private.registration_observation_chat_jobs job
    where job.status in ('pending', 'claimed')
  )
  and not exists (
    select 1
    from (
      select
        expected.function_key,
        expected.service_role_execute_required,
        procedure.oid,
        procedure.prosecdef,
        procedure.proowner,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from (
        values
          (
            'lightweight_enqueue_private',
            'dashboard_private.enqueue_lightweight_registration_alerts_v1(text,uuid,bigint,text,text)'::text,
            false
          ),
          (
            'lightweight_booking_public',
            'public.enqueue_lightweight_registration_booking_alerts_v1(text,uuid,bigint)'::text,
            true
          ),
          (
            'lightweight_due_public',
            'public.enqueue_due_lightweight_registration_reminders_v1()'::text,
            true
          ),
          (
            'lightweight_schedule_public',
            'public.manage_lightweight_registration_alert_schedule_v1(text)'::text,
            true
          ),
          (
            'automatic_settings_public',
            'public.set_registration_customer_reminder_settings_v1(uuid,boolean,smallint,bigint,jsonb)'::text,
            true
          )
      ) expected(function_key, signature, service_role_execute_required)
      left join pg_catalog.pg_proc procedure
        on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    ) lightweight_fence
    where lightweight_fence.oid is null
      or not lightweight_fence.prosecdef
      or pg_catalog.pg_get_userbyid(lightweight_fence.proowner) <> 'postgres'
      or lightweight_fence.definition like '%40001%'
      or lightweight_fence.definition like ('%net' || '.http_%')
      or pg_catalog.has_function_privilege('public', lightweight_fence.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', lightweight_fence.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', lightweight_fence.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'service_role', lightweight_fence.oid, 'EXECUTE'
      ) is distinct from lightweight_fence.service_role_execute_required
      or (
        lightweight_fence.function_key in (
          'lightweight_enqueue_private', 'lightweight_booking_public'
        )
        and lightweight_fence.definition not like '%0%'
      )
      or (
        lightweight_fence.function_key = 'lightweight_due_public'
        and lightweight_fence.definition not like '%''status'', ''explicit_only''%'
      )
      or (
        lightweight_fence.function_key = 'lightweight_schedule_public'
        and lightweight_fence.definition not like
          '%lightweight_registration_alert_schedule_retired%using errcode = ''55000''%'
      )
      or (
        lightweight_fence.function_key = 'automatic_settings_public'
        and (
          lightweight_fence.definition not like '%p_enabled is distinct from false%'
          or lightweight_fence.definition not like
            '%registration_customer_reminder_automatic_delivery_retired%using errcode = ''55000''%'
          or lightweight_fence.definition not like
            '%registration_customer_reminder_settings_conflict%using errcode = ''23514''%'
        )
      )
  )
  and not exists (
    select 1
    from (
      values
        (
          'public.claim_registration_observation_chat_jobs_v1(text,integer,integer)'::text,
          'return;'
        ),
        (
          'public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb)'::text,
          'registration_observation_chat_automatic_materialization_retired'
        )
    ) expected(signature, required_marker)
    left join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    where procedure.oid is null
      or not procedure.prosecdef
      or pg_catalog.pg_get_userbyid(procedure.proowner) <> 'postgres'
      or pg_catalog.pg_get_functiondef(procedure.oid) not like
        '%' || expected.required_marker || '%'
      or pg_catalog.pg_get_functiondef(procedure.oid) like '%40001%'
      or pg_catalog.pg_get_functiondef(procedure.oid) like
        '%dashboard_private.notification_events%'
      or pg_catalog.pg_get_functiondef(procedure.oid) like
        '%dashboard_private.registration_observation_chat_jobs%'
      or pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  )
  and not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
    )
      and (
        pg_catalog.pg_get_userbyid(procedure.proowner) <> 'postgres'
        or pg_catalog.pg_get_functiondef(procedure.oid) like '%40001%'
        or pg_catalog.pg_get_functiondef(procedure.oid) not like
          '%registration_visit_notification_revision_mismatch%using errcode = ''23514''%'
        or pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
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
  and (
    select pg_catalog.count(*) = 1
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_attribute status_attribute
      on status_attribute.attrelid = trigger.tgrelid
      and status_attribute.attname = 'status'
      and not status_attribute.attisdropped
    where trigger.tgrelid =
        'public.ops_registration_enrollments'::pg_catalog.regclass
      and trigger.tgname = 'create_registration_first_consultation_task_v1'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 17
      and pg_catalog.cardinality(trigger.tgattr::smallint[]) = 1
      and status_attribute.attnum = any(trigger.tgattr::smallint[])
      and trigger.tgqual is null
      and trigger.tgnargs = 0
      and trigger.tgfoid =
        'dashboard_private.create_registration_first_consultation_task_v1()'::pg_catalog.regprocedure
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
