# Registration Intake Routing Design

**Date:** 2026-07-13
**Status:** Approved direction, written-spec review pending

## Goal

Make the registration-add dialog fast to scan, allow the operator to choose the first subject-specific work without leaving the dialog, and persist that choice in the canonical subject-track model.

The change also fixes the create failure caused by an empty campus, removes the misleading editable phone-consultation reservation time, and keeps English and mathematics independent while still allowing one shared level-test or visit appointment.

## Existing Problems

1. A new form starts with an empty `campus`, but `create_registration_case` accepts only `본관` or `별관`. The dialog has no campus control, so saving can fail with the raw database code `registration_campus_invalid`.
2. Inquiry, level-test, consultation, placement, and admission fields are all visible at once. Most are irrelevant when the operator is entering the first inquiry.
3. The add dialog still edits legacy fields such as `phoneConsultationAt` and `visitConsultationAt`. In ready mode, `createRegistrationCase` does not persist those fields, so an operator can enter data that is silently discarded.
4. A phone consultation is a per-subject waiting item, not a scheduled appointment. An editable field named `전화상담 예약일시` misstates the workflow.
5. The current consultation layout uses one shared counselor field even though each subject track may have a different responsible director.

## Product Decisions

### 1. One inquiry, independent subject plans

The parent registration case stores the shared student and inquiry information once. Each selected subject receives one initial plan:

- `문의 유지`
- `레벨테스트`
- `바로 전화상담`
- `방문상담`

The operator can choose a different plan for English and mathematics. The default is `문의 유지`, so saving basic information never advances a track accidentally.

Two subjects choosing `레벨테스트` share one level-test appointment. Two subjects choosing `방문상담` may share one visit appointment. A subject not included in the visit remains on its own chosen path, including the phone queue.

The first release supports at most one shared level-test appointment and one shared visit appointment in the add dialog. Separate visit times are scheduled later from each subject track.

Changing a subject plan is an explicit data change, unlike merely collapsing a panel:

- When one of two participating subjects leaves an appointment plan, the appointment draft remains for the other subject.
- When the last participating subject leaves, the appointment date, time, and place draft are cleared and the panel closes.
- Returning to that plan starts with an empty appointment draft, preventing an old time from being submitted accidentally.

### 2. Progressive disclosure

`문의 정보` is always open. Immediately below it, a compact `과목별 다음 업무` control shows one row per selected subject.

- Choosing `레벨테스트` opens the level-test panel.
- Choosing `바로 전화상담` opens the consultation panel with a read-only phone-waiting summary.
- Choosing `방문상담` opens the consultation panel and enables visit date/time and room.
- Choosing `문의 유지` opens no downstream panel.

Level-test and consultation panels can also be collapsed manually. Collapsing changes visibility only; it never clears entered values or changes the selected plan. Removing a plan or its data requires an explicit action.

For an existing case, a panel opens automatically when the focused subject is at that stage or the panel already contains meaningful data. Validation navigation first opens a hidden panel and then moves focus to the invalid field.

Placement and admission do not appear in a new-inquiry dialog. They remain available only when an existing case reaches those stages.

### 3. Consultation layout and semantics

On desktop, the consultation panel is a two-column, two-row grid:

| Left | Right |
| --- | --- |
| 상담 책임자 | 전화상담 대기 기준일시 |
| 방문상담 예약일시 | 방문상담실 |

On mobile, the fields follow the same order vertically.

`상담 책임자` is subject-specific. When both subjects are selected, the control shows separate labeled values such as `영어 · 강부희` and `수학 · 강정은`. Existing annual director rules supply the defaults; the operator may use the existing subject-track override behavior where permitted.

`전화상담 대기 기준일시` is read-only and exists only for an active phone-waiting consultation:

- Direct consultation without a level test: the common inquiry time.
- Consultation after a completed level test: that subject attempt's server-recorded completion time.
- A visit appointment for that subject: no active phone-waiting timestamp is shown.
- Returning to the phone queue after a visit is canceled: the server re-entry time, because that is when phone work becomes actionable again.

The UI does not write the legacy `phoneConsultationAt` field in ready mode.

### 4. Campus behavior

New registration cases use `본관` as the internal default. The add dialog does not gain another field.

The canonical common-information editor uses a required `본관/별관` selector. A legacy case with a missing campus initially resolves to `본관`; an existing `별관` value is preserved. The database RPC remains strict, and historical migrations are not edited.

The legacy fallback is initially presentational. Saving the common-information editor persists the selected `본관` value through the canonical update RPC; the client does not perform a silent background write.

### 5. Inquiry time

The new-case dialog does not display an inquiry-time picker. Opening a fresh registration form captures the current time once, and submission supplies a current timestamp defensively if the form value is missing. Editing an existing case continues to preserve its saved inquiry time.

