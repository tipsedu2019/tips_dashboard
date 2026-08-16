begin;

select plan(15);

select has_column(
  'public',
  'ops_registration_appointments',
  'schedule_confirmed_at',
  'appointment records when its current schedule was confirmed'
);

select has_function(
  'dashboard_private',
  'registration_appointment_reminder_due_v1',
  array['text', 'text', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone'],
  'KST appointment reminder eligibility helper exists'
);

select function_privs_are(
  'dashboard_private',
  'registration_appointment_reminder_due_v1',
  array['text', 'text', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone'],
  'authenticated',
  array[]::text[],
  'eligibility helper is not callable from the client role'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'scheduled',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  true,
  'an appointment confirmed before its KST date is due on that date'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'visit_consultation', 'scheduled',
    '2026-08-20 04:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'a same-day-created appointment is not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'visit_consultation', 'scheduled',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'an appointment changed after KST midnight is not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'scheduled',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-19 14:59:59+00', '2026-08-20 01:00:00+00'
  ),
  true,
  'an appointment changed before KST midnight remains due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'canceled',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'canceled appointments are not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'completed',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'completed appointments are not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'scheduled',
    '2026-08-19 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'past-date appointments are not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'level_test', 'scheduled',
    '2026-08-21 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'future-date appointments are not due'
);

select is(
  dashboard_private.registration_appointment_reminder_due_v1(
    'observation_class', 'scheduled',
    '2026-08-20 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-18 04:00:00+00', '2026-08-20 01:00:00+00'
  ),
  false,
  'observation appointments stay outside the appointment reminder rule'
);

select has_function(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'the bounded worker can query the remaining eligible backlog'
);

select function_privs_are(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'authenticated', array[]::text[],
  'the backlog check is not callable from the browser role'
);

select function_privs_are(
  'public', 'continue_registration_customer_reminder_worker_v1', array[]::text[],
  'service_role', array['EXECUTE'],
  'only server-side worker code can request a bounded continuation'
);

select * from finish();

rollback;
