# Draft only; not executed. PostgreSQL isolationtester source with seven explicit
# overlapping transaction permutations. It needs the final migration chain in
# an approved disposable synthetic database and an expected-output integration.
# Set test.registration_guard.approved_local_db=on only in that isolated runner.
# The cancellation/archive contenders below change synthetic fixture facts at
# the task/track/row lock boundary; they do not claim cancellation/archive UI proof.

setup
{
  BEGIN;
  RESET ROLE;
  SET timezone = 'Asia/Seoul';
  DO $$
  BEGIN
    IF current_user <> 'postgres'
      OR current_setting('test.registration_guard.approved_local_db', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'registration_guard_isolated_runner_required' USING ERRCODE = '42501';
    END IF;
  END;
  $$;
  CREATE SCHEMA registration_guard_race_fixture;
  CREATE FUNCTION registration_guard_race_fixture.sid(n integer)
  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('a9710000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
  $$;
  CREATE FUNCTION registration_guard_race_fixture.actor(p_active boolean, p_local boolean DEFAULT true)
  RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
  BEGIN
    PERFORM set_config('request.jwt.claim.sub',
      CASE WHEN p_active THEN registration_guard_race_fixture.sid(1)::text ELSE '' END, p_local);
    PERFORM set_config('request.jwt.claim.role', CASE WHEN p_active THEN 'authenticated' ELSE '' END, p_local);
    PERFORM set_config('request.jwt.claims', CASE WHEN p_active THEN jsonb_build_object(
      'sub', registration_guard_race_fixture.sid(1), 'role', 'authenticated')::text ELSE '{}' END, p_local);
    IF p_active THEN
      IF (SELECT auth.uid()) IS DISTINCT FROM registration_guard_race_fixture.sid(1)
        OR (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
        OR NOT dashboard_private.registration_actor_is_active_manager_v1((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'registration_guard_race_fixture_actor_invalid' USING ERRCODE = '42501';
      END IF;
    ELSIF (SELECT auth.uid()) IS NOT NULL OR (SELECT auth.role()) IS NOT NULL THEN
      RAISE EXCEPTION 'registration_guard_race_fixture_actor_not_cleared' USING ERRCODE = '42501';
    END IF;
  END;
  $$;
  REVOKE ALL ON FUNCTION registration_guard_race_fixture.actor(boolean,boolean) FROM PUBLIC;
  SELECT registration_guard_race_fixture.actor(false, false);
  CREATE FUNCTION registration_guard_race_fixture.rows()
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_array(jsonb_build_object(
      'classId', registration_guard_race_fixture.sid(21), 'textbookIds', jsonb_build_array(),
      'classStartDate', current_date + 7,
      'classStartSessionKey', to_char(current_date + 7, 'YYYY-MM-DD') || ':1',
      'classStartSession', '합성 입력 라벨', 'sortOrder', 0));
  $$;
  CREATE FUNCTION registration_guard_race_fixture.original_canceled_rows()
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_array(jsonb_build_object(
      'id', registration_guard_race_fixture.sid(604),
      'classId', registration_guard_race_fixture.sid(21),
      'textbookIds', jsonb_build_array(), 'classStartDate', null,
      'classStartSessionKey', null, 'classStartSession', null, 'sortOrder', 0));
  $$;
  CREATE TABLE registration_guard_race_fixture.results(
    worker text NOT NULL, case_number integer NOT NULL, result_sqlstate text NOT NULL,
    message text, response jsonb, PRIMARY KEY(worker, case_number)
  );
  CREATE TABLE registration_guard_race_fixture.baseline(counts jsonb NOT NULL);
  CREATE FUNCTION registration_guard_race_fixture.capture(
    p_case integer, p_track integer, p_key text,
    p_expected_rows jsonb DEFAULT jsonb_build_array(), p_action text DEFAULT 'save'
  )
  RETURNS void LANGUAGE plpgsql AS $$
  DECLARE
    v_state text := '00000';
    v_message text;
    v_response jsonb;
  BEGIN
    BEGIN
      IF p_action = 'status' THEN
        v_response := public.set_registration_workflow_status_v1(
          registration_guard_race_fixture.sid(p_track), 'waiting_new_class', 1, p_key);
      ELSIF p_action = 'director' THEN
        v_response := public.assign_registration_track_director(
          registration_guard_race_fixture.sid(p_track), null, null, null, 1, p_key);
      ELSE
        v_response := public.save_registration_enrollment_details_guarded_v2(
          registration_guard_race_fixture.sid(p_track), registration_guard_race_fixture.rows(),
          p_expected_rows, 1, p_key);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    END;
    INSERT INTO registration_guard_race_fixture.results(worker, case_number, result_sqlstate, message, response)
    VALUES(current_setting('application_name'), p_case, v_state, v_message, v_response);
  END;
  $$;
  GRANT USAGE ON SCHEMA registration_guard_race_fixture TO authenticated;
  GRANT SELECT, INSERT ON registration_guard_race_fixture.results TO authenticated;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA registration_guard_race_fixture TO authenticated;

  INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  VALUES(registration_guard_race_fixture.sid(1), 'authenticated', 'authenticated',
    'registration-guard-race@example.invalid', jsonb_build_object(), jsonb_build_object('fixture', true));
  INSERT INTO public.profiles(id, role, name, email)
  VALUES(registration_guard_race_fixture.sid(1), 'admin', '등록 저장 동시성 합성 운영자',
    'registration-guard-race@example.invalid')
  ON CONFLICT(id) DO UPDATE SET role = excluded.role, name = excluded.name, email = excluded.email;
  SELECT registration_guard_race_fixture.actor(true);
  INSERT INTO public.teacher_catalogs(id, name, subjects, is_visible, sort_order)
  VALUES(registration_guard_race_fixture.sid(31), '등록 저장 동시성 합성 교사', ARRAY['영어'], true, 9981);
  INSERT INTO public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
  VALUES(registration_guard_race_fixture.sid(32), '등록 저장 동시성 합성 강의실', ARRAY['영어'], true, 9982, '본관');
  INSERT INTO public.classes(id, name, subject, status, teacher, room, schedule, schedule_storage_mode, schedule_plan)
  VALUES(registration_guard_race_fixture.sid(21), '등록 저장 동시성 합성반', '영어', '수업 진행 중',
    '등록 저장 동시성 합성 교사', '등록 저장 동시성 합성 강의실',
    substr('일월화수목금토', extract(dow FROM current_date + 7)::integer + 1, 1) || ' 18:00-20:00', 'legacy',
    jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object(
      'date', current_date + 7, 'sessionNumber', 1, 'scheduleState', 'active',
      'sessionKey', to_char(current_date + 7, 'YYYY-MM-DD') || ':1',
      'startTime', '18:00', 'endTime', '20:00',
      'teacherCatalogId', registration_guard_race_fixture.sid(31),
      'classroomCatalogId', registration_guard_race_fixture.sid(32)))));
  INSERT INTO public.ops_tasks(id, title, type, status, requested_by, student_name, subject, campus, priority)
  SELECT registration_guard_race_fixture.sid(200 + n), '등록 저장 동시성 합성 ' || n,
    'registration', 'requested', registration_guard_race_fixture.sid(1),
    '등록 저장 동시성 합성 학생 ' || n, '영어', '본관', 'normal'
  FROM generate_series(1, 8) n;
  INSERT INTO public.ops_registration_details(task_id)
  SELECT registration_guard_race_fixture.sid(200 + n) FROM generate_series(1, 8) n;
  INSERT INTO public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status,
    migration_review_required, workflow_status, workflow_revision,
    director_profile_id, director_assignment_source, director_assigned_at)
  SELECT registration_guard_race_fixture.sid(300 + n), registration_guard_race_fixture.sid(200 + n),
    '영어', 'inquiry', false, 'consultation_requested', 1,
    CASE WHEN n = 8 THEN registration_guard_race_fixture.sid(1) ELSE null END,
    CASE WHEN n = 8 THEN 'manual' ELSE null END,
    CASE WHEN n = 8 THEN now() ELSE null END
  FROM generate_series(1, 8) n;
  INSERT INTO public.ops_registration_enrollments(id, track_id, class_id, status, sort_order)
  VALUES(registration_guard_race_fixture.sid(604), registration_guard_race_fixture.sid(304),
    registration_guard_race_fixture.sid(21), 'planned', 0);
  -- Commit only a fully valid seed graph; keep the manager until checks finish.
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO registration_guard_race_fixture.baseline
  SELECT jsonb_build_object(
    'events', (SELECT count(*) FROM dashboard_private.notification_events),
    'fanout', (SELECT count(*) FROM dashboard_private.notification_event_fanout_jobs),
    'deliveries', (SELECT count(*) FROM dashboard_private.notification_deliveries),
    'messages', (SELECT count(*) FROM public.ops_registration_customer_messages),
    'reminders', (SELECT count(*) FROM dashboard_private.registration_customer_reminder_jobs),
    'chat', (SELECT count(*) FROM dashboard_private.registration_observation_chat_jobs));

  CREATE FUNCTION registration_guard_race_fixture.assert_case(p_case integer)
  RETURNS void LANGUAGE plpgsql AS $$
  DECLARE
    v_successes integer;
    v_receipts integer;
    v_other registration_guard_race_fixture.results%rowtype;
    v_status text;
    v_revision integer;
    v_rows integer;
    v_track integer := CASE WHEN p_case = 6 THEN 306 WHEN p_case = 7 THEN 308 ELSE 300 + p_case END;
    v_current_counts jsonb;
  BEGIN
    SELECT count(*) FILTER (WHERE result_sqlstate = '00000') INTO v_successes
    FROM registration_guard_race_fixture.results WHERE case_number = p_case;
    IF (SELECT count(*) FROM registration_guard_race_fixture.results WHERE case_number = p_case) <> 2 THEN
      RAISE EXCEPTION 'race case % must record both completed workers', p_case;
    END IF;
    SELECT * INTO STRICT v_other FROM registration_guard_race_fixture.results
    WHERE worker = 'registration_guard_race_b' AND case_number = p_case;
    SELECT count(*) INTO v_receipts FROM dashboard_private.ops_registration_mutations
    WHERE actor_id = registration_guard_race_fixture.sid(1) AND request_key LIKE 'guard-race-' || p_case || '-%';
    SELECT workflow_status, workflow_revision INTO STRICT v_status, v_revision
    FROM public.ops_registration_subject_tracks WHERE id = registration_guard_race_fixture.sid(v_track);
    SELECT count(*) INTO v_rows FROM public.ops_registration_enrollments
    WHERE track_id = registration_guard_race_fixture.sid(v_track) AND status = 'planned';

    IF p_case IN (1, 3, 4) AND (v_other.result_sqlstate <> '23514'
      OR v_other.message <> 'registration_enrollment_details_refresh_required') THEN
      RAISE EXCEPTION 'race case % expected 23514 refresh; received % %', p_case, v_other.result_sqlstate, v_other.message;
    END IF;
    IF p_case = 1 AND (v_successes <> 1 OR v_receipts <> 1 OR v_rows <> 1
      OR v_status <> 'enrollment_requested' OR v_revision <> 2) THEN
      RAISE EXCEPTION 'same snapshot race must have one committed enrollment winner';
    END IF;
    IF p_case = 2 THEN
      IF v_successes <> 2 OR v_receipts <> 1 OR v_rows <> 1 OR v_revision <> 2
        OR v_status <> 'enrollment_requested'
        OR (SELECT count(DISTINCT response) FROM registration_guard_race_fixture.results WHERE case_number = 2) <> 1 THEN
        RAISE EXCEPTION 'same key race must replay one receipt and one identical committed response';
      END IF;
    END IF;
    IF p_case = 3 AND (v_successes <> 1 OR v_receipts <> 1 OR v_rows <> 0
      OR v_status <> 'waiting_new_class' OR v_revision <> 2) THEN
      RAISE EXCEPTION 'manual status winner must remain intact after a stale save';
    END IF;
    IF p_case = 4 AND (v_successes <> 1 OR v_receipts <> 0 OR v_rows <> 0
      OR v_status <> 'consultation_requested' OR v_revision <> 1
      OR NOT EXISTS(SELECT 1 FROM public.ops_registration_enrollments
        WHERE id = registration_guard_race_fixture.sid(604) AND status = 'canceled')) THEN
      RAISE EXCEPTION 'a save must not resurrect a concurrently canceled mutable row';
    END IF;
    IF p_case = 5 AND (v_successes <> 1 OR v_receipts <> 0 OR v_rows <> 0 OR v_revision <> 1
      OR v_other.result_sqlstate <> '42501' OR v_other.message <> 'registration_access_denied'
      OR NOT EXISTS(SELECT 1 FROM public.ops_registration_subject_tracks
        WHERE id = registration_guard_race_fixture.sid(305) AND archived_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'a save must be denied after concurrent archive commits';
    END IF;
    IF p_case = 6 AND (v_successes <> 1 OR v_receipts <> 1 OR v_rows <> 1 OR v_revision <> 2
      OR v_status <> 'enrollment_requested' OR v_other.result_sqlstate <> '22023'
      OR v_other.message <> 'registration_mutation_request_conflict'
      OR EXISTS(SELECT 1 FROM public.ops_registration_enrollments WHERE track_id = registration_guard_race_fixture.sid(307))
      OR NOT EXISTS(SELECT 1 FROM public.ops_registration_subject_tracks
        WHERE id = registration_guard_race_fixture.sid(307) AND workflow_status = 'consultation_requested' AND workflow_revision = 1)) THEN
      RAISE EXCEPTION 'one actor and key across tracks must commit one target and reject the other';
    END IF;
    IF p_case = 7 AND (v_successes <> 2 OR v_receipts <> 2 OR v_rows <> 1 OR v_revision <> 2
      OR v_status <> 'enrollment_requested' OR v_other.result_sqlstate <> '00000'
      OR NOT EXISTS(SELECT 1 FROM public.ops_registration_subject_tracks
        WHERE id = registration_guard_race_fixture.sid(308) AND director_profile_id IS NULL)
      OR (SELECT count(*) FROM public.ops_task_events
        WHERE task_id = registration_guard_race_fixture.sid(208)
          AND event_type = 'registration_fact_saved'
          AND after_value::jsonb ->> 'factType' = 'director_assignment') <> 1) THEN
      RAISE EXCEPTION 'director track lock and task audit FK must coexist with the guarded task lock';
    END IF;
    SELECT jsonb_build_object(
      'events', (SELECT count(*) FROM dashboard_private.notification_events),
      'fanout', (SELECT count(*) FROM dashboard_private.notification_event_fanout_jobs),
      'deliveries', (SELECT count(*) FROM dashboard_private.notification_deliveries),
      'messages', (SELECT count(*) FROM public.ops_registration_customer_messages),
      'reminders', (SELECT count(*) FROM dashboard_private.registration_customer_reminder_jobs),
      'chat', (SELECT count(*) FROM dashboard_private.registration_observation_chat_jobs)) INTO v_current_counts;
    IF v_current_counts IS DISTINCT FROM (SELECT counts FROM registration_guard_race_fixture.baseline) THEN
      RAISE EXCEPTION 'race case % violated the no-send boundary', p_case;
    END IF;
  END;
  $$;
  SELECT registration_guard_race_fixture.actor(false);
  COMMIT;
}

teardown
{
  BEGIN;
  RESET ROLE;
  SELECT registration_guard_race_fixture.actor(true);
  DELETE FROM public.ops_tasks
  WHERE id IN (SELECT registration_guard_race_fixture.sid(200 + n) FROM generate_series(1, 8) n);
  DELETE FROM public.classes WHERE id = registration_guard_race_fixture.sid(21);
  DELETE FROM public.teacher_catalogs WHERE id = registration_guard_race_fixture.sid(31);
  DELETE FROM public.classroom_catalogs WHERE id = registration_guard_race_fixture.sid(32);
  SET CONSTRAINTS ALL IMMEDIATE;
  -- Clear JWT before deleting the account referenced by it and audit triggers.
  SELECT registration_guard_race_fixture.actor(false);
  DELETE FROM public.profiles WHERE id = registration_guard_race_fixture.sid(1);
  DELETE FROM auth.users WHERE id = registration_guard_race_fixture.sid(1);
  DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM public.ops_tasks
        WHERE id IN (SELECT registration_guard_race_fixture.sid(200 + n) FROM generate_series(1, 8) n))
      OR EXISTS(SELECT 1 FROM public.ops_registration_enrollments WHERE class_id = registration_guard_race_fixture.sid(21))
      OR EXISTS(SELECT 1 FROM public.ops_registration_subject_tracks
        WHERE id IN (SELECT registration_guard_race_fixture.sid(300 + n) FROM generate_series(1, 8) n))
      OR EXISTS(SELECT 1 FROM public.ops_registration_details
        WHERE task_id IN (SELECT registration_guard_race_fixture.sid(200 + n) FROM generate_series(1, 8) n))
      OR EXISTS(SELECT 1 FROM dashboard_private.ops_registration_mutations WHERE actor_id = registration_guard_race_fixture.sid(1))
      OR EXISTS(SELECT 1 FROM public.classes WHERE id = registration_guard_race_fixture.sid(21))
      OR EXISTS(SELECT 1 FROM public.teacher_catalogs WHERE id = registration_guard_race_fixture.sid(31))
      OR EXISTS(SELECT 1 FROM public.classroom_catalogs WHERE id = registration_guard_race_fixture.sid(32))
      OR EXISTS(SELECT 1 FROM public.profiles WHERE id = registration_guard_race_fixture.sid(1))
      OR EXISTS(SELECT 1 FROM auth.users WHERE id = registration_guard_race_fixture.sid(1)) THEN
      RAISE EXCEPTION 'registration_guard_race_fixture_cleanup_incomplete' USING ERRCODE = '23514';
    END IF;
  END; $$;
  DROP SCHEMA registration_guard_race_fixture CASCADE;
  COMMIT;
}

session "a"
setup
{
  RESET ROLE;
  SELECT registration_guard_race_fixture.actor(false, false);
  SET timezone = 'Asia/Seoul';
  SET application_name = 'registration_guard_race_a';
}
teardown { ROLLBACK; RESET ROLE; SELECT registration_guard_race_fixture.actor(false, false); }
step "a_begin"
{
  BEGIN;
  SET LOCAL statement_timeout = '30s';
  SELECT registration_guard_race_fixture.actor(true);
  SET LOCAL ROLE authenticated;
  DO $$ BEGIN
    IF current_user <> 'authenticated' OR (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
      OR (SELECT auth.uid()) IS DISTINCT FROM registration_guard_race_fixture.sid(1) THEN
      RAISE EXCEPTION 'registration_guard_race_writer_context_invalid' USING ERRCODE = '42501';
    END IF;
  END; $$;
}
step "a_save_one" { SELECT registration_guard_race_fixture.capture(1, 301, 'guard-race-1-a'); }
step "a_save_replay" { SELECT registration_guard_race_fixture.capture(2, 302, 'guard-race-2-shared'); }
step "a_manual_status" { SELECT registration_guard_race_fixture.capture(3, 303, 'guard-race-3-status', jsonb_build_array(), 'status'); }
step "a_cancel_fixture"
{
  RESET ROLE;
  SELECT id FROM public.ops_tasks WHERE id = registration_guard_race_fixture.sid(204) FOR UPDATE;
  SELECT id FROM public.ops_registration_subject_tracks WHERE id = registration_guard_race_fixture.sid(304) FOR UPDATE;
  UPDATE public.ops_registration_enrollments SET status = 'canceled' WHERE id = registration_guard_race_fixture.sid(604);
  INSERT INTO registration_guard_race_fixture.results(worker, case_number, result_sqlstate)
  VALUES('registration_guard_race_a', 4, '00000');
}
step "a_archive_fixture"
{
  RESET ROLE;
  SELECT id FROM public.ops_tasks WHERE id = registration_guard_race_fixture.sid(205) FOR UPDATE;
  UPDATE public.ops_registration_subject_tracks SET archived_at = now(), archived_by = registration_guard_race_fixture.sid(1)
  WHERE id = registration_guard_race_fixture.sid(305);
  INSERT INTO registration_guard_race_fixture.results(worker, case_number, result_sqlstate)
  VALUES('registration_guard_race_a', 5, '00000');
}
step "a_save_cross_track" { SELECT registration_guard_race_fixture.capture(6, 306, 'guard-race-6-shared'); }
step "a_hold_director_track"
{
  RESET ROLE;
  SELECT id FROM public.ops_registration_subject_tracks WHERE id = registration_guard_race_fixture.sid(308) FOR UPDATE;
  SET LOCAL ROLE authenticated;
}
step "a_assign_after_guard_task" { SELECT registration_guard_race_fixture.capture(7, 308, 'guard-race-7-director', jsonb_build_array(), 'director'); }
step "a_commit" { COMMIT; }

session "b"
setup
{
  RESET ROLE;
  SELECT registration_guard_race_fixture.actor(false, false);
  SET timezone = 'Asia/Seoul';
  SET application_name = 'registration_guard_race_b';
}
teardown { ROLLBACK; RESET ROLE; SELECT registration_guard_race_fixture.actor(false, false); }
step "b_begin"
{
  BEGIN;
  SET LOCAL statement_timeout = '30s';
  SELECT registration_guard_race_fixture.actor(true);
  SET LOCAL ROLE authenticated;
  DO $$ BEGIN
    IF current_user <> 'authenticated' OR (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
      OR (SELECT auth.uid()) IS DISTINCT FROM registration_guard_race_fixture.sid(1) THEN
      RAISE EXCEPTION 'registration_guard_race_writer_context_invalid' USING ERRCODE = '42501';
    END IF;
  END; $$;
}
step "b_save_one" { SELECT registration_guard_race_fixture.capture(1, 301, 'guard-race-1-b'); }
step "b_save_replay" { SELECT registration_guard_race_fixture.capture(2, 302, 'guard-race-2-shared'); }
step "b_save_after_status" { SELECT registration_guard_race_fixture.capture(3, 303, 'guard-race-3-save'); }
step "b_save_after_cancel"
{
  SELECT registration_guard_race_fixture.capture(4, 304, 'guard-race-4-save', registration_guard_race_fixture.original_canceled_rows());
}
step "b_save_after_archive" { SELECT registration_guard_race_fixture.capture(5, 305, 'guard-race-5-save'); }
step "b_save_cross_track" { SELECT registration_guard_race_fixture.capture(6, 307, 'guard-race-6-shared'); }
step "b_save_after_director" { SELECT registration_guard_race_fixture.capture(7, 308, 'guard-race-7-save'); }
step "b_commit" { COMMIT; }

session "verify"
setup
{
  RESET ROLE;
  SELECT registration_guard_race_fixture.actor(false, false);
  SET timezone = 'Asia/Seoul';
  SET application_name = 'registration_guard_race_verify';
  DO $$ BEGIN
    IF current_user <> 'postgres' THEN
      RAISE EXCEPTION 'registration_guard_race_verifier_role_invalid' USING ERRCODE = '42501';
    END IF;
  END; $$;
}
teardown { RESET ROLE; SELECT registration_guard_race_fixture.actor(false, false); }
step "verify_one" { SELECT registration_guard_race_fixture.assert_case(1); }
step "verify_replay" { SELECT registration_guard_race_fixture.assert_case(2); }
step "verify_status" { SELECT registration_guard_race_fixture.assert_case(3); }
step "verify_cancel" { SELECT registration_guard_race_fixture.assert_case(4); }
step "verify_archive" { SELECT registration_guard_race_fixture.assert_case(5); }
step "verify_cross_track" { SELECT registration_guard_race_fixture.assert_case(6); }
step "verify_director_fk" { SELECT registration_guard_race_fixture.assert_case(7); }

# Each contender launches while A still holds the real transaction locks.
# isolationtester must observe B blocked before moving on to A's commit.
permutation "a_begin" "a_save_one" "b_begin" "b_save_one" "a_commit" "b_commit" "verify_one"
permutation "a_begin" "a_save_replay" "b_begin" "b_save_replay" "a_commit" "b_commit" "verify_replay"
permutation "a_begin" "a_manual_status" "b_begin" "b_save_after_status" "a_commit" "b_commit" "verify_status"
permutation "a_begin" "a_cancel_fixture" "b_begin" "b_save_after_cancel" "a_commit" "b_commit" "verify_cancel"
permutation "a_begin" "a_archive_fixture" "b_begin" "b_save_after_archive" "a_commit" "b_commit" "verify_archive"
permutation "a_begin" "a_save_cross_track" "b_begin" "b_save_cross_track" "a_commit" "b_commit" "verify_cross_track"

# A first holds the director's track lock. B takes the guarded task lock and
# waits for that track. A then calls the unchanged director RPC, inserting its
# task-linked audit while B still owns the task write lock. FOR UPDATE on B's
# task would conflict with A's FK KEY SHARE and create a cycle; NO KEY UPDATE
# lets A finish, after which B completes its enrollment save normally.
permutation "a_begin" "a_hold_director_track" "b_begin" "b_save_after_director" "a_assign_after_guard_task" "a_commit" "b_commit" "verify_director_fk"