## Data Model

### Phone-consultation readiness

Add canonical readiness metadata to `ops_registration_consultations`:

- `ready_at timestamptz`
- `ready_source text` constrained to `inquiry`, `level_test_completion`, `visit_reopened`, `director_resolved`, `track_reopened`, `migration`, or `legacy`

Both fields are required for new `mode = 'phone'` rows and null for visit rows. A forward-only migration backfills active legacy phone rows from the best available canonical event or activity data. When the original source cannot be recovered, it uses `created_at` with source `legacy`.

All phone-row-creating server operations set the fields:

- initial direct-phone plan or inquiry routed directly to consultation: `ready_at = inquiry_at`, source `inquiry`
- level-test completion: `ready_at = completed_at`, source `level_test_completion`
- responsible director assigned after a track was already waiting: `ready_at = track.stage_entered_at`, source `director_resolved`
- visit cancellation or visit-appointment participation removal: `ready_at = now()`, source `visit_reopened`
- terminal track reopened to consultation waiting: `ready_at = now()`, source `track_reopened`
- migration review resolved to consultation waiting: recovered legacy phone time when available, otherwise `now()`, source `migration`

Phone queues sort by `ready_at`, then stable track ID. The displayed label and list order therefore use the same operational timestamp. Other stages continue to use `track.stage_entered_at`.

This replaces only the previous canonical-design sentence that ordered phone consultations by `stage_entered_at`. The implementation updates the canonical design reference, summary-query projection, service types, and `registration-track-list` comparator together so documentation, display, and ordering cannot diverge.

### Initial workflow input

The client submits one normalized initial-workflow plan with the common case data:

```text
subjects: [영어, 수학]
subjectPlans:
  영어: level_test
  수학: direct_phone
levelTestAppointment:
  scheduledAt
  place
  subjects: [영어]
visitAppointment: null
```

Appointment subject lists must exactly match the subjects whose plan requires that appointment. A visit plan requires a resolved responsible director, date/time, and room. A level-test plan requires date/time and place. Direct phone consultation requires a resolved responsible director but no editable time.

The server remains authoritative for director assignment. The client may send an optional subject-to-profile override map only when the operator explicitly changes a displayed default. The server otherwise resolves the existing annual rules at commit time and validates every override as an active, eligible principal profile.

## Atomic Create Flow

Add the idempotent public RPC `create_registration_case_with_initial_workflow_v1`. One request key covers the complete mutation.

Its contract is:

```text
create_registration_case_with_initial_workflow_v1(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
  p_request_key text
) returns jsonb
```

The response contains `taskId`, `commonRevision`, `subjects`, canonical `tracks`, created `appointments`, and post-commit `notificationTargets`. A private `security definer` implementation owns the mutation; the public wrapper is `security invoker`. Public and anonymous execution are revoked, and authenticated execution is granted, matching the existing mutation pattern.

Within one database transaction, the RPC:

1. Validates common fields, campus, subjects, subject plans, appointment membership, times, places, and director eligibility.
2. Creates the parent task and registration detail.
3. Creates one subject track per selected subject.
4. Applies the existing subject-and-grade director rules to every track so a completed level test can enter its consultation queue without a second common-data edit. Inquiry and level-test plans may remain assignment-required when no rule resolves; direct-phone and visit plans require a valid director before creation can commit.
5. Creates shared level-test and/or visit appointments with subject-specific child activities.
6. Creates direct phone-waiting consultations with canonical readiness metadata.
7. Writes subject-track events and recomputes the parent projection.
8. Returns the case, tracks, appointments, and post-commit notification targets.

If any step fails, no partial case, track, appointment, or consultation remains. An identical retry returns the first committed response; reusing the key with different input is rejected.

The existing plain `create_registration_case` remains available for call sites that intentionally create inquiry-only cases. The add dialog uses the new RPC when the intake-workflow capability is ready.

Visit-notification delivery remains post-commit. A notification failure does not retry the database mutation. The client keeps the returned target for the existing in-session retry flow and shows that the reservation was saved but its notification still needs attention.

## Client Components

The large add form receives focused helpers rather than more inline conditionals:

- an initial-plan normalizer and validator in the registration workflow module
- a `RegistrationInitialPlanControl` for subject-specific choices
- controlled collapsible level-test and consultation sections
- a read-only `PhoneConsultationReadyAt` presentation
- a canonical create-service wrapper for the atomic RPC

The form derives the visible panels from the selected subject plans. It does not derive business state from whether a panel happens to be open.

The existing date-time control remains constrained to 09:00 through 21:00 for operator-selected appointments. System-generated inquiry and phone-waiting timestamps are not constrained or edited by the picker.

