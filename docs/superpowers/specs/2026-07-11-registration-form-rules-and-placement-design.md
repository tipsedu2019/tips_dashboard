# Registration Form Rules and Placement Design

**Date:** 2026-07-11

## Goal

Make the registration form match the academy's actual intake, placement, and admission sequence while reusing one deterministic academic-director rule in registration and makeup requests.

## Scope

- Remove the inquiry-channel field from registration UI, application code, and the `ops_registration_details` database schema.
- Require grade and inquiry date/time for new registrations.
- Replace native registration date/time inputs with the shared polished picker controls.
- Remove manual level-test completion/result and consultation-completion inputs without losing historical data.
- Select registration start date and session from the selected class schedule.
- Default the selected class's linked textbook while allowing an intentional no-textbook choice.
- Reorder and simplify the admission checklist.
- Apply one year-aware director-assignment rule to registration consultation ownership and makeup approval ownership.

## Data and Workflow Decisions

### Inquiry

`inquiry_channel` is removed completely. Application code must stop reading, writing, sorting, displaying, exporting, and templating it before the migration drops the column. The migration uses `drop column if exists` without `cascade`.

Grade and inquiry date/time are required at application validation and UI accessibility layers. Existing rows with missing values remain readable; the migration does not add `not null` constraints because existing data cannot be safely backfilled.

### Level test and consultation completion

The form no longer exposes `level_test_completed_at`, `level_test_result`, or `consultation_at` as editable inputs. These columns remain in the database so historical records and existing stage inference are not destroyed.

- Moving into the level-test-result stage stamps `level_test_completed_at` automatically when it is empty.
- New level-test completion requires `level_test_material_link` instead of free-text `level_test_result`.
- Moving into the consultation-result stage stamps `consultation_at` automatically when it is empty.
- Existing result text and completion timestamps remain read-only in historical details.
- Retest continues to clear the prior completion timestamp, result text, and material URL.

### Date and time controls

Registration date/time fields use a shared `DateTimePickerControl` composed from the existing `DatePickerControl` and `TimePickerControl`. The value contract stays compatible with existing local `YYYY-MM-DDTHH:mm` form values and ISO values returned by the service. The control is keyboard accessible, works inside dialogs, and preserves the established mobile popover behavior.

### Class schedule selection

Selecting a class exposes only selectable sessions from that class's `schedule_plan`. A session choice sets `class_start_date` and `class_start_session` together. Canceled, exception, and TBD sessions are not selectable. When no usable schedule exists, the form shows that the class schedule must be configured instead of accepting an arbitrary date or session.

The registration list remains lightweight. Full schedule data is loaded only for the selected class, so the prior registration loading optimization is preserved.

### Textbook default and deselection

When the registration class changes, the first valid linked textbook becomes the default. Changing to another class recalculates the default. After the user explicitly clears the textbook for the current class, the empty selection is preserved; this represents a student who already owns the book. A registration may complete without a textbook, and textbook-specific synchronization runs only when a textbook is selected.

### Admission sequence

The visible sequence is:

1. 입학신청서 발송
2. 메이크에듀 등록(수업·교재)
3. 청구서 발송
4. 수납 완료 확인
5. 등록 완료

`교재 준비`, `수업시간표 명단`, and `교재 청구출고표` are not shown as manual checklist items. Their existing database fields remain compatible with old records and background synchronization but do not block the new visible completion sequence. `등록 완료` is derived from the final registration pipeline state rather than introducing a duplicate boolean column.

## Academic Director Assignment

A shared pure module returns a normalized result with `resolved`, `ambiguous`, or `unsupported` status. It returns official names; each consumer resolves the name to its stable profile/catalog ID and blocks saving when the expected account link is missing.

### Mathematics

- Elementary and middle school: 강정은
- High school: 양소윤

### English

The 2026 base groups are:

- 초4, 중1, 고1: 강부희
- 초5, 중2, 고2: 정보영
- 초6, 중3, 고3: 김민경

The assignment rotates on a three-year cycle. In 2027 the groups map to 김민경, 강부희, 정보영 respectively; in 2028 they map to 정보영, 김민경, 강부희; 2029 repeats 2026.

The effective year is the inquiry date's Seoul-calendar year for registration and the request creation/submission year for makeup requests. Reopening an old record in a new year must not silently reassign it.

### Edge cases and overrides

- English grades 초1 through 초3 are unsupported and require manual selection.
- A simultaneous English and mathematics inquiry is ambiguous when the two subjects resolve to different directors and requires manual selection.
- Values without an exact grade number are not guessed.
- Registration supplies the resolved director as a default but preserves an explicit administrator override.
- Makeup requests use the same default; managers may make an explicit operational override, while non-manager submissions are validated against the computed rule.
- Late option loading may fill an empty automatic default but must not overwrite an existing saved or manually selected director.

## Migration and Rollout

1. Ship compatibility code that no longer references `inquiry_channel`.
2. Apply a generated Supabase migration with a short local lock timeout and `alter table ... drop column if exists inquiry_channel`.
3. Verify the column is absent and create/edit registration requests still save.

No remote migration or deployment is performed unless separately authorized.

## Verification

- Pure unit tests cover the three-year English matrix, mathematics divisions, ambiguous/unsupported cases, automatic timestamps, new completion blockers, checklist order, schedule filtering, and textbook deselection.
- Service/source-contract tests prove `inquiry_channel` is no longer read or written and schedule hydration remains selected-class-only.
- Focused registration and makeup suites run before the broader TypeScript, ESLint, and production build checks.
- Browser QA covers desktop and mobile registration dialogs, required labels, shared date/time picker, class schedule selection, textbook default/clear, director defaults, checklist order, and console health.