The level-test panel in the add dialog contains only reservation date/time, place, and participating-subject summary. Result URLs belong to each subject attempt and appear only when that attempt is completed; they are never collected as part of initial scheduling.

The service maps `ready_at` and `ready_source` onto canonical consultation and track-list types. The consultation list exposes the active phone row's `readyAt`; it never falls back to the ignored legacy form field.

## Compatible Deployment

The forward-only database migration is an expand-and-switch migration executed as one transaction:

1. Add nullable readiness columns.
2. Replace every phone-consultation insertion path in the same migration: inquiry routing, delayed director assignment, visit cancellation, visit participation removal, level-test completion, migration-review resolution, and terminal-track reopen.
3. Backfill existing phone rows from canonical events or activity data, using `created_at` with source `legacy` only when necessary.
4. Add and validate a constraint requiring readiness values for phone rows and null readiness values for visit rows.
5. Create and grant the new atomic-create RPC.
6. Create `registration_intake_workflow_runtime_version() returns 1` as the final readiness marker.

The core `registration_subject_tracks_runtime_version()` stays at version 1 because the expanded schema remains compatible with the current client. This avoids making the existing deployed app enter maintenance mode during rollout.

The new client probes the intake capability independently. Before the capability exists, it hides the initial-plan control and uses the existing inquiry-only create path; it never displays inputs that would be discarded. Database expansion therefore deploys before the client without breaking the old app, and the new app also degrades safely if it reaches an older database.

The fixture dispatcher, runtime-probe tests, service wrapper, and source-contract tests implement the same named capability and RPC contract.

## Validation and Errors

Client validation prevents submission when:

- a selected subject has no valid plan
- a required appointment date/time or place is missing
- a visit plan has no room or responsible director
- appointment membership differs from the subject plans
- campus normalization does not resolve to `본관` or `별관`

The server repeats all business validation while holding the required locks. Known database error codes map to Korean operator messages. `registration_campus_invalid` becomes `캠퍼스 정보를 확인해 주세요.` Raw internal codes are not shown as the primary alert.

## Compatibility

Legacy timeline fields remain readable for migrated cases but are not written by the ready-mode add flow. Canonical track, appointment, level-test, and consultation tables are authoritative.

The parent compatibility projection continues to represent older consumers. Subject-specific state is never merged back into one global counselor, appointment, or result field.

## Test Strategy

### Unit and source-contract tests

- missing create campus becomes `본관`; existing `별관` remains unchanged
- each subject plan independently controls visible panels and normalized payload
- collapsing and reopening a panel preserves values
- validation opens a collapsed panel before focusing its field
- consultation DOM order is counselor, phone readiness, visit time, visit room
- visit selection removes that subject from the active phone presentation
- phone readiness is never created merely by opening a panel

### Service and database tests

- inquiry-only, level-test-only, direct-phone-only, and visit-only creation
- mixed English level-test plus mathematics phone
- shared two-subject level test and shared two-subject visit
- invalid appointment membership and missing director roll back the entire create
- idempotent retry and mismatched-key reuse
- readiness source and timestamp for inquiry, test completion, and visit reopen
- visit creation cancels only the selected subject's active phone row
- every phone-row creation path supplies valid readiness metadata
- no partial parent or track survives an induced child-insert failure

### Browser verification

Run the local fixture/runtime surface and verify:

1. A basic inquiry saves without a campus error.
2. The dialog initially shows only inquiry information and subject-plan controls.
3. Choosing level test opens only its fields; choosing visit opens consultation fields.
4. English and mathematics can take different initial paths.
5. A shared two-subject appointment appears once with two subject badges.
6. Direct phone consultation shows a read-only waiting timestamp, not a picker.
7. Setting a visit removes the active phone-waiting display for that subject only.
8. Reopening the dialog and loading the case shows the persisted canonical state.

No production test record is created during verification without explicit authorization.

## Out of Scope

- Multiple separate visit appointments during initial creation
- Redesigning later waiting, enrollment, admission, or payment stages
- Changing the established annual director-assignment rules
- Deleting legacy columns before migration compatibility is retired

## Implementation Slices and Completion Conditions

1. **Schema and RPC:** the forward migration, capability probe, all phone-row creation paths, atomic create RPC, schema tests, and SQL transaction tests pass. The old client contract remains valid against the expanded schema.
2. **Client and fixture:** the conditional form, director preview/override, readiness display, service types, list ordering, fixture actions, and focused component tests pass. No downstream value is written to a legacy ready-mode field.
3. **End-to-end verification:** focused tests, full test suite, lint, production build, and local fixture browser scenarios pass. Any unrelated pre-existing failure is recorded separately, and no production record is created without authorization.
